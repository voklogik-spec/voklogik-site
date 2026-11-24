/* © 2026 Voklogik LLC. All rights reserved. Proprietary and confidential. Voklogik™, Topaz™ and Opal™ are trademarks of Voklogik LLC. */
/* Free report rules, shared by the payment analyzer and the Affordability check.
   - Preview is always free and carries the Voklogik watermark.
   - A visitor's first clean report (save or print, no watermark) is free once they ask for a summary by email.
   - After that a clean report needs a Homebuyer Pass or a business plan.
   - Visitors who already used some of the earlier 5 free reports keep the ones they have left. */
(function(){
  var UK="voklogik:reports",CK="voklogik:freecap",DK="voklogik:freeclaimed";
  function get(k){try{return localStorage.getItem(k)}catch(e){return null}}
  function set(k,v){try{localStorage.setItem(k,v)}catch(e){}}
  var F=window.VKFREE={clean:false,prev:false}; // clean: the report being made has no watermark; prev: it is a preview
  // How many free reports this browser was given: 5 for earlier visitors, 1 after the email step, otherwise 0.
  F.cap=function(){
    var c=parseInt(get(CK),10);if(c===1||c===5)return c;
    if(get(UK)!==null&&!get(DK)){set(CK,"5");return 5}
    return 0;
  };
  F.canOffer=function(){return F.cap()===0&&!get(DK)};
  F.vid=function(){var v=get("voklogik:vid");if(!v){try{v=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():""}catch(e){v=""}
    if(!v){var h="abcdef0123456789";for(var i=0;i<32;i++)v+=h.charAt(Math.floor(Math.random()*16))}set("voklogik:vid",v)}return v};
  function payRows(){try{window.dispatchEvent(new Event("pagehide"))}catch(e){} // makes the page write its latest entries to storage
    try{var p=JSON.parse(get("voklogik:payment")||"null");var m=function(n){return "$"+Math.round(n).toLocaleString("en-US")};
    if(p&&p.total)return[["## Monthly payment",""],["Home price",p.price?m(p.price):"n/a"],["Loan amount",m(p.loan)],["Rate",p.ratePct+"%"],["Term",p.years+" years"],["Estimated monthly payment",m(p.total)]]}catch(e){}return[]}
  F.rows=function(){var r=[];try{if(window.__vkRows)r=window.__vkRows()}catch(e){}return r&&r.length?r:payRows()};

  function el(t,css,txt){var e=document.createElement(t);if(css)e.style.cssText=css;if(txt!=null)e.textContent=txt;return e}
  // Opens the email step. opts.rows is the summary to send; done() runs once the free report is granted.
  F.offer=function(opts,done){
    // Inside the home page's embedded Affordability check, show the box on the page the visitor is looking at.
    try{if(window.parent!==window&&window.parent.VKFREE&&window.parent.VKFREE.offer!==F.offer){window.parent.VKFREE.offer(opts,function(){set(CK,"1");done()});return}}catch(e){}
    var old=document.getElementById("vkFree");if(old)old.remove();
    var ov=el("div","position:fixed;inset:0;z-index:100000;background:rgba(3,7,18,.6);display:flex;align-items:center;justify-content:center;padding:16px");ov.id="vkFree";ov.setAttribute("role","dialog");ov.setAttribute("aria-modal","true");ov.setAttribute("aria-labelledby","vkFreeH");
    var bx=el("div","background:#fff;color:#0F172A;border-radius:12px;border-top:4px solid #FF5500;max-width:440px;width:100%;padding:22px 22px 18px;font:15px/1.5 Inter,-apple-system,'Segoe UI',Arial,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.35);max-height:92vh;overflow:auto");
    var h=el("h2","margin:0 0 6px;font:700 1.25rem/1.25 inherit;color:#0F172A","Your first clean report is free");h.id="vkFreeH";
    var p=el("p","margin:0 0 14px;color:#475569","Tell us where to send it. We will email you a summary of your report, and this report saves or prints without the watermark.");
    var lb=el("label","display:block;font-weight:600;font-size:.9rem;margin:0 0 4px","Your email");lb.htmlFor="vkFreeEmail";
    var em=el("input","width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #CBD5E1;border-radius:8px;font:inherit;color:#0F172A;background:#fff");em.type="email";em.id="vkFreeEmail";em.autocomplete="email";em.maxLength=120;
    var hp=el("input","position:absolute;left:-9999px;width:1px;height:1px");hp.tabIndex=-1;hp.autocomplete="off";hp.setAttribute("aria-hidden","true");
    var cl=el("label","display:flex;gap:10px;align-items:flex-start;margin:12px 0 0;font-size:.86rem;color:#475569;font-weight:400"),cb=el("input","width:18px;height:18px;flex:none;margin-top:2px");cb.type="checkbox";cb.id="vkFreeOk";
    cl.appendChild(cb);cl.appendChild(el("span","","Email me a summary of my report, and occasional Voklogik updates. I can unsubscribe at any time."));
    var msg=el("p","margin:10px 0 0;min-height:20px;font-size:.88rem;color:#B91C1C");msg.setAttribute("role","status");
    var go=el("button","display:block;width:100%;margin:6px 0 0;background:#FF5500;color:#fff;border:0;border-radius:8px;padding:13px 16px;font:700 1rem inherit;cursor:pointer","Email me a summary of my report");go.type="button";
    var no=el("button","display:block;width:100%;margin:8px 0 0;background:none;border:0;color:#475569;padding:8px;font:600 .9rem inherit;cursor:pointer;text-decoration:underline","Not now");no.type="button";
    var fine=el("p","margin:10px 0 0;font-size:.78rem;color:#64748B");fine.appendChild(document.createTextNode("Preview is always free. After this one, a clean report needs a Homebuyer Pass: $14.99 for 25 reports over 30 days. "));
    var pl=el("a","color:#0369A1","Privacy notice");pl.href="/privacy.html";pl.target="_blank";pl.rel="noopener";fine.appendChild(pl);
    [h,p,lb,em,hp,cl,msg,go,no,fine].forEach(function(x){bx.appendChild(x)});ov.appendChild(bx);document.body.appendChild(ov);
    function close(){ov.remove();document.removeEventListener("keydown",esc)}
    function esc(e){if(e.key==="Escape")close()}
    document.addEventListener("keydown",esc);no.onclick=close;ov.addEventListener("mousedown",function(e){if(e.target===ov)close()});
    setTimeout(function(){try{em.focus()}catch(e){}},30);
    em.addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();go.click()}});
    go.onclick=function(){
      var v=em.value.trim();msg.style.color="#B91C1C";
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)){msg.textContent="Please enter a valid email.";return}
      if(!cb.checked){msg.textContent="Please tick the box so we know it is OK to email you.";return}
      go.disabled=true;go.style.opacity=".6";msg.style.color="#475569";msg.textContent="Sending...";
      fetch("/.netlify/functions/free-report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:F.vid(),email:v,consent:true,website:hp.value,kind:(opts&&opts.kind)||"",rows:(opts&&opts.rows)||[]})})
       .then(function(r){return r.json().then(function(j){return{st:r.status,j:j}})}).then(function(x){
         if(x.j&&x.j.ok){set(CK,"1");close();try{if(window.track)track("free_report_email")}catch(e){}done()}
         else{go.disabled=false;go.style.opacity="1";msg.style.color="#B91C1C";msg.textContent=(x.j&&x.j.error)||"Could not send. Please try again.";
           if(x.st===409){set(DK,"1");if(opts&&opts.onUsed)try{opts.onUsed()}catch(e){}}}})
       .catch(function(){go.disabled=false;go.style.opacity="1";msg.style.color="#B91C1C";msg.textContent="Could not send. Please try again."});
    };
  };
})();
