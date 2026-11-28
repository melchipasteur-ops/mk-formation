/* MK-DIGIT GRAPH — notifications push.
   Un bouton 🔔 apparaît une fois connecté (administration ou étudiant). Il demande l'autorisation, enregistre le téléphone
   et permet d'envoyer un essai. L'administrateur principal peut aussi envoyer un message à tous les étudiants. */
(function () {
  "use strict";
  if (window.mkPushLoaded) return; window.mkPushLoaded = true;
  var ua = navigator.userAgent || "", ios = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var st = false; try { st = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; } catch (e) {}
  var can = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && (location.protocol === "https:" || location.hostname === "localhost");
  var LK = "mk_push_", HIDE = "mk_push_hide_";
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k) || ""; if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return ""; } }
  function ss(k) { try { return sessionStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  async function api(action, data) {
    var r = await fetch("/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ action: action }, data || {})) }), j = {};
    try { j = await r.json(); } catch (e) {}
    if (!r.ok || j.error) throw new Error(j.error || "Erreur serveur"); return j;
  }
  // Qui est connecté sur cette page ?
  function who() {
    var h = location.hash || "", at = ss("f_at");
    if (h.indexOf("#/adminmelchi97") === 0) { if (!at) return null; var me = {}; try { me = JSON.parse(ss("f_me") || "{}") || {}; } catch (e) {} return { role: "a", ref: "adm", token: at, root: me.root !== false, label: "l'administration" }; }
    if (h.indexOf("#/vue/") === 0 || h === "#/apercu" || h.indexOf("#/partenaire") === 0) return null; // aperçu administrateur ou espace partenaire
    var q = ""; try { q = (new URLSearchParams(location.search).get("n") || "").toUpperCase(); } catch (e) {}
    if (q && ss("id_" + q)) return { role: "s", ref: q, num: q, id: ss("id_" + q), label: "votre formation" };
    try { for (var i = 0; i < sessionStorage.length; i++) { var k = sessionStorage.key(i); if (k && k.indexOf("id_") === 0 && sessionStorage.getItem(k)) return { role: "s", ref: k.slice(3), num: k.slice(3), id: sessionStorage.getItem(k), label: "votre formation" }; } } catch (e) {}
    return null;
  }
  function key64(b) { var p = "=".repeat((4 - b.length % 4) % 4), s = atob((b + p).replace(/-/g, "+").replace(/_/g, "/")), o = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; }
  async function reg() { var r = await navigator.serviceWorker.getRegistration("/"); if (!r) r = await navigator.serviceWorker.register("/sw.js", { scope: "/" }); return navigator.serviceWorker.ready.then(function () { return r; }); }
  async function current() { if (!can) return null; try { var r = await navigator.serviceWorker.getRegistration("/"); return r ? await r.pushManager.getSubscription() : null; } catch (e) { return null; } }
  function cred(w, sub) { var d = { sub: sub.toJSON ? sub.toJSON() : sub, as: w.role, ua: ua.slice(0, 160) }; if (w.role === "a") d.token = w.token; else { d.num = w.num; d.id = w.id; } return d; }
  async function enable(w) {
    var p = await Notification.requestPermission(); if (p !== "granted") throw new Error(p === "denied" ? "Les notifications sont bloquées. Autorisez-les dans les réglages du navigateur (cadenas ou ⋮ > Paramètres du site > Notifications), puis réessayez." : "Aucune autorisation reçue. Touchez de nouveau « Activer » puis « Autoriser ». Si aucune fenêtre ne s'ouvre : Paramètres du téléphone > Applications > " + (st ? "MK Admin / MK Digit" : "Chrome") + " > Notifications > activer, puis réessayez.");
    var k = (await api("pushKey")).key, r = await reg(), sub = await r.pushManager.getSubscription();
    if (!sub) sub = await Promise.race([r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key64(k) }), new Promise(function (_, no) { setTimeout(function () { no(new Error("Le service de notifications du téléphone ne répond pas. Vérifiez la connexion Internet puis réessayez.")); }, 25000); })]);
    await api("pushSub", cred(w, sub)); ls(LK + w.role + "_" + w.ref, sub.endpoint); ls(LK + "who", w.role + ":" + w.ref); return sub;
  }
  async function disable(w) { var sub = await current(); if (sub) { try { await api("pushUnsub", { endpoint: sub.endpoint }); } catch (e) {} try { await sub.unsubscribe(); } catch (e) {} } ls(LK + w.role + "_" + w.ref, null); ls(LK + "who", null); }

  function css() {
    if (document.getElementById("mk-push-css")) return;
    var s = document.createElement("style"); s.id = "mk-push-css";
    s.textContent = "#mk-bell{position:fixed;left:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:45;font:700 13px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;border:0;border-radius:999px;padding:9px 14px;min-height:38px;cursor:pointer;background:#0f172a;color:#fff;box-shadow:0 6px 20px rgba(15,23,42,.35)}#mk-bell.on{background:#16a34a;padding:9px 12px}#mk-pp{position:fixed;left:12px;right:12px;bottom:calc(60px + env(safe-area-inset-bottom,0px));z-index:60;max-width:420px;background:#fff;color:#0f172a;border-radius:16px;padding:14px;box-shadow:0 12px 40px rgba(15,23,42,.35);font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}#mk-pp h3{margin:0 0 6px;font-size:16px}#mk-pp p{margin:6px 0}#mk-pp .r{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}#mk-pp button{font:inherit;font-weight:700;border:0;border-radius:10px;padding:9px 12px;min-height:40px;cursor:pointer;background:#0b6fcf;color:#fff}#mk-pp button.g{background:#e2e8f0;color:#0f172a}#mk-pp input,#mk-pp textarea{width:100%;box-sizing:border-box;font:inherit;border:1px solid #cbd5e1;border-radius:10px;padding:8px;margin-top:6px}#mk-pp small{color:#64748b}#mk-pp .x{position:absolute;right:8px;top:6px;background:transparent;color:#64748b;font-size:18px;padding:4px 8px;min-height:0}@media print{#mk-bell,#mk-pp{display:none}}";
    document.head.appendChild(s);
  }
  function rm(id) { var e = document.getElementById(id); if (e) e.remove(); }
  function panel(html) { rm("mk-pp"); var d = document.createElement("div"); d.id = "mk-pp"; d.setAttribute("role", "dialog"); d.innerHTML = '<button type="button" class="x" aria-label="Fermer">✕</button>' + html; document.body.appendChild(d); var b = document.getElementById("mk-bell"); if (b && b.style.bottom) d.style.bottom = "calc(" + (b.getBoundingClientRect ? (innerHeight - b.getBoundingClientRect().top + 8) : 60) + "px)"; d.querySelector(".x").onclick = function () { rm("mk-pp"); }; return d; }
  function msg(d, t, bad) { var m = d.querySelector(".m"); if (m) { m.textContent = t; m.style.color = bad ? "#dc2626" : "#16a34a"; } }

  async function open(w) {
    css(); var sub = await current(), mine = sub && ls(LK + w.role + "_" + w.ref) === sub.endpoint && Notification.permission === "granted";
    if (!mine) {
      var d = panel("<h3>🔔 Recevoir les notifications</h3><p>" + (w.role === "a" ? "Soyez prévenu sur ce téléphone à chaque <b>inscription</b>, <b>paiement à valider</b>, <b>travail à corriger</b> et réponse de partenaire." : "Soyez prévenu quand votre <b>travail est corrigé</b>, quand un <b>paiement est validé</b> et quand un <b>nouveau cours</b> est ouvert.") + "</p><p class='m'></p><div class='r'><button type='button' class='go'>Activer</button><button type='button' class='g later'>Plus tard</button></div>");
      d.querySelector(".later").onclick = function () { ls(HIDE + w.role, String(Date.now())); rm("mk-pp"); draw(); };
      d.querySelector(".go").onclick = async function () { this.disabled = true; try { await enable(w); rm("mk-pp"); draw(); open(w); } catch (e) { msg(d, e.message, true); this.disabled = false; } };
      return;
    }
    var html = "<h3>🔔 Notifications activées</h3><p>Ce téléphone reçoit les notifications de " + esc(w.label) + ".</p><p class='m'></p><div class='r'><button type='button' class='t'>Envoyer un essai</button><button type='button' class='g off'>Désactiver</button></div>";
    if (w.role === "a" && w.root) html += "<hr style='border:0;border-top:1px solid #e2e8f0;margin:12px 0'><h3>📣 Message aux étudiants</h3><small class='stat'></small><input class='ti' maxlength='80' placeholder='Titre (ex. : Cours en direct ce soir)'><textarea class='bo' rows='3' maxlength='240' placeholder='Votre message (240 caractères maximum)'></textarea><div class='r'><button type='button' class='send'>Envoyer à tous les étudiants</button></div>";
    var p = panel(html);
    p.querySelector(".t").onclick = async function () { this.disabled = true; try { await api("pushTest", { endpoint: sub.endpoint }); msg(p, "Essai envoyé : la notification va apparaître."); } catch (e) { msg(p, e.message, true); } this.disabled = false; };
    p.querySelector(".off").onclick = async function () { await disable(w); rm("mk-pp"); draw(); };
    var sd = p.querySelector(".send");
    if (sd) {
      api("pushStats", { token: w.token }).then(function (j) { var s = p.querySelector(".stat"); if (s) s.textContent = j.students + " téléphone(s) d'étudiants abonné(s) · " + j.admins + " pour l'administration"; }).catch(function () {});
      sd.onclick = async function () {
        var ti = p.querySelector(".ti").value.trim(), bo = p.querySelector(".bo").value.trim(); if (ti.length < 2 || bo.length < 2) return msg(p, "Écrivez un titre et un message.", true);
        if (!confirm("Envoyer ce message à tous les étudiants abonnés ?")) return;
        this.disabled = true; try { var j = await api("pushSend", { token: w.token, title: ti, body: bo }); msg(p, "Envoyé à " + j.students + " étudiant(s) (" + j.sent + " appareil(s))."); p.querySelector(".ti").value = ""; p.querySelector(".bo").value = ""; } catch (e) { msg(p, e.message, true); } this.disabled = false;
      };
    }
  }
  function lift() { var b = document.getElementById("mk-bell"), p = document.getElementById("mk-pwa"); if (b) b.style.bottom = p ? "calc(" + (p.offsetHeight + 24) + "px + env(safe-area-inset-bottom,0px))" : ""; } // au-dessus du bandeau « Installer l'application »
  var last = "";
  async function draw() {
    var w = who(), sig = w ? w.role + ":" + w.ref : ""; if (!document.body) return;
    if (!w) { rm("mk-bell"); if (last) rm("mk-pp"); last = ""; return; }
    if (sig !== last) rm("mk-pp"); last = sig;
    if (!can) { // iPhone : les notifications ne marchent que dans l'application installée sur l'écran d'accueil
      if (ios && !st && !document.getElementById("mk-bell") && Date.now() - (+ls(HIDE + "ios") || 0) > 7 * 864e5) { css(); var b0 = document.createElement("button"); b0.id = "mk-bell"; b0.type = "button"; b0.textContent = "🔔 Notifications"; b0.onclick = function () { var d = panel("<h3>🔔 Notifications sur iPhone</h3><p>Ajoutez d'abord l'application à l'écran d'accueil : touchez <b>Partager</b> ⬆️ puis « Sur l'écran d'accueil ». Ouvrez-la ensuite depuis son icône et touchez 🔔.</p><div class='r'><button type='button' class='g'>Compris</button></div>"); d.querySelector(".g").onclick = function () { ls(HIDE + "ios", String(Date.now())); rm("mk-pp"); rm("mk-bell"); }; }; document.body.appendChild(b0); }
      return;
    }
    var sub = await current(), on = sub && Notification.permission === "granted" && ls(LK + w.role + "_" + w.ref) === sub.endpoint;
    if (!on && Notification.permission === "denied") { rm("mk-bell"); return; }
    if (!on && Date.now() - (+ls(HIDE + w.role) || 0) < 7 * 864e5) { // « Plus tard » : petite cloche discrète seulement
      css(); var bb = document.getElementById("mk-bell") || document.body.appendChild(Object.assign(document.createElement("button"), { id: "mk-bell", type: "button" })); bb.className = ""; bb.textContent = "🔔"; bb.setAttribute("aria-label", "Notifications"); bb.onclick = function () { open(who() || w); }; lift(); return;
    }
    css(); var b = document.getElementById("mk-bell"); if (!b) { b = document.createElement("button"); b.id = "mk-bell"; b.type = "button"; document.body.appendChild(b); }
    b.className = on ? "on" : ""; b.textContent = on ? "🔔" : "🔔 Activer les notifications"; b.setAttribute("aria-label", on ? "Notifications activées" : "Activer les notifications");
    b.onclick = function () { open(who() || w); };
    lift();
    if (on && !ss(LK + "sync")) { try { sessionStorage.setItem(LK + "sync", "1"); } catch (e) {} api("pushSub", cred(w, sub)).catch(function () {}); } // garde l'abonnement à jour
  }
  addEventListener("hashchange", function () { setTimeout(draw, 300); });
  addEventListener("load", function () { setTimeout(draw, 800); });
  setInterval(draw, 4000); // les pages changent sans recharger (connexion, déconnexion)
})();
