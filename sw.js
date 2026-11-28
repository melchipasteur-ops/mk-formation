/* Service worker MK-DIGIT GRAPH — volontairement minimal et sans risque pour la production.
   • Il ne met JAMAIS en cache les pages, l'API, les données des étudiants, les paiements ni les médias.
   • Il ne touche à aucune requête autre que : (1) la navigation entre pages, pour afficher une page « hors connexion »
     si le réseau est coupé ; (2) les icônes et la page hors connexion, gardées localement.
   • Les mises à jour du site sont donc immédiates : aucune ancienne version n'est conservée. */
const V = "mk-v2", PRE = ["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(PRE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const r = e.request; if (r.method !== "GET") return;
  const u = new URL(r.url); if (u.origin !== location.origin) return; // supabase, cdnjs… : on n'y touche pas
  if (r.mode === "navigate") { e.respondWith(fetch(r).catch(() => caches.match("/offline.html"))); return; }
  if (PRE.includes(u.pathname)) e.respondWith(caches.match(r).then(m => m || fetch(r)));
});

// ===== Notifications push : affichage et ouverture de la bonne page =====
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : "" }; }
  const title = d.title || "MK-DIGIT GRAPH";
  e.waitUntil(self.registration.showNotification(title, { body: d.body || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: d.tag || undefined, renotify: !!d.tag, data: { url: d.url || "/" }, vibrate: [120, 60, 120] }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) if (new URL(c.url).origin === self.location.origin && "focus" in c) { c.navigate(url).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
self.addEventListener("pushsubscriptionchange", e => { /* le navigateur a renouvelé l'abonnement : il sera réenregistré à la prochaine ouverture de l'application */ });
