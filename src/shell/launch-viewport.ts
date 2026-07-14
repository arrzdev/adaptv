//pre-paint shell viewport init for standalone PWAs. on an iOS standalone cold start
//the layout viewport (lvh/dvh) resolves against an initial containing block that
//paints small then expands after first paint — the "launch shift" that re-centers a
//top-anchored splash downward. `screen.height` is the physical panel (often taller
//than the usable viewport), so instead measure the *resolved* `100vh` once via a
//hidden fixed probe and freeze it into `--pwa-launch-height`; the splash then pins to
//a height that can't move. standalone only — a browser tab has no such shift, so the
//var stays unset there and the splash just centers.
export function getLaunchViewportInitScript(): string {
  return `(function(){try{if(!((window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)||window.navigator.standalone===true))return;var r=document.documentElement;var p=document.createElement('div');p.style.cssText='position:fixed;top:0;left:0;height:100vh;width:0;visibility:hidden;pointer-events:none';r.appendChild(p);var h=Math.round(p.getBoundingClientRect().height);p.remove();if(h>0)r.style.setProperty('--pwa-launch-height',h+'px');}catch(e){}})();`
}
