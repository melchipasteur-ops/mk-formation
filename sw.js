/* Service worker MK-DIGIT GRAPH — volontairement minimal et sans risque pour la production.
   • Il ne met JAMAIS en cache les pages, l'API, les données des étudiants, les paiements ni les médias.
   • Il ne touche à aucune requête autre que : (1) la navigation entre pages, pour afficher une page « hors connexion »
     si le réseau est coupé ; (2) les icônes et la page hors connexion, gardées localement.
   • Les mises à jour du site sont donc immédiates : aucune ancienne version n'est conservée. */
const V = "mk-v1", PRE = ["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(PRE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const r = e.request; if (r.method !== "GET") return;
  const u = new URL(r.url); if (u.origin !== location.origin) return; // supabase, cdnjs… : on n'y touche pas
  if (r.mode === "navigate") { e.respondWith(fetch(r).catch(() => caches.match("/offline.html"))); return; }
  if (PRE.includes(u.pathname)) e.respondWith(caches.match(r).then(m => m || fetch(r)));
});
