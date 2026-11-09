/* Boîtes de dialogue stylisées (remplacent alert / confirm / prompt du navigateur) */
(function () {
  var css = document.createElement("style");
  css.textContent = [
    ".dlg{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(2,6,23,.62);backdrop-filter:blur(4px);animation:dlgf .16s ease both}",
    "@keyframes dlgf{from{opacity:0}to{opacity:1}}@keyframes dlgu{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}",
    ".dlg .db{width:100%;max-width:440px;max-height:90vh;overflow:auto;background:var(--c,#fff);color:var(--t,#0f172a);border:1px solid var(--b,#e2e8f0);border-radius:20px;box-shadow:0 24px 70px rgba(2,6,23,.45);animation:dlgu .22s ease both;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}",
    ".dlg .dh{display:flex;align-items:center;gap:12px;padding:16px 18px;color:#fff;background:linear-gradient(135deg,#0a2a6b,#0b6fcf 60%,#7c3aed)}",
    ".dlg.warn .dh{background:linear-gradient(135deg,#b45309,#ea580c)}.dlg.bad .dh{background:linear-gradient(135deg,#b91c1c,#ea580c)}.dlg.good .dh{background:linear-gradient(135deg,#047857,#0d9488)}",
    ".dlg .di{flex:0 0 40px;height:40px;border-radius:50%;display:grid;place-items:center;font-size:20px;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.4)}",
    ".dlg .dt{font-size:16px;font-weight:800;line-height:1.25}.dlg .dm{padding:16px 18px 6px;font-size:15px;line-height:1.55;white-space:pre-wrap;word-break:break-word}",
    ".dlg .dm b{font-weight:800}.dlg input.dp{display:block;width:calc(100% - 36px);margin:8px 18px 4px;padding:12px 14px;font-size:16px;border-radius:12px;border:1.5px solid var(--b,#cbd5e1);background:var(--bg,#f8fafc);color:var(--t,#0f172a);outline:none;min-height:46px;box-sizing:border-box}",
    ".dlg input.dp:focus{border-color:var(--p,#0b6fcf);box-shadow:0 0 0 3px rgba(11,111,207,.2)}",
    ".dlg .da{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;padding:14px 18px 18px}",
    ".dlg .da button{margin:0;min-height:44px;padding:10px 20px;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;border:0;font-family:inherit}",
    ".dlg .da .ok{color:#fff;background:linear-gradient(135deg,#0b6fcf,#4f46e5);box-shadow:0 6px 16px rgba(79,70,229,.3)}.dlg.bad .da .ok{background:linear-gradient(135deg,#dc2626,#ea580c);box-shadow:0 6px 16px rgba(220,38,38,.3)}.dlg.good .da .ok{background:linear-gradient(135deg,#16a34a,#0d9488)}",
    ".dlg .da .no{background:transparent;color:var(--t,#0f172a);border:1.5px solid var(--b,#cbd5e1)}.dlg .da button:focus-visible{outline:3px solid rgba(11,111,207,.45);outline-offset:2px}",
    "@media(max-width:480px){.dlg{align-items:flex-end;padding:10px}.dlg .da button{flex:1}}"
  ].join("\n");
  (document.head || document.documentElement).appendChild(css);

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }
  function kind(msg, base) {
    var m = String(msg);
    if (/supprim|définitiv|irréversible|ROMPRE|efface|purge|PRODUCTION|annuler cette transaction/i.test(m)) return "bad";
    if (base === "alert") {
      if (/^\s*(✔|✅|🎉)|succès|enregistré|modifié|supprimé|envoyé|copié|terminé/i.test(m)) return "good";
      if (/impossible|erreur|refus|invalide|incorrect|interdit|expir|échec|doit |déjà|trop|veuillez|aucun|non /i.test(m)) return "warn";
      return "";
    }
    return "";
  }
  var ICON = { "": "ℹ️", warn: "⚠️", bad: "🗑️", good: "✅" };
  function build(msg, o) {
    var d = document.createElement("div"), k = o.kind, lines = String(msg == null ? "" : msg).split("\n"), title = o.title || "", body = String(msg == null ? "" : msg);
    d.className = "dlg " + k; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true");
    if (!title) { title = lines[0].length <= 70 && lines.length > 1 ? lines[0] : (o.defTitle); if (title === lines[0] && lines.length > 1) body = lines.slice(1).join("\n").replace(/^\n+/, ""); }
    d.innerHTML = '<div class="db"><div class="dh"><div class="di">' + ICON[k] + '</div><div class="dt">' + esc(title) + '</div></div><div class="dm">' + esc(body) + '</div>' + (o.input ? '<input class="dp" type="text" autocomplete="off" autocapitalize="off" spellcheck="false">' : '') + '<div class="da">' + (o.cancel ? '<button type="button" class="no">' + esc(o.noLabel || "Annuler") + '</button>' : '') + '<button type="button" class="ok">' + esc(o.okLabel || "OK") + '</button></div></div>';
    return d;
  }
  function open(msg, o) {
    return new Promise(function (res) {
      var prev = document.activeElement, d = build(msg, o), inp = d.querySelector("input.dp"), ok = d.querySelector(".ok"), no = d.querySelector(".no");
      if (inp) inp.value = o.def == null ? "" : String(o.def);
      function done(v) { document.removeEventListener("keydown", key, true); d.remove(); try { prev && prev.focus && prev.focus(); } catch (e) { } res(v); }
      function key(e) {
        if (!d.isConnected) return;
        var top = document.querySelectorAll(".dlg"); if (top[top.length - 1] !== d) return;
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(o.input ? null : (o.cancel ? false : undefined)); }
        else if (e.key === "Enter" && (!no || document.activeElement !== no) && !(e.target && e.target.tagName === "BUTTON" && e.target !== ok)) { e.preventDefault(); e.stopPropagation(); done(o.input ? inp.value : (o.cancel ? true : undefined)); }
        else if (e.key === "Tab") { var f = [].slice.call(d.querySelectorAll("input,button")); if (!f.length) return; var i = f.indexOf(document.activeElement); e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); }
      }
      document.addEventListener("keydown", key, true);
      ok.onclick = function () { done(o.input ? inp.value : (o.cancel ? true : undefined)); };
      if (no) no.onclick = function () { done(o.input ? null : false); };
      d.addEventListener("mousedown", function (e) { if (e.target === d && o.cancel) done(o.input ? null : false); });
      document.body.appendChild(d);
      setTimeout(function () { (inp || ok).focus(); if (inp) inp.select(); }, 30);
    });
  }
  window.dlgAlert = function (m) { var k = kind(m, "alert"); return open(m, { kind: k, defTitle: k === "warn" ? "Attention" : k === "good" ? "Terminé" : "Information", okLabel: "OK" }); };
  window.dlgConfirm = function (m) { var k = kind(m, "confirm"); return open(m, { kind: k, defTitle: k === "bad" ? "Confirmer l'action" : "Confirmation", cancel: true, okLabel: k === "bad" ? "Oui, continuer" : "Confirmer" }); };
  window.dlgPrompt = function (m, def) { var k = kind(m, "confirm"); return open(m, { kind: k, defTitle: "Saisie demandée", input: true, cancel: true, def: def, okLabel: "Valider" }); };
  /* alert reste utilisable partout : la boîte s'affiche sans bloquer le code */
  window.alert = function (m) { window.dlgAlert(m); };
})();
