/* MK-DIGIT GRAPH — confort de navigation (site et formation)
   1. Chaque clic sur un bouton ou un onglet amène directement à la section concernée.
   2. Tout le site s'utilise au clavier (Tab, Entrée, Espace, Échap, flèches, « / », « ? »).
   3. On retrouve la page et l'endroit exact où l'on était avant de quitter le site ou l'application.
   Script autonome : il n'appelle aucune fonction du site et ne touche ni à l'API ni aux données. */
(function () {
  "use strict";
  if (window.__mkux) return; window.__mkux = 1;
  var d = document, W = window, LS = null, SS = null;
  try { LS = W.localStorage; } catch (e) { }
  try { SS = W.sessionStorage; } catch (e) { }
  var reduce = false; try { reduce = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { }
  var now = function () { return Date.now(); };
  var appEl = function () { return d.getElementById("app"); };
  var BARS = "header nav,#nv,.nav,.tabs,.chips,.navbar,[role=tablist]";
  var OVER = ".modal,.lb,#lb,.dlg,.mk-help";

  /* ---------- Styles : focus visible, lien d'évitement, bandeau de reprise ---------- */
  var css = d.createElement("style"); css.id = "mk-ux-css";
  css.textContent = [
    ":where(a,button,summary,select,[tabindex],[data-mk-kb]):focus-visible{outline:3px solid #f59e0b!important;outline-offset:2px!important}",
    "a:has(>button):focus-visible{outline:none!important}a:focus-visible>button{outline:3px solid #f59e0b;outline-offset:2px}",
    "[data-mk-t]:focus,[data-mk-t]:focus-visible{outline:none!important}",
    "[data-mk-kb]{cursor:pointer}",
    ".mk-skip{position:fixed;left:8px;top:8px;z-index:2147483600;display:flex;gap:8px;transform:translateY(-140%);transition:transform .15s}",
    ".mk-skip:focus-within{transform:none}",
    ".mk-skip button{margin:0;min-height:40px;padding:8px 14px;border-radius:10px;border:2px solid #fff;background:#0a2a6b;color:#fff;font:700 14px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(2,6,23,.35)}",
    ".mk-res{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483000;width:min(560px,calc(100% - 24px));display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 14px;border-radius:16px;background:#0a2a6b;color:#fff;box-shadow:0 18px 50px rgba(2,6,23,.45);font:15px/1.4 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;animation:mkres .25s ease both}",
    "@keyframes mkres{from{opacity:0;transform:translate(-50%,16px)}to{opacity:1;transform:translateX(-50%)}}",
    ".mk-res span{flex:1 1 220px;min-width:0}.mk-res b{font-weight:800}",
    ".mk-res button{margin:0;min-height:42px;padding:8px 16px;border-radius:12px;border:0;font:700 14px inherit;font-family:inherit;cursor:pointer}",
    ".mk-res .go{background:#fff;color:#0a2a6b}.mk-res .x{background:transparent;color:#fff;border:1.5px solid rgba(255,255,255,.5)}",
    "@media print{.mk-skip,.mk-res{display:none!important}}"
  ].join("\n");
  (d.head || d.documentElement).appendChild(css);

  /* ---------- Outils ---------- */
  function vis(el) { if (!el || !el.isConnected) return false; if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return false; var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function topOff() {
    var m = 0;
    d.querySelectorAll("header,.navbar,.tabs").forEach(function (e) {
      if (!vis(e)) return; var cs = getComputedStyle(e);
      if ((cs.position === "sticky" || cs.position === "fixed") && e.offsetHeight < innerHeight / 3) m = Math.max(m, e.getBoundingClientRect().bottom > 0 ? e.offsetHeight : 0);
    });
    return m + 10;
  }
  var ourScroll = 0;
  function scrollY_(y, smooth) { ourScroll = now(); y = Math.max(0, Math.round(y)); try { W.scrollTo({ top: y, behavior: smooth && !reduce ? "smooth" : "auto" }); } catch (e) { W.scrollTo(0, y); } }
  function docTop(el) { return el.getBoundingClientRect().top + W.pageYOffset; }
  function focusQuiet(el) {
    if (!el) return;
    if (!el.matches("a[href],button,input,select,textarea,summary,[tabindex]")) { el.setAttribute("tabindex", "-1"); el.setAttribute("data-mk-t", ""); }
    try { el.focus({ preventScroll: true }); } catch (e) { }
  }
  function focusables(root) {
    return [].slice.call(root.querySelectorAll("a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex='-1'])")).filter(vis);
  }
  function lost() { var a = d.activeElement; return !a || a === d.body || a === d.documentElement || !a.isConnected; }
  function topOverlay() {
    var L = [].slice.call(d.querySelectorAll(OVER)).filter(function (e) { return e.isConnected && getComputedStyle(e).display !== "none"; });
    return L[L.length - 1] || null;
  }
  function editable(t) { return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); }

  /* =====================================================================
     1. CLIC → SECTION DÉDIÉE
     ===================================================================== */
  var P = null, userMove = 0;
  function onSig() {
    var a = appEl(); if (!a) return "";
    return [].slice.call(a.querySelectorAll(".on,[aria-selected=true]")).map(function (e) { return (e.textContent || "").trim().slice(0, 40); }).join("|");
  }
  function isBackCtl(el) { var t = (el.textContent || "") + " " + (el.getAttribute("onclick") || ""); return /goBack|history\.back|←\s*Retour/.test(t); }
  d.addEventListener("click", function (e) {
    var t = e.target; if (!t || !t.closest) return;
    var el = t.closest("a,button,summary,[role=button],[data-mk-kb],label,[onclick]"); if (!el) return;
    if (el.closest(".dlg,#lb,.lb,.mk-res,.mk-skip,.mk-help")) return;
    var href = el.tagName === "A" ? el.getAttribute("href") || "" : "";
    if (/^#[A-Za-z][\w-]*$/.test(href)) { // ancre interne vers une section de la page
      var tg = d.getElementById(href.slice(1));
      if (tg) { e.preventDefault(); scrollY_(docTop(tg) - topOff(), true); focusQuiet(tg.querySelector("h1,h2,h3") || tg); return; }
    }
    P = {
      el: el, t: now(), kb: e.detail === 0, hash: location.hash, sig: onSig(), back: isBackCtl(el),
      nav: !!el.closest(BARS) || (!!href && !/^javascript:/i.test(href)), txt: (el.textContent || "").trim().slice(0, 60),
      oc: el.getAttribute("onclick") || "", added: [], rer: false, inModal: !!el.closest(".modal")
    };
    userMove = 0;
  }, true);
  addEventListener("mousedown", function (e) { if (e.target === d.documentElement) { userMove = now(); R = null; } }, true); // barre de défilement
  ["wheel", "touchmove"].forEach(function (n) { addEventListener(n, function () { userMove = now(); if (R) R = null; }, { passive: true }); });
  addEventListener("keydown", function (e) {
    if (/^(PageUp|PageDown|Home|End)$/.test(e.key) || ((e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === " ") && !editable(e.target) && !(e.target && e.target.closest && e.target.closest("button,a,summary,[data-mk-kb]")))) { userMove = now(); R = null; }
  }, true);

  var evalT = 0;
  function collect(muts) {
    if (!P) return;
    if (now() - P.t > 8000) { P = null; return; }
    var a = appEl();
    muts.forEach(function (m) {
      if (m.type === "childList") {
        if (a && m.target === a && m.removedNodes.length) P.rer = true;
        m.addedNodes.forEach(function (n) { if (n.nodeType === 1) P.added.push(n); });
      } else if (m.type === "attributes" && m.target.nodeType === 1) {
        var n = m.target, an = m.attributeName, ov = m.oldValue || "";
        if ((an === "hidden" && m.oldValue !== null && !n.hasAttribute("hidden")) || (an === "open" && n.hasAttribute("open")) ||
          (an === "style" && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(ov)) || (an === "class" && /\b(hidden|hide|d-none)\b/.test(ov))) P.added.push(n);
      }
    });
    clearTimeout(evalT); evalT = setTimeout(evaluate, 160);
  }
  function firstHeading(root, after) {
    var L = [].slice.call((root || appEl() || d.body).querySelectorAll("h1,h2,h3")).filter(vis);
    if (after) L = L.filter(function (h) { return after.compareDocumentPosition(h) & 4; });
    return L[0] || null;
  }
  function changedBar(oldSig) {
    var a = appEl(); if (!a) return null;
    var old = (oldSig || "").split("|");
    var L = [].slice.call(a.querySelectorAll(".on,[aria-selected=true]")).filter(vis);
    for (var i = 0; i < L.length; i++) { var tx = (L[i].textContent || "").trim().slice(0, 40); if (old.indexOf(tx) < 0) return L[i].closest(BARS) || L[i].parentElement; }
    return null;
  }
  function sameAgain(p) { // retrouve, après un nouvel affichage, le bouton sur lequel on venait d'appuyer
    var a = appEl(); if (!a) return null;
    var L = a.querySelectorAll(p.el.tagName.toLowerCase());
    for (var i = 0; i < L.length; i++) { if ((L[i].textContent || "").trim().slice(0, 60) === p.txt && (L[i].getAttribute("onclick") || "") === p.oc && vis(L[i])) return L[i]; }
    return null;
  }
  function evaluate() {
    var p = P; if (!p) return;
    if (userMove > p.t) { P = null; return; }
    var a = appEl(), ov = topOverlay();
    if (ov && !p.inModal) { P = null; return; }            // une fenêtre s'est ouverte : elle gère elle-même le focus
    var hashCh = location.hash !== p.hash, bar = changedBar(p.sig);
    if (p.back && hashCh) { P = null; return; }             // « Retour » : la position précédente est restaurée plus bas
    if ((p.rer || hashCh) && (p.nav || hashCh || bar)) {
      // ---- Navigation : nouvelle page ou nouvel onglet ----
      var tgt = null, y = 0;
      if (bar && a && a.contains(bar)) {
        tgt = bar.nextElementSibling || bar;
        y = docTop(tgt) - topOff();
        if (y < innerHeight * 0.4) y = 0;           // l'onglet est déjà en haut : on remonte tout simplement
      }
      scrollY_(y, false);
      if (p.kb || lost() || !p.el.isConnected) focusQuiet(firstHeading(a, bar) || a);
      P = null; return;
    }
    if (p.rer) {                                              // simple rafraîchissement : on garde la position et le focus
      if (p.kb && lost()) { var s = sameAgain(p); if (s) focusQuiet(s); }
      P = null; return;
    }
    // ---- Contenu ajouté ou dévoilé sous le bouton : on l'amène à l'écran ----
    var off = topOff(), best = null;
    p.added.forEach(function (n) {
      if (!n.isConnected || n === p.el || n.contains(p.el) || p.el.contains(n)) return;
      if (n.closest(OVER + ",.toast,.mk-res,.mk-skip,header,footer,[data-live],[data-live-i]")) return;
      if (a && !a.contains(n)) return;
      if (!vis(n) || n.offsetHeight < 24) return;
      if (!best || (best.compareDocumentPosition(n) & 2)) best = n;   // le premier dans l'ordre de la page
    });
    if (best) {
      var r = best.getBoundingClientRect();
      if (r.top < off - 2 || r.top > innerHeight * 0.82) {
        scrollY_(docTop(best) - off, true);
        if (p.kb) { var f = focusables(best)[0]; if (f) setTimeout(function () { try { f.focus({ preventScroll: true }); } catch (e) { } }, 30); }
      }
    }
    P = null;
  }

  /* =====================================================================
     2. CLAVIER
     ===================================================================== */
  var NATIVE = /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|LABEL|OPTION|VIDEO|AUDIO|IFRAME)$/;
  function makeKb(el) {
    if (el.hasAttribute("data-mk-kb") || NATIVE.test(el.tagName)) return;
    if (el.matches(OVER + ",.st,.toast") || /event\.target\s*===?\s*this/.test(el.getAttribute("onclick") || "")) return; // fonds de fenêtres
    if (el.closest("a[href],button")) return;
    el.setAttribute("data-mk-kb", "");
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
    if (!el.hasAttribute("role")) el.setAttribute("role", "button");
    if (!(el.textContent || "").trim() && !el.getAttribute("aria-label")) { var l = el.getAttribute("alt") || el.getAttribute("title"); if (l) el.setAttribute("aria-label", l); }
  }
  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    var list = [root].concat([].slice.call(root.querySelectorAll("*")));
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.closest && el.closest(".dlg")) continue;
      if (el.hasAttribute("onclick") || typeof el.onclick === "function") makeKb(el);
      else if (el.tagName === "IMG" && el.classList.contains("th")) makeKb(el);
      if (el.tagName === "A" && el.hasAttribute("href")) { var b = el.querySelector(":scope>button"); if (b && b.getAttribute("tabindex") !== "-1") b.setAttribute("tabindex", "-1"); }
      if (el.tagName === "LABEL") { // « Choisir un fichier » : champ caché déclenché par l'étiquette
        var c = el.control; if (c && c.type === "file" && !vis(c) && !el.hasAttribute("data-mk-kb")) { el.setAttribute("data-mk-kb", ""); el.setAttribute("tabindex", "0"); el.setAttribute("role", "button"); }
      }
      if (el.classList && el.classList.contains("on") && el.closest && el.closest(BARS) && /^(A|BUTTON)$/.test(el.tagName)) el.setAttribute("aria-current", "page");
    }
  }
  // Entrée / Espace sur les éléments rendus cliquables
  d.addEventListener("keydown", function (e) {
    var t = e.target; if (!t || !t.hasAttribute || !t.hasAttribute("data-mk-kb")) return;
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); t.click(); }
  });
  // Flèches dans les menus et barres d'onglets
  d.addEventListener("keydown", function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey || !/^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) return;
    var t = e.target; if (!t || !t.closest || editable(t)) return;
    var bar = t.closest(BARS); if (!bar || !/^(A|BUTTON)$/.test(t.tagName) && !t.closest("a[href]")) return;
    var items = [].slice.call(bar.querySelectorAll("a[href],button:not([disabled])")).filter(function (x) { return vis(x) && x.getAttribute("tabindex") !== "-1" && x.closest(BARS) === bar; });
    var i = items.indexOf(t.closest("a[href]") && items.indexOf(t) < 0 ? t.closest("a[href]") : t); if (i < 0 || items.length < 2) return;
    e.preventDefault();
    var j = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    items[j].focus(); try { items[j].scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (x) { }
  });
  // Mode lecture seule (aperçu partenaire) : le clavier ne doit pas contourner le blocage des boutons
  d.addEventListener("click", function (e) {
    var t = e.target; if (!t || !t.closest) return;
    var b = t.closest("button,input,select"); if (!b || !b.closest(".ro") || b.classList.contains("keep") || b.closest(".nav")) return;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);

  // Fenêtres (fiche étudiant, images agrandies, reçus…) : focus dedans, Tab reste dedans, Échap ferme
  var ovPrev = [];
  function onOverlayOpen(o) {
    if (o.classList.contains("dlg") || o.__mk) return; o.__mk = 1;
    if (!o.getAttribute("role")) o.setAttribute("role", "dialog");
    o.setAttribute("aria-modal", "true");
    ovPrev.push({ o: o, prev: d.activeElement });
    setTimeout(function () { if (o.isConnected && !o.contains(d.activeElement)) { var f = focusables(o)[0]; f ? f.focus({ preventScroll: true }) : focusQuiet(o.querySelector(".box,h2") || o); } }, 40);
  }
  function onOverlayGone() {
    ovPrev = ovPrev.filter(function (x) {
      if (x.o.isConnected) return true;
      if (lost() || !d.activeElement.isConnected || x.o.contains(d.activeElement)) { var p = x.prev; if (p && p.isConnected) { try { p.focus({ preventScroll: true }); } catch (e) { } } }
      return false;
    });
  }
  function closeOverlay(o) {
    var L = [].slice.call(o.querySelectorAll("button,a")).filter(vis);
    var c = L.filter(function (b) { return /✖|✕|×|Fermer|Annuler/i.test((b.textContent || "") + (b.getAttribute("aria-label") || "")); })[0];
    if (c) { c.click(); return; }
    if (typeof o.onclick === "function" || o.hasAttribute("onclick")) { o.dispatchEvent(new MouseEvent("click", { bubbles: true })); return; }
    if (o.classList.contains("mk-help")) o.remove();
  }
  d.addEventListener("keydown", function (e) {
    var o = topOverlay(); if (!o || o.classList.contains("dlg")) return;
    if (e.key === "Escape") {
      if (o.id === "lb" || o.classList.contains("lb")) return;     // déjà géré par la visionneuse
      e.preventDefault(); closeOverlay(o); return;
    }
    if (e.key === "Tab") {
      var f = focusables(o); if (!f.length) { e.preventDefault(); return; }
      var i = f.indexOf(d.activeElement);
      if (i < 0 || (e.shiftKey && i === 0) || (!e.shiftKey && i === f.length - 1)) { e.preventDefault(); f[e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i < 0 ? 0 : 0)].focus(); }
    }
  }, true);
  d.addEventListener("focusin", function (e) { // le focus ne doit pas « s'échapper » derrière une fenêtre ouverte
    var o = topOverlay(); if (!o || o.classList.contains("dlg")) return;
    if (!o.contains(e.target)) { var f = focusables(o)[0]; if (f) f.focus({ preventScroll: true }); }
  });

  // Raccourcis : « / » recherche, « ? » aide
  function searchField() {
    var a = appEl() || d.body;
    var L = [].slice.call(a.querySelectorAll("#gq,#sq,input[type=search],input[placeholder^='🔎']")).filter(vis);
    return L[0] || null;
  }
  function help() {
    var txt = "⌨️ Utiliser le site au clavier\n" +
      "• Tab / Maj + Tab : passer d'un bouton ou d'un champ à l'autre\n" +
      "• Entrée ou Espace : appuyer sur le bouton sélectionné\n" +
      "• Flèches ← → : se déplacer dans un menu ou une barre d'onglets\n" +
      "• Échap : fermer une fenêtre ouverte\n" +
      "• / : aller au champ de recherche (s'il y en a un)\n" +
      "• Alt + ← : page précédente\n" +
      "• ? : afficher cette aide\n\n" +
      "Le site retient la page et l'endroit où vous étiez : à votre retour, vous reprenez au même endroit.";
    if (W.dlgAlert) W.dlgAlert(txt); else alert(txt);
  }
  d.addEventListener("keydown", function (e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target; if (editable(t)) return;
    if (t && t !== d.body && !/^(A|BUTTON|SUMMARY)$/.test(t.tagName) && !(t.hasAttribute && t.hasAttribute("data-mk-t"))) return;
    if (topOverlay()) return;
    if (e.key === "?") { e.preventDefault(); help(); }
    else if (e.key === "/") { var s = searchField(); if (s) { e.preventDefault(); s.focus(); try { s.select(); } catch (x) { } } }
  });

  // Lien d'évitement (visible seulement au clavier)
  function skipBar() {
    if (d.querySelector(".mk-skip") || !d.body) return;
    var s = d.createElement("div"); s.className = "mk-skip np";
    s.innerHTML = '<button type="button" data-k="c">Aller au contenu principal</button><button type="button" data-k="h">Aide clavier (?)</button>';
    s.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if (b.getAttribute("data-k") === "h") return help();
      var a = appEl(); if (!a) return;
      var h = firstHeading(a); var f = h || a;
      scrollY_(Math.max(0, docTop(f) - topOff()), false); focusQuiet(f);
    });
    d.body.insertBefore(s, d.body.firstChild);
    var a = appEl(); if (a) { if (a.tagName !== "MAIN" && !a.getAttribute("role")) a.setAttribute("role", "main"); if (!a.hasAttribute("tabindex")) a.setAttribute("tabindex", "-1"); a.setAttribute("data-mk-t", ""); }
  }

  /* =====================================================================
     3. REPRENDRE LÀ OÙ ON ÉTAIT
     ===================================================================== */
  var KEY = "mk_pos_v1", MAXAGE = 30 * 864e5;
  function pth() { var p = location.pathname || "/"; return /^\/(index\.html)?$/.test(p) ? "/" : p; }
  function hk() { var h = location.hash || ""; return h === "" || h === "#" ? "#/" : h; }
  function url() { return pth() + (hk() === "#/" ? "" : hk()); }
  function load() { try { return JSON.parse((LS && LS.getItem(KEY)) || "{}") || {}; } catch (e) { return {}; } }
  function store(o) { try { LS && LS.setItem(KEY, JSON.stringify(o)); } catch (e) { } }
  var ANCH = "h1,h2,h3,h4,.card,.day,summary,.note,tr,li,p";
  function norm(s) { return String(s || "").replace(/\s+/g, " ").trim().slice(0, 80); }
  function anchorNow() {
    var a = appEl(); if (!a) return null;
    var off = topOff(), line = W.pageYOffset + off, L = a.querySelectorAll(ANCH), pick = null;
    for (var i = 0; i < L.length; i++) {
      var r = L[i].getBoundingClientRect(); if (!r.height) continue;
      if (r.top <= off + 2) { if (r.bottom > off || !pick) pick = L[i]; else if (r.bottom > off - 2) pick = L[i]; } else break;
    }
    if (!pick) return null;
    var tx = norm(pick.textContent); if (!tx) return null;
    var k = 0; for (var j = 0; j < L.length && L[j] !== pick; j++) if (norm(L[j].textContent) === tx) k++;
    return { a: tx, i: k, o: Math.round(line - docTop(pick)) };
  }
  function title() {
    var a = appEl(), h = a && (firstHeading(a) || a.querySelector("h1,h2"));
    var t = norm(h ? h.textContent : d.title).slice(0, 70);
    return t || "votre dernière page";
  }
  var block = 0, bannerOn = false;
  function save(force) {
    if (R || (P && now() - P.t < 1500) || now() < block) return;
    var o = load(); o.p = o.p || {}; var k = pth(), h = hk();
    var m = o.p[k] = o.p[k] || {};
    var st = anchorNow() || {}; st.y = Math.round(W.pageYOffset); st.t = now();
    m[h] = st;
    var keys = Object.keys(m); if (keys.length > 40) { keys.sort(function (x, y) { return (m[x].t || 0) - (m[y].t || 0); }); keys.slice(0, keys.length - 40).forEach(function (x) { delete m[x]; }); }
    if (!bannerOn && !d.querySelector("#app input[type=password]")) o.last = { u: url(), t: now(), ti: title() };
    store(o);
  }
  var sT = 0;
  addEventListener("scroll", function () { clearTimeout(sT); sT = setTimeout(save, 350); }, { passive: true });
  d.addEventListener("visibilitychange", function () { if (d.visibilityState === "hidden") save(true); });
  addEventListener("pagehide", function () { save(true); });

  // Restauration progressive : on attend que le contenu soit affiché (chargement, connexion…)
  var R = null, rTick = 0;
  function findAnchor(st) {
    var a = appEl(); if (!a || !st.a) return null;
    var L = a.querySelectorAll(ANCH), k = 0;
    for (var i = 0; i < L.length; i++) { if (norm(L[i].textContent) === st.a) { if (k === (st.i || 0)) return vis(L[i]) ? L[i] : null; k++; } }
    return null;
  }
  function startRestore(st) {
    if (!st || (!st.y && !st.a)) return;
    R = { k: url(), st: st, t0: now(), found: 0 };
    clearInterval(rTick); rTick = setInterval(tryRestore, 200); tryRestore();
  }
  function tryRestore() {
    if (!R) { clearInterval(rTick); return; }
    if (url() !== R.k || now() - R.t0 > 120000) { R = null; return; }
    var st = R.st, el = findAnchor(st), off = topOff();
    if (el) {
      var y = docTop(el) + (st.o || 0) - off;
      if (Math.abs(W.pageYOffset - y) > 3) scrollY_(y, false);
      if (!R.found) R.found = now();
      if (now() - R.found > 1400) R = null;                    // la mise en page est stable : terminé
      return;
    }
    var login = d.querySelector("#app input[type=password]");
    if (!login && now() - R.t0 > (st.a ? 5000 : 900) && d.documentElement.scrollHeight >= (st.y || 0) + innerHeight * 0.5) { scrollY_(st.y || 0, false); R = null; }
  }

  // Retour / Suivant du navigateur, « ← Retour » : on revient à la position qu'on avait sur cette page
  addEventListener("hashchange", function () {
    block = now() + 900; hideBanner();
    var clicked = P && now() - P.t < 1500 && !P.back;
    if (clicked) return;
    var o = load(), m = (o.p || {})[pth()] || {}, st = m[hk()];
    if (st && now() - (st.t || 0) < MAXAGE && (st.y > 0 || st.a)) startRestore(st); else { R = null; scrollY_(0, false); }
  });
  addEventListener("hashchange", function () { setTimeout(save, 1600); });

  // Bandeau « Reprendre là où vous étiez »
  function hideBanner() { var b = d.querySelector(".mk-res"); if (b) b.remove(); bannerOn = false; }
  function banner(last) {
    if (!d.body) return;
    hideBanner(); bannerOn = true;
    var b = d.createElement("div"); b.className = "mk-res np"; b.setAttribute("role", "region"); b.setAttribute("aria-label", "Reprendre");
    b.innerHTML = '<span>↩ Reprendre là où vous étiez : <b></b></span><button type="button" class="go">Reprendre</button><button type="button" class="x" aria-label="Fermer">✕</button>';
    b.querySelector("b").textContent = last.ti || "votre dernière page";
    b.querySelector(".go").onclick = function () { hideBanner(); goTo(last.u); };
    b.querySelector(".x").onclick = function () { hideBanner(); var o = load(); o.last = { u: url(), t: now(), ti: title() }; store(o); };
    var sk = d.querySelector(".mk-skip"); d.body.insertBefore(b, sk ? sk.nextSibling : d.body.firstChild);
    setTimeout(function () { if (b.isConnected && lost()) { try { b.querySelector(".go").focus({ preventScroll: true }); } catch (e) { } } }, 400);
  }
  function goTo(u) {
    var i = u.indexOf("#"), p = i < 0 ? u : u.slice(0, i), h = i < 0 ? "" : u.slice(i);
    if (/^\/(index\.html)?$/.test(p) ? pth() === "/" : p === pth()) { if (h && h !== location.hash) location.hash = h; }
    else location.href = u;
  }

  function init() {
    skipBar(); scan(d.body);
    try { if ("scrollRestoration" in history) history.scrollRestoration = "manual"; } catch (e) { }
    var fresh = true; try { fresh = !(SS && SS.getItem("mk_seen")); SS && SS.setItem("mk_seen", "1"); } catch (e) { }
    var ref = ""; try { ref = d.referrer ? new URL(d.referrer).origin : ""; } catch (e) { }
    var internal = ref === location.origin;
    var o = load(), last = o.last, st = ((o.p || {})[pth()] || {})[hk()];
    var standalone = false; try { standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; } catch (e) { }
    var atRoot = hk() === "#/";
    if (fresh && !internal && atRoot && last && last.u && last.u !== url() && now() - (last.t || 0) < MAXAGE) {
      if (standalone) { goTo(last.u); return; }   // application installée : réouverture directe
      banner(last);
    }
    if (st && now() - (st.t || 0) < MAXAGE && (st.y > 0 || st.a)) startRestore(st);
  }

  // Observateur unique : rend cliquables au clavier les nouveaux éléments, suit les clics, les fenêtres et la restauration
  var mo = new MutationObserver(function (muts) {
    collect(muts);
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (m.type !== "childList") continue;
      for (var j = 0; j < m.addedNodes.length; j++) {
        var n = m.addedNodes[j]; if (n.nodeType !== 1) continue;
        scan(n);
        if (n.matches && n.matches(OVER)) onOverlayOpen(n);
      }
      if (m.removedNodes.length) onOverlayGone();
    }
    if (R) tryRestore();
  });
  function boot() { mo.observe(d.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["style", "hidden", "open", "class"] }); init(); }
  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", boot); else boot();
  W.mkUX = { help: help, save: save };
})();
