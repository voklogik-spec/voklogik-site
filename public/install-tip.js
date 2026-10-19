/* "Add to home screen" reminder in the footer. Shows steps for the visitor's device. Hidden once the app is installed. */
(function(){
  var standalone=(window.matchMedia&&matchMedia("(display-mode: standalone)").matches)||navigator.standalone===true;
  if(standalone)return;
  var f=document.querySelector("footer");if(!f)return;
  var ua=navigator.userAgent||"",ios=/iphone|ipad|ipod/i.test(ua)||(/Macintosh/.test(ua)&&navigator.maxTouchPoints>1),android=/android/i.test(ua);
  var evt=null;window.addEventListener("beforeinstallprompt",function(e){evt=e});
  var a=document.createElement("a");a.href="#addhome";a.textContent="Add to home screen";a.id="addHome";
  f.appendChild(document.createTextNode(" · "));f.appendChild(a);
  var box=document.createElement("div");box.id="homeTip";box.hidden=true;
  box.style.cssText="margin:14px 0 0;padding:14px 16px;background:var(--panel,#fff);border:1px solid var(--line,#ccc);border-radius:8px;color:var(--ink,#222);font-size:.95rem;line-height:1.5;max-width:560px";
  function li(t){return "<li>"+t+"</li>"}
  var steps={
    ios:li("Open <b>voklogik.com</b> in <b>Safari</b>.")+li("Tap the <b>Share</b> icon (the square with an arrow) at the bottom of the screen.")+li("Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>."),
    android:li("Open <b>voklogik.com</b> in <b>Chrome</b>.")+li("Tap the <b>⋮</b> menu at the top right.")+li("Tap <b>Install app</b> (or <b>Add to Home screen</b>), then confirm."),
    desktop:li("In <b>Chrome</b> or <b>Edge</b>, click the install icon at the right end of the address bar.")+li("Or open the browser menu and choose <b>Install Voklogik</b>.")
  };
  var order=ios?["ios","android","desktop"]:android?["android","ios","desktop"]:["desktop","ios","android"];
  var names={ios:"iPhone and iPad",android:"Android",desktop:"Computer"};
  var h='<b>Keep Voklogik on your home screen</b><p style="margin:4px 0 8px;color:var(--muted,#666)">Opens like an app, in one tap.</p>';
  order.forEach(function(k,i){h+=(i?'<details style="margin-top:8px"><summary style="cursor:pointer">'+names[k]+'</summary>':'<div><b>'+names[k]+'</b>')+'<ol style="margin:6px 0 0;padding-left:20px">'+steps[k]+'</ol>'+(i?'</details>':'</div>')});
  h+='<p style="margin:10px 0 0"><button type="button" id="homeNow" hidden style="background:var(--accent,#C4581C);color:var(--on-accent,#fff);border:0;border-radius:6px;padding:8px 14px;font:inherit;font-weight:700;cursor:pointer">Install now</button> <button type="button" id="homeClose" style="background:none;border:0;color:var(--muted,#666);cursor:pointer;font:inherit;text-decoration:underline">Close</button></p>';
  box.innerHTML=h;f.appendChild(box);
  a.addEventListener("click",function(e){e.preventDefault();box.hidden=!box.hidden;
    var b=document.getElementById("homeNow");b.hidden=!evt;if(!box.hidden)box.scrollIntoView({block:"nearest",behavior:"smooth"})});
  document.getElementById("homeClose").onclick=function(){box.hidden=true};
  document.getElementById("homeNow").onclick=function(){if(!evt)return;try{evt.prompt();evt.userChoice.then(function(){evt=null;box.hidden=true})}catch(x){}};
})();
