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
      r.it.push({ x: x, s: it.str });
    });
    rows.sort(function (a, b) { return b.y - a.y; });
    var lines = [];
    rows.forEach(function (r) {
      r.it.sort(function (a, b) { return a.x - b.x; });
      var s = r.it.map(function (t) { return t.s.trim(); }).join(" ").replace(/\s+/g, " ").trim();
      if (s) { lines.push(s); chars += s.length; }
    });
    pages.push({ lines: lines, items: items, rows: rows.map(function (r) { return r.it.map(function (t) { return { x: t.x, s: t.s.trim() }; }).filter(function (t) { return t.s; }); }), w: (page.view && page.view[2]) || 612 });
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

async function runBank(files, out, api) {
  msg(out, "Reading your statements on this device...");
  var inc = api.income(), threshold = inc > 0 ? inc * 0.5 : 0, parsed = [], bad = null;
  for (var i = 0; i < Math.min(files.length, 3); i++) {
    try { parsed.push(parseStmt(await readLines(files[i]), threshold)); } catch (e) { bad = bad || e; }
  }
  var ok = parsed.filter(function (x) { return x.accounts.length; });
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
      p.appendChild(row("Large deposit: " + usd(d.amt), "Deposit on " + d.date, two)); rowsD.push({ d: d, s: s2, a: sa });
    });
  } else {
    p.appendChild(h("div", "dr-note", "We did not spot any large deposits, but this check can miss some. Review your statements yourself."));
  }
  var ft;
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
    msg(out, "Added to your assets. You can still change it above.", "ok");
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
// What each page is, and the figures on it
function parseTaxPages(pages) {
  var out = { sc: [], sco: { year: null, biz: null, k1s: [] }, pt: { year: null, biz: null, k1s: [] }, cc: { year: null, biz: null }, amort: null, years: [] };
  pages.forEach(function (pg) {
    var L = pg.lines, T = L.join("\n"), top = L.slice(0, 22).join("\n");
    if (/Schedule K-1/i.test(top) && /Shareholder.s Share of Current Year Income/i.test(T)) { out.sco.k1s.push(parseK1(pg, "sco")); if (!out.sco.year) out.sco.year = taxYear(L); return; }
    if (/Schedule K-1/i.test(top) && /Partner.s Share of Current Year Income/i.test(T)) { out.pt.k1s.push(parseK1(pg, "pt")); if (!out.pt.year) out.pt.year = taxYear(L); return; }
    if (/Schedule C/i.test(top) && /Profit or Loss From Business/i.test(T)) {
      var y = taxYear(L);
      out.sc.push({ year: y, net: lineVal(pg, /^31\b.*net profit/i, 31), dep: lineVal(pg, /^13\b.*depreciation/i, 13, 0.52), depl: lineVal(pg, /^12\b.*depletion/i, 12, 0.52) });
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
var TAXTITLE = { sc: "Sole proprietor (Schedule C)", sco: "S Corp (Form 1120-S and K-1)", pt: "Partnership (Form 1065 and K-1)", cc: "C Corp (Form 1120)" };

async function runTax(files, out, api) {
  msg(out, "Reading your tax returns on this device...");
  var found = {}, bad = null, i;
  function put(key, year, data) { var k = key; (found[k] = found[k] || {}); var yk = year || ("file" + (Object.keys(found[k]).length + 1)); if (found[k][yk]) { found[k][yk].dup = true; return; } found[k][yk] = data; }
  for (i = 0; i < Math.min(files.length, 3); i++) {
    var res;
    try { res = parseTaxPages(await readPages(files[i], TAX_PAGES)); } catch (e) { bad = bad || e; continue; }
    if (res.sc.length) {
      var yr = res.sc[0].year, tot;
      if (res.sc.length === 1) tot = { net: res.sc[0].net.v, dep: res.sc[0].dep.v, depl: res.sc[0].depl.v };
      else { tot = { net: 0, dep: 0, depl: 0 }; res.sc.forEach(function (c) { tot.net = sum(tot.net, c.net.v); tot.dep = sum(tot.dep, c.dep.v); tot.depl = sum(tot.depl, c.depl.v); }); }
      put("sc", yr, { net: tot.net, dep: tot.dep, depl: tot.depl, count: res.sc.length });
    }
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
  if (!keys.length) { msg(out, bad ? errText(bad, "tax preparer or the IRS") : "We could not find a Schedule C, 1120-S, 1065 or 1120 in these files. Please type your figures in."); return; }
  var p = panel(out, "We found " + keys.length + (keys.length === 1 ? " business return" : " business returns") + ". Check each one.");
  var blocks = [];
  keys.forEach(function (key) {
    var yrs = Object.keys(found[key]).sort(function (a, b) { return (+b || 0) - (+a || 0); }).slice(0, 3);
    var box = h("div", "dr-acct"), top = h("label", "dr-inc"), inc = h("input"); inc.type = "checkbox"; inc.checked = true;
    top.appendChild(inc); top.appendChild(h("span", "", TAXTITLE[key] + ", " + yrs.length + (yrs.length === 1 ? " year" : " years")));
    box.appendChild(top);
    var spec = { key: key, inc: inc, yrs: yrs, f: {}, k1sel: {}, own: null };
    var hdr = h("div", "dr-row dr-wide dr-yhead"); hdr.appendChild(h("span", "", "")); var cell = h("div", "dr-ycells");
    yrs.forEach(function (y, idx) { cell.appendChild(h("span", "", /^file/.test(y) ? "Year " + (idx + 1) : "Tax year " + y)); }); hdr.appendChild(cell); box.appendChild(hdr);
    function frow(id, label, sub, vals) {
      var r = h("div", "dr-row dr-wide"), d = h("div"); d.appendChild(h("span", "", label)); if (sub) d.appendChild(h("small", "", sub)); r.appendChild(d);
      var c = h("div", "dr-ycells"); spec.f[id] = [];
      yrs.forEach(function (y, idx) { var inp = field(vals[idx] === null || vals[idx] === undefined ? "" : String(vals[idx])); if (vals[idx] !== null && vals[idx] !== undefined) inp.classList.add("dr-found"); inp.setAttribute("aria-label", label + ", " + (/^file/.test(y) ? "year " + (idx + 1) : "tax year " + y)); c.appendChild(inp); spec.f[id].push(inp); });
      r.appendChild(c); box.appendChild(r);
    }
    var D = yrs.map(function (y) { return found[key][y]; });
    if (key === "sc") {
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
    if (yrs.length >= 3) { var sl = h("label", "dr-inc"), c3 = h("input"); c3.type = "checkbox"; c3.checked = true; sl.appendChild(c3); sl.appendChild(h("span", "", "Use a 3-year average (you uploaded 3 years)")); box.appendChild(sl); spec.c3 = c3; }
    var dupN = yrs.filter(function (y) { return found[key][y].dup; }).length;
    if (dupN) box.appendChild(h("div", "dr-note", "The same tax year appeared in more than one file. We used the first one."));
    if (yrs.length < 2) box.appendChild(h("div", "dr-note", "Only one year was found. Lenders usually want two years of returns."));
    blocks.push(spec); p.appendChild(box);
  });
  p.appendChild(h("div", "dr-note", "This is an estimate for planning. It follows the usual add-backs, but your lender decides what income counts, and may use other figures or ask for more."));
  var ft;
  function calc() {
    var okAny = false;
    blocks.forEach(function (b) {
      if (!b.inc.checked) return;
      var needsK1 = Object.keys(b.k1sel).some(function (i) { return !b.k1sel[i].s.value; });
      if (!needsK1) okAny = true;
    });
    ft.summary.textContent = okAny ? "Ready to add to your self-employed income." : "Choose your K-1 above, or tick a return.";
    ft.use.disabled = !okAny;
  }
  ft = foot(p, "", function () {
    var payload = [];
    blocks.forEach(function (b) {
      if (!b.inc.checked) return;
      if (Object.keys(b.k1sel).some(function (i) { return !b.k1sel[i].s.value; })) return;
      var rows = {};
      Object.keys(b.f).forEach(function (id) { rows[id] = b.f[id].map(function (i) { return i.value.trim() === "" ? null : toNum(i.value) * (/^\s*[-(]/.test(i.value) ? -1 : 1); }); });
      payload.push({ key: b.key, rows: rows, own: b.ownInp ? toNum(b.ownInp.value) : null, three: !!(b.c3 && b.c3.checked), years: b.yrs.length });
    });
    api.applyTax(payload);
    msg(out, "Added to your self-employed income. You can still change it above.", "ok");
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
    if (housing) box.appendChild(h("div", "dr-note", "Housing payments are entered with your properties, not under debts. Tick the box only if this payment is not counted anywhere else."));
    if (a.lates) box.appendChild(row("Late payments on the report", a.late12 ? "At least one in the last 12 months" : (a.undated ? "Dates not found" : "None in the last 12 months"), h("div", "dr-ro bad", a.lates + (a.worst ? " (up to " + a.worst + " days)" : ""))));
    else box.appendChild(row("Late payments on the report", "", h("div", "dr-ro good", "None found")));
    p.appendChild(box); rows.push({ a: a, inc: inc, t: t, b: b });
  });
  var hl = open.some(function (a) { return (a.type === "mortgage" || a.type === "rent") && (a.late12 || (a.lates && a.undated)); });
  var nl = open.filter(function (a) { return a.lates > 0; }).length;
  if (hl) p.appendChild(h("div", "dr-note dr-alert", "A late mortgage or rent payment shows in the last 12 months. Lenders look closely at this. A warning will be added to your debts."));
  if (coll.length) p.appendChild(h("div", "dr-note dr-alert", (coll.length === 1 ? "1 collection or charge-off was found." : coll.length + " collections or charge-offs were found.") + ' "Do you have any tax liens, judgments, collections or charge-offs?" will be set to Yes.'));
  if (closed > 0) p.appendChild(row("Closed or paid accounts", "Left out", h("div", "dr-ro", String(closed))));
  var ft;
  function calc() { var tot = 0; rows.forEach(function (r) { if (r.inc.checked) tot += toNum(r.b.value); }); ft.summary.textContent = "Added to debts: " + usd(tot) + " a month"; }
  ft = foot(p, "", function () {
    var list = []; rows.forEach(function (r) { if (r.inc.checked && toNum(r.b.value) > 0) list.push({ type: r.t.value, amount: round2(toNum(r.b.value)) }); });
    api.applyDebts(list, { coll: coll.length, housingLate: hl, lateAccts: nl });
    msg(out, "Added to your debts. You can still change them below.", "ok");
  }, out);
  rows.forEach(function (r) { r.inc.addEventListener("change", calc); r.b.addEventListener("input", calc); });
  calc();
}

export function run(kind, files, out, api) { return kind === "pay" ? runPay(files[0], out, api) : kind === "credit" ? runCredit(files, out, api) : kind === "tax" ? runTax(files, out, api) : runBank(files, out, api); }
export { parsePay, parseStmt, readLines, readPages, parseTaxPages, parseCredit };
