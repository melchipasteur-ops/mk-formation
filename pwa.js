/* MK-DESIGN GRAPH — mode application : enregistrement du service worker et invitation à installer. */
(function () {
  "use strict";
  var st = false; try { st = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; } catch (e) {}
  // Service worker (HTTPS ou localhost uniquement)
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    addEventListener("load", function () { navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(function (r) { try { r.update(); } catch (e) {} }).catch(function () {}); });
  }
  // Dans l'application installée : empêche le « tirer pour actualiser » de recharger la page par accident (travail en cours)
  if (st) { var s0 = document.createElement("style"); s0.textContent = "html,body{overscroll-behavior-y:contain}"; document.head.appendChild(s0); return; }

  var KEY = "mk_pwa_hide", def = null;
  var ua = navigator.userAgent || "", ios = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  function hidden() { try { var t = +localStorage.getItem(KEY) || 0; return Date.now() - t < 14 * 864e5; } catch (e) { return false; } }
  function hide() { var b = document.getElementById("mk-pwa"); if (b) b.remove(); }
  function dismiss() { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {} hide(); }
  function show(msg, btn) {
    if (hidden() || document.getElementById("mk-pwa") || !document.body) return;
    if (!document.getElementById("mk-pwa-css")) {
      var s = document.createElement("style"); s.id = "mk-pwa-css";
      s.textContent = "#mk-pwa{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:50;max-width:520px;margin:0 auto;background:#0f172a;color:#fff;border-radius:16px;padding:12px 14px;display:flex;gap:10px;align-items:center;box-shadow:0 10px 34px rgba(15,23,42,.4);font:14px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}#mk-pwa img{width:40px;height:40px;border-radius:10px;flex:none;background:#fff}#mk-pwa span{flex:1}#mk-pwa b{display:block;font-size:14px}#mk-pwa button{font:inherit;font-weight:700;border:0;border-radius:10px;padding:9px 14px;min-height:40px;cursor:pointer;background:#0b6fcf;color:#fff}#mk-pwa button.x{background:transparent;color:#94a3b8;padding:9px 8px;font-size:18px}@media print{#mk-pwa{display:none}}";
      document.head.appendChild(s);
    }
    var d = document.createElement("div"); d.id = "mk-pwa"; d.setAttribute("role", "dialog"); d.setAttribute("aria-label", "Installer l'application");
    d.innerHTML = '<img src="/icons/icon-192.png" alt=""><span><b>Installer l\u2019application</b>' + msg + "</span>" + (btn ? '<button type="button" id="mk-pwa-go">Installer</button>' : "") + '<button type="button" class="x" id="mk-pwa-x" aria-label="Fermer">\u2715</button>';
    document.body.appendChild(d);
    document.getElementById("mk-pwa-x").onclick = dismiss;
    var g = document.getElementById("mk-pwa-go");
    if (g) g.onclick = function () { if (!def) return hide(); def.prompt(); def.userChoice.then(function () { def = null; hide(); }, function () { hide(); }); };
  }
  addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); def = e; setTimeout(function () { if (def) show("Accès direct depuis votre écran d\u2019accueil, plein écran.", true); }, 2500); });
  addEventListener("appinstalled", function () { def = null; hide(); try { localStorage.removeItem(KEY); } catch (e) {} });
  if (ios) addEventListener("load", function () { setTimeout(function () { show("Touchez <b style=\"display:inline\">Partager</b> \u2B06\uFE0F puis \u00AB Sur l\u2019\u00E9cran d\u2019accueil \u00BB.", false); }, 3500); });
})();
