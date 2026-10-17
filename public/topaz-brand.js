/* Topaz / Opal branding for reports. Loaded by the calculator and Affordability pages.
   Only does anything when the visitor signed in on /topaz.html on this device. */
(function(){
  var V=window.VKTZ={acct:null,now:false,printing:false,_dim:{}};
  var flag=false;try{flag=localStorage.getItem("voklogik:topaz")==="1"}catch(e){}
  function brand(){return (V.acct&&V.acct.brand)||{}}
  V.active=function(){return !!V.acct&&(V.acct.plan==="topaz"||V.acct.plan==="opal")};
  // Branded when the plan is active and has reports left (or this very report just used the last one).
  V.branded=function(){return V.active()&&(V.now||V.acct.left!==0)};
  V.exhausted=function(){return V.active()&&V.acct.left===0&&!V.now};
  V.use=function(){
    return fetch("/api/topaz/use",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:"{}"})
      .then(function(r){return r.json()}).then(function(j){
        if(j.ok){V.acct.left=j.left;if(V.acct.limit!=null)V.acct.used=V.acct.limit-j.left;V.bar()}
        else if(j.left===0){V.acct.left=0;V.bar()}
        return j});
  };
  V.lines=function(){
    var b=brand(),a=[];
    var who=[b.name,b.title,b.company].filter(Boolean).join(", ");
    var c=[b.phone,b.email,b.website].filter(Boolean);
    var ids=[b.mls?"MLS# "+String(b.mls).replace(/^MLS#?\s*/i,""):"",b.nmls?"NMLS ID "+String(b.nmls).replace(/^NMLS( ID)?#?\s*/i,""):""].filter(Boolean);
    if(who)a.push(who);
    var rest=c.concat(ids).join("   |   ");if(rest)a.push(rest);
    return a;
  };
  V.title=function(){var b=brand();return b.company||b.name||"Voklogik"};
  function dim(src){
    if(!src)return null;
    if(V._dim[src])return V._dim[src];
    return null;
  }
  function preload(){
    ["logo","headshot"].forEach(function(k){var s=brand()[k];if(!s||V._dim[s])return;
      var im=new Image();im.onload=function(){V._dim[s]={w:im.width,h:im.height}};im.src=s});
  }
  function fit(src,bw,bh){var d=dim(src)||{w:bw,h:bh},s=Math.min(bw/d.w,bh/d.h);return{w:d.w*s,h:d.h*s}}
  function kind(src){return /^data:image\/png/.test(src)?"PNG":"JPEG"}
  // Draw the logo (or company name) and headshot inside a report header. Returns the x where headshot starts.
  V.drawBrand=function(d,o){ // o: x,y,boxW,boxH,PW,L,fg,fontName,nameSize,nameBaseline
    var b=brand(),right=o.PW-o.L;
    if(b.logo){try{var f=fit(b.logo,o.boxW,o.boxH);d.addImage(b.logo,kind(b.logo),o.L,o.y+(o.boxH-f.h)/2,f.w,f.h)}catch(e){}}
    else{d.setTextColor(o.fg[0],o.fg[1],o.fg[2]);d.setFont(o.fontName,"bold");d.setFontSize(o.nameSize);d.text(V.title(),o.L,o.nameBase)}
    if(b.headshot){try{var h=o.boxH;d.addImage(b.headshot,kind(b.headshot),right-h,o.y,h,h);right-=h+12}catch(e){}}
    return right;
  };
  V.drawLines=function(d,x,y,color,maxW,font){
    var ls=V.lines();if(!ls.length)return;
    d.setTextColor(color[0],color[1],color[2]);d.setFont(font,"normal");
    ls.forEach(function(t,i){var sz=9.5;d.setFontSize(sz);while(d.getTextWidth(t)>maxW&&sz>6){sz-=.5;d.setFontSize(sz)}d.text(t,x,y+i*11)});
  };
  function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
  V.printHtml=function(){
    if(!V.branded())return "";
    var b=brand(),ls=V.lines();
    return '<div class="tz-print">'+(b.logo?'<img class="tz-logo" src="'+b.logo+'" alt="">':"")
      +'<div class="tz-txt"><b>'+esc(ls[0]||V.title())+'</b>'+ls.slice(1).map(function(l){return"<br>"+esc(l)}).join("")+'</div>'
      +(b.headshot?'<img class="tz-head" src="'+b.headshot+'" alt="">':"")+'</div>';
  };
  // Calculator page: put the block just above the "Prepared for" line.
  V.mountPrint=function(on){
    var host=document.getElementById("tzPrint");
    if(!host){var p=document.getElementById("prepPrint");if(!p)return;host=document.createElement("div");host.id="tzPrint";p.parentNode.insertBefore(host,p)}
    host.innerHTML=on?V.printHtml():"";
  };
  var css=document.createElement("style");
  css.textContent=".tz-print{display:flex;align-items:center;gap:14px;border-bottom:3px solid #E8681A;padding:0 0 10px;margin:0 0 14px;font:13px/1.4 Arial,sans-serif;color:#222}.tz-print .tz-logo{max-height:56px;max-width:170px}.tz-print .tz-txt{flex:1}.tz-print .tz-head{width:56px;height:56px;border-radius:50%;object-fit:cover}"
   +".tz-hero{max-width:520px;margin:0 auto;background:#14707A;background:linear-gradient(160deg,#1A8089,#0F5F68);color:#fff;border-bottom:5px solid #E8681A;border-radius:14px;padding:24px 28px;text-align:left;font-family:-apple-system,Segoe UI,Arial,sans-serif}.tz-top{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}.tz-hero h2{margin:0;font-size:1.7rem;line-height:1.15;color:#fff;font-family:inherit;display:flex;flex-wrap:wrap;align-items:center;gap:0 10px}.tz-hero h2 span{flex-basis:100%;font-size:.8rem;font-weight:500;letter-spacing:.9px;text-transform:uppercase;color:#CDEBEC;margin:4px 0 0 36px}.tz-gem{display:inline-block;width:26px;height:26px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#FFE3A6,#E2A03F 60%,#B87420);box-shadow:0 0 0 2px rgba(255,255,255,.35)}.tz-gem.opal{background:radial-gradient(circle at 35% 30%,#fff,#C9E4E8 40%,#E8C8E0 70%,#B7D7C9)}.tz-logo{max-height:54px;max-width:140px;background:#fff;border-radius:8px;padding:6px 8px;object-fit:contain}.tz-face{width:54px;height:54px;border-radius:50%;object-fit:cover;border:2px solid #fff}.tz-big{font-size:1.25rem;font-weight:600;margin:16px 0 12px;color:#fff}.tz-lab{display:flex;justify-content:space-between;font-size:.8rem;color:#CDEBEC;margin:0 0 5px}.tz-meter{height:10px;background:#0B4850;border-radius:6px;overflow:hidden}.tz-meter i{display:block;height:100%;background:#E8681A}.tz-small{font-size:.85rem;color:#D5EEEE;margin:12px 0 0}.tz-acts{margin:16px 0 0;display:flex;gap:10px;flex-wrap:wrap}.tz-btn{background:#E8681A;color:#fff;text-decoration:none;font-weight:700;border-radius:8px;padding:10px 16px;font-size:.92rem}.tz-btn.ghost{background:none;border:1px solid #8CC9CE}"
   +"#tzPrint{display:none}@media print{#tzPrint:not(:empty){display:block}}"
   +"#tzBar{background:#0F5F68;color:#fff;border-bottom:3px solid #E8681A;font:14px/1.3 -apple-system,Segoe UI,Arial,sans-serif;padding:8px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}#tzBar b{letter-spacing:.3px}#tzBar .c{display:inline-block;width:16px;height:16px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#FFE3A6,#E2A03F 60%,#B87420);box-shadow:0 0 0 2px rgba(255,255,255,.35)}#tzBar .c.opal{background:radial-gradient(circle at 35% 30%,#fff,#C9E4E8 40%,#E8C8E0 70%,#B7D7C9)}#tzBar a{color:#fff;margin-left:auto}@media print{#tzBar{display:none!important}}";
  document.head.appendChild(css);
  // Home page: members see their Topaz level in place of the "Pick what fits you" plans.
  function heroSwap(){
    var h=document.getElementById("plans");
    if(!h||!h.classList.contains("plans-hero")||!V.active())return false;
    var a=V.acct,name=a.plan==="opal"?"Opal":"Topaz",lim=a.limit,b=a.brand||{};
    var pct=lim==null?100:Math.max(0,Math.min(100,(a.left/lim)*100));
    var first=(b.name||"").trim().split(/\s+/)[0]||"";
    var renew=a.periodEnd?(a.cancelAtPeriodEnd?"Ends ":"Renews ")+new Date(a.periodEnd).toLocaleDateString():"";
    var badge=b.logo?'<img class="tz-logo" src="'+b.logo+'" alt="">':(b.headshot?'<img class="tz-face" src="'+b.headshot+'" alt="">':"");
    h.innerHTML='<div class="tz-hero"><div class="tz-top"><div><h2><i class="tz-gem '+(a.plan==="opal"?"opal":"")+'"></i>'+name+' Level <span>by voklogik</span></h2></div>'+badge+'</div>'
      +'<p class="tz-big">Welcome back'+(first?", "+esc(first):"")+'.</p>'
      +'<div class="tz-lab"><span>Reports left this month</span><span>'+(lim==null?"Unlimited":esc(renew))+'</span></div><div class="tz-meter"><i style="width:'+pct+'%"></i></div>'
      +'<p class="tz-small">Your logo, headshot and contact details are on every report you save or print.</p>'
      +'<p class="tz-acts"><a class="tz-btn" href="/topaz.html">Dashboard and branding</a><a class="tz-btn ghost" href="/affordability">Affordability check</a></p></div>';
    h.id="plans";return true;
  }
  V.bar=function(){
    if(!document.body){document.addEventListener("DOMContentLoaded",V.bar);return}
    var el=document.getElementById("tzBar");
    heroSwap();
    if(!V.acct){if(el)el.remove();return}
    if(!el){el=document.createElement("div");el.id="tzBar";document.body.insertBefore(el,document.body.firstChild)}
    var a=V.acct,txt=!V.active()?"Topaz is not active on this account.":(a.left==null?"Unlimited branded reports":a.left+" of "+a.limit+" branded reports left this month");
    el.innerHTML='<span class="c'+(a.plan==="opal"?" opal":"")+'"></span><b>'+(a.plan==="opal"?"Opal":"Topaz")+' Level by voklogik</b><span>'+esc(txt)+'</span><a href="/topaz.html">Dashboard</a>';
  };
  V.ready=flag?fetch("/api/topaz/me",{credentials:"same-origin"}).then(function(r){return r.ok?r.json():null}).then(function(j){
      if(j&&j.ok){V.acct=j.account;preload();V.bar()}else{try{localStorage.removeItem("voklogik:topaz")}catch(e){}}
      if(V.onchange)V.onchange()}).catch(function(){}):Promise.resolve();
})();
