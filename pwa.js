/* MK-DIGIT GRAPH — mode application : service worker, invitation à installer (avec solutions de secours) et diagnostic (?pwa=debug). */
(function () {
  "use strict";
  var st = false; try { st = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; } catch (e) {}
  var debug = /[?&]pwa=debug\b/.test(location.search), KEY = "mk_pwa_hide", def = null, got = false;
  var ua = navigator.userAgent || "", ios = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1),
      android = /Android/i.test(ua), mobile = ios || android || /Mobile/i.test(ua),
      inapp = /FBAN|FBAV|FB_IAB|Instagram|MicroMessenger|TikTok|Snapchat|Line\/|; wv\)/i.test(ua);

  // Service worker (HTTPS ou localhost uniquement)
  var swState = "non démarré";
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    addEventListener("load", function () { navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(function (r) { swState = "enregistré (" + r.scope + ")"; try { r.update(); } catch (e) {} }).catch(function (e) { swState = "ÉCHEC : " + (e && e.message || e); }); });
  } else swState = "indisponible (HTTPS requis ou navigateur non compatible)";

  // Mémoire de la fermeture du bandeau (14 jours)
  function hidden() { try { return Date.now() - (+localStorage.getItem(KEY) || 0) < 14 * 864e5; } catch (e) { return false; } }
  function css() {
    if (document.getElementById("mk-pwa-css")) return;
    var s = document.createElement("style"); s.id = "mk-pwa-css";
    s.textContent = "#mk-pwa{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:50;max-width:520px;margin:0 auto;background:#0f172a;color:#fff;border-radius:16px;padding:12px 14px;display:flex;gap:10px;align-items:center;box-shadow:0 10px 34px rgba(15,23,42,.4);font:14px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}#mk-pwa img{width:40px;height:40px;border-radius:10px;flex:none;background:#fff}#mk-pwa span{flex:1}#mk-pwa b.t{display:block;font-size:14px}#mk-pwa button{font:inherit;font-weight:700;border:0;border-radius:10px;padding:9px 14px;min-height:40px;cursor:pointer;background:#0b6fcf;color:#fff}#mk-pwa button.x{background:transparent;color:#94a3b8;padding:9px 8px;font-size:18px}#mk-chip{position:fixed;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:40;font:700 13px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;border:0;border-radius:999px;padding:9px 14px;min-height:38px;cursor:pointer;background:#0b6fcf;color:#fff;box-shadow:0 6px 20px rgba(15,23,42,.35)}#mk-dbg{position:fixed;top:0;left:0;right:0;z-index:99;max-height:70vh;overflow:auto;background:#0f172a;color:#e2e8f0;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:calc(10px + env(safe-area-inset-top,0px)) 12px 12px;white-space:pre-wrap;word-break:break-word}@media print{#mk-pwa,#mk-chip,#mk-dbg{display:none}}";
    document.head.appendChild(s);
  }
  function rm(id) { var b = document.getElementById(id); if (b) b.remove(); }
  // Contenu adapté au navigateur de la personne
  function content() {
    if (def) return { msg: "Accès direct depuis votre écran d\u2019accueil, en plein écran.", btn: true };
    if (inapp) return { msg: "Ouvrez ce site dans <b>Chrome</b> (menu \u22EE puis \u00AB Ouvrir dans le navigateur \u00BB) pour pouvoir l\u2019installer." };
    if (ios) return { msg: "Touchez <b>Partager</b> \u2B06\uFE0F puis \u00AB Sur l\u2019\u00E9cran d\u2019accueil \u00BB." };
    if (android) return { msg: "Ouvrez le menu \u22EE du navigateur puis touchez <b>\u00AB Installer l\u2019application \u00BB</b> ou \u00AB Ajouter \u00E0 l\u2019\u00E9cran d\u2019accueil \u00BB." };
    return { msg: "Cliquez sur l\u2019ic\u00F4ne d\u2019installation \u2295 dans la barre d\u2019adresse de votre navigateur (Chrome ou Edge)." };
  }
  function dismiss() { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {} rm("mk-pwa"); chip(); }
  function show(force) {
    if (st || !document.body || (!force && hidden())) return;
    css(); rm("mk-pwa"); rm("mk-chip");
    var c = content(), d = document.createElement("div"); d.id = "mk-pwa"; d.setAttribute("role", "dialog"); d.setAttribute("aria-label", "Installer l'application");
    d.innerHTML = '<img src="/icons/icon-192.png" alt=""><span><b class="t">Installer l\u2019application</b>' + c.msg + "</span>" + (c.btn ? '<button type="button" id="mk-pwa-go">Installer</button>' : "") + '<button type="button" class="x" id="mk-pwa-x" aria-label="Fermer">\u2715</button>';
    document.body.appendChild(d);
    document.getElementById("mk-pwa-x").onclick = dismiss;
    var g = document.getElementById("mk-pwa-go");
    if (g) g.onclick = function () { if (!def) { rm("mk-pwa"); return; } def.prompt(); def.userChoice.then(function () { def = null; rm("mk-pwa"); rm("mk-chip"); }, function () { rm("mk-pwa"); chip(); }); };
  }
  // Petit bouton permanent : permet de rouvrir l'invitation après l'avoir fermée
  function chip() {
    if (st || !document.body || document.getElementById("mk-chip") || document.getElementById("mk-pwa")) return;
    if (!(got || mobile)) return;
    css(); var b = document.createElement("button"); b.id = "mk-chip"; b.type = "button"; b.textContent = "\uD83D\uDCF2 Installer"; b.setAttribute("aria-label", "Installer l'application");
    b.onclick = function () { show(true); }; document.body.appendChild(b);
  }

  addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); def = e; got = true; setTimeout(function () { if (!def) return; if (hidden()) chip(); else show(false); }, 2500); });
  addEventListener("appinstalled", function () { def = null; rm("mk-pwa"); rm("mk-chip"); try { localStorage.removeItem(KEY); } catch (e) {} });

  if (st) { var s0 = document.createElement("style"); s0.textContent = "html,body{overscroll-behavior-y:contain}"; document.head.appendChild(s0); }
  else addEventListener("load", function () {
    // Si le navigateur n'a pas proposé l'installation tout seul, on explique comment faire à la main
    setTimeout(function () { if (!got && mobile) { if (hidden()) chip(); else show(false); } }, ios ? 3500 : 6000);
  });

  // Diagnostic : ouvrez le site avec ?pwa=debug à la fin de l'adresse
  if (debug) addEventListener("load", function () {
    setTimeout(function () {
      css(); try { localStorage.removeItem(KEY); } catch (e) {}
      var L = [], ok = function (b) { return b ? "OK  " : "NON "; }, p = document.createElement("div"); p.id = "mk-dbg"; document.body.appendChild(p);
      var out = function () { p.textContent = "DIAGNOSTIC APPLICATION (touchez ici pour fermer)\n" + L.join("\n"); }; p.onclick = function () { p.remove(); };
      L.push(ok(location.protocol === "https:" || location.hostname === "localhost") + "HTTPS : " + location.protocol);
      L.push("    Déjà en mode application (installée) : " + (st ? "OUI → l'invitation est volontairement masquée" : "non"));
      L.push((got ? "OK  " : "NON ") + "Le navigateur a proposé l'installation (beforeinstallprompt) : " + (got ? "oui" : "pas (encore)"));
      L.push("    Navigateur intégré (WhatsApp, Facebook…) : " + (inapp ? "OUI → Chrome ne permet pas d'installer ici, ouvrez dans Chrome" : "non"));
      L.push("    Appareil : " + (ios ? "iPhone/iPad" : android ? "Android" : "ordinateur") + " | " + ua.slice(0, 110));
      L.push("    Service worker : " + swState);
      var cv = /(?:Chrome|CriOS|EdgA|SamsungBrowser|OPR)\/(\d+)/.exec(ua); L.push((cv && +cv[1] >= 100 ? "OK  " : "    ") + "Version du navigateur : " + (cv ? cv[0] : "inconnue") + (cv && +cv[1] < 100 ? " → trop ancienne, mettez à jour Chrome dans le Play Store" : ""));
      try { var cn = navigator.connection; if (cn && cn.saveData) L.push("NON Économiseur de données ACTIVÉ : il peut empêcher l'installation, désactivez-le"); } catch (e) {}
      out();
      if ("serviceWorker" in navigator) navigator.serviceWorker.getRegistration().then(function (r) { L.push(ok(r && r.active) + "Service worker actif : " + (r && r.active ? r.active.state : "aucun") + (navigator.serviceWorker.controller ? " (contrôle cette page)" : " (ne contrôle pas encore cette page : rechargez)")); out(); });
      var mk = document.querySelector('link[rel=manifest]');
      if (!mk) { L.push("NON Lien du manifeste absent de la page"); out(); return; }
      fetch(mk.href, { cache: "no-store" }).then(function (r) {
        var ct = r.headers.get("content-type") || ""; L.push(ok(r.ok) + "Manifeste " + mk.getAttribute("href") + " : HTTP " + r.status + " (" + ct.split(";")[0] + ")"); out();
        return r.json().then(function (j) {
          L.push(ok(j.display === "standalone" && j.start_url) + "Manifeste lisible : display=" + j.display + " start_url=" + j.start_url + " id=" + j.id);
          var ic = (j.icons || []).filter(function (i) { return i.purpose !== "maskable"; });
          return Promise.all(ic.map(function (i) { return fetch(i.src, { cache: "no-store" }).then(function (x) { L.push(ok(x.ok && /image\/png/.test(x.headers.get("content-type") || "")) + "Icône " + i.sizes + " : HTTP " + x.status + " " + (x.headers.get("content-type") || "")); out(); }).catch(function () { L.push("NON Icône " + i.sizes + " : introuvable"); out(); }); }));
        });
      }).catch(function (e) { L.push("NON Manifeste illisible : " + (e && e.message || e) + " (la route renvoie peut-être une page HTML)"); out(); });
    }, 1500);
  });
})();
