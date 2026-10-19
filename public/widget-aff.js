/* Affordability inside a member's Opal page (/affordability.html?w=<page-name>[&embed=1]).
   Adds the member's card at the top, a link back to the payment estimate, and a form that
   sends the member a summary. Does nothing on the normal Affordability page. */
(function(){
  var q=location.search,m=q.match(/[?&]w=([a-z0-9-]+)/i);
  if(!m)return;
  var H=m[1],embed=/[?&]embed=1/.test(q),pv=/[?&]pv=1/.test(q);
  function track(e){if(pv)return;try{var k="vk:ev:"+H+":"+e;if(sessionStorage.getItem(k))return;sessionStorage.setItem(k,"1")}catch(x){}
    try{fetch("/api/widget/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({h:H,e:e}),keepalive:true}).catch(function(){})}catch(x){}}
  if(embed)document.documentElement.classList.add("embed");
  var main=document.querySelector("main");if(!main)return;
  function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
  function link(txt,href){var a=el("a","",txt);a.href=href;return a}
  function safeHost(w){w=String(w||"").trim().replace(/^https?:\/\//i,"").replace(/\/+$/,"");return /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}([\/?#][A-Za-z0-9\/._~%?=&#+-]*)?$/.test(w)?w:null}
  var back=link("← Back to the payment estimate","/w/"+H+(embed&&pv?"?embed=1&pv=1":embed?"?embed=1":pv?"?pv=1":""));back.id="wBack";

  (window.VKTZ&&VKTZ.ready?VKTZ.ready:Promise.resolve()).then(function(){
    var P=window.VKTZ&&VKTZ.profile;
    if(!P||!P.brand){
      var g=el("div","","");g.style.cssText="text-align:center;padding:60px 16px";g.appendChild(el("h1","","This page is not available"));
      main.innerHTML="";main.appendChild(g);return;
    }
    var b=P.brand;track("aff");
    document.title=(b.name||b.company||"Affordability")+" | Affordability check";

    // member card
    var card=el("div");card.id="wAgent";
    if(b.logo){var l=el("img","logo");l.alt="";l.src=b.logo;card.appendChild(l)}
    if(b.headshot){var f=el("img","face");f.alt="";f.src=b.headshot;card.appendChild(f)}
    var who=el("div","who");who.appendChild(el("b","",b.name||b.company||""));
    who.appendChild(el("span","",[b.title,b.name?b.company:""].filter(Boolean).join(" · ")));
    var ct=el("div","ct");
    if(b.phone)ct.appendChild(link(b.phone,"tel:"+b.phone.replace(/[^0-9+]/g,"")));
    if(b.email&&/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(b.email))ct.appendChild(link(b.email,"mailto:"+b.email));
    var w=safeHost(b.website);if(w)ct.appendChild(link(w,"https://"+w));
    who.appendChild(ct);card.appendChild(who);
    main.insertBefore(card,main.firstChild);
    main.insertBefore(back,card.nextSibling);

    // lead form
    var who2=b.name||b.company||"your agent";
    var sec=el("section");sec.id="wLead";
    sec.appendChild(el("h2","","Want to talk it through?"));
    sec.appendChild(el("p","sub","Send this summary to "+who2+" and get a reply. Only what you tap Send on is shared."));
    var f2=document.createElement("form");f2.noValidate=true;
    function field(id,label,type,opt,max,ac){var d=el("div");var lb=el("label","",label);lb.htmlFor=id;
      if(opt){var o=el("span","", " (optional)");o.style.cssText="font-weight:400;color:#6A6678";lb.appendChild(o)}
      var i=document.createElement("input");i.id=id;i.type=type;i.maxLength=max;if(ac)i.autocomplete=ac;i.style.cssText="width:100%;padding:11px 12px;border:1px solid #DCD8E8;border-radius:8px;background:#F8F7FB;color:#2B2838;font:inherit";
      d.appendChild(lb);d.appendChild(i);return d}
    var grid=el("div","g");
    grid.appendChild(field("lName","Your name","text",false,80,"name"));grid.appendChild(field("lEmail","Email","email",false,120,"email"));
    grid.appendChild(field("lPhone","Phone","tel",true,30,"tel"));grid.appendChild(field("lMsg","Message","text",true,500));
    f2.appendChild(grid);
    var hp=el("div","hp");hp.setAttribute("aria-hidden","true");var hl=el("label","","Leave this empty");var hi=document.createElement("input");hi.id="lWeb";hi.tabIndex=-1;hi.autocomplete="off";hl.appendChild(hi);hp.appendChild(hl);f2.appendChild(hp);
    var cl=el("label","consent");var cb=document.createElement("input");cb.type="checkbox";cb.id="lOk";cl.appendChild(cb);
    cl.appendChild(el("span","","I agree that "+who2+" and Voklogik may contact me about this summary by email, and by phone if I add a number. I understand this is not a loan application, approval or commitment."));
    f2.appendChild(cl);
    var send=el("button","send","Send my summary");send.type="submit";f2.appendChild(send);
    var msg=el("p","msg");msg.setAttribute("role","status");f2.appendChild(msg);
    sec.appendChild(f2);main.appendChild(sec);

    var fine=el("p");fine.id="wFine";
    var ids=[];if(b.nmls)ids.push("NMLS ID #"+b.nmls);if(b.mls)ids.push(b.mls);
    fine.appendChild(document.createTextNode("This is an estimate for planning only. It is not a loan offer, pre-approval or commitment. "+(ids.length?ids.join(" · ")+" · ":"")+"Equal Housing Opportunity. "));
    fine.appendChild(link("Privacy notice","/privacy.html"));
    main.appendChild(fine);

    function say(c,t){msg.className="msg"+(c?" "+c:"");msg.textContent=t}
    f2.onsubmit=function(e){
      e.preventDefault();say("","");
      if(!$v("lName")){say("err","Please add your name.");return}
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test($v("lEmail"))){say("err","Please enter a valid email.");return}
      if(!cb.checked){say("err","Please tick the box so we know it is OK to contact you.");return}
      var rows=[];try{rows=window.__vkRows?window.__vkRows():[]}catch(x){}
      send.disabled=true;say("","Sending...");
      fetch("/api/widget/lead",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        h:H,name:$v("lName"),email:$v("lEmail"),phone:$v("lPhone"),message:$v("lMsg"),website:hi.value,consent:true,kind:"affordability",affordability:rows})})
      .then(function(r){return r.json().then(function(j){return{ok:r.ok&&j.ok,j:j}})}).then(function(x){
        if(x.ok){f2.hidden=true;sec.querySelector("h2").textContent="Thank you.";sec.querySelector(".sub").textContent="Your summary was sent. You should hear back soon."}
        else{send.disabled=false;say("err",x.j.error||"Could not send. Please try again.")}})
      .catch(function(){send.disabled=false;say("err","Could not send. Please try again.")});
    };
    function $v(id){var e=document.getElementById(id);return e?e.value.trim():""}
  });
})();
