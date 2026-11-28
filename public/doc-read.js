/* © 2026 Voklogik LLC. All rights reserved. Proprietary and confidential. Voklogik™, Topaz™ and Opal™ are trademarks of Voklogik LLC. */
/* Voklogik document reader (pay stubs and bank statements).
   Loaded only when someone taps an upload button. Everything runs in the browser:
   the file is read from memory, text is pulled out with pdf.js, a few numbers are
   picked from it, and then the file and its text are dropped. Nothing is uploaded,
   stored or logged. We never look for names, addresses, SSNs or account numbers.
   Every number is shown for the person to check before it reaches the form. */

var MAX_BYTES = 15 * 1024 * 1024, MAX_PAGES = 8, TAX_PAGES = 60;
var pdfP = null;
function loadPdf() {
  if (!pdfP) pdfP = import("/pdfjs/pdf.mjs").then(function (m) {
    m.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.mjs";
    return m;
  }).catch(function (e) { pdfP = null; throw e; });
  return pdfP;
}

/* ---------- reading the file ---------- */
function fail(code, msg) { var e = new Error(msg); e.code = code; return e; }

async function readPages(file, limit) {
  if (!file) throw fail("none", "No file.");
  if (file.size > MAX_BYTES) throw fail("big", "That file is over 15 MB.");
  var buf = await file.arrayBuffer();
  var head = new Uint8Array(buf.slice(0, 5)), sig = String.fromCharCode.apply(null, head);
  if (sig.indexOf("%PDF") !== 0) throw fail("type", "That does not look like a PDF.");
  var pdfjs = await loadPdf(), doc;
  try {
    // isEvalSupported off: no code generation from PDF content
    doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, enableXfa: false, useSystemFonts: false }).promise;
  } catch (e) {
    if (e && e.name === "PasswordException") throw fail("password", "This PDF is password protected.");
    throw fail("bad", "This PDF could not be opened.");
  }
  var pages = [], chars = 0, n = Math.min(doc.numPages, limit || MAX_PAGES);
  for (var p = 1; p <= n; p++) {
    var page = await doc.getPage(p), tc = await page.getTextContent(), rows = [], items = [];
    tc.items.forEach(function (it) {
      if (!it.str || !it.str.trim()) return;
      var y = it.transform[5], x = it.transform[4], r = null;
      items.push({ x: x, y: y, s: it.str.trim() });
      for (var i = 0; i < rows.length; i++) if (Math.abs(rows[i].y - y) <= 2.5) { r = rows[i]; break; }
      if (!r) { r = { y: y, it: [] }; rows.push(r); }
      r.it.push({ x: x, s: it.str, r: x + (it.width || 0) });
    });
    rows.sort(function (a, b) { return b.y - a.y; });
    var lines = [];
    rows.forEach(function (r) {
      r.it.sort(function (a, b) { return a.x - b.x; });
      var s = r.it.map(function (t) { return t.s.trim(); }).join(" ").replace(/\s+/g, " ").trim();
      if (s) { lines.push(s); chars += s.length; }
    });
    pages.push({ lines: lines, items: items, rows: rows.map(function (r) { return r.it.map(function (t) { return { x: t.x, s: t.s.trim(), r: t.r }; }).filter(function (t) { return t.s; }); }), w: (page.view && page.view[2]) || 612 });
    page.cleanup();
  }
  try { doc.destroy(); } catch (e) {}
  if (chars < 60) throw fail("scan", "This looks like a scan or a photo.");
  return pages;
}
async function readLines(file) {
  var pg = await readPages(file), out = [];
  pg.forEach(function (p) { out = out.concat(p.lines); });
  return out;
}

/* ---------- small helpers ---------- */
var MONEY = /\(?-?\$?\d{1,3}(?:,\d{3})+\.\d{2}\)?|\(?-?\$?\d+\.\d{2}\)?/g;
function nums(s) {
  var out = [], m;
  MONEY.lastIndex = 0;
  while ((m = MONEY.exec(s))) {
    var neg = /^\(|^-/.test(m[0]) || /-$/.test(m[0]);
    var v = parseFloat(m[0].replace(/[^0-9.]/g, ""));
    if (isFinite(v)) out.push({ v: neg ? -v : v, i: m.index });
  }
  return out;
}
function plain(s) { // numbers that may lack cents (hours, rates)
  var out = [], re = /\d[\d,]*\.?\d*/g, m;
  while ((m = re.exec(s))) { var v = parseFloat(m[0].replace(/,/g, "")); if (isFinite(v)) out.push(v); }
  return out;
}
function usd(n) { return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function round2(n) { return Math.round(n * 100) / 100; }
function parseDate(s) {
  var m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (m) { var y = +m[3]; if (y < 100) y += 2000; return new Date(y, +m[1] - 1, +m[2]); }
  var MN = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  m = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
  if (m) { var k = MN.indexOf(m[1].slice(0, 3).toLowerCase()); if (k >= 0) return new Date(+m[3], k, +m[2]); }
  return null;
}
var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dshort(d) { return MON[d.getMonth()] + " " + d.getDate(); }
function triple(list, tol) { // find rate x hours = amount among the first numbers of a line
  for (var a = 0; a < list.length; a++) for (var b = 0; b < list.length; b++) for (var c = 0; c < list.length; c++) {
    if (a === b || b === c || a === c) continue;
    var x = list[a], y = list[b], z = list[c];
    if (x > 0 && y > 0 && z > 0 && Math.abs(x * y - z) <= Math.max(0.02, z * (tol || 0.005))) return { rate: x, hours: y, amt: z };
  }
  return null;
}

/* ---------- pay stub ---------- */
function normFreq(s) {
  s = s.toLowerCase().replace(/[\s\-]/g, "");
  if (/^semimonthly|^twicemonthly|^twiceamonth/.test(s)) return "semimonthly";
  if (/^biweekly|^everyotherweek|^every2weeks/.test(s)) return "biweekly";
  if (/^weekly/.test(s)) return "weekly";
  if (/^monthly/.test(s)) return "monthly";
  if (/^annual|^yearly/.test(s)) return "annual";
  return null;
}
function parsePay(lines) {
  var T = lines.join("\n"), freq = null, m;
  m = /pay\s*(?:frequency|cycle|schedule|period\s*type)\s*[:\-]?\s*(semi-?\s?monthly|bi-?\s?weekly|twice\s+(?:a\s+)?monthly|weekly|monthly|annual(?:ly)?)/i.exec(T);
  if (m) freq = normFreq(m[1]);
  // pay period dates
  var pe = null, ps = null;
  m = /(?:pay\s*period|period)[^\n\d]{0,25}(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:-|–|to|through|thru)\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(T);
  if (!m) m = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:-|–|to|through|thru)\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/.exec(T);
  if (m) { ps = parseDate(m[1]); pe = parseDate(m[2]); }
  if (!freq && ps && pe) {
    var days = Math.round((pe - ps) / 86400000) + 1;
    if (days >= 5 && days <= 8) freq = "weekly";
    else if (days >= 12 && days <= 15) freq = "biweekly";
    else if (days >= 14 && days <= 17 && (ps.getDate() === 1 || ps.getDate() === 16)) freq = "semimonthly";
    else if (days >= 27 && days <= 31) freq = "monthly";
  }
  if (!freq) {
    var low = T.toLowerCase();
    if (/semi[-\s]?monthly|twice\s+(a\s+)?month/.test(low)) freq = "semimonthly";
    else if (/bi[-\s]?weekly|every\s+(other|2|two)\s+weeks?/.test(low)) freq = "biweekly";
    else if (/\bweekly\b/.test(low)) freq = "weekly";
    else if (/\bmonthly\b/.test(low)) freq = "monthly";
  }
  // gross pay (current period) and year to date
  var gross = null, ytd = null, i, l, n;
  var GL = /^(?:total\s+)?(?:gross\s*(?:pay|earnings|wages|income)?|earnings\s+total|total\s+(?:earnings|wages|pay))\b/i;
  for (i = 0; i < lines.length && gross === null; i++) {
    l = lines[i];
    if (!GL.test(l) || /net\b/i.test(l.slice(0, 20))) continue;
    n = nums(l);
    if (n.length >= 2) { gross = Math.min(n[0].v, n[1].v); ytd = Math.max(n[0].v, n[1].v); }
    else if (n.length === 1) { if (/ytd|year/i.test(l)) ytd = n[0].v; else gross = n[0].v; }
  }
  if (gross === null) for (i = 0; i < lines.length && gross === null; i++) { // pick up a lone "current" figure after a YTD-only match
    l = lines[i];
    if (/gross/i.test(l) && !/ytd|year/i.test(l)) { n = nums(l); if (n.length) gross = n[0].v; }
  }
  // rate and hours from a regular earnings line
  var rate = null, hours = null;
  for (i = 0; i < lines.length; i++) {
    l = lines[i];
    if (!/^(regular|reg\b|hourly|salary|base|wages|straight)/i.test(l)) continue;
    var t = triple(plain(l.replace(/^[A-Za-z .\/\-]+/, "")).slice(0, 6));
    if (t) { rate = t.rate; hours = t.hours; if (gross === null) gross = t.amt; break; }
  }
  // overtime / bonus lines (not counted as base income)
  var extra = 0, extraNames = {};
  lines.forEach(function (ln) {
    var mm = /^(overtime|over\s*time|ot\b|bonus|commission|incentive|retro)/i.exec(ln);
    if (!mm) return;
    var rest = ln.replace(/^[A-Za-z .\/\-]+/, ""), t2 = triple(plain(rest).slice(0, 6)), val = null, nn = nums(ln);
    if (t2) val = t2.amt; else if (nn.length >= 2) val = Math.min(nn[0].v, nn[1].v); else if (nn.length === 1) val = nn[0].v;
    if (val && val > 0) { extra += val; extraNames[mm[1].toLowerCase().replace(/\s+/g, "")] = 1; }
  });
  if (gross === null) return null;
  var base = gross;
  if (extra > 0 && extra < gross) base = round2(gross - extra);
  return { freq: freq, gross: gross, base: base, extra: round2(extra), rate: rate, hours: hours, ytd: ytd, periodEnd: pe, periodStart: ps };
}
var FREQ_LABEL = { annual: "Annually", monthly: "Monthly", semimonthly: "Semi-monthly (twice a month)", biweekly: "Every two weeks", weekly: "Weekly" };
var FREQ_MULT = { annual: 1 / 12, monthly: 1, semimonthly: 2, biweekly: 26 / 12, weekly: 52 / 12 };
var FREQ_TXT = { annual: "/ 12", monthly: "x 1", semimonthly: "x 2", biweekly: "x 26 / 12", weekly: "x 52 / 12" };

/* ---------- bank statement ---------- */
function typeGuess(lines, idx) {
  for (var k = idx; k >= Math.max(0, idx - 40); k--) {
    var s = lines[k].toLowerCase();
    if (/^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s/.test(s)) continue; // a transaction line, such as "Transfer to Savings", is not an account heading
    if (/money\s*market|certificate of deposit|\bcd\b/.test(s)) return "mmkt";
    if (/savings/.test(s)) return "savings";
    if (/checking|everyday|complete chk|total checking/.test(s)) return "checking";
  }
  return "checking";
}
function parseStmt(lines, threshold) {
  var period = null, m, T = lines.join("\n");
  m = /([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})\s*(?:-|–|to|through|thru)\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})/.exec(T);
  if (!m) m = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:-|–|to|through|thru)\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/.exec(T);
  if (m) { var a = parseDate(m[1]), b = parseDate(m[2]); if (a && b && b >= a) period = { start: a, end: b }; }
  var accts = [], seen = {}, DATE0 = /^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s/;
  lines.forEach(function (l, i) {
    if (!/(ending|closing)\s+balance/i.test(l) || /daily|beginning|opening|previous/i.test(l) || DATE0.test(l)) return;
    var n = nums(l); if (!n.length) return;
    var v = n[n.length - 1].v; if (v < 0) return;
    var k = typeGuess(lines, i) + "|" + v; if (seen[k]) return; seen[k] = 1;
    if (accts.length < 4) accts.push({ type: typeGuess(lines, i), balance: v });
  });
  var deps = [];
  if (threshold) lines.forEach(function (l, li) {
    if (!DATE0.test(l)) return;
    if (!/deposit|transfer\s+from|zelle|wire|incoming|venmo|cash\s*app|credit\s+from/i.test(l)) return;
    if (/payroll|direct\s*dep|dir\s*dep|salary|interest|dividend|refund|reversal/i.test(l)) return;
    var n = nums(l); if (!n.length) return;
    var amt = n[0].v; if (amt >= threshold) deps.push({ date: l.split(" ")[0], amt: amt, type: typeGuess(lines, li) });
  });
  return { period: period, accounts: accts, deposits: deps };
}

// Statements that print two accounts side by side (checking on the left, savings on the right) merge into one line per row.
// Rows made of two label groups are split, and each side is read down its own column, so every account keeps its own heading.
function stmtLines(pg) {
  var rows = pg.rows || [], w = pg.w || 612, cut = w * 0.5, out = [], run = [];
  var LAB = /balance|interest|deposit|withdraw|checking|savings|money\s*market|acct|account/i, MON = /^[+\-(]?\$?[\d,]+\.\d\d\)?$/;
  function txt(a) { return a.map(function (t) { return t.s; }).join(" ").replace(/\s+/g, " ").trim(); }
  function flush() {
    if (!run.length) return;
    run.forEach(function (r) { out.push(txt(r.l)); });
    run.forEach(function (r) { out.push(txt(r.r)); });
    run = [];
  }
  rows.forEach(function (row) {
    var L = row.filter(function (t) { return t.x < cut; }), R = row.filter(function (t) { return t.x >= cut; });
    var twin = L.length && R.length && !MON.test(R[0].s) && !MON.test(L[0].s) && LAB.test(txt(L)) && LAB.test(txt(R));
    if (twin) { run.push({ l: L, r: R }); return; }
    flush();
    var s = txt(row); if (s) out.push(s);
  });
  flush();
  return out;
}
async function readStmtLines(file) {
  var pg = await readPages(file), out = [];
  pg.forEach(function (p) { out = out.concat(stmtLines(p)); });
  return out;
}

/* ---------- screen ---------- */
function h(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function row(label, sub, ctl) {
  var r = h("div", "dr-row"), d = h("div"); d.appendChild(h("span", "", label));
  if (sub) d.appendChild(h("small", "", sub));
  r.appendChild(d); r.appendChild(ctl); return r;
}
function field(val) { var i = h("input", "dr-in"); i.type = "text"; i.inputMode = "decimal"; i.value = val; return i; }
function sel(opts, val) {
  var s = h("select", "dr-in");
  opts.forEach(function (o) { var op = h("option", "", o[1]); op.value = o[0]; s.appendChild(op); });
  if (val != null) s.value = val; return s;
}
function toNum(s) { var v = parseFloat(String(s).replace(/[^0-9.]/g, "")); return isFinite(v) ? v : 0; }
function msg(out, text, kind) {
  out.textContent = ""; var d = h("div", "dr-msg" + (kind === "ok" ? " ok" : ""), text); d.setAttribute("role", "status"); out.appendChild(d);
}
function errText(e, what) {
  var c = e && e.code;
  if (c === "password") return "This PDF is password protected. Remove the password or type your numbers in.";
  if (c === "scan") return "This looks like a scan or a photo. We can only read PDFs downloaded from your " + what + ". Please type your numbers in.";
  if (c === "big") return "That file is over 15 MB. Please type your numbers in.";
  if (c === "type") return "That does not look like a PDF. Please choose a PDF file, or type your numbers in.";
  return "We could not open that file. Please type your numbers in.";
}
function panel(out, title) {
  out.textContent = "";
  var p = h("div", "dr-panel"); p.appendChild(h("h5", "", title));
  p.appendChild(h("div", "dr-warn", "Highlighted fields were read from your file and may be wrong. Change anything that does not match."));
  out.appendChild(p); return p;
}
function foot(p, summary, onUse, out, canUse) {
  var f = h("div", "dr-foot"), s = h("b", "", summary); f.appendChild(s); f.appendChild(h("span", "dr-sp"));
  var c = h("button", "dr-btn ghost", "Cancel"); c.type = "button"; c.onclick = function () { out.textContent = ""; };
  var u = h("button", "dr-btn", "Use these numbers"); u.type = "button"; u.onclick = function () { onUse(); };
  f.appendChild(c); f.appendChild(u); p.appendChild(f);
  return { summary: s, use: u };
}

async function runPay(file, out, api) {
  msg(out, "Reading your pay stub on this device...");
  var lines;
  try { lines = await readLines(file); } catch (e) { msg(out, errText(e, "payroll provider")); return; }
  var r = parsePay(lines); lines = null;
  if (!r) { msg(out, "We could not find the gross pay on this file. Please type it in."); return; }
  var p = panel(out, "We found these on your pay stub. Check each one.");
  var fSel = sel([["", "Choose..."]].concat(Object.keys(FREQ_LABEL).map(function (k) { return [k, FREQ_LABEL[k]]; })), r.freq || "");
  var fAmt = field(r.base.toFixed(2)), fRate = field(r.rate ? r.rate.toFixed(2) : ""), fHrs = field(r.hours ? String(r.hours) : "");
  [fSel, fAmt, fRate, fHrs].forEach(function (x) { x.classList.add("dr-found"); });
  p.appendChild(row("Pay frequency", r.freq ? "" : "We could not tell. Please choose.", fSel));
  p.appendChild(row("Gross pay this period", r.extra ? "Overtime and bonus of " + usd(r.extra) + " taken out" : "", fAmt));
  if (r.rate || r.hours) {
    p.appendChild(row("Hourly rate", "for reference, not used", fRate));
    p.appendChild(row("Hours this period", "for reference, not used", fHrs));
  }
  if (r.ytd) { var y = h("div", "dr-ro", usd(r.ytd)); p.appendChild(row("Year-to-date gross", "a check only, not income", y)); }
  if (r.extra) p.appendChild(row("Overtime / bonus found", "not counted: it needs a 2-year average", h("div", "dr-ro", usd(r.extra))));
  var chk = h("div", "dr-note"); chk.hidden = true; p.appendChild(chk);
  function calc() {
    var amt = toNum(fAmt.value), k = fSel.value, mo = k ? amt * FREQ_MULT[k] : 0;
    ft.summary.textContent = k && amt ? "Monthly: " + usd(mo) + "   (" + usd(amt) + " " + FREQ_TXT[k] + ")" : "Choose how often you are paid.";
    ft.use.disabled = !(k && amt > 0);
    // cross-check with year to date
    chk.hidden = true;
    if (r.ytd && r.periodEnd && mo > 0) {
      var pe = r.periodEnd, dim = new Date(pe.getFullYear(), pe.getMonth() + 1, 0).getDate(), months = pe.getMonth() + pe.getDate() / dim;
      if (months >= 1.5) {
        var ytdMo = r.ytd / months;
        chk.textContent = "Year-to-date suggests about " + usd(ytdMo) + " a month" + (r.extra ? " including overtime and bonus" : "") + ". If that is far from the figure above, check your pay frequency.";
        chk.hidden = false;
      }
    }
  }
  var ft = foot(p, "", function () {
    api.applyPay({ amount: round2(toNum(fAmt.value)), freq: fSel.value });
    msg(out, "Added to your income. You can still change it above.", "ok");
  }, out);
  [fSel, fAmt].forEach(function (x) { x.addEventListener("input", calc); x.addEventListener("change", calc); });
  calc();
}

async function runBank(files, out, api, keep) {  // keep: what the person already changed, when the panel is rebuilt after income changes
  msg(out, "Reading your statements on this device...");
  var inc = api.income(), threshold = inc > 0 ? inc * 0.5 : 0, parsed = [], bad = null, stLines = [];
  for (var i = 0; i < Math.min(files.length, 3); i++) {
    try { var SL = await readStmtLines(files[i]); parsed.push(parseStmt(SL, threshold)); stLines.push(SL); } catch (e) { bad = bad || e; }
  }
  var ok = parsed.filter(function (x) { return x.accounts.length; });
  if (!ok.length && !bad && stLines.some(function (L) { return parseRetire(L); })) { return runRetire(files, out, api); }
  if (!ok.length) { msg(out, bad ? errText(bad, "bank") : "We could not find an ending balance on this file. Please type it in."); return; }
  ok.sort(function (a, b) { return (a.period ? +a.period.end : 0) - (b.period ? +b.period.end : 0); });
  var latest = ok[ok.length - 1], p = panel(out, "We found " + latest.accounts.length + (latest.accounts.length === 1 ? " account" : " accounts") + " on " + ok.length + (ok.length === 1 ? " statement" : " statements") + ". Check each one.");
  var TYPES = [["checking", "Checking"], ["savings", "Savings"], ["mmkt", "Money market / CD"], ["other", "Other"]], rowsA = [];
  latest.accounts.forEach(function (a, idx) {
    var inc2 = h("input"); inc2.type = "checkbox"; inc2.checked = true; inc2.setAttribute("aria-label", "Include this account");
    var t = sel(TYPES, a.type), b = field(a.balance.toFixed(2)); t.classList.add("dr-found"); b.classList.add("dr-found");
    var box = h("div", "dr-acct"); var top = h("label", "dr-inc"); top.appendChild(inc2); top.appendChild(h("span", "", "Account " + (idx + 1) + (latest.period ? ", ending balance " + dshort(latest.period.end) : "")));
    box.appendChild(top); box.appendChild(row("Account type", "", t)); box.appendChild(row("Ending balance", "", b)); p.appendChild(box);
    rowsA.push({ inc: inc2, t: t, b: b });
  });
  // re-reading after income was added: keep what the person already changed
  if (keep && keep.a.length === rowsA.length) rowsA.forEach(function (r, i) { r.inc.checked = keep.a[i].inc; r.t.value = keep.a[i].t; r.b.value = keep.a[i].b; });
  var months = {}; ok.forEach(function (x) { if (x.period) months[x.period.end.getFullYear() + "-" + x.period.end.getMonth()] = 1; });
  var nm = Object.keys(months).length, rd = ok.map(function (x) { return x.period ? dshort(x.period.start) + " to " + dshort(x.period.end) : "dates not found"; }).join(", ");
  p.appendChild(row("Statements read", rd, h("div", "dr-ro" + (nm >= 2 ? " good" : ""), nm >= 2 ? nm + " months covered" : "Lenders usually want 2 months")));
  var deps = [], dseen = {}; ok.forEach(function (x) { x.deposits.forEach(function (d) { var k = d.date + "|" + d.amt; if (!dseen[k] && deps.length < 8) { dseen[k] = 1; deps.push(d); } }); });
  var LDS = [["tbv", "To be verified"], ["ver", "Can document"], ["exc", "Exclude from assets"]], rowsD = [];
  if (!threshold) {
    var n0 = h("div", "dr-note", "Add your income first and we can also look for large deposits."); p.appendChild(n0);
  } else if (deps.length) {
    p.appendChild(h("div", "dr-note", 'We found deposits over half of your monthly income. "Do you have any large deposits?" will be set to Yes. Choose what to do with each one. Your lender will ask where the money came from.'));
    deps.forEach(function (d) {
      var s2 = sel(LDS, "tbv"); s2.classList.add("dr-found"); s2.setAttribute("aria-label", "What to do with this deposit");
      var sa = h("select"), gi = 0; sa.setAttribute("aria-label", "Account the deposit went into"); sa.classList.add("dr-found");
      latest.accounts.forEach(function (a, ai) { var o = h("option", "", "Into account " + (ai + 1)); o.value = ai; sa.appendChild(o); });
      for (var q = latest.accounts.length - 1; q >= 0; q--) if (latest.accounts[q].type === d.type) gi = q;
      sa.value = gi;
      var two = h("div", "dr-two"); two.appendChild(sa); two.appendChild(s2);
      var kd = keep && keep.d[d.date + "|" + d.amt]; if (kd) { s2.value = kd.s; sa.value = kd.a; }
      p.appendChild(row("Large deposit: " + usd(d.amt), "Deposit on " + d.date, two)); rowsD.push({ d: d, s: s2, a: sa });
    });
  } else {
    p.appendChild(h("div", "dr-note", "We did not spot any large deposits, but this check can miss some. Review your statements yourself."));
  }
  var ft;
  // Income can be added after the statements: when it changes and stays changed, read them again so large deposits are checked against the new figure.
  var shownFor = inc, cand = null, candAt = 0, watch = setInterval(function () {
    if (!p.isConnected) { clearInterval(watch); return; }
    var cur = api.income();
    if (cur === shownFor) { cand = null; return; }
    if (cur !== cand) { cand = cur; candAt = Date.now(); return; }
    if (Date.now() - candAt < 1200) return;
    clearInterval(watch);
    var kd = {}; rowsD.forEach(function (r) { kd[r.d.date + "|" + r.d.amt] = { s: r.s.value, a: r.a.value }; });
    runBank(files, out, api, { a: rowsA.map(function (r) { return { inc: r.inc.checked, t: r.t.value, b: r.b.value }; }), d: kd });
  }, 500);
  function calc() {
    var tot = 0; rowsA.forEach(function (r) { if (r.inc.checked) tot += toNum(r.b.value); });
    var exm = {}, ex = 0; rowsD.forEach(function (r) { if (r.s.value === "exc") exm[r.a.value] = (exm[r.a.value] || 0) + r.d.amt; });
    Object.keys(exm).forEach(function (k) { var ra = rowsA[+k]; if (ra && ra.inc.checked) ex += Math.min(exm[k], Math.max(0, toNum(ra.b.value))); });
    ft.summary.textContent = "Added to assets: " + usd(tot - ex) + (ex > 0 ? " (after deducting " + usd(ex) + ")" : ""); ft.use.disabled = !(tot > 0);
  }
  ft = foot(p, "", function () {
    var list = [], amap = {}; rowsA.forEach(function (r, ri) { if (r.inc.checked && toNum(r.b.value) > 0) amap[ri] = Object.keys(amap).length; });
    rowsA.forEach(function (r) { if (r.inc.checked && toNum(r.b.value) > 0) list.push({ type: r.t.value, amount: round2(toNum(r.b.value)) }); });
    api.applyAssets(list, rowsD.length > 0, rowsD.map(function (r) { var k = amap[+r.a.value]; return { date: r.d.date, amt: r.d.amt, st: r.s.value, acct: k == null ? null : k }; }));
    // Keep checking large deposits against whatever income is on the page, after this panel is gone too.
    var depsFor = function (th) {
      var seen = {}, res = [];
      stLines.forEach(function (L) { var x; try { x = parseStmt(L, th); } catch (e) { return; } if (!x.accounts.length) return; x.deposits.forEach(function (d) { var k = d.date + "|" + d.amt; if (!seen[k] && res.length < 8) { seen[k] = 1; res.push(d); } }); });
      return res;
    };
    if (window.vkBankWatch) clearInterval(window.vkBankWatch);
    var owned = {}, lastInc = api.income(), cand = null, candAt = 0;
    rowsD.forEach(function (r) { owned[r.d.date + "|" + r.d.amt] = 1; });
    msg(out, "Added to your assets. You can still change it above. " + (lastInc > 0 ? "Large deposits are checked against your current income, and again whenever it changes." : "Large deposits will be checked as soon as income is entered, and again whenever it changes."), "ok");
    window.vkBankWatch = setInterval(function () {
      var cur = api.income();
      if (cur === lastInc) { cand = null; return; }
      if (cur !== cand) { cand = cur; candAt = Date.now(); return; }
      if (Date.now() - candAt < 1200) return;
      lastInc = cur; cand = null;
      var found = cur > 0 ? depsFor(cur * 0.5) : [];
      if (api.syncDeposits) api.syncDeposits(found, owned);
      if (out.isConnected) msg(out, "Added to your assets. You can still change it above. " + (found.length ? "Checked against your current income: large deposits found. Review them under Total Assets." : "Checked against your current income: no large deposits found."), "ok");
    }, 700);
  }, out);
  rowsA.forEach(function (r) { r.inc.addEventListener("change", calc); r.b.addEventListener("input", calc); });
  rowsD.forEach(function (r) { r.s.addEventListener("change", calc); });
  calc();
}


/* ---------- tax returns (Schedule C, 1120-S, 1065, 1120 and their K-1s) ---------- */
// Amount at the end of a form line: "13 Depreciation ... . . . 13 8,200".
// Returns {st:"amt",v} | {st:"blank"} (the box number is there but nothing in it) | {st:"none"} (no box number seen on this row).
function trailAmount(line, lineNo) {
  var t = line.split(/\s+/), vals = [], no = String(lineNo).toLowerCase();
  for (var i = t.length - 1; i >= 0; i--) {
    if (!/^(\(?-?\$?\d[\d,]*(?:\.\d+)?\)?-?|\d+[a-c])$/i.test(t[i])) break;
    vals.unshift(t[i]);
  }
  if (!vals.length) return { st: "none" };
  var last = vals[vals.length - 1].toLowerCase(), pen = vals.length > 1 ? vals[vals.length - 2].toLowerCase() : "";
  if (last === no) return { st: "blank" };
  if (pen === no) { var v = moneyOf(vals[vals.length - 1]); return v === null ? { st: "none" } : { st: "amt", v: v }; }
  // Some forms and preparer printouts show the amount without repeating the line number in a box: "31 Net profit or (loss) ... $129,600.00".
  if (new RegExp("^" + no + "[a-c]?\\.?\\s", "i").test(line.trim()) && /^\(?-?\$[\d,]+(?:\.\d\d)?\)?$|^\(?-?\d[\d,]*\.\d\d\)?$/.test(vals[vals.length - 1])) { var v2 = moneyOf(vals[vals.length - 1]); if (v2 !== null) return { st: "amt", v: v2 }; }
  return { st: "none" };
}
function sum() { var t = 0; for (var i = 0; i < arguments.length; i++) { if (arguments[i] === null || arguments[i] === undefined) return null; t += arguments[i]; } return t; }
function moneyOf(tok) {
  var neg = /^\(/.test(tok) || /^-/.test(tok) || /-$/.test(tok);
  var v = parseFloat(String(tok).replace(/[^0-9.]/g, ""));
  return isFinite(v) ? (neg ? -v : v) : null;
}
function rowText(row, w, frac) {
  return row.filter(function (t) { return !frac || t.x < w * frac; }).map(function (t) { return t.s; }).join(" ").replace(/\s+/g, " ").trim();
}
// Find the line whose label matches re, then its amount on that row or on one of the next 3 rows (long labels wrap).
// frac limits a two-column form (Schedule C expenses) to the left part of the page.
function lineVal(pg, re, lineNo, frac) {
  var r = lineVal1(pg, re, lineNo, frac);
  // A one-column printout puts the amount in the right half of the page: look again across the whole row.
  if (r.found && r.v === null && frac) { var r2 = lineVal1(pg, re, lineNo, 0); if (r2.v !== null) return r2; }
  return r;
}
function lineVal1(pg, re, lineNo, frac) {
  var rows = pg.rows || [];
  for (var i = 0; i < rows.length; i++) {
    if (!re.test(rowText(rows[i], pg.w, frac))) continue;
    for (var k = i; k < Math.min(rows.length, i + 4); k++) {
      var r = trailAmount(rowText(rows[k], pg.w, frac), lineNo);
      if (r.st === "amt") return { found: true, v: r.v };
      if (r.st === "blank") return { found: true, v: 0 };
    }
    return { found: true, v: null };   // label found but the amount could not be located: leave it for the person to fill in
  }
  return { found: false, v: 0 };
}
// Schedule E, Part I: one amount per rental property (columns A, B, C), matched to its column by position.
var SE_MONEY = /^\(?-?\$?\d[\d,]*(?:\.\d+)?\)?-?$/;
function seRowAmts(row, lineNo) {
  var v = [];
  for (var i = row.length - 1; i >= 0; i--) { if (!SE_MONEY.test(row[i].s)) break; v.unshift(row[i]); }
  var boxed = false;
  if (v.length && v[0].s === String(lineNo) && (v.length > 1 || row.length > 1)) { boxed = true; v.shift(); }
  return { boxed: boxed, items: v.map(function (t) { return { r: t.r != null ? t.r : t.x, v: moneyOf(t.s) }; }).filter(function (t) { return t.v !== null; }) };
}
function seLineItems(pg, re, lineNo) {
  var rows = pg.rows || [];
  for (var i = 0; i < rows.length; i++) {
    if (!re.test(rowText(rows[i], pg.w, 0))) continue;
    for (var k = i; k < Math.min(rows.length, i + 3); k++) {
      var r = seRowAmts(rows[k], lineNo);
      if (k === i && (r.items.length || r.boxed)) return { found: true, items: r.items };
      if (k > i) { if (r.boxed || r.items.length) return { found: true, items: r.items }; break; }
    }
    return { found: true, items: [] };
  }
  return { found: false, items: [] };
}
function seAddrs(L) {
  var out = [];
  for (var i = 0; i < L.length; i++) {
    if (!/physical address of each property/i.test(L[i])) continue;
    for (var k = i + 1; k < Math.min(L.length, i + 10); k++) {
      var t = L[k].trim();
      if (/^(1b|2|3)\b/.test(t) && !/^[ABC]\b/.test(t)) break;
      if (/type of property|fair rental days/i.test(t)) break;
      var m = /^([ABC])[\s:.)\-]+(\S.*)$/.exec(t);
      if (m && !/^\d{1,3}(?:\s+\d{1,3})?$/.test(m[2]) && /[A-Za-z]/.test(m[2])) out.push({ L: m[1], addr: m[2].replace(/\s+/g, " ").trim() });
    }
    break;
  }
  return out;
}
function seDays(L) {
  var days = [];
  for (var i = 0; i < L.length; i++) {
    if (!/fair rental days/i.test(L[i])) continue;
    for (var k = i; k < Math.min(L.length, i + 6); k++) { var m = /^\s*([ABC])\s+(\d{1,3})(?:\s+(\d{1,3}))?\s*$/.exec(L[k]); if (m) days.push({ L: m[1], d: +m[2] }); }
    if (days.length) break;
  }
  return days;
}
function parseSchedE(pg) {
  var L = pg.lines, defs = [["rents", /^3\b.*rents received/i, 3], ["ins", /^9\b.*insurance/i, 9], ["int", /^12\b.*mortgage interest/i, 12], ["tax", /^16\b.*taxes/i, 16], ["dep", /^18\b.*depreciation/i, 18], ["exp", /^20\b.*total expenses/i, 20]];
  var got = {}, rights = [];
  defs.forEach(function (d) { var r = seLineItems(pg, d[1], d[2]); got[d[0]] = r; r.items.forEach(function (t) { rights.push(t.r); }); });
  rights.sort(function (a, b) { return a - b; });
  var cl = [];
  rights.forEach(function (x) { if (cl.length && x - cl[cl.length - 1].hi < 20) { cl[cl.length - 1].hi = x; cl[cl.length - 1].n++; } else cl.push({ lo: x, hi: x, n: 1 }); });
  var cols = cl.length <= 3 ? cl.map(function (c) { return (c.lo + c.hi) / 2; }) : null;
  var addrs = seAddrs(L), days = seDays(L), nP = Math.max(cols ? cols.length : 0, addrs.length, days.length);
  var props = [];
  for (var p = 0; p < Math.min(nP, 3); p++) {
    var o = { L: "ABC"[p], addr: "", days: null, rents: null, ins: null, int: null, tax: null, dep: null, exp: null };
    var ad = addrs.filter(function (a) { return a.L === o.L; })[0]; if (ad) o.addr = ad.addr; else if (addrs.length === nP && addrs[p]) o.addr = addrs[p].addr;
    var dy = days.filter(function (a) { return a.L === o.L; })[0]; if (dy) o.days = dy.d;
    defs.forEach(function (d) {
      var items = got[d[0]].items, val = null;
      if (cols) { var best = null; items.forEach(function (t) { var dist = Math.abs(t.r - cols[p]); if (dist < 30 && (best === null || dist < best.dist)) best = { dist: dist, v: t.v }; }); if (best) val = best.v; }
      else if (items[p]) val = items[p].v;
      if (val === null && got[d[0]].found) val = 0;
      o[d[0]] = val;
    });
    if (o.addr || o.rents || o.exp) props.push(o);
  }
  return props;
}
function taxYear(lines) {
  for (var i = 0; i < Math.min(lines.length, 18); i++) {
    var m = /(?:^|[^\d-])(20[12]\d)(?:$|[^\d-])/.exec(lines[i]);
    if (m) return +m[1];
  }
  return null;
}
function nearBelow(items, label, dx0, dx1, dy) { // numeric item below a label, in the same box
  var best = null;
  items.forEach(function (it) {
    if (!/^\(?-?\$?\d[\d,]*(?:\.\d+)?\)?$/.test(it.s)) return;
    var dy0 = label.y - it.y;
    if (dy0 < -3 || dy0 > dy) return;
    if (it.x < label.x + dx0 || it.x > label.x + dx1) return;
    if (!best || dy0 < best.d) best = { v: moneyOf(it.s), d: dy0 };
  });
  return best ? best.v : null;
}
function k1Rows(items, label, codes) { // code letter + amount rows under a box heading (distributions)
  var out = {};
  items.forEach(function (c) {
    if (!/^[A-Z]{1,2}$/.test(c.s)) return;
    var dy = label.y - c.y;
    if (dy < 0 || dy > 90 || c.x < label.x - 12 || c.x > label.x + 60) return;
    items.forEach(function (a) {
      if (Math.abs(a.y - c.y) > 3 || a.x <= c.x || a.x > label.x + 230) return;
      if (/^\(?-?\$?\d[\d,]*(?:\.\d+)?\)?$/.test(a.s)) out[c.s] = moneyOf(a.s);
    });
  });
  return out;
}
function parseK1(page, kind) {
  var items = page.items, lines = page.lines, T = lines.join("\n"), r = { kind: kind };
  var l1 = items.filter(function (i) { return /ordinary business income/i.test(i.s); })[0];
  r.k1 = l1 ? nearBelow(items, l1, -12, 230, 48) : null;
  if (r.k1 === null && l1) { var mm = /ordinary business income[^\d(\-]*(\(?-?[\d,]+\)?)/i.exec(T); if (mm) r.k1 = moneyOf(mm[1]); }
  if (kind === "sco") {
    var d16 = items.filter(function (i) { return /items affecting shareholder basis/i.test(i.s); })[0];
    var rows = d16 ? k1Rows(items, d16) : {};
    r.dist = rows.D !== undefined ? rows.D : null;
    var f = lines.filter(function (l) { return /percentage of stock ownership/i.test(l); })[0], mo = f && /(\d{1,3}(?:\.\d+)?)\s*%/.exec(f);
    if (!mo) { var fi = lines.findIndex(function (l) { return /percentage of stock ownership/i.test(l); }); if (fi >= 0 && lines[fi + 1]) mo = /(\d{1,3}(?:\.\d+)?)\s*%/.exec(lines[fi + 1]); }
    r.own = mo ? parseFloat(mo[1]) : null;
  } else {
    var g = items.filter(function (i) { return /guaranteed payments/i.test(i.s); });
    var g4c = g.filter(function (i) { return /total|4c/i.test(i.s); })[0], g4a = g.filter(function (i) { return /services|4a/i.test(i.s); })[0] || g[0];
    r.gp = g4c ? nearBelow(items, g4c, -12, 230, 40) : (g4a ? nearBelow(items, g4a, -12, 230, 40) : null);
    var d19 = items.filter(function (i) { return /^19\b.*distributions|^distributions$/i.test(i.s); })[0];
    var rows2 = d19 ? k1Rows(items, d19) : {};
    r.dist = rows2.A !== undefined ? rows2.A : null;
    var pl = lines.filter(function (l) { return /^Profit\b/.test(l) && /%/.test(l); })[0], ms = pl ? pl.match(/(\d{1,3}(?:\.\d+)?)\s*%/g) : null;
    r.own = ms ? parseFloat(ms[ms.length - 1]) : null;
  }
  return r;
}

// Form 1065 line 16: 16a depreciation, 16b less amount on 1125-A, 16c net (the 16c box sits on the "b" row)
function depr1065(pg) {
  var a = lineVal(pg, /^16a\b.*depreciation/i, "16a"), rows = pg.rows || [], net = null, bval = null;
  for (var i = 0; i < rows.length; i++) {
    var tx = rowText(rows[i], pg.w);
    if (!/less depreciation reported/i.test(tx)) continue;
    var m = /16c(?:\s+(\(?-?[\d,]+\)?))?\s*$/.exec(tx), mb = /16b\s+(\(?-?[\d,]+\)?)\s/.exec(tx + " ");
    if (m && m[1]) net = moneyOf(m[1]); if (mb) bval = moneyOf(mb[1]);
  }
  if (net !== null) return { found: true, v: net };
  if (a.found && a.v !== null) return { found: true, v: a.v - (bval || 0) };
  return { found: a.found, v: a.found ? null : 0 };
}
// First amount found for a list of [label pattern, line number] choices (the line numbers change from year to year).
function firstLine(pg, choices) {
  for (var i = 0; i < choices.length; i++) { var r = lineVal(pg, choices[i][0], choices[i][1]); if (r.found && r.v !== null) return r.v; }
  return null;
}
// An amount after a label on a transcript line ("WAGES, SALARIES, TIPS, ETC:.....$161,567.00"), on that line or just below it.
function tAmt(L, i) {
  for (var k = i; k < Math.min(L.length, i + 3); k++) {
    var t = k === i ? L[k].replace(/^[^:]*:/, "") : L[k];
    var m = t.match(/\(?-?\s?\$\s?-?[\d,]+(?:\.\d\d)?\)?|\(?-?[\d,]*\d\.\d\d\)?/g);
    if (m) { var tok = m[m.length - 1].replace(/\s/g, ""), neg = /^\(/.test(tok) || /-/.test(tok), v = parseFloat(tok.replace(/[^0-9.]/g, "")); return isFinite(v) ? (neg ? -v : v) : null; }
    if (k > i && /[A-Za-z]{4}/.test(L[k])) break;
  }
  return null;
}
// IRS transcripts: Tax Return, Account, Record of Account and Wage and Income.
function parseTranscript(pages) {
  var L = [], T;
  pages.forEach(function (p) { L = L.concat(p.lines); });
  T = L.join("\n");
  var ym = /tax\s+(?:period|year)\s*(?:ending|requested)?[^A-Za-z0-9]{0,4}(?:[A-Za-z]{3,9}\.?\s*\d{1,2},?\s*|\d{1,2}[-\/]\d{1,2}[-\/]|[A-Za-z]{3,9}\.?\s*)?(20[12]\d)/i.exec(T);
  var r = { year: ym ? +ym[1] : null, wages: null, biz: null, total: null, agi: null, w2: null, nec: null, scNet: null, scDep: null }, inW2 = false, inSc = false;
  L.forEach(function (l, i) {
    var u = l.trim();
    if (/^form\s+w-?2\b/i.test(u)) inW2 = true; else if (/^form\s+(1099|1098|5498|w-?2g)/i.test(u)) inW2 = false;
    if (/^schedule\s+c\b/i.test(u) && !/^schedule c\)/i.test(u)) inSc = true; else if (/^schedule\s+[a-bd-z]\b|^form\s+\d/i.test(u)) inSc = false;
    var v;
    if (/^wages,?\s+salaries,?\s+tips/i.test(u)) { if ((v = tAmt(L, i)) !== null && r.wages === null) r.wages = v; }
    else if (/^business income or loss\s*\(?\s*schedule c\s*\)?\s*:/i.test(u) && !/per computer/i.test(u)) { if ((v = tAmt(L, i)) !== null && r.biz === null) r.biz = v; }
    else if (/^total income\b(?!.*per computer)/i.test(u)) { if ((v = tAmt(L, i)) !== null && r.total === null) r.total = v; }
    else if (/^adjusted gross income\b(?!.*per computer)/i.test(u)) { if ((v = tAmt(L, i)) !== null && r.agi === null) r.agi = v; }
    else if (inW2 && /^wages,?\s+tips,?\s+(?:and\s+)?other\s+comp/i.test(u)) { if ((v = tAmt(L, i)) !== null) r.w2 = (r.w2 || 0) + v; }
    else if (/^nonemployee compensation/i.test(u)) { if ((v = tAmt(L, i)) !== null) r.nec = (r.nec || 0) + v; }
    else if (inSc && /^net (?:profit|income)\b/i.test(u)) { if ((v = tAmt(L, i)) !== null && r.scNet === null) r.scNet = v; }
    else if (inSc && /^depreciation\b/i.test(u)) { if ((v = tAmt(L, i)) !== null && r.scDep === null) r.scDep = v; }
  });
  if (r.agi === null) { var pc = /^adjusted gross income per computer[^\n]*/im.exec(T); if (pc) { var ix = L.indexOf(pc[0]); if (ix >= 0) r.agi = tAmt(L, ix); } }
  return r;
}
function isTranscript(pages) {
  var top = pages[0] ? pages[0].lines.slice(0, 30).join("\n") : "";
  return /\btranscript\b/i.test(top) && /internal revenue service|tax period|tax year|form 1040|request date|record of account/i.test(top);
}
// What each page is, and the figures on it
function parseTaxPages(pages) {
  var out = { sc: [], se: [], pers: [], sco: { year: null, biz: null, k1s: [] }, pt: { year: null, biz: null, k1s: [] }, cc: { year: null, biz: null }, amort: null, years: [] };
  if (pages.length && isTranscript(pages)) {
    var tr = parseTranscript(pages);
    if (tr.wages !== null || tr.biz !== null || tr.total !== null || tr.agi !== null || tr.w2 !== null || tr.nec !== null)
      out.pers.push({ year: tr.year, wages: tr.wages !== null ? tr.wages : tr.w2, addl: tr.biz !== null ? tr.biz : tr.nec, total: tr.total, agi: tr.agi, src: "transcript" });
    var sn = tr.scNet !== null ? tr.scNet : (tr.biz !== null && tr.biz !== 0 ? tr.biz : null);
    if (sn !== null) out.sc.push({ year: tr.year, net: { found: true, v: sn }, dep: tr.scDep !== null ? { found: true, v: tr.scDep } : { found: true, v: null }, depl: { found: true, v: 0 } });
    return out;
  }
  pages.forEach(function (pg) {
    var L = pg.lines, T = L.join("\n"), top = L.slice(0, 22).join("\n");
    if (/Schedule K-1/i.test(top) && /Shareholder.s Share of Current Year Income/i.test(T)) { out.sco.k1s.push(parseK1(pg, "sco")); if (!out.sco.year) out.sco.year = taxYear(L); return; }
    if (/Schedule K-1/i.test(top) && /Partner.s Share of Current Year Income/i.test(T)) { out.pt.k1s.push(parseK1(pg, "pt")); if (!out.pt.year) out.pt.year = taxYear(L); return; }
    if (/Schedule E/i.test(top) && /Income or Loss From Rental Real Estate and Royalties/i.test(T)) {
      var sp = parseSchedE(pg); if (sp.length) out.se.push({ year: taxYear(L), props: sp });
      return;
    }
    if (/Schedule C/i.test(top) && /Profit or Loss From Business/i.test(T)) {
      var y = taxYear(L);
      out.sc.push({ year: y, net: lineVal(pg, /^31\b.*net profit/i, 31), dep: lineVal(pg, /^13\b.*depreciation/i, 13, 0.52), depl: lineVal(pg, /^12\b.*depletion/i, 12, 0.52) });
      return;
    }
    if (/Form\s*1040/i.test(top) && /Individual Income Tax Return/i.test(T) && !/^\s*schedule\b/i.test(L[0] || "")) {
      out.pers.push({ year: taxYear(L), src: "1040",
        wages: firstLine(pg, [[/^1z\b.*add lines 1a/i, "1z"], [/^1a\b.*w-?2/i, "1a"], [/^1\b.*wages, salaries/i, 1]]),
        addl: firstLine(pg, [[/^8\b.*(additional|other) income/i, 8]]),
        total: firstLine(pg, [[/^9\b.*total income/i, 9], [/^6\b.*total income/i, 6], [/^22\b.*total income/i, 22]]),
        agi: firstLine(pg, [[/^11\b.*adjusted gross income/i, 11], [/^8b\b.*adjusted gross income/i, "8b"], [/^7\b.*adjusted gross income/i, 7]]) });
      return;
    }
    if (/Form 4562/i.test(top) && /Depreciation and Amortization/i.test(T)) {
      var am = lineVal(pg, /^44\b.*total/i, 44); if (am.found) out.amort = (out.amort || 0) + am.v; return;
    }
    if (/1120-?S/i.test(top) && /Income Tax Return for an S Corporation/i.test(T) && !out.sco.biz) {
      out.sco.year = out.sco.year || taxYear(L);
      out.sco.biz = { ord: lineVal(pg, /^21\b.*ordinary business income/i, 21), dep: lineVal(pg, /^14\b.*depreciation/i, 14), depl: lineVal(pg, /^15\b.*depletion/i, 15), officers: lineVal(pg, /^7\b.*compensation of officers/i, 7) };
      return;
    }
    if (/1065/.test(top) && /U\.S\. Return of Partnership Income/i.test(T) && !out.pt.biz) {
      out.pt.year = out.pt.year || taxYear(L);
      var dep1065 = depr1065(pg);
      out.pt.biz = { ord: lineVal(pg, /^22\b.*ordinary business income/i, 22), dep: dep1065, depl: lineVal(pg, /^17\b.*depletion/i, 17) };
      return;
    }
    if (/Form 1120(?!-?S)/i.test(top) && /U\.S\. Corporation Income Tax Return/i.test(T) && !out.cc.biz) {
      out.cc.year = taxYear(L);
      out.cc.biz = { ti: lineVal(pg, /^30\b.*taxable income/i, 30), tax: lineVal(pg, /^31\b.*total tax/i, 31), dep: lineVal(pg, /^20\b.*depreciation/i, 20), depl: lineVal(pg, /^21\b.*depletion/i, 21) };
    }
  });
  return out;
}
var TAXTITLE = { se: "Rental properties (Schedule E)", p: "Personal return or IRS transcript (Form 1040)", sc: "Sole proprietor (Schedule C)", sco: "S Corp (Form 1120-S and K-1)", pt: "Partnership (Form 1065 and K-1)", cc: "C Corp (Form 1120)" };

async function runTax(files, out, api) {
  msg(out, "Reading your tax returns on this device...");
  var found = {}, bad = null, i;
  function put(key, year, data) { var k = key; (found[k] = found[k] || {}); var yk = year || ("file" + (Object.keys(found[k]).length + 1)); if (found[k][yk]) { found[k][yk].dup = true; return; } found[k][yk] = data; }
  for (i = 0; i < Math.min(files.length, 6); i++) {
    var res;
    try { res = parseTaxPages(await readPages(files[i], TAX_PAGES)); } catch (e) { bad = bad || e; continue; }
    if (res.sc.length) {
      var yr = res.sc[0].year, tot;
      if (res.sc.length === 1) tot = { net: res.sc[0].net.v, dep: res.sc[0].dep.v, depl: res.sc[0].depl.v };
      else { tot = { net: 0, dep: 0, depl: 0 }; res.sc.forEach(function (c) { tot.net = sum(tot.net, c.net.v); tot.dep = sum(tot.dep, c.dep.v); tot.depl = sum(tot.depl, c.depl.v); }); }
      put("sc", yr, { net: tot.net, dep: tot.dep, depl: tot.depl, count: res.sc.length });
    }
    if (res.se.length) { var allP = []; res.se.forEach(function (e) { allP = allP.concat(e.props); }); put("se", res.se[0].year, { props: allP }); }
    res.pers.forEach(function (pp) { put("p", pp.year, pp); });
    if (res.sco.biz || res.sco.k1s.length) {
      var b = res.sco.biz, da = b ? sum(b.dep.v, b.depl.v, res.amort || 0) : null;
      put("sco", res.sco.year, { da: da, daParts: b ? { dep: b.dep.v, depl: b.depl.v, amort: res.amort || 0 } : null, ord: b ? b.ord.v : null, officers: b && b.officers.found ? b.officers.v : null, k1s: res.sco.k1s });
    }
    if (res.pt.biz || res.pt.k1s.length) {
      var bp = res.pt.biz, dap = bp ? sum(bp.dep.v, bp.depl.v, res.amort || 0) : null;
      put("pt", res.pt.year, { da: dap, daParts: bp ? { dep: bp.dep.v, depl: bp.depl.v, amort: res.amort || 0 } : null, ord: bp ? bp.ord.v : null, k1s: res.pt.k1s });
    }
    if (res.cc.biz) {
      var bc = res.cc.biz;
      put("cc", res.cc.year, { ti: bc.ti.v, tax: bc.tax.v, da: sum(bc.dep.v, bc.depl.v, res.amort || 0), daParts: { dep: bc.dep.v, depl: bc.depl.v, amort: res.amort || 0 } });
    }
  }
  var keys = Object.keys(found);
  if (!keys.length) { msg(out, bad ? errText(bad, "tax preparer or the IRS") : "We could not find a Schedule C, Schedule E, 1120-S, 1065 or 1120 in these files. Please type your figures in."); return; }
  var onlyP = keys.length === 1 && keys[0] === "p", hasP = keys.indexOf("p") >= 0;
  var p = panel(out, onlyP ? "We found your personal tax return. Check each figure." : "We found " + keys.length + (hasP ? (keys.length === 1 ? " tax record" : " tax records") : (keys.length === 1 ? " business return" : " business returns")) + ". Check each one.");
  var blocks = [];
  keys.forEach(function (key) {
    var yrs = Object.keys(found[key]).sort(function (a, b) { return (+b || 0) - (+a || 0); }).slice(0, 3);
    var box = h("div", "dr-acct"), top = h("label", "dr-inc"), inc = h("input"); inc.type = "checkbox"; inc.checked = true;
    if (key === "p") inc.checked = false; else top.appendChild(inc);
    top.appendChild(h("span", "", TAXTITLE[key] + ", " + yrs.length + (yrs.length === 1 ? " year" : " years")));
    box.appendChild(top);
    var spec = { key: key, inc: inc, yrs: yrs, f: {}, k1sel: {}, own: null };
    var hdr = h("div", "dr-row dr-wide dr-yhead"); hdr.appendChild(h("span", "", "")); var cell = h("div", "dr-ycells");
    yrs.forEach(function (y, idx) { cell.appendChild(h("span", "", /^file/.test(y) ? "Year " + (idx + 1) : "Tax year " + y)); }); hdr.appendChild(cell); if (key !== "se") box.appendChild(hdr);
    function frow(id, label, sub, vals) {
      var r = h("div", "dr-row dr-wide"), d = h("div"); d.appendChild(h("span", "", label)); if (sub) d.appendChild(h("small", "", sub)); r.appendChild(d);
      var c = h("div", "dr-ycells"); spec.f[id] = [];
      yrs.forEach(function (y, idx) { var inp = field(vals[idx] === null || vals[idx] === undefined ? "" : String(vals[idx])); if (vals[idx] !== null && vals[idx] !== undefined) inp.classList.add("dr-found"); inp.setAttribute("aria-label", label + ", " + (/^file/.test(y) ? "year " + (idx + 1) : "tax year " + y)); c.appendChild(inp); spec.f[id].push(inp); });
      r.appendChild(c); box.appendChild(r);
    }
    var D = yrs.map(function (y) { return found[key][y]; });
    if (key === "p") {
      frow("wages", "Wages (line 1z)", D.some(function (d) { return d.src === "transcript"; }) ? "from the IRS transcript" : "", D.map(function (d) { return d.wages; }));
      frow("addl", "Business and other income", "Schedule C, Schedule 1 or 1099-NEC", D.map(function (d) { return d.addl; }));
      frow("total", "Total income (line 9)", "", D.map(function (d) { return d.total; }));
      frow("agi", "Adjusted gross income (line 11)", "", D.map(function (d) { return d.agi; }));
      box.appendChild(h("div", "dr-note", "These figures are shown for your records and to check against your other documents. Wage income comes from your pay stubs. Self-employed income is added from the Schedule C or business return."));
    } else if (key === "se") {
      // one block per rental property: the figures are checked on its card under Additional Properties Owned
      var norm = function (x) { return String(x || "").split(",")[0].toLowerCase().replace(/[^a-z0-9]/g, ""); };
      var latest = D[0].props || [], prior = (D[1] && D[1].props) || [], SEK = ["rents", "exp", "dep", "int", "tax", "ins"];
      var list = latest.slice(0, 10).map(function (pp, ix) {
        var pr = null; if (norm(pp.addr)) prior.forEach(function (q) { if (!pr && norm(q.addr) === norm(pp.addr)) pr = q; }); if (!pr && prior.length === latest.length && !norm(pp.addr)) pr = prior[ix] || null;
        return { cur: pp, prev: pr };
      });
      spec.props = list.map(function (it, ix) {
        var pp = it.cur, one = !it.prev, dy = pp.days, mo = dy > 0 ? Math.max(1, Math.min(12, Math.round(dy / 30.4))) : 12;
        var net = function (q) { return q ? (q.rents || 0) - (q.exp || 0) + (q.dep || 0) + (q.int || 0) + (q.tax || 0) + (q.ins || 0) : null; };
        var blk = h("div", "dr-acct"), tl = h("div", "dr-inc"); tl.appendChild(h("span", "", "Rental property " + pp.L)); if (pp.addr) tl.appendChild(h("span", "dr-bal", pp.addr)); blk.appendChild(tl);
        blk.appendChild(row("Rents received", /^file/.test(yrs[0]) ? "" : "tax year " + yrs[0], h("div", "dr-ro", usd(pp.rents || 0))));
        if (it.prev) blk.appendChild(row("Rents received", /^file/.test(yrs[1] || "") ? "" : "tax year " + (yrs[1] || ""), h("div", "dr-ro", usd(it.prev.rents || 0))));
        var ms = sel([["tax", "Tax returns: average of two years (Fannie Mae Form 1038)"], ["one", "Owned less than a year: one year, spread over the months rented"]], one ? "one" : "tax"); ms.classList.add("dr-found");
        var mi = field(String(mo)); if (dy > 0) mi.classList.add("dr-found");
        blk.appendChild(row("How to average the rental income", "Fannie Mae Form 1038", ms));
        blk.appendChild(row("Months rented in the most recent year", dy > 0 ? "from the days rented on the return" : "type it in", mi));
        box.appendChild(blk);
        return { pp: pp, prev: it.prev, ms: ms, mi: mi };
      });
      box.appendChild(h("div", "dr-note", "These " + list.length + (list.length === 1 ? " rental property was" : " rental properties were") + " added under Additional Properties Owned, one card each. Rental income follows Fannie Mae Form 1038: rents less expenses, adding back depreciation, interest, taxes, insurance and HOA dues, then subtracting that property's monthly payment. Enter the full payment (PITIA) on each card. Add HOA dues and other add-backs there too. For a new or listed property with no tax return, use 75% of the lease or market rent on its card."));
      if (latest.length > 10) box.appendChild(h("div", "dr-note", "These returns show " + latest.length + " rental properties. Vorelia accepts up to 10 rental (investment) properties."));
      spec.rentOnly = true;
      if (api.addRentals) { try { api.addRentals(spec.props.map(function (x) { return { addr: x.pp.addr, label: x.pp.L }; }), false); } catch (e) {} }
    } else if (key === "sc") {
      frow("net", "Net profit (line 31)", D.some(function (d) { return d.count > 1; }) ? "more than one Schedule C: added together" : "", D.map(function (d) { return d.net; }));
      frow("dep", "Depreciation (line 13)", "", D.map(function (d) { return d.dep; }));
      frow("depl", "Depletion (line 12)", "", D.map(function (d) { return d.depl; }));
    } else if (key === "cc") {
      frow("w2", "W-2 wages from the corporation", "type it in from your W-2, box 1", D.map(function () { return null; }));
      frow("ti", "Taxable income (line 30)", "", D.map(function (d) { return d.ti; }));
      frow("tax", "Total tax (line 31)", "", D.map(function (d) { return d.tax; }));
      frow("da", "Depreciation, depletion & amortization", "lines 20 and 21, plus Form 4562 if included", D.map(function (d) { return d.da; }));
    } else {
      var gid = key === "sco" ? "w2" : "gp";
      frow(gid, key === "sco" ? "W-2 wages from the S corp" : "Guaranteed payments (K-1 box 4)", key === "sco" ? (D.some(function (d) { return d.officers; }) ? "type it in from your W-2, box 1. The return shows officer pay of " + D.map(function (d) { return d.officers ? usd(d.officers) : ""; }).filter(Boolean).join(" / ") + " for all officers" : "type it in from your W-2, box 1") : "", D.map(function (d, idx) { if (key === "sco") return null; var k = d.k1s && d.k1s.length === 1 ? d.k1s[0] : null; return k && k.gp !== undefined ? k.gp : null; }));
      frow("k1", "Ordinary business income (K-1 box 1)", D.some(function (d) { return d.k1s && d.k1s.length > 1; }) ? "more than one K-1 found: choose yours below" : "", D.map(function (d) { var k = d.k1s && d.k1s.length === 1 ? d.k1s[0] : null; return k ? k.k1 : null; }));
      frow("da", "Depreciation, depletion & amortization (business total)", "line " + (key === "sco" ? "14 and 15" : "16c and 17") + ", plus Form 4562 if included", D.map(function (d) { return d.da; }));
      frow("dist", "Distributions to you " + (key === "sco" ? "(K-1 box 16, code D)" : "(K-1 box 19, code A)"), "optional", D.map(function (d) { var k = d.k1s && d.k1s.length === 1 ? d.k1s[0] : null; return k ? k.dist : null; }));
      // several K-1s in a file: choose yours (we never read names)
      D.forEach(function (d, idx) {
        if (!d.k1s || d.k1s.length <= 1) return;
        var s = sel([["", "Choose..."]].concat(d.k1s.map(function (k, j) { return [String(j), "K-1 #" + (j + 1) + (k.own != null ? ", " + k.own + "%" : "") + (k.k1 != null ? ", income " + usd(k.k1).replace(".00", "") : "")]; })), "");
        s.classList.add("dr-found"); spec.k1sel[idx] = { s: s, d: d };
        var kr = row("Which K-1 is yours? " + (/^file/.test(yrs[idx]) ? "Year " + (idx + 1) : yrs[idx]), "we do not read names", s); kr.className = "dr-row dr-wide"; box.appendChild(kr);
        s.addEventListener("change", function () {
          var k = d.k1s[+s.value]; if (!k) return;
          if (spec.f.k1[idx]) spec.f.k1[idx].value = k.k1 == null ? "" : String(k.k1);
          if (key === "pt" && spec.f.gp && spec.f.gp[idx] && k.gp != null) spec.f.gp[idx].value = String(k.gp);
          if (spec.f.dist[idx]) spec.f.dist[idx].value = k.dist == null ? "" : String(k.dist);
          spec.ownInp.value = k.own == null ? spec.ownInp.value : String(k.own); calc();
        });
      });
      var ownVal = null; D.forEach(function (d) { (d.k1s || []).forEach(function (k) { if (ownVal === null && k.own != null && d.k1s.length === 1) ownVal = k.own; }); });
      var oi = field(ownVal === null ? "100" : String(ownVal)); if (ownVal !== null) oi.classList.add("dr-found"); spec.ownInp = oi;
      box.appendChild(row("Your ownership share (%)", ownVal === null ? (Object.keys(spec.k1sel).length ? "set when you choose your K-1" : "not found, please check") : "from the K-1", oi));
    }
    if (key === "cc") { var oi2 = field("100"); spec.ownInp = oi2; box.appendChild(row("Your ownership share (%)", "type it in, it is not on the return", oi2)); }
    if (yrs.length >= 3 && key !== "p" && key !== "se") { var sl = h("label", "dr-inc"), c3 = h("input"); c3.type = "checkbox"; c3.checked = true; sl.appendChild(c3); sl.appendChild(h("span", "", "Use a 3-year average (you uploaded 3 years)")); box.appendChild(sl); spec.c3 = c3; }
    var dupN = yrs.filter(function (y) { return found[key][y].dup; }).length;
    if (dupN) box.appendChild(h("div", "dr-note", "The same tax year appeared in more than one file. We used the first one."));
    if (yrs.length < 2 && key !== "p" && key !== "se") box.appendChild(h("div", "dr-note", "Only one year was found. Lenders usually want two years of returns."));
    blocks.push(spec); p.appendChild(box);
  });
  p.appendChild(h("div", "dr-note", "This is an estimate for planning. It follows the usual add-backs, but your lender decides what income counts, and may use other figures or ask for more."));
  var ft;
  function calc() {
    var okAny = false, onlyPers = blocks.every(function (b) { return b.key === "p"; });
    blocks.forEach(function (b) {
      if (b.key === "p" || !b.inc.checked) return;
      var needsK1 = Object.keys(b.k1sel).some(function (i) { return !b.k1sel[i].s.value; });
      if (!needsK1) okAny = true;
    });
    ft.summary.textContent = okAny ? "Ready to add to your self-employed income." : (onlyPers ? "Nothing to add from this return. Wage income comes from pay stubs." : "Choose your K-1 above, or tick a return.");
    ft.use.disabled = !okAny;
  }
  ft = foot(p, "", function () {
    var payload = [];
    blocks.forEach(function (b) {
      if (b.key === "p" || !b.inc.checked) return;
      if (Object.keys(b.k1sel).some(function (i) { return !b.k1sel[i].s.value; })) return;
      if (b.key === "se") {
        var fig = function (q) { return q ? { rents: q.rents, exp: q.exp, dep: q.dep, int: q.int, tax: q.tax, ins: q.ins } : null; };
        payload.push({ key: "rentprops", props: b.props.map(function (x) { return { addr: x.pp.addr, label: x.pp.L, days: x.pp.days, mode: x.ms.value, months: toNum(x.mi.value), years: [fig(x.pp), fig(x.prev)] }; }) });
        return;
      }
      var rows = {};
      Object.keys(b.f).forEach(function (id) { rows[id] = b.f[id].map(function (i) { return i.value.trim() === "" ? null : toNum(i.value) * (/^\s*[-(]/.test(i.value) ? -1 : 1); }); });
      payload.push({ key: b.key === "se" ? "rent" : b.key, rows: rows, own: b.ownInp ? toNum(b.ownInp.value) : null, three: !!(b.c3 && b.c3.checked), years: b.yrs.length });
    });
    var res = api.applyTax(payload) || {}, hasRent = payload.some(function (x) { return x.key === "rentprops"; }), others = payload.some(function (x) { return x.key !== "rentprops"; });
    msg(out, (others ? "Added to your self-employed income. " : "") + (hasRent ? "The rental figures were filled in on each property card under Additional Properties Owned. Enter the full monthly payment (PITIA) on each one to see its net rental income or loss." + (res.capped ? " Vorelia accepts up to 10 rental (investment) properties, so the rest were not added." : "") : "You can still change it above."), "ok");
  }, out);
  blocks.forEach(function (b) { b.inc.addEventListener("change", calc); Object.keys(b.k1sel).forEach(function (i) { b.k1sel[i].s.addEventListener("change", calc); }); });
  calc();
}


/* ---------- credit report ---------- */
var CR_ANCHOR = /\baccount\s*(?:number|#|no\.?)(?=\s|:|$)|#\s*(?=[\w*]*[\d*])[\w*]{4,}\s*$/i;
var CR_SEC = /^(revolving|mortgage|real estate|installment|collections?|other|line of credit|open|closed)\s+accounts?\b/i;
function crType(t) {
  t = t.toLowerCase();
  if (/collection/.test(t)) return "coll";
  if (/mortgage|real estate|home equity|heloc|\bmtg\b/.test(t)) return "mortgage";
  if (/\brent(al)?\b|\blease\b|apartment/.test(t)) return "rent";
  if (/auto|vehicle/.test(t)) return "auto";
  if (/student|education/.test(t)) return "student";
  if (/credit card|revolving|charge account|flexible spending|line of credit/.test(t)) return "card";
  if (/installment|personal|unsecured|secured|loan/.test(t)) return "personal";
  return "other";
}
function crMoney(str) { var m = /\$\s*([\d,]+(?:\.\d{1,2})?)/.exec(str); return m ? parseFloat(m[1].replace(/,/g, "")) : null; }
function parseCredit(lines, today) {
  today = today || new Date();
  var cut = new Date(today.getFullYear(), today.getMonth() - 12, 1), idx = [], sec = "", secAt = [];
  lines.forEach(function (l, i) { var m = CR_SEC.exec(l); if (m) sec = m[1]; secAt[i] = sec; if (CR_ANCHOR.test(l)) idx.push(i); });
  var out = [];
  idx.forEach(function (a, k) {
    var end = k + 1 < idx.length ? idx[k + 1] : Math.min(lines.length, a + 60), blk = lines.slice(a, end);
    var o = { type: "other", pay: null, bal: null, open: true, lates: 0, late12: false, worst: 0, coll: false }, typeTxt = secAt[a] || "", statusTxt = "", years = [];
    blk.forEach(function (l) {
      var m;
      if (CR_SEC.test(l)) return;
      if ((m = /(?:account|loan)\s+type\s*:?\s*([^$]*?)(?=\s+(?:loan|account)\s+type|\s+date\s|$)/ig)) { var mm; while ((mm = m.exec(l))) typeTxt += " " + mm[1]; }
      if ((m = /(?:account\s+status|pay\s+status|^status)\s*:?\s*(.+?)(?=\s+date\s+(?:opened|closed)|$)/i.exec(l))) statusTxt += " " + m[1];
      if (/^(?:remarks?|comments?)\b/i.test(l)) statusTxt += " " + l;
      if ((m = /date\s+closed\s*:?\s*(\d{1,2}\/\d{2,4})/i.exec(l))) o.open = false;
      if ((m = /(?:monthly|scheduled|regular)\s+payment(?:\s+amount)?\s*:?\s*(\$\s*[\d,]+(?:\.\d{1,2})?)/i.exec(l)) && o.pay === null) o.pay = crMoney(m[1]);
      if ((m = /(\$\s*[\d,]+(?:\.\d{1,2})?)\s*(?:per month|monthly(?!\s+payment)|\/\s*mo\b)/i.exec(l)) && o.pay === null) o.pay = crMoney(m[1]);
      if ((m = /(?:^|\s)(high|original|highest)?\s*(?:current\s+|reported\s+)?balance\s*:?\s*(\$\s*[\d,]+(?:\.\d{1,2})?)/i.exec(l)) && !m[1] && o.bal === null) o.bal = crMoney(m[2]);
      if ((m = /30\s*\/\s*60\s*\/\s*90[^0-9]*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/.exec(l))) { var c = +m[1] + +m[2] + +m[3]; if (c > o.lates) { o.lates = c; o.undated = true; } }
      if ((m = /^(20\d\d)\s+(.+)$/.exec(l))) { var tk = m[2].split(" "); if (tk.length <= 12 && tk.every(function (x) { return x.length <= 4; })) years.push({ y: +m[1], t: tk }); }
    });
    var top = 0, dated = 0; years.forEach(function (r) { if (r.y > top) top = r.y; });
    years.forEach(function (r) {
      var off = r.t.length === 12 ? 0 : (r.y === top ? 0 : 12 - r.t.length);
      r.t.forEach(function (x, i) {
        if (/^co$/i.test(x)) o.coll = true;
        if (!/^(30|60|90|120|150|180)$/.test(x)) return;
        dated++; if (+x > o.worst) o.worst = +x;
        if (new Date(r.y, off + i, 1) >= cut) o.late12 = true;
      });
    });
    if (dated) { o.lates = Math.max(dated, o.undated ? o.lates : 0); o.undated = false; }
    var st = statusTxt.toLowerCase();
    if (/\bclosed\b|paid in full|transferred|\bsold\b|refinanced/.test(st)) o.open = false;
    if (/collection|charged?[\s-]?off|profit and loss/.test(st + " " + typeTxt.toLowerCase())) o.coll = true;
    if (/past due|delinquent|days late/.test(st) && !/never/.test(st) && !o.coll) { o.late12 = true; if (!o.lates) o.lates = 1; }
    o.type = o.coll ? "coll" : crType(typeTxt);
    if (o.bal === null && o.pay === null && !statusTxt && !typeTxt.trim()) return;
    out.push(o);
  });
  return out.length ? out : parseCreditTable(lines);
}
// Summary-style reports list one account per row: "Creditor (type)  Status  Balance  Monthly payment".
function parseCreditTable(lines) {
  var out = [], on = false;
  lines.forEach(function (l) {
    if (/creditor|account type|account name/i.test(l) && /status/i.test(l) && /balance|limit/i.test(l) && /payment/i.test(l)) { on = true; return; }
    if (!on) return;
    if (/^total\b/i.test(l)) { on = false; return; }
    var m = l.match(/\$\s*[\d,]+(?:\.\d{1,2})?(?![\w.])/g); if (!m || m.length < 2) return;
    var first = l.indexOf(m[0]), head = l.slice(0, first), st = /\b(current|open|closed|paid|past due|delinquent|collection|charged?[\s-]?off|late)\b/i.exec(head);
    var typeTxt = st ? head.slice(0, st.index) : head, statusTxt = st ? head.slice(st.index) : "";
    var lt = /\((\d+)\s*late\)/i.exec(statusTxt), lates = lt ? +lt[1] : 0, s = statusTxt.toLowerCase();
    var o = { type: crType(typeTxt), pay: crMoney(m[1]), bal: crMoney(m[0]), open: !/\bclosed\b|paid in full|transferred|\bsold\b/.test(s), lates: lates, late12: false, worst: 0, coll: /collection|charged?[\s-]?off/.test(s + " " + typeTxt.toLowerCase()), undated: lates > 0 };
    if (/past due|delinquent|days late/.test(s) && !lates) { o.lates = 1; o.late12 = true; o.undated = false; }
    if (o.coll) o.type = "coll";
    out.push(o);
  });
  return out;
}
var CR_LABEL = { card: "Credit card", auto: "Auto loan", student: "Student loan", personal: "Personal loan", mortgage: "Mortgage", rent: "Rent", other: "Other" };
async function runCredit(files, out, api) {
  msg(out, "Reading your credit report on this device...");
  var all = [], seen = {}, bad = null, got = 0;
  for (var i = 0; i < Math.min(files.length, 3); i++) {
    var lines = [];
    try { (await readPages(files[i], TAX_PAGES)).forEach(function (pg) { lines = lines.concat(pg.lines); }); } catch (e) { bad = bad || e; continue; }
    var r = parseCredit(lines); lines = null; if (r.length) got++;
    r.forEach(function (a) {
      var k = [a.type, a.bal, a.pay, a.open].join("|"), prev = seen[k];
      if (prev) { prev.lates = Math.max(prev.lates, a.lates); prev.late12 = prev.late12 || a.late12; prev.worst = Math.max(prev.worst, a.worst); return; }
      seen[k] = a; all.push(a);
    });
  }
  if (!all.length) { msg(out, bad ? errText(bad, "credit bureau") : "We could not find any accounts on this file. Please type your payments in."); return; }
  var open = all.filter(function (a) { return a.open && !a.coll; }), coll = all.filter(function (a) { return a.coll; }), closed = all.length - open.length - coll.length;
  var p = panel(out, "We found " + open.length + (open.length === 1 ? " open account" : " open accounts") + " on your credit report. Check each one.");
  var TYPES = [["card", "Credit card"], ["auto", "Auto loan"], ["student", "Student loan"], ["personal", "Personal loan"], ["other", "Other"]], rows = [];
  open.forEach(function (a) {
    var housing = a.type === "mortgage" || a.type === "rent";
    var inc = h("input"); inc.type = "checkbox"; inc.checked = !housing && a.pay > 0; inc.setAttribute("aria-label", "Include this account");
    var t = sel(TYPES, housing ? "other" : a.type), b = field(a.pay != null ? a.pay.toFixed(2) : ""); t.classList.add("dr-found"); if (a.pay != null) b.classList.add("dr-found");
    var box = h("div", "dr-acct"), top = h("label", "dr-inc"); top.appendChild(inc);
    top.appendChild(h("span", "", CR_LABEL[a.type] || "Other")); if (a.bal != null) top.appendChild(h("span", "dr-bal", "Balance " + usd(a.bal)));
    box.appendChild(top);
    if (!housing) box.appendChild(row("Type", "", t));
    box.appendChild(row("Monthly payment", a.pay != null ? "" : "Not shown on the report. Check your latest statement.", b));
    var link = null;
    if (housing && a.type === "mortgage") {
      var ch = (api.ownedChoices ? api.ownedChoices() : []), opts = [["", "Not linked"]];
      ch.forEach(function (c) { opts.push([String(c.id), c.name]); });
      opts.push(["new", "A property not listed yet (add it)"], ["subj", "The home I am buying or refinancing"]);
      link = sel(opts, ""); box.appendChild(row("Which property is this mortgage for?", "its payment and balance go to that property", link));
      var refresh = function () { if (!api.ownedChoices) return; var cur = link.value, ch2 = api.ownedChoices(), taken = {};
        rows.forEach(function (r) { if (r.link && r.link !== link && r.link.value && /^\d+$/.test(r.link.value)) taken[r.link.value] = 1; });
        var o2 = [["", "Not linked"]]; ch2.forEach(function (c) { if (!taken[String(c.id)]) o2.push([String(c.id), c.name]); }); o2.push(["new", "A property not listed yet (add it)"], ["subj", "The home I am buying or refinancing"]);
        link.innerHTML = ""; o2.forEach(function (o) { var op = h("option", "", o[1]); op.value = o[0]; link.appendChild(op); }); link.value = o2.some(function (o) { return o[0] === cur; }) ? cur : ""; };
      link.addEventListener("mousedown", refresh); link.addEventListener("focus", refresh);
      if (!api.applyMortgages) box.appendChild(h("div", "dr-note dr-alert", "This page is out of date, so mortgages cannot be linked to properties yet. Refresh the page (Ctrl+Shift+R, or Cmd+Shift+R on a Mac) and upload the credit report again."));
      link.addEventListener("change", function () { var on = !!link.value; inc.disabled = on; if (on) inc.checked = false; rows.forEach(function (r) { if (r.link && r.link !== link && r.link.value && r.link.value === link.value && /^\d+$/.test(link.value)) { r.link.value = ""; r.inc.disabled = false; } }); calc(); });
    }
    if (housing) box.appendChild(h("div", "dr-note", a.type === "mortgage" ? "Choose the property to move this payment to Additional Properties Owned. A linked mortgage is not counted again as a debt. Credit reports usually show principal and interest only, so add taxes, insurance and HOA dues there." : "Housing payments are entered with your properties, not under debts. Tick the box only if this payment is not counted anywhere else."));
    if (a.lates) box.appendChild(row("Late payments on the report", a.late12 ? "At least one in the last 12 months" : (a.undated ? "Dates not found" : "None in the last 12 months"), h("div", "dr-ro bad", a.lates + (a.worst ? " (up to " + a.worst + " days)" : ""))));
    else box.appendChild(row("Late payments on the report", "", h("div", "dr-ro good", "None found")));
    p.appendChild(box); rows.push({ a: a, inc: inc, t: t, b: b, link: link });
  });
  var hl = open.some(function (a) { return (a.type === "mortgage" || a.type === "rent") && (a.late12 || (a.lates && a.undated)); });
  var nl = open.filter(function (a) { return a.lates > 0; }).length;
  if (hl) p.appendChild(h("div", "dr-note dr-alert", "A late mortgage or rent payment shows in the last 12 months. Lenders look closely at this. A warning will be added to your debts."));
  if (coll.length) p.appendChild(h("div", "dr-note dr-alert", (coll.length === 1 ? "1 collection or charge-off was found." : coll.length + " collections or charge-offs were found.") + ' "Do you have any tax liens, judgments, collections or charge-offs?" will be set to Yes.'));
  if (closed > 0) p.appendChild(row("Closed or paid accounts", "Left out", h("div", "dr-ro", String(closed))));
  var ft;
  function calc() { var tot = 0, nl = 0, nu = 0; rows.forEach(function (r) { if (r.link && r.link.value && r.link.value !== "subj") nl++; if (r.link && !r.link.value && !r.inc.checked) nu++; if (r.inc.checked && !(r.link && r.link.value)) tot += toNum(r.b.value); }); ft.summary.textContent = "Added to debts: " + usd(tot) + " a month" + (nl ? ". " + nl + (nl === 1 ? " mortgage moves" : " mortgages move") + " to Additional Properties Owned." : "") + (nu ? ". " + nu + (nu === 1 ? " mortgage is not linked and will not be counted." : " mortgages are not linked and will not be counted.") : ""); }
  ft = foot(p, "", function () {
    var list = [], mt = [];
    rows.forEach(function (r) {
      if (r.link && r.link.value && r.link.value !== "subj") { mt.push({ to: r.link.value, pay: round2(toNum(r.b.value)), upb: r.a.bal || 0 }); return; }
      if (r.link && r.link.value === "subj") return;
      if (r.inc.checked && toNum(r.b.value) > 0) list.push({ type: r.t.value, amount: round2(toNum(r.b.value)) });
    });
    api.applyDebts(list, { coll: coll.length, housingLate: hl, lateAccts: nl });
    var mr = mt.length && api.applyMortgages ? api.applyMortgages(mt) : { linked: 0 };
    var nu2 = rows.filter(function (r) { return r.link && !r.link.value && !r.inc.checked; }).length;
    msg(out, (mr.linked ? "Added to your debts, and " + mr.linked + (mr.linked === 1 ? " mortgage" : " mortgages") + " moved to Additional Properties Owned. Check the payment on each property. You can still change them below." : "Added to your debts. You can still change them below.") + (nu2 ? " " + nu2 + (nu2 === 1 ? " mortgage was not added" : " mortgages were not added") + ". Link each one to a property, or tick Include to count it as a debt." : ""), nu2 ? "" : "ok");
  }, out);
  rows.forEach(function (r) { r.inc.addEventListener("change", calc); r.b.addEventListener("input", calc); });
  calc();
}


/* ---------- Social Security / pension award letters ---------- */
function lineAmt(lines, re, span) {
  for (var i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue;
    for (var j = i; j <= i + (span || 0) && j < lines.length; j++) { var n = nums(lines[j]); if (n.length) return n[n.length - 1].v; }
  }
  return null;
}
function parseBenefit(lines) {
  var text = lines.join(" ");
  if (!/social security|pension|annuity|retirement benefit|benefit (amount|letter)/i.test(text)) return null;
  var gross = lineAmt(lines, /before (any )?deductions|gross (monthly )?(benefit|amount|pension)|(monthly|total) benefit amount/i, 1);
  var med = lineAmt(lines, /medicare[^$]*premium|part b premium/i, 0);
  var tax = lineAmt(lines, /(federal )?(income )?tax(es)? withheld|withholding amount/i, 0);
  var net = lineAmt(lines, /amount we pay you|net (monthly )?(benefit|payment|amount)|amount (deposited|paid)|we (will )?(deposit|pay)/i, 0);
  if (med !== null) med = Math.abs(med);
  if (gross === null && net !== null) gross = net + (med || 0) + (tax || 0);
  if (gross === null || !(gross > 0)) return null;
  var taxZero = tax === 0 || (tax === null && /not withholding|no (federal )?tax(es)? (is|are|was|were) (being )?withheld/i.test(text));
  return { gross: round2(gross), med: med, tax: tax, net: net, taxZero: taxZero, ss: /social security/i.test(text) };
}
async function runBenefit(files, out, api) {
  msg(out, "Reading your award letter on this device...");
  var lines;
  try { lines = await readLines(files[0]); } catch (e) { msg(out, errText(e, "benefit")); return; }
  var r = parseBenefit(lines); lines = null;
  if (!r) { msg(out, "We could not find the monthly benefit on this file. Please type it in."); return; }
  var p = panel(out, "We found these on your " + (r.ss ? "Social Security award letter" : "benefit letter") + ". Check each one.");
  var fAmt = field(r.gross.toFixed(2)); fAmt.classList.add("dr-found");
  var fTax = sel([["no", "None of it is taxable (gross it up)"], ["yes", "Part or all of it is taxable (no gross-up)"]], r.taxZero ? "no" : "yes"); fTax.classList.add("dr-found");
  var fUp = field("25");
  p.appendChild(row("Monthly benefit before deductions", "We use the gross amount, not what is deposited", fAmt));
  if (r.med !== null) p.appendChild(row("Medicare premium deducted", "not subtracted from your income", h("div", "dr-ro", usd(r.med))));
  p.appendChild(row("Federal income tax withheld", "", h("div", "dr-ro", r.tax !== null ? usd(r.tax) : (r.taxZero ? "None" : "Not shown"))));
  if (r.net !== null) p.appendChild(row("Amount deposited", "a check only, not income", h("div", "dr-ro", usd(r.net))));
  p.appendChild(row("Is this benefit taxable?", "", fTax));
  var upRow = row("Gross-up rate (%)", "Conventional loans often use 25%, FHA often 15%. Your lender decides.", fUp); p.appendChild(upRow);
  p.appendChild(h("div", "dr-note", "Please verify this. No tax withheld does not always mean the benefit is not taxable. Check your tax return and your SSA-1099, and expect your lender to ask for proof."));
  var ft;
  function calc() {
    var amt = toNum(fAmt.value), up = Math.min(toNum(fUp.value), 50), nt = fTax.value === "no";
    upRow.hidden = !nt;
    ft.summary.textContent = amt > 0 ? "Counted as income: " + usd(round2(nt ? amt * (1 + up / 100) : amt)) + " a month" + (nt ? " (" + usd(amt) + " + " + up + "% gross-up)" : "") : "Enter the monthly benefit.";
    ft.use.disabled = !(amt > 0);
  }
  ft = foot(p, "", function () {
    api.applyBenefit({ amount: round2(toNum(fAmt.value)), nontax: fTax.value === "no", grossUp: Math.min(toNum(fUp.value), 50) });
    msg(out, "Added to your income. Confirm on your tax return that it is not taxable. You can still change it above.", "ok");
  }, out);
  [fAmt, fTax, fUp].forEach(function (x) { x.addEventListener("input", calc); x.addEventListener("change", calc); });
  calc();
}
/* ---------- retirement account statements (401(k), IRA, 403(b)) ---------- */
function parseRetire(lines) {
  var text = lines.join(" ");
  var kind = /401\s*\(?k\)?/i.test(text) ? "401(k)" : /403\s*\(?b\)?/i.test(text) ? "403(b)" : /\b(roth )?ira\b/i.test(text) ? "IRA" : /thrift savings/i.test(text) ? "TSP" : /pension plan|retirement (savings )?(plan|account)/i.test(text) ? "retirement plan" : "";
  var brok = false;
  if (!kind && /brokerage|securities|portfolio (value|summary)|account value/i.test(text) && /(stocks?|equities|mutual funds?|etfs?|bonds?|holdings|positions)/i.test(text)) { kind = "brokerage"; brok = true; }
  if (!kind) return null;
  var vest = lineAmt(lines, /vested (account )?balance/i, 0);
  var end = lineAmt(lines, /(ending|closing|current) (account )?(balance|value)|ending value/i, 1);
  if (end === null) end = lineAmt(lines, /total account (value|balance)|total (vested )?balance|^total\b.*\$/i, 1);
  if (end === null) end = lineAmt(lines, /\baccount value\b/i, 1);
  var amt = vest !== null ? vest : end;
  if (amt === null || !(amt > 0)) return null;
  var d = /(?:ending|closing)[^()]*\((\d{1,2}\/\d{1,2}\/\d{4})\)/i.exec(text) || /(?:through|-)\s*((?:[A-Z][a-z]+) \d{1,2}, \d{4})/.exec(text);
  return { amount: round2(amt), kind: kind, type: brok ? "stocks" : "retirement", asOf: d ? d[1] : "", vested: vest !== null };
}
async function runRetire(files, out, api) {
  msg(out, "Reading your retirement statement on this device...");
  var lines;
  try { lines = await readLines(files[0]); } catch (e) { msg(out, errText(e, "retirement plan")); return; }
  var r = parseRetire(lines); lines = null;
  if (!r) { msg(out, "We could not find the account balance on this file. Please type it in."); return; }
  var p = panel(out, "We found this on your " + r.kind + " statement. Check it.");
  var fAmt = field(r.amount.toFixed(2)); fAmt.classList.add("dr-found");
  p.appendChild(row(r.vested ? "Vested balance" : "Account balance", r.asOf ? "as of " + r.asOf : "", fAmt));
  p.appendChild(h("div", "dr-note", r.type === "stocks" ? "Stocks and funds can count toward your reserves without being sold. We count 70% of the part you would not sell, and you can change that. Any part you would sell counts as liquid for cash to close. Set both on the Assets tab." : "Retirement accounts can count toward your reserves without being withdrawn. We count 60% of the part you would not withdraw, and you can change that. Any part you would withdraw counts as liquid, before taxes and penalties. Set both on the Assets tab."));
  var ft = foot(p, "", function () {
    api.applyAssets([{ type: r.type, amount: round2(toNum(fAmt.value)) }], false, [], "retire");
    msg(out, "Added to your assets. You can still change it above.", "ok");
  }, out);
  function calc() { var a = toNum(fAmt.value); ft.summary.textContent = a > 0 ? "Added to assets: " + usd(a) : "Enter the balance."; ft.use.disabled = !(a > 0); }
  fAmt.addEventListener("input", calc); calc();
}

export function run(kind, files, out, api) { return kind === "benefit" ? runBenefit(files, out, api) : kind === "retire" ? runRetire(files, out, api) : kind === "pay" ? runPay(files[0], out, api) : kind === "credit" ? runCredit(files, out, api) : kind === "tax" ? runTax(files, out, api) : runBank(files, out, api); }
export { parsePay, parseStmt, readLines, readStmtLines, readPages, parseTaxPages, parseCredit, parseBenefit, parseRetire };
