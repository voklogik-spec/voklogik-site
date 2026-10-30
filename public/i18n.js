/* Voklogik EN | ES. Translates the page in place from a dictionary (/i18n-es.js).
   English stays the source text. Numbers are kept as typed and slotted into the Spanish sentence.
   Choice is remembered in this browser (localStorage "voklogik:lang"); ?lang=es or ?lang=en sets it. No auto-switching. */
(function(){
  var KEY="voklogik:lang",LANG="en",ATTRS=["placeholder","title","aria-label","alt"];
  try{
    var q=new URLSearchParams(location.search).get("lang");
    if(q==="es"||q==="en")localStorage.setItem(KEY,q);
    LANG=localStorage.getItem(KEY)==="es"?"es":"en";
  }catch(e){}
  var MON="January|February|March|April|May|June|July|August|September|October|November|December";
  var ES_MON=["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  var TOK=new RegExp("\\b("+MON+")(?: (\\d{1,2}),)? (\\d{4})\\b|\\$?\\d[\\d,]*(?:\\.\\d+)?%?(?!\\w)","g");
  var miss={}, tracked=new Set(), tOrig=new WeakMap(), aOrig=new WeakMap(), obs=null;
  window.vkLang=function(){return LANG};
  window.vkLocale=function(){return LANG==="es"?"es-US":"en-US"};
  window.__vkMiss=miss;

  function norm(s){return s.replace(/\s+/g," ").trim()}
  function key(s){
    var nums=[];
    var k=norm(s).replace(TOK,function(m,mon,day,yr){
      if(mon){var mi=("January February March April May June July August September October November December").split(" ").indexOf(mon);
        nums.push((day?day+" de ":"")+ES_MON[mi]+" de "+yr)}
      else nums.push(m);
      return "{"+nums.length+"}";
    });
    return {k:k,nums:nums};
  }
  function fill(t,nums){return t.replace(/\{(\d+)\}/g,function(m,i){var v=nums[i-1];return v==null?m:v})}
  var SUF=/^(.*?)(,? )(Most recent year|Prior year|Two years back)$/;
  function lookup(s,sub){
    var D=window.VK_ES;if(!D)return null;
    var o=key(s),t=D[o.k];
    if(t!=null)return fill(t,o.nums);
    if(/^\{\d+\}$/.test(o.k))return o.nums[0];
    var m=SUF.exec(norm(s));
    if(m){var a=lookup(m[1],1),b=D[m[3]];if(a!=null&&b!=null)return a+m[2]+b}
    if(sub)return null;
    var R=window.VK_ES_RULES||[],ns=norm(s);
    for(var i=0;i<R.length;i++){
      var re=new RegExp(R[i][0]);
      if(re.test(ns)){
        var out0=ns.replace(re,R[i][1]);
        (R[i][2]||[]).forEach(function(x){out0=out0.split(x[0]).join(x[1])});
        return out0;
      }
    }
    // "label, detail" compound strings: translate each part
    if(o.k.indexOf(", ")>0){
      var parts=ns.split(", "),out=[],ok=true;
      for(var j=0;j<parts.length;j++){var p=lookup(parts[j],1);if(p==null){ok=false;break}out.push(p)}
      if(ok)return out.join(", ");
    }
    // several sentences: translate each sentence
    var sents=ns.split(/(?<=[.!?]) /);
    if(sents.length>1){
      var o2=[],ok2=true;
      for(var q=0;q<sents.length;q++){
        var sn=sents[q],tt=lookup(sn,1);
        if(tt==null&&/\.$/.test(sn)){var t3=lookup(sn.slice(0,-1),1);if(t3!=null)tt=t3+"."}
        if(tt==null){ok2=false;break}
        o2.push(tt);
      }
      if(ok2)return o2.join(" ");
    }
    return null;
  }
  // Translate any English string (for reports, PDFs). Returns it unchanged in English or when no entry exists.
  function tr(s){
    if(LANG!=="es"||s==null)return s;
    s=String(s);
    if(!/[A-Za-z]/.test(s))return s;
    var lead=s.match(/^\s*/)[0],trail=s.match(/\s*$/)[0];
    var t=lookup(s);
    if(t==null){var k=key(s).k;if(isEs(k))return s;if(/[A-Za-z]{3}/.test(k.replace(/\{\d+\}/g,"")))miss[k]=1;return s}
    return lead+t+trail;
  }
  window.vkTr=tr;
  var TK=["a","b","t","w","head","sub","date","disclaimer","urla"];
  function trObj(o){
    if(LANG!=="es"||o==null)return o;
    if(Array.isArray(o))return o.map(trObj);
    if(typeof o==="object"){var r={};for(var k in o){var v=o[k];r[k]=(TK.indexOf(k)>-1&&typeof v==="string")?tr(v):(typeof v==="object"?trObj(v):v)}return r}
    return o;
  }
  window.vkTrObj=trObj;
  // Wrap a jsPDF document so every string it prints goes through the dictionary (no-op in English).
  var WRAPPED=new WeakSet();
  window.vkPdf=function(d){
    if(LANG!=="es"||WRAPPED.has(d))return d;
    WRAPPED.add(d);var t0=d.text,s0=d.splitTextToSize;
    var T=function(x){return Array.isArray(x)?x.map(tr):(typeof x==="string"?tr(x):x)};
    d.text=function(t){var a=[].slice.call(arguments);a[0]=T(t);return t0.apply(d,a)};
    d.splitTextToSize=function(t,w,o){return s0.call(d,T(t),w,o)};
    return d;
  };
  // Spanish text back to its English source (for code that matches on English labels).
  var REV=null;
  window.vkUntr=function(x){
    if(LANG!=="es"||!window.VK_ES)return x;
    if(!REV){REV={};var D=window.VK_ES;for(var e in D){if(D[e].indexOf("{")<0&&!(D[e] in REV))REV[D[e]]=e}}
    var k=norm(x);return REV[k]!=null?REV[k]:x;
  };

  var ESV=null;
  function isEs(k){
    var D=window.VK_ES;if(!D)return false;
    if(!ESV){ESV={};for(var e in D)ESV[D[e]]=1}
    return !!ESV[k];
  }
  function doText(n){
    var v=n.nodeValue,rec=tOrig.get(n);
    if(rec&&v===rec.es)return;
    if(LANG!=="es"){if(rec)tOrig.delete(n);return}
    if(!v||!/[A-Za-z]/.test(v))return;
    var p=n.parentNode;if(p&&(p.nodeName==="SCRIPT"||p.nodeName==="STYLE"||p.nodeName==="TEXTAREA"||p.nodeName==="TITLE"))return;
    var es=tr(v);
    if(es!==v){tOrig.set(n,{en:v,es:es});tracked.add(n);n.nodeValue=es}
    else if(rec)tOrig.delete(n);
  }
  function doAttrs(el){
    if(!el.getAttribute)return;
    for(var i=0;i<ATTRS.length;i++){
      var a=ATTRS[i],v=el.getAttribute(a);if(v==null)continue;
      var m=aOrig.get(el),rec=m&&m[a];
      if(rec&&v===rec.es)continue;
      if(LANG!=="es"){if(rec)delete m[a];continue}
      if(!/[A-Za-z]/.test(v))continue;
      var es=tr(v);
      if(es!==v){if(!m){m={};aOrig.set(el,m)}m[a]={en:v,es:es};tracked.add(el);el.setAttribute(a,es)}
    }
  }
  function walk(root){
    if(!root)return;
    if(root.nodeType===3){doText(root);return}
    if(root.nodeType!==1)return;
    var nn=root.nodeName;if(nn==="SCRIPT"||nn==="STYLE")return;
    doAttrs(root);
    var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT,null),n;
    while(n=w.nextNode()){
      if(n.nodeType===3)doText(n);
      else if(n.nodeName!=="SCRIPT"&&n.nodeName!=="STYLE")doAttrs(n);
    }
  }
  function restore(){
    tracked.forEach(function(n){
      if(n.nodeType===3){var r=tOrig.get(n);if(r&&n.nodeValue===r.es)n.nodeValue=r.en;tOrig.delete(n)}
      else{var m=aOrig.get(n);if(m){for(var a in m){if(n.getAttribute(a)===m[a].es)n.setAttribute(a,m[a].en)}aOrig.delete(n)}}
    });
    tracked.clear();
  }
  function meta(){
    document.documentElement.lang=LANG;
    var md=document.querySelector('meta[name="description"]');
    if(md){if(!md._en)md._en=md.getAttribute("content");md.setAttribute("content",LANG==="es"?tr(md._en):md._en)}
    if(!document._enTitle)document._enTitle=document.title;
    document.title=LANG==="es"?tr(document._enTitle):document._enTitle;
  }
  function start(){
    if(obs||!document.documentElement)return;
    obs=new MutationObserver(function(list){
      for(var i=0;i<list.length;i++){
        var r=list[i];
        if(r.type==="characterData")doText(r.target);
        else if(r.type==="attributes")doAttrs(r.target);
        else for(var j=0;j<r.addedNodes.length;j++)walk(r.addedNodes[j]);
      }
      if(tracked.size>6000)tracked.forEach(function(n){if(!n.isConnected)tracked.delete(n)});
    });
    obs.observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:ATTRS});
  }
  function apply(){walk(document.body);meta();syncBtn();document.dispatchEvent(new CustomEvent("vklang",{detail:LANG}))}
  function setLang(l){
    if(l===LANG)return;
    LANG=l==="es"?"es":"en";
    try{localStorage.setItem(KEY,LANG)}catch(e){}
    try{if(typeof track==="function")track("language_changed",{language:LANG})}catch(e){}
    if(LANG==="es"&&!window.VK_ES){
      var s=document.createElement("script");s.src="/i18n-es.js";
      s.onload=function(){apply()};
      document.head.appendChild(s);
    }else if(LANG==="es"){apply()}
    else{restore();apply()}
  }
  window.vkSetLang=setLang;

  function syncBtn(){
    var b=document.getElementById("langSw");if(!b)return;
    b.setAttribute("data-lang",LANG);
    var en=b.querySelector('[data-l="en"]'),es=b.querySelector('[data-l="es"]');
    if(en)en.setAttribute("aria-pressed",LANG==="en");
    if(es)es.setAttribute("aria-pressed",LANG==="es");
  }
  function addButton(){
    if(document.getElementById("langSw"))return;
    var nav=document.querySelector("header nav");if(!nav)return;
    var b=document.createElement("span");b.id="langSw";b.className="langsw";b.setAttribute("role","group");b.setAttribute("aria-label","Language");
    b.innerHTML='<button type="button" data-l="en" lang="en" aria-label="English">EN</button><span aria-hidden="true">|</span><button type="button" data-l="es" lang="es" aria-label="Español">ES</button>';
    b.addEventListener("click",function(e){var t=e.target.closest&&e.target.closest("button[data-l]");if(t)setLang(t.getAttribute("data-l"))});
    nav.appendChild(b);
    if(!document.getElementById("langSwCss")){
      var st=document.createElement("style");st.id="langSwCss";
      st.textContent=".langsw{display:inline-flex;align-items:center;gap:2px;margin-left:10px;font-size:.85rem;color:var(--muted,#666)}"+
        ".langsw button{background:none;border:0;padding:4px 6px;font:inherit;font-weight:600;color:inherit;cursor:pointer;border-radius:4px;letter-spacing:.03em}"+
        ".langsw button[aria-pressed=true]{color:var(--accent,#C4581C);text-decoration:underline;text-underline-offset:4px}"+
        ".langsw button:focus-visible{outline:2px solid var(--accent,#C4581C);outline-offset:1px}";
      document.head.appendChild(st);
    }
    syncBtn();
  }

  if(LANG==="es"&&!window.VK_ES&&document.readyState==="loading")document.write('<script src="/i18n-es.js"><\/script>');
  start();
  function ready(){addButton();if(LANG==="es")apply();else syncBtn()}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",ready);else ready();
})();
