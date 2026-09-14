//pre-paint shell viewport init for standalone PWAs. on an iOS standalone cold start
//the layout viewport (lvh/dvh) resolves against an initial containing block that
//paints small then expands after first paint — the "launch shift" that re-centers a
//top-anchored splash downward. `screen.height` is the physical panel (often taller
//than the usable viewport), so instead measure the *resolved* `100vh` once via a
//hidden fixed probe and freeze it into `--pwa-launch-height`; the splash then pins to
//a height that can't move. standalone only — a browser tab has no such shift, so the
//var stays unset there and the splash just centers.
//
//The freeze only ever holds off GROWTH. On most launches an iOS 26.1 installed app runs
//this script while its web view is still the whole 874pt screen; ~120ms later the view
//shrinks to 812pt below the status bar and fires `resize`, while 100vh stays 874. Frozen
//there, the splash centred 31pt below the middle of what is on screen. So until the splash
//is revealed, a resize that leaves less than the frozen height lowers it to `innerHeight`
//plus the top inset. `innerHeight`, not `100dvh`: at that event 100dvh still reads 874
//and settles to 812 later, with no further resize. The same check runs once at head, for a
//reload of an already-shrunk page (applying a service-worker update, the stale-chunk
//recovery, the offline or boot-error retry): it reads 100vh 874 over innerHeight 812
//before first paint and never gets that resize. The top inset's var is resolved by then:
//this script is emitted before the stylesheet link, but every route stylesheet carries
//`precedence`, so React hoists the links ahead of it and the pending stylesheet blocks the
//script (pinned by the playground's screens e2e spec). On iOS 18 the page runs under the
//status bar and the inset makes the sum the whole screen, so growth there changes nothing.
//Only an iOS Home Screen app lowers it (`navigator.standalone`, which it sets and Android
//does not): the shrink was measured nowhere else, and an Android installed app with its
//keyboard still up could read a short innerHeight (not measured), so there the freeze stays.
//Not covered: a rotation before the reveal lowers the height without raising it back.
//The attribute is the one useSplashHandoff writes (pinned by the test).
export function getLaunchViewportInitScript(): string {
  return `(function(){try{if(!((window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)||window.navigator.standalone===true))return;var r=document.documentElement;function measure(height){var p=document.createElement('div');p.style.cssText='position:fixed;top:0;left:0;height:'+height+';width:0;visibility:hidden;pointer-events:none';r.appendChild(p);var h=Math.round(p.getBoundingClientRect().height);p.remove();return h}var h=measure('100vh');if(!(h>0))return;var ios=window.navigator.standalone===true;function lower(){var shown=Math.round(window.innerHeight)+measure('var(--adaptv-inset-top, 0px)');if(window.innerHeight>0&&shown<h)h=shown}if(ios)lower();r.style.setProperty('--pwa-launch-height',h+'px');if(!ios)return;var shrink=function(){if(r.hasAttribute('data-adaptv-splash-revealed')){window.removeEventListener('resize',shrink);return}var was=h;lower();if(h!==was)r.style.setProperty('--pwa-launch-height',h+'px')};window.addEventListener('resize',shrink)}catch(e){}})();`
}
