const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const { AsyncLocalStorage } = require("async_hooks");
const als = new AsyncLocalStorage(); // adresse IP de la requête en cours (pour le blocage des essais)
const TOTAL = +process.env.PRIX_TOTAL || 12000;
// Forum VIP WhatsApp : jamais envoyé au navigateur avant qu'un paiement ait été effectué, validé ou non (voir « receipt »). Le forum de l'inscription gratuite reste public.
const GROUP_LINK = process.env.LIEN_GROUPE || "https://chat.whatsapp.com/CiiVr96Ajj74gM7jTQYoYU?s=cl&p=a&mlu=4&ilr=4&iam=2";
const readGroup = v => { const l = String(v || "").trim(); if (!l) return null; if (l.length > 300 || !/^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+(\?[^\s]*)?$/.test(l)) throw E("Lien du forum VIP invalide : il doit commencer par https://chat.whatsapp.com/"); return l; };
const URL_ = () => process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY_ = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
let _db;
const E = (m, st = 400) => Object.assign(new Error(m), { st });
const db = new Proxy({}, { get: (_, k) => { if (!_db) { if (!URL_() || !KEY_()) throw E("Configuration serveur incomplète.", 500); _db = createClient(URL_(), KEY_(), { auth: { persistSession: false } }); } const v = _db[k]; return typeof v === "function" ? v.bind(_db) : v; } });
const SECRET = () => { const s = process.env.TOKEN_SECRET; if (!s || s.length < 16) throw E("Configuration serveur incomplète.", 500); return s; };
const rnd = n => { const c = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; return Array.from({ length: n }, () => c[crypto.randomInt(c.length)]).join(""); };
const UPC = "ABCDEFGHJKMNPQRSTUVWXYZ", LOC = "abcdefghijkmnpqrstuvwxyz", DGC = "23456789", SPC = "@#$%&*+=?!";
const pk = c => c[crypto.randomInt(c.length)];
const strongCode = (n = 12) => { const a = [pk(UPC), pk(LOC), pk(DGC), pk(SPC)], all = UPC + LOC + DGC + SPC; while (a.length < n) a.push(pk(all)); for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a.join(""); };
const strongOk = x => typeof x === "string" && x.length >= 12 && x.length <= 64 && /[A-Z]/.test(x) && /[a-z]/.test(x) && /[0-9]/.test(x) && /[^A-Za-z0-9]/.test(x);
const WEAK_MSG = "Mot de passe trop faible : 12 caractères minimum avec au moins une majuscule, une minuscule, un chiffre et un caractère spécial (@ # $ % & * + = ? !).";
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const normId = x => String(x || "").trim().replace(/\s+/g, " ").toLowerCase();
const ROOT_ID = () => normId(process.env.ADMIN_ID || "Admin Melchi");
// Le mot de passe provisoire d'un partenaire reste visible par l'administrateur jusqu'à son changement (comme avant) : il est chiffré dans la base
const PEK = () => crypto.createHash("sha256").update("pin-enc:" + SECRET()).digest();
const pinEnc = t => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", PEK(), iv), ct = Buffer.concat([c.update(String(t), "utf8"), c.final()]); return "enc:" + [iv, c.getAuthTag(), ct].map(b => b.toString("base64")).join(":"); };
const pinDec = e => { try { if (!String(e).startsWith("enc:")) return e || null; const [iv, tag, ct] = e.slice(4).split(":").map(x => Buffer.from(x, "base64")), d = crypto.createDecipheriv("aes-256-gcm", PEK(), iv); d.setAuthTag(tag); return Buffer.concat([d.update(ct), d.final()]).toString("utf8"); } catch (err) { return null; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mac = p => crypto.createHmac("sha256", SECRET()).update(p).digest("base64url");
const sign = o => { const p = Buffer.from(JSON.stringify(o)).toString("base64url"); return p + "." + mac(p); };
function check(t, role) {
  const [p, s] = String(t || "").split("."); if (!p || !s) throw E("Session expirée. Reconnectez-vous.", 401);
  const e = mac(p); if (s.length !== e.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) throw E("Session invalide.", 401);
  const o = JSON.parse(Buffer.from(p, "base64url").toString()); if (o.r !== role || o.exp < Date.now()) throw E("Session expirée. Reconnectez-vous.", 401);
  return o;
}
const hash = (pin, salt = crypto.randomBytes(8).toString("hex")) => salt + ":" + crypto.scryptSync(String(pin), salt, 32).toString("hex");
const same = (pin, h) => { const [s, x] = String(h).split(":"); const y = hash(pin, s).split(":")[1]; return x && x.length === y.length && crypto.timingSafeEqual(Buffer.from(x), Buffer.from(y)); };
const must = r => { if (r.error) throw r.error; return r.data; };
async function limit(key, max, win) {
  const now = Date.now(), r = must(await db.from("rate").select("*").eq("k", key).maybeSingle());
  if (!r || now - Number(r.t) > win) { must(await db.from("rate").upsert({ k: key, n: 1, t: now })); return; }
  if (r.n >= max) throw E("Trop de tentatives. Réessayez dans quelques minutes.", 429);
  must(await db.from("rate").update({ n: r.n + 1 }).eq("k", key));
}
// Essais INCORRECTS uniquement : un utilisateur honnête n'est jamais bloqué par ses bonnes connexions
async function failCheck(key, max, win) { const r = must(await db.from("rate").select("*").eq("k", key).maybeSingle()); if (r && Date.now() - Number(r.t) <= win && r.n >= max) throw E("Trop d'essais incorrects (3 maximum). Réessayez dans 15 minutes ou contactez MK-DIGIT GRAPH.", 429); }
async function failAdd(key, win) { const now = Date.now(), r = must(await db.from("rate").select("*").eq("k", key).maybeSingle()); if (!r || now - Number(r.t) > win) must(await db.from("rate").upsert({ k: key, n: 1, t: now })); else must(await db.from("rate").update({ n: r.n + 1 }).eq("k", key)); }
const failClear = async key => { must(await db.from("rate").delete().eq("k", key)); };
// Double vérification (TOTP, compatible Google Authenticator) : active seulement si ADMIN_TOTP_SECRET est défini
const b32 = x => { const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, val = 0; const out = []; for (const ch of String(x).toUpperCase().replace(/[^A-Z2-7]/g, "")) { val = (val << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
const totp = (secret, t = Date.now()) => { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(t / 30000))); const h = crypto.createHmac("sha1", b32(secret)).update(c).digest(), o = h[h.length - 1] & 15; return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0"); };
const totpOk = code => { const sec = process.env.ADMIN_TOTP_SECRET; if (!sec) return true; const c = Buffer.from(String(code || "").replace(/\s/g, "").padStart(6, "x").slice(0, 6)); return [-1, 0, 1].some(i => { const a = Buffer.from(totp(sec, Date.now() + i * 30000)); return a.length === c.length && crypto.timingSafeEqual(a, c); }); };
const setting = async k => { const r = must(await db.from("settings").select("value").eq("key", k).maybeSingle()); return r ? r.value : false; };
const putSetting = async (k, v) => must(await db.from("settings").upsert({ key: k, value: v }));
// Offres : montant offert à un étudiant (déduit du prix total, à payer en UNE seule fois)
const offersMap = async () => { const m = {}; try { must(await db.from("offers").select("num,amount")).forEach(r => { m[r.num] = Number(r.amount); }); } catch (e) { /* table « offers » pas encore créée : aucune offre */ } return m; };
const offerOf = async num => { try { const r = must(await db.from("offers").select("amount").eq("num", String(num || "")).maybeSingle()); return r ? Number(r.amount) : 0; } catch (e) { return 0; } };
// Tarif réduit de 1re tranche : accordé UNIQUEMENT par l'administrateur, étudiant par étudiant (table formation_t1).
// Il ne change que le montant de la 1re tranche : le prix total reste le même (le reste à payer augmente d'autant).
const T1_REDUIT = +process.env.PRIX_TRANCHE1_REDUIT || 5000;
const t1Map = async () => { const m = {}; try { must(await db.from("formation_t1").select("num,t1")).forEach(r => { m[r.num] = Number(r.t1); }); } catch (e) { /* table pas encore créée : aucun tarif réduit */ } return m; };
const t1Of = async num => { try { const r = must(await db.from("formation_t1").select("t1").eq("num", String(num || "")).maybeSingle()); return r ? Number(r.t1) : 0; } catch (e) { return 0; } };
const withT1 = (P, o) => o > 0 && P && o < P.total ? { ...P, t1: o } : P;
const COLS = "num,id,vc,nom,prenoms,dob,lieu,email,partner,status,motif,termine,date,dv,wa,phase,retire,date_retrait";
const sum = (a, st) => a.filter(x => x.st === st).reduce((t, x) => t + Number(x.amount), 0);
const pub = r => ({ num: r.num, id: r.id, vc: r.vc, nom: r.nom, prenoms: r.prenoms, dob: r.dob, lieu: r.lieu, email: r.email, partner: r.partner, status: r.status, motif: r.motif, wa: r.wa, phase: r.phase || "complet", termine: !!r.termine, retire: !!r.retire, date_retrait: r.date_retrait ? Number(r.date_retrait) : 0, date: Number(r.date), dv: r.dv ? Number(r.dv) : 0 });
const enrich = (r, pays, off = 0, P = null) => { P = P || pricingOf(null); const m = pays.filter(p => p.num === r.num), paid = sum(m, "valide"), pend = sum(m, "attente"); return { ...pub(r), paid, pend, reste: Math.max(0, P.total - off - paid), solde: paid >= P.total - off, nPay: m.length, offer: off, total: P.total - off, base: P.total, t1: P.t1, free: P.free, t1days: P.t1days }; };
// Vue partenaire : AUCUN nom, AUCUN identifiant de connexion, AUCUNE référence de transaction.
const forPartner = s => ({ num: s.num, partner: s.partner, phase: s.phase, date: s.date, paid: s.paid, pend: s.pend, reste: s.reste, solde: s.solde });
const payPart = x => ({ id: x.id, num: x.num, amount: Number(x.amount), date: Number(x.date), st: x.st, dv: x.dv ? Number(x.dv) : 0 });
const dreqPart = r => ({ id: r.id, num: r.num, partner: r.partner, st: r.st, date: Number(r.date) });
const payPub = x => ({ id: x.id, num: x.num, partner: x.partner, amount: Number(x.amount), trx: x.trx, date: Number(x.date), st: x.st, motif: x.motif, dv: x.dv ? Number(x.dv) : 0 });
const PCOLS = "id,num,partner,amount,trx,date,st,motif,dv";
const baseOf = (p, pays) => pays.filter(x => x.st === "valide" && x.partner === p.id && (!p.rompu || x.dv <= p.rompu.date)).reduce((t, x) => t + x.amount, 0);
// Commission par paliers : le taux dépend du rang de l'étudiant parmi ceux du partenaire (ordre du 1er paiement validé). Hors paliers : taux par défaut (coef).
const tierPct = (p, rank) => { for (const t of (Array.isArray(p.tiers) ? p.tiers : [])) if (rank >= t.from && (t.to == null || rank <= t.to)) return Number(t.pct); return Number(p.coef); };
const commOf = (p, pays) => {
  const v = pays.filter(x => x.st === "valide" && x.partner === p.id && (!p.rompu || x.dv <= p.rompu.date)), first = {};
  v.forEach(x => { if (!(x.num in first) || x.dv < first[x.num]) first[x.num] = x.dv; });
  const rank = {}; Object.keys(first).sort((a, b) => first[a] - first[b] || (a < b ? -1 : 1)).forEach((n, i) => { rank[n] = i + 1; });
  return Math.round(v.reduce((t, x) => t + x.amount * tierPct(p, rank[x.num]) / 100, 0));
};
const part = (p, withPin, pouts = [], base = 0, comm = null) => ({ id: p.id, name: p.name, code: p.code, wa: p.wa || "", coef: Number(p.coef), base, comm: comm == null ? Math.round(base * Number(p.coef) / 100) : comm, tiers: Array.isArray(p.tiers) ? p.tiers : [], paid: pouts.filter(x => x.st === "recu").reduce((a, x) => a + Number(x.amount), 0), pending: pouts.filter(x => x.st === "attente").reduce((a, x) => a + Number(x.amount), 0), rompu: p.rompu || null, pinChanged: !!p.pin_changed, ...(withPin && !p.pin_changed && p.pin ? { pin: pinDec(p.pin) } : {}) });
const payRow = x => ({ id: x.id, partner: x.partner, amount: Number(x.amount), ref: x.ref, note: x.note, date: Number(x.date), st: x.st, date_conf: x.date_conf ? Number(x.date_conf) : 0 });
const img = s => typeof s === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(s) && s.length < 900000;
const pinOk = (p, pin) => p.pin_hash ? (same(String(pin || ""), p.pin_hash) || (!p.pin_changed && same(String(pin || "").trim().toUpperCase(), p.pin_hash))) : (p.pin != null && String(pin || "").trim().toUpperCase() === String(p.pin).toUpperCase());
const needSet = async t => { const p = await getPartner(t.pid); if (!p || p.rompu) throw E("Accès désactivé.", 401); if (!p.pin_changed) throw E("Changez d'abord votre mot de passe provisoire.", 403); return p; };
const getPartner = async id => must(await db.from("partners").select("*").eq("id", id).maybeSingle());
const findStudent = async (num, id, cols = COLS) => {
  const n = String(num || "").toUpperCase().slice(0, 30), ip = (als.getStore() || {}).ip || "?";
  await failCheck("sf:" + n, 3, 900e3); await failCheck("si:" + ip, 20, 900e3);
  const need = cols.split(",").includes("id"), r = must(await db.from("students").select(need ? cols : cols + ",id").eq("num", n).maybeSingle()), typed = String(id || "").trim().slice(0, 64);
  // codes de 12 caractères : sensibles à la casse ; anciens codes de 6 caractères (majuscules) : casse ignorée
  const good = r && r.id && (String(r.id).length > 8 ? safeEq(typed, r.id) : safeEq(typed.toUpperCase(), String(r.id).toUpperCase()));
  if (!good) { await failAdd("sf:" + n, 900e3); await failAdd("si:" + ip, 900e3); return null; }
  if (!need) delete r.id;
  return r;
};
async function syncStatus(num) {
  const ps = must(await db.from("payments").select("amount,st").eq("num", num)), paid = sum(ps, "valide");
  const cur = must(await db.from("students").select("status").eq("num", num).maybeSingle()); if (!cur) return;
  const st = paid >= (await prc(num)).total - (await offerOf(num)) ? "valide" : "attente";
  if (cur.status !== st) must(await db.from("students").update({ status: st, dv: st === "valide" ? Date.now() : null }).eq("num", num));
}

// ===================== FORMATION : accès, paiement par tranches, cours, notes =====================
// ===== PARCOURS : formation (création vidéo & web / informatique) + module (vidéo ou web) =====
// Chaque étudiant a un « parcours » : { formation, module }. Sans colonne en base (ou valeur vide) = comportement d'origine (création, 30 jours, tarif de la promotion).
const CTS = { creation: require("./formation_content.json"), informatique: require("./formation_content_informatique.json") }; // cours + leçons + réponses : lu uniquement par le serveur
const FORMS = { creation: { label: "Création de vidéos avec l'IA et de sites web", short: "Création vidéo & web", key: 0 }, informatique: { label: "Informatique professionnelle : de débutant à professionnel (60 jours)", short: "Informatique professionnelle (60 jours)", key: 100 } };
const MODS = { video: { from: 1, to: 14, label: "Création de vidéos avec l'IA" }, web: { from: 15, to: 29, label: "Création de sites web" } };
const MOD_TOTAL = +process.env.PRIX_MODULE_TOTAL || 7000, MOD_FORM = +process.env.PRIX_MODULE_FORMATION || 5000; // 7 000 = 5 000 (formation) + 2 000 (attestation)
const FORMS_PUB = Object.fromEntries(Object.entries(FORMS).map(([k, v]) => [k, { label: v.label, short: v.short, modules: k === "creation" }]));
const MODS_PUB = Object.fromEntries(Object.entries(MODS).map(([k, v]) => [k, { label: v.label, from: v.from, to: v.to, days: v.to - v.from + 1 }]));
const FLEN = { creation: 30, informatique: 60 }; // nombre de jours de chaque formation
const DEF_TRACK = { formation: "creation", module: null };
const cleanTrack = (f, m) => { const formation = FORMS[f] ? f : "creation", module = formation === "creation" && MODS[m] ? m : null; return { formation, module }; };
const curT = () => (als.getStore() || {}).T || DEF_TRACK;
const inMod = (n, T) => !T || !T.module || (n >= MODS[T.module].from && n <= MODS[T.module].to);
const courseOf = T => CTS[(T || DEF_TRACK).formation].course.filter(x => inMod(x.n, T));
const NK = () => FORMS[curT().formation].key; // décalage des clés « jour » des notes et médias de l'administrateur (évite le mélange entre formations)
const CT = { get course() { return courseOf(curT()); }, get lessons() { return CTS[curT().formation].lessons; }, get teach() { return CTS[curT().formation].teach; }, get sites() { return CTS[curT().formation].sites || {}; } };
const trackOf = async num => { try { const r = await db.from("students").select("formation,module").eq("num", String(num || "")).maybeSingle(); if (r.error || !r.data) return DEF_TRACK; return cleanTrack(r.data.formation, r.data.module); } catch (e) { return DEF_TRACK; } };
const trackMap = async () => { const m = {}; try { const r = await db.from("students").select("num,formation,module"); if (r.error) return m; (r.data || []).forEach(x => { m[x.num] = cleanTrack(x.formation, x.module); }); } catch (e) { /* colonnes pas encore créées */ } return m; };
const trackPub = T => ({ form: T.formation, module: T.module, formLabel: FORMS[T.formation].label, modLabel: T.module ? MODS[T.module].label : "" });
// Tarif d'un module : 7 000 FCFA au total = 5 000 de formation (1re tranche, couvre tous les jours du module) + 2 000 d'attestation (solde)
const modPr = (P, T) => T && T.module ? { ...P, total: MOD_TOTAL, t1: MOD_FORM, t1days: MODS[T.module].to - MODS[T.module].from + 1, att: MOD_TOTAL - MOD_FORM, mod: true } : P;
const T1 = +process.env.PRIX_TRANCHE1 || 7000, FREE_DAYS = 2, T1_DAYS = 10, PASSM = 14, WT = 0.3;
const dayDef = n => CT.course.find(x => x.n === n);
const quizOf = n => (CT.lessons[n] || {}).quiz || null;
const nz = s => String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9<>\/ ]/g, " ").replace(/\s+/g, " ").trim();
const qok = (q, a) => a == null || a === "" ? false : q[0] === "qcm" ? a === q[3] : q[0] === "vf" ? a === q[2] : q[2].some(x => nz(a).includes(nz(x)));
const qscore = (n, qa) => { const Q = quizOf(n); if (!Q) return null; const ok = Q.map((q, i) => qok(q, qa[i])), s = ok.filter(Boolean).length; return { ok, s, t: Q.length, v: Math.round(s / Q.length * 200) / 10 }; };
const qpub = Q => Q.map(q => q.slice(0, q[0] === "qcm" ? 3 : 2));
const qexp = q => q[q[0] === "qcm" ? 4 : 3];
const qans = (q, a) => a == null || a === "" ? "(sans réponse)" : q[0] === "qcm" ? q[2][a] : q[0] === "vf" ? (a ? "Vrai" : "Faux") : String(a);
const DEFAULT_START = Date.parse(process.env.FORMATION_START || "2026-11-01T00:00:00+01:00"); // minuit à Cotonou
// Promotions : chaque promotion (mois de formation) a sa propre date de démarrage et son propre calendrier ; la promotion 1 = la formation d'origine
const cohortOf = async num => { try { const r = must(await db.from("students").select("cohort").eq("num", String(num || "")).maybeSingle()); return r && Number(r.cohort) || 1; } catch (e) { return 1; } };
const regCohort = async (formation = "creation") => { // promotion dans laquelle les nouveaux s'inscrivent, pour une formation donnée (0 = aucune)
  try {
    let r = await db.from("formation_cfg").select("id,formation").eq("registering", true).order("id", { ascending: false });
    if (r.error) { r = await db.from("formation_cfg").select("id").eq("registering", true).order("id", { ascending: false }); if (r.error) throw r.error; }
    const rows = (r.data || []).filter(x => (x.formation || "creation") === formation);
    return rows.length ? Number(rows[0].id) : formation === "creation" ? 1 : 0;
  } catch (e) { return formation === "creation" ? 1 : 0; }
};
const unsetReg = async F => { let r = await db.from("formation_cfg").select("id,formation"); if (r.error) r = await db.from("formation_cfg").select("id"); const ids = (r.data || []).filter(x => (x.formation || "creation") === F).map(x => Number(x.id)); if (ids.length) must(await db.from("formation_cfg").update({ registering: false }).in("id", ids)); };
const formOfCohort = async id => { try { const r = await db.from("formation_cfg").select("*").eq("id", Number(id) || 0).maybeSingle(); return r.data && FORMS[r.data.formation] ? r.data.formation : "creation"; } catch (e) { return "creation"; } };
const studentsC = async cols => { const r = await db.from("students").select(cols + ",cohort"); return r.error ? db.from("students").select(cols) : r; };
// Tarification d'une promotion : prix total, 1re tranche (0 = paiement en une seule fois), jours gratuits, jours couverts par la 1re tranche
// Identité : civilité, nom, date et lieu de naissance (imprimés sur l'attestation)
const CIVS = ["M.", "Mme", "Mlle"];
const civMap = async () => { const m = {}; try { must(await db.from("students").select("num,civ")).forEach(x => { if (x.civ) m[x.num] = x.civ; }); } catch (e) { /* colonne civ pas encore créée */ } return m; };
const civOf = async num => { try { const r = must(await db.from("students").select("civ").eq("num", String(num || "")).maybeSingle()); return r && r.civ || ""; } catch (e) { return ""; } };
const cleanSp = v => String(v || "").replace(/\s+/g, " ").trim();
const nameOk = v => v.length >= 2 && v.length <= 80 && /^\p{L}[\p{L}\s'’.-]*\p{L}$/u.test(v);
const checkDob = dob => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) throw E("Date de naissance invalide : saisissez le jour, le mois et l'année.");
  const t = Date.parse(dob + "T00:00:00Z"); if (isNaN(t) || new Date(t).toISOString().slice(0, 10) !== dob) throw E("Date de naissance inexistante : vérifiez le jour, le mois et l'année.");
  const age = (Date.now() - t) / 31557600000; if (!(age >= 10 && age <= 100)) throw E("Date de naissance peu plausible : vérifiez l'année (âge entre 10 et 100 ans).");
};
const pricingOf = r => ({ len: FLEN[r && r.formation] || 30, total: r && Number(r.price) > 0 ? Number(r.price) : TOTAL, t1: r && r.t1 != null ? Number(r.t1) : T1, free: r && r.free_days != null ? Number(r.free_days) : FREE_DAYS, t1days: r && r.t1_days != null ? Number(r.t1_days) : T1_DAYS });
const pricesMap = async () => { const m = {}; try { must(await db.from("formation_cfg").select("*")).forEach(r => { m[Number(r.id)] = pricingOf(r); }); } catch (e) { /* tarifs par défaut */ } if (!m[1]) m[1] = pricingOf(null); return m; };
const cohortMap = async () => { const m = {}; must(await studentsC("num")).forEach(x => { m[x.num] = Number(x.cohort) || 1; }); return m; };
const prc = async num => withT1(modPr((await fcfg(await cohortOf(num))).pr, await trackOf(num)), await t1Of(num));
const fcfgFor = async num => { const c = await fcfg(await cohortOf(num)), o = await t1Of(num), T = await trackOf(num); return o > 0 || T.module ? { ...c, pr: withT1(modPr(c.pr, T), o) } : c; };
const readPricing = d => {
  const total = Math.round(+d.price), t1 = Math.round(+d.t1 || 0), free = Math.round(+d.free), t1days = Math.round(+d.t1days || 0);
  if (!(total >= 100 && total <= 10000000)) throw E("Prix total invalide (au moins 100 FCFA).");
  if (t1 < 0 || (t1 > 0 && t1 >= total)) throw E("La 1re tranche doit être comprise entre 1 et " + (total - 1) + " FCFA (ou 0 pour un paiement en une seule fois).");
  if (!(free >= 0 && free <= 60)) throw E("Jours gratuits : de 0 à 60.");
  if (t1 > 0 && !(t1days >= Math.max(1, free) && t1days <= 60)) throw E("Jours couverts par la 1re tranche : entre " + Math.max(1, free) + " et 60.");
  return { price: total, t1, free_days: free, t1_days: t1 > 0 ? t1days : free };
};
const cohortsList = async (all = []) => {
  let rows; try { rows = must(await db.from("formation_cfg").select("*").order("id")); } catch (e) { rows = must(await db.from("formation_cfg").select("id,start_at,launch_at").order("id")); }
  const regSet = new Set(); for (const f of Object.keys(FORMS)) { const x = await regCohort(f); if (x) regSet.add(x); }
  return rows.map(r => { const id = Number(r.id); return { id, formation: FORMS[r.formation] ? r.formation : "creation", name: r.name || "Promotion " + id, start: r.start_at ? Number(r.start_at) : DEFAULT_START, launched: !!r.launch_at, registering: regSet.has(id), pr: pricingOf(r), groupe: r.group_link || "", grp: r.group_link || GROUP_LINK, n: all.filter(x => (Number(x.cohort) || 1) === id).length }; });
};
const fcfg = async (cid = 1) => {
  const r = must(await db.from("formation_cfg").select("*").eq("id", cid).maybeSingle()), manual = r && r.launch_at ? Number(r.launch_at) : 0, start = r && r.start_at ? Number(r.start_at) : DEFAULT_START;
  return { len: FLEN[r && r.formation] || 30, launch: manual || (Date.now() >= start ? start : 0), manual: !!manual, start, adm: r ? Number(r.admin_day || 0) : 0, pr: pricingOf(r), grp: r && r.group_link || GROUP_LINK };
};
const schedDay = c => c.launch ? Math.min(c.len || 30, Math.floor((Date.now() - c.launch) / 864e5) + 1) : 0;
const openDayOf = c => c.launch ? Math.min(c.len || 30, Math.max(schedDay(c), c.adm)) : 0;
const levelOf = (paid, off = 0, P = null) => { P = P || pricingOf(null); return paid >= P.total - off ? (P.len || 30) : P.t1 > 0 && paid >= P.t1 ? P.t1days : P.free; };
const passed30 = async num => { const ok = new Set(must(await db.from("formation_prog").select("day,grade").eq("num", String(num || ""))).filter(x => x.grade != null && Number(x.grade) >= PASSM).map(x => Number(x.day))); return courseOf(await trackOf(num)).every(x => ok.has(x.n)); }; // « terminé » = tous les jours du parcours validés (30 jours, ou ceux du module)
const isFree = async num => !!must(await db.from("formation_free").select("num").eq("num", String(num || "")).maybeSingle());
// Autorisation d'avancer : l'étudiant ouvre les jours 1 à « upto » sans avoir validé les précédents (table formation_skip). Jamais bloquant si la table est absente.
const skipMap = async () => { try { const r = await db.from("formation_skip").select("*"); if (r.error) return {}; const m = {}; (r.data || []).forEach(x => { m[x.num] = { upto: Math.max(0, Math.min(60, Number(x.upto) || 0)), mode: x.mode === "compose" ? "compose" : "free", note: x.note || "", at: Number(x.at || 0) }; }); return m; } catch (e) { return {}; } };
const skipOf = async num => { try { const r = await db.from("formation_skip").select("upto,mode").eq("num", String(num || "")).maybeSingle(); return r.error || !r.data ? { upto: 0, mode: "free" } : { upto: Math.max(0, Math.min(60, Number(r.data.upto) || 0)), mode: r.data.mode === "compose" ? "compose" : "free" }; } catch (e) { return { upto: 0, mode: "free" }; } };
// "gift" = accès offert : jamais exposé à l'étudiant (il voit simplement « accès complet »)
const fInfoBase = (paid, pend, c, gift, ov, off = 0, sk = 0) => { const P = c.pr || pricingOf(null), LN = c.len || P.len || 30, hasT1 = P.t1 > 0 && paid >= P.t1, skO = sk && typeof sk === "object" ? sk : { upto: Number(sk) || 0, mode: "free" }, skp = (c.launch || ov) ? Math.max(0, Math.min(LN, Number(skO.upto) || 0)) : 0, open = Math.min(LN, Math.max(openDayOf(c), ov ? Number(ov.open_day || 0) : 0, skp)), full = gift || paid >= P.total - off; return { launched: !!c.launch || !!ov, startAt: c.start, now: Date.now(), nextAt: c.launch && schedDay(c) < LN ? c.launch + schedDay(c) * 864e5 : 0, early: !!ov, skip: skp, skipMode: skp && skO.mode === "compose" ? "compose" : "free", openDay: open, paid, pend, level: full ? LN : levelOf(paid, off, P), len: LN, plan: full ? "complet" : hasT1 ? "tranche1" : "gratuit", remaining: !full && hasT1 ? Math.max(0, P.t1days - open) : null, freeLeft: !full && !hasT1 ? Math.max(0, P.free - open) : null, T1: P.t1, TOTAL: P.total - off, base: P.total, offer: off, free: P.free, t1days: P.t1days }; };
// Module : les jours du module sont comptés à partir de 1 (jour 1 du module), puis ramenés aux numéros réels du cours (ex. module web = jours 15 à 29).
const fInfo = (paid, pend, c, gift, ov, off = 0, sk = 0, T = null) => {
  if (!T || !T.module) return { ...fInfoBase(paid, pend, c, gift, ov, off, sk), formation: T ? T.formation : curT().formation, module: null };
  const M = MODS[T.module], o = M.from - 1, L = M.to - o, P = modPr(c.pr || pricingOf(null), T), skO = sk && typeof sk === "object" ? sk : { upto: Number(sk) || 0, mode: "free" };
  const rel = x => Math.max(0, Math.min(L, (Number(x) || 0) - o)), ab = v => v > 0 ? v + o : 0;
  const fx = fInfoBase(paid, pend, { ...c, pr: P }, gift, ov ? { ...ov, open_day: rel(ov.open_day) } : ov, off, { upto: rel(skO.upto), mode: skO.mode });
  return { ...fx, formation: T.formation, module: T.module, mod: { key: T.module, from: M.from, to: M.to, len: L, off: o, label: M.label }, att: Math.max(0, P.total - P.t1), skip: ab(fx.skip), openDay: ab(Math.min(L, fx.openDay)), level: fx.level >= 30 ? 30 : fx.level + o, nextAt: c.launch && schedDay(c) < L ? c.launch + schedDay(c) * 864e5 : 0 };
};
// Classements : rang du jour (parmi les notes du jour) et rang général (par moyenne), dans la promotion de l'étudiant. Égalités = même rang.
const rankFrom = rows => {
  const byDay = {}, sums = {};
  rows.forEach(r => { if (r.grade == null) return; const g = Number(r.grade); (byDay[r.day] = byDay[r.day] || []).push(g); const a = sums[r.num] = sums[r.num] || { s: 0, n: 0 }; a.s += g; a.n++; });
  const avg = {}; for (const n in sums) avg[n] = Math.round(sums[n].s / sums[n].n * 100) / 100;
  const avgs = Object.values(avg), rk = (arr, v) => 1 + arr.filter(x => x > v).length, mean = a => a.length ? Math.round(a.reduce((t, x) => t + x, 0) / a.length * 100) / 100 : null;
  const dayAvg = {}; for (const d in byDay) dayAvg[d] = mean(byDay[d]);
  return { avg, nr: avgs.length, classAvg: mean(avgs), dayAvg, dayRank: (day, g) => byDay[day] ? { r: rk(byDay[day], Number(g)), n: byDay[day].length } : null, genRank: num => avg[num] == null ? null : { r: rk(avgs, avg[num]), n: avgs.length } };
};
const rankCache = {};
const rankInfo = async cid => {
  const c = rankCache[cid]; if (c && Date.now() - c.t < 30000) return c.v;
  const cm = await cohortMap(), v = rankFrom(must(await db.from("formation_prog").select("num,day,grade")).filter(r => r.grade != null && (cm[r.num] || 1) === cid));
  rankCache[cid] = { t: Date.now(), v }; return v;
};
// Note d'un travail : combine la note du travail (gp) et le score du quiz (gt) ; renvoie null s'il n'y a pas de remise
const gradeOne = async (num, n, g, comment) => {
  const r = must(await db.from("formation_prog").select("sub,gt").eq("num", num).eq("day", n).maybeSingle()); if (!r || !r.sub) return null;
  const fin = r.gt == null ? g : Math.round((g * (1 - WT) + Number(r.gt) * WT) * 10) / 10;
  must(await db.from("formation_prog").update({ gp: g, grade: fin, comment: String(comment || "").slice(0, 600), gat: Date.now() }).eq("num", num).eq("day", n));
  if (fin >= PASSM) { const all = must(await db.from("formation_prog").select("day,grade").eq("num", num)); if (await passed30(num)) must(await db.from("students").update({ termine: true }).eq("num", num)); } else { const st0 = must(await db.from("students").select("termine").eq("num", num).maybeSingle()); if (st0 && st0.termine && !(await passed30(num))) must(await db.from("students").update({ termine: false }).eq("num", num)); }
  Object.keys(rankCache).forEach(k => delete rankCache[k]);
  return fin;
};
const passedRow = r => !!r && r.grade != null && Number(r.grade) >= PASSM;
const pendDays = (fx, pm) => { const o = []; for (let d = fx.mod ? fx.mod.from : 1; d <= (fx.skip || 0); d++) if (!passedRow(pm[d])) o.push(d); return o; };
const dayAcc = (n, fx, pm) => !fx.launched ? "start" : fx.mod && (n < fx.mod.from || n > fx.mod.to) ? "mod" : n <= (fx.skip || 0) ? (n > fx.level ? "view" : "ok") : n > fx.level ? "pay" : n > fx.openDay ? "wait" : fx.skipMode === "compose" && !fx.preview && pendDays(fx, pm).length ? "comp" : n > (fx.mod ? fx.mod.from : 1) && !fx.preview && !passedRow(pm[n - 1]) ? "prev" : "ok";
const reasonOf = (a, n, fx, pm) => a === "mod" ? "Ce jour ne fait pas partie de votre module. Si vous souhaitez changer de module, contactez MK-DIGIT GRAPH." : a === "start" ? "La formation n'a pas encore démarré. Vous y aurez accès dès son lancement officiel."
  : a === "wait" ? "Le jour " + n + " n'est pas encore ouvert. Il s'ouvrira sur l'ordre de MK-DIGIT GRAPH."
  : a === "pay" ? (fx.mod && !(fx.offer > 0) ? "Les " + fx.free + " jours gratuits sont terminés. Réglez " + fx.T1 + " FCFA (formation) pour continuer, plus " + fx.att + " FCFA d'attestation (vous pouvez aussi tout payer en une fois : " + fx.base + " FCFA)." : fx.offer > 0 ? "Les " + fx.free + " jours gratuits sont terminés. Payez " + fx.TOTAL + " FCFA en une seule fois pour continuer." : fx.T1 > 0 && fx.paid >= fx.T1 ? "Votre 1re tranche couvre les " + fx.t1days + " premiers jours. Réglez la 2e tranche (" + (fx.base - fx.T1) + " FCFA) pour continuer." : fx.T1 > 0 ? "Les " + fx.free + " jours gratuits sont terminés. Payez " + fx.T1 + " FCFA (jours 1 à " + fx.t1days + ") ou " + fx.base + " FCFA (accès complet) pour continuer." : "Les " + fx.free + " jours gratuits sont terminés. Payez " + fx.base + " FCFA pour continuer.")
  : a === "view" ? "Ce jour est ouvert en lecture seule : vous pouvez suivre le cours, mais vous devez d'abord payer pour composer (remettre votre travail)." : a === "comp" ? "Votre formateur vous a fait avancer : composez d'abord (et faites valider) le(s) jour(s) " + pendDays(fx, pm || {}).join(", ") + " (14/20 minimum chacun). Vous pouvez les faire le même jour." : "Validez d'abord le jour précédent (14/20 minimum).";
async function fctx(d, c, key, max = 300) {
  await limit(key + ":" + c.ip, max, 900e3);
  let adm = false; if (d.token) { try { check(d.token, "a"); adm = true; } catch (e) { adm = false; } }
  const cfg = await fcfg(), pm = {}, cols = "day,sub,grade,gp,gt,comment,att,gat";
  if (adm && !d.num) { // aperçu administrateur : tout est ouvert, lecture seule
    for (let i = 1; i <= (cfg.len || 30); i++) pm[i] = null;
    return { s: { num: "APERCU", nom: "Aperçu", prenoms: "Administrateur" }, fx: { ...fInfo(0, 0, cfg, true), launched: true, openDay: cfg.len || 30, preview: true }, pm, ro: true };
  }
  const s = adm ? must(await db.from("students").select("num,nom,prenoms").eq("num", String(d.num).toUpperCase().slice(0, 30)).maybeSingle()) : await findStudent(d.num, d.id, "num,nom,prenoms");
  if (!s) throw E(adm ? "Étudiant introuvable." : "Numéro ou identifiant incorrect.", 404);
  const ps = must(await db.from("payments").select("amount,st").eq("num", s.num)), fx = fInfo(sum(ps, "valide"), sum(ps, "attente"), await fcfgFor(s.num), await isFree(s.num), must(await db.from("formation_access").select("*").eq("num", s.num).maybeSingle()), await offerOf(s.num), await skipOf(s.num), await trackOf(s.num));
  must(await db.from("formation_prog").select(cols).eq("num", s.num)).forEach(r => pm[r.day] = r);
  return { s, fx, pm, ro: adm };
}
function needDay(d, fx, pm, write) { const n = Math.round(+d.day); if (!dayDef(n)) throw E(CTS[curT().formation].course.some(x => x.n === n) ? "Ce jour ne fait pas partie de votre module. Si vous souhaitez changer de module, contactez MK-DIGIT GRAPH." : "Jour inconnu.", 404); const a = dayAcc(n, fx, pm); if (a === "view") { if (write) throw E(reasonOf(a, n, fx, pm), 403); return n; } if (a !== "ok") throw E(reasonOf(a, n, fx, pm), 403); return n; } // « view » = lecture seule (avancé sans avoir payé) : toute écriture (travail, quiz, vidéo) est refusée
function cleanData(d) {
  const o = {}, arr = a => Array.isArray(a) ? a.slice(0, 60).map(Boolean) : [];
  o.steps = arr(d.steps); o.ex = arr(d.ex); o.answer = String(d.answer || "").slice(0, 4000); o.files = {};
  if (d.files && typeof d.files === "object") Object.entries(d.files).slice(0, 10).forEach(([k, v]) => { if (/^[\w\-]{1,40}\.(html|css|js|php|txt)$/i.test(k)) o.files[k] = String(v).slice(0, 60000); });
  // Images du travail à partager avec le formateur : plusieurs (8 max). L'ancien champ « shot » (une seule image) est converti.
  { let imgs = (Array.isArray(d.shots) ? d.shots : []).filter(img); if (!imgs.length && img(d.shot)) imgs = [d.shot]; let tot = 0; o.shots = imgs.slice(0, 8).filter(x => (tot += x.length) < 3300000); o.shot = ""; }
  o.qa = {};
  if (d.qa && typeof d.qa === "object") Object.entries(d.qa).slice(0, 20).forEach(([k, v]) => { if (/^\d{1,2}$/.test(k) && ["number", "boolean", "string"].includes(typeof v)) o.qa[k] = typeof v === "string" ? v.slice(0, 200) : v; });
  return o;
}
const recOut = r => r ? { ...(r.data || {}), sub: Number(r.sub || 0), grade: r.grade == null ? null : Number(r.grade), gp: r.gp == null ? null : Number(r.gp), gt: r.gt == null ? null : Number(r.gt), comment: r.comment || "", att: r.att || 0 } : {};


// ===================== FORMATION : vidéos et images des cours (stockage privé) =====================
// Les fichiers sont dans un bucket PRIVÉ : aucune adresse publique. L'étudiant reçoit uniquement des liens signés qui expirent (2 h),
// et seulement pour les médias que l'administrateur a rendus visibles (pour tous ou pour des étudiants précis).
const MBUCKET = "formation-media", MTTL = 7200, MMAX = 500 * 1024 * 1024;
const MMIME = { "video/mp4": ["video", "mp4"], "video/webm": ["video", "webm"], "video/quicktime": ["video", "mov"], "audio/mpeg": ["audio", "mp3"], "audio/mp3": ["audio", "mp3"], "audio/mp4": ["audio", "m4a"], "audio/x-m4a": ["audio", "m4a"], "audio/m4a": ["audio", "m4a"], "audio/aac": ["audio", "aac"], "audio/wav": ["audio", "wav"], "audio/x-wav": ["audio", "wav"], "audio/ogg": ["audio", "ogg"], "audio/webm": ["audio", "weba"], "image/jpeg": ["image", "jpg"], "image/png": ["image", "png"], "image/webp": ["image", "webp"], "image/gif": ["image", "gif"] };
const mNums = v => [...new Set((Array.isArray(v) ? v : String(v || "").split(/[\s,;]+/)).map(x => String(x || "").trim().toUpperCase().slice(0, 30)).filter(Boolean))].slice(0, 500);
const mSigned = async rows => { const out = {}; if (!rows.length) return out; const r = await db.storage.from(MBUCKET).createSignedUrls(rows.map(x => x.path), MTTL); (r.data || []).forEach(x => { if (x && x.signedUrl) out[x.path] = x.signedUrl; }); return out; };
const mAdminOut = (x, url) => ({ id: x.id, day: Number(x.day), kind: x.kind, title: x.title || "", vis: x.vis || "off", nums: Array.isArray(x.nums) ? x.nums : [], ready: !!x.ready, size: Number(x.size || 0), url: url || "" });
// Médias visibles pour un étudiant donné (jamais d'erreur bloquante : le cours doit toujours s'afficher)
const mediaFor = async (n, num, preview) => {
  try {
    const rows = must(await db.from("formation_media").select("*").eq("day", n + NK()).eq("ready", true).order("pos", { ascending: true }))
      .filter(x => preview ? (x.vis || "off") !== "off" : x.vis === "all" || (x.vis === "some" && Array.isArray(x.nums) && x.nums.includes(String(num).toUpperCase())));
    const u = await mSigned(rows);
    return rows.filter(x => u[x.path]).map(x => ({ id: x.id, kind: x.kind, title: x.title || "", url: u[x.path] }));
  } catch (e) { return []; }
};

// ===================== REMISES : VIDÉOS DES ÉTUDIANTS ET BIBLIOTHÈQUE =====================
// Les vidéos vont directement dans un bucket PRIVÉ (formation-subs) via une adresse d'envoi signée : elles ne passent pas par le serveur.
// Les images des remises restent dans formation_prog.data.shots. Aucune adresse publique : uniquement des liens signés qui expirent.
const VBUCKET = "formation-subs", VMAX = 15 * 1024 * 1024, VMAXN = 8;
// Tous les formats vidéo sont acceptés (par type MIME « video/* » ou par extension). La lecture dans le navigateur dépend du format ; le téléchargement marche toujours.
const VEXTS = ["mp4", "m4v", "mov", "qt", "webm", "mkv", "avi", "wmv", "asf", "flv", "f4v", "3gp", "3g2", "mpg", "mpeg", "mpe", "ogv", "ogg", "ts", "mts", "m2ts", "mxf", "vob", "divx", "hevc", "h264", "rm", "rmvb"], VMT = { mov: "video/quicktime", qt: "video/quicktime", mkv: "video/x-matroska", avi: "video/x-msvideo", wmv: "video/x-ms-wmv", asf: "video/x-ms-asf", flv: "video/x-flv", "3gp": "video/3gpp", "3g2": "video/3gpp2", m4v: "video/x-m4v", mpg: "video/mpeg", mpeg: "video/mpeg", mpe: "video/mpeg", ogv: "video/ogg", ogg: "video/ogg", ts: "video/mp2t", mts: "video/mp2t", m2ts: "video/mp2t" };
const vKind = (name, mime) => { const ext = (String(name || "").split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, ""), mt = String(mime || "").toLowerCase().split(";")[0].trim(), isMt = mt.startsWith("video/");
  if (!isMt && !VEXTS.includes(ext)) return null; const sub = isMt ? mt.slice(6).replace(/^x-/, "").replace(/[^a-z0-9]/g, "").slice(0, 8) : "", x = VEXTS.includes(ext) ? ext : (sub || "mp4"); return { x, mt: isMt ? mt : (VMT[x] || "video/" + x) }; };
// Fichiers de travail des étudiants (documents) : même table que les vidéos, rangés sous « docs/ » dans le bucket privé des médias
const DOCX_ = { docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12", xls: "application/vnd.ms-excel", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ppt: "application/vnd.ms-powerpoint", pdf: "application/pdf", odt: "application/vnd.oasis.opendocument.text", ods: "application/vnd.oasis.opendocument.spreadsheet", odp: "application/vnd.oasis.opendocument.presentation", txt: "text/plain", csv: "text/csv", rtf: "application/rtf", zip: "application/zip" }, DMAX = 15 * 1024 * 1024, DMAXN = 6;
const extOf = n => (String(n || "").split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const isDocName = n => Object.prototype.hasOwnProperty.call(DOCX_, extOf(n));
const bkt = x => String(x && x.path || "").startsWith("docs/") ? MBUCKET : VBUCKET;
const safeNum = n => String(n || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40);
const vName = x => String(x.name || "video").replace(/[^\w.\- ()]/g, "_").slice(0, 80);
const vidOut = (x, u) => ({ id: x.id, day: Number(x.day), name: x.name || "video", size: Number(x.size || 0), at: Number(x.at || 0), url: u || "", dl: u ? u + (u.includes("?") ? "&" : "?") + "download=" + encodeURIComponent(vName(x)) : "" });
// Vidéos d'un étudiant (un jour précis ou tous) avec liens signés. Ne bloque jamais : si la table n'existe pas encore, renvoie une liste vide.
const vidDocs = async (num, n) => { const V = await vidsFor(num, n); return { vids: V.list, docs: V.docs }; };
const vidsFor = async (num, day) => {
  try {
    let q = db.from("formation_vid").select("*").eq("num", String(num || "")).eq("ready", true); if (day != null) q = q.eq("day", day);
    const r = await q.order("at", { ascending: true }); if (r.error) return { list: [], docs: [], purged: 0 };
    const rows = r.data || [], live = rows.filter(x => !x.purged_at && x.path), u = {};
    for (const B of [VBUCKET, MBUCKET]) { const part = live.filter(x => bkt(x) === B); if (part.length) { const g = await db.storage.from(B).createSignedUrls(part.map(x => x.path), MTTL); (g.data || []).forEach(x => { if (x && x.signedUrl && x.path) u[x.path] = x.signedUrl; }); } }
    const all = live.filter(x => u[x.path]).map(x => ({ ...vidOut(x, u[x.path]), doc: isDocName(x.name) }));
    return { list: all.filter(x => !x.doc), docs: all.filter(x => x.doc), purged: rows.length - live.length };
  } catch (e) { return { list: [], docs: [], purged: 0 }; }
};

// Supprime un étudiant et tout ce qui lui est rattaché (paiements, progression, vidéos, accès…), puis l'inscrit dans le journal.
const wipeStudent = async (s, pname, how) => {
  must(await db.from("payments").delete().eq("num", s.num)); must(await db.from("formation_prog").delete().eq("num", s.num)); must(await db.from("formation_free").delete().eq("num", s.num)); must(await db.from("formation_access").delete().eq("num", s.num)); await db.from("formation_skip").delete().eq("num", s.num);
  try { const vr = await db.from("formation_vid").select("path,purged_at").eq("num", s.num); for (const B of [VBUCKET, MBUCKET]) { const ps = (vr.data || []).filter(x => !x.purged_at && bkt(x) === B).map(x => x.path); for (let i = 0; i < ps.length; i += 100) await db.storage.from(B).remove(ps.slice(i, i + 100)); } await db.from("formation_vid").delete().eq("num", s.num); } catch (e) { /* ignoré */ }
  must(await db.from("dreq").delete().eq("num", s.num)); must(await db.from("students").delete().eq("num", s.num));
  must(await db.from("log").insert({ date: Date.now(), num: s.num, nom: s.nom + " " + s.prenoms, statut: s.status, partner: pname, how }));
};

// ===================== ADMINISTRATEURS ET DROITS D'ACCÈS =====================
const PERMS = { dash: "Tableau de bord (statistiques, listes)", students: "Informations confidentielles des étudiants (noms, contacts, naissance, photo, identifiants)", payments: "Paiements : historique, validation, captures", partners: "Partenaires, commissions et versements", delete: "Supprimer des inscriptions", attest: "Attestations et ouverture du retrait", f_ctl: "Formation : démarrer et ouvrir les jours", f_corr: "Formation : corriger les travaux", f_view: "Formation : voir comme un étudiant", f_courses: "Formation : cours et notes pour professeur", f_gift: "Formation : accès offerts" };
const ROOTONLY = "root";
const PERM = { adminState: "dash", img: "students", pimg: "payments", setPayStatus: "payments", addPartner: "partners", setCoef: "partners", addPayout: "partners", cancelPayout: "partners", breakContract: "partners", restoreContract: "partners", resetPin: "partners", partnerState: "partners", closeReq: "delete", delStudent: "delete", bulkDelStudents: "delete", setConf: "students", setTerm: "attest", allTerm: "attest", setOpen: "attest", setOffer: "f_gift", setT1: "f_gift", setCiv: "students", setTiers: "partners", moveStudent: "students", setTrack: "students", newCohort: "f_ctl", setCohortPricing: "f_ctl", deleteCohort: "f_ctl", setRegCohort: "f_ctl", detachPartner: "partners",
  fAdmin: "f_any", fSub: "f_corr", fGrade: "f_corr", fGradeBulk: "f_corr", fLaunch: "f_ctl", fSetDay: "f_ctl", fSetStart: "f_ctl", fAccessList: "f_ctl", fAccessSet: "f_ctl", fSkipSet: "f_ctl", fLib: "f_corr", fLibGet: "f_corr", fGradeInfo: "f_corr", fPurge: ROOTONLY, fCourses: "f_courses", fCourse: "f_courses", fNote: "f_courses", fMediaList: "f_courses", fMediaInit: "f_courses", fMediaDone: "f_courses", fMediaSet: "f_courses", fMediaDel: "f_courses", fFreeList: "f_gift", fFreeSet: "f_gift", fState: "f_view", fDay: "f_view", fCheck: "f_view", fBulletin: "f_view", fFiche: "f_view",
  adminMe: "*", adminChangePwd: "*", regenCode: "students", bulkCodes: "students", unlock: "students", adminList: ROOTONLY, adminSave: ROOTONLY, adminReset: ROOTONLY, adminDel: ROOTONLY, audit: ROOTONLY, backup: ROOTONLY, purgeAll: ROOTONLY, setProd: ROOTONLY, setReg: ROOTONLY };
const READONLY = new Set(["fAccessList", "fLib", "fLibGet", "fGradeInfo", "adminState", "fAdmin", "fCourses", "fCourse", "fFreeList", "fMediaList", "fState", "fDay", "fCheck", "fBulletin", "fFiche", "img", "pimg", "adminMe", "adminList", "audit", "partnerState"]);
async function adminCtx(token) {
  let t; try { t = check(token, "a"); } catch (e) { return null; }
  if (!t.u || t.u === "root") return { root: true, id: "root", name: "Administrateur principal", pm: Object.keys(PERMS) };
  const a = must(await db.from("admins").select("*").eq("id", t.u).maybeSingle()); if (!a || !a.active) throw E("Accès désactivé.", 401);
  return { root: false, id: a.id, name: a.name, pm: (Array.isArray(a.perms) ? a.perms : []).filter(p => PERMS[p]), must: !!a.must_change };
}
const needRoot = (d, c) => { check(d.token, "a"); if (!c.who || !c.who.root) throw E("Réservé à l'administrateur principal.", 403); };
const hasP = (c, p) => !c.who || c.who.root || c.who.pm.includes(p);
const DUMMY = hash("dummy");
async function audit(who, d) { try { await db.from("admin_audit").insert({ at: Date.now(), who: who.name, action: d.action, target: String(d.num || d.id || d.day || d.login || "").slice(0, 40) }); } catch (e) { /* le journal ne bloque jamais l'action */ } }

const A = {
  async regState() {
    const forms = {}; for (const f of Object.keys(FORMS)) { const id = await regCohort(f); if (id) { const cf = await fcfg(id); forms[f] = { open: true, cohort: id, start: cf.start, pr: cf.pr }; } else forms[f] = { open: false }; }
    const rc = await regCohort(), c = await fcfg(rc);
    return { closed: !!(await setting("reg_closed")), start: c.start, cohort: rc, pr: c.pr, forms, formsInfo: FORMS_PUB, mods: MODS_PUB, modPrice: { total: MOD_TOTAL, formation: MOD_FORM, attestation: MOD_TOTAL - MOD_FORM } };
  },
  async partnerInfo({ code }) { const p = must(await db.from("partners").select("rompu").eq("code", String(code || "").toLowerCase().slice(0, 12)).maybeSingle()); return { exists: !!p, active: !!p && !p.rompu }; },
  async register(d, c) {
    await limit("rg:" + c.ip, 20, 3600e3);
    if (await setting("reg_closed")) throw E("Les inscriptions sont fermées pour le moment. Contactez MK-DIGIT GRAPH sur WhatsApp.", 403);
    const nom = cleanSp(d.nom), prenoms = cleanSp(d.prenoms), civ = String(d.civ || "").trim();
    let wa = String(d.wa || "").replace(/\D/g, "");
    if (!CIVS.includes(civ)) throw E("Choisissez votre civilité (M., Mme ou Mlle).");
    if (!nameOk(nom) || !nameOk(prenoms)) throw E("Nom et prénoms : lettres uniquement (2 caractères minimum), sans chiffres ni symboles.");
    if (wa.length === 8) wa = "22901" + wa; else if (wa.length === 10 && wa.startsWith("01")) wa = "229" + wa;
    if (wa.length < 10 || wa.length > 15) throw E("Numéro WhatsApp invalide. Saisissez-le avec l'indicatif, par exemple 22901XXXXXXXX.");
    if (must(await db.from("students").select("num").eq("wa", wa).limit(1)).length) throw E("Ce numéro WhatsApp est déjà inscrit. Utilisez « Mon reçu » avec votre numéro d'attribution et votre identifiant, ou contactez-nous sur WhatsApp.");
    let partner = null;
    if (d.partnerCode) { const p = must(await db.from("partners").select("id,rompu").eq("code", String(d.partnerCode).toLowerCase().slice(0, 12)).maybeSingle()); if (p && !p.rompu) partner = p.id; }
    const TK = cleanTrack(d.formation, d.module); if (d.formation && !FORMS[d.formation]) throw E("Formation inconnue."); if (d.module && !MODS[d.module]) throw E("Module inconnu.");
    if (d.formation && TK.formation === "creation" && !TK.module) throw E("Choisissez votre module : création de vidéos ou création de sites web.");
    const rc = await regCohort(TK.formation); if (!rc) throw E("Les inscriptions à cette formation ne sont pas encore ouvertes. Contactez MK-DIGIT GRAPH sur WhatsApp.", 403);
    const n = must(await db.rpc("next_num"));
    const row = { num: "FORM-2026-" + String(n).padStart(5, "0"), id: strongCode(12), vc: rnd(10), nom: nom.toUpperCase().slice(0, 80), prenoms: prenoms.slice(0, 120), wa, partner, phase: "inscrit", status: "attente", termine: false, retire: false, montant: 0, date: Date.now(), ...(rc !== 1 ? { cohort: rc } : {}) };
    let ins = await db.from("students").insert({ ...row, civ }); if (ins.error) ins = await db.from("students").insert(row); must(ins);
    if (TK.formation !== "creation" || TK.module) { const u = await db.from("students").update({ formation: TK.formation, module: TK.module }).eq("num", row.num); if (u.error) { await db.from("students").delete().eq("num", row.num); throw E("Cette formation n'est pas encore activée sur le serveur (mise à jour de la base requise). Contactez MK-DIGIT GRAPH sur WhatsApp."); } }
    return { num: row.num, id: row.id };
  },
  async complete(d, c) {
    await limit("cp:" + c.ip, 20, 3600e3);
    const s = await findStudent(d.num, d.id, "num,phase");
    if (!s) throw E("Numéro ou identifiant incorrect.", 404);
    if (s.phase !== "inscrit") throw E("Votre dossier est déjà complété.");
    const nom = cleanSp(d.nom), prenoms = cleanSp(d.prenoms);
    const civ = String(d.civ || "").trim(), lieu = cleanSp(d.lieu), email = String(d.email || "").trim().toLowerCase();
    if (!CIVS.includes(civ)) throw E("Choisissez votre civilité (M., Mme ou Mlle).");
    if (!nameOk(nom) || !nameOk(prenoms)) throw E("Nom et prénoms : lettres uniquement (2 caractères minimum), sans chiffres ni symboles.");
    checkDob(String(d.dob || "").slice(0, 10));
    if (lieu.length < 2 || lieu.length > 100 || !/^\p{L}[\p{L}\p{N}\s,'’.()\/-]*$/u.test(lieu)) throw E("Lieu de naissance invalide : indiquez la ville ou la localité (et le pays si hors du Bénin).");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) throw E("Adresse e-mail invalide.");
    if (!img(d.photo)) throw E("Photo invalide (image trop lourde ou format non pris en charge).");
    const patch = { nom: nom.toUpperCase().slice(0, 80), prenoms: prenoms.slice(0, 120), dob: String(d.dob).slice(0, 10), lieu, email, photo: d.photo, phase: "complet" };
    let up = await db.from("students").update({ ...patch, civ }).eq("num", s.num); if (up.error) up = await db.from("students").update(patch).eq("num", s.num); must(up); return { ok: true };
  },
  async pay(d, c) {
    await limit("py:" + c.ip, 25, 3600e3);
    const s = await findStudent(d.num, d.id, "num,phase,partner");
    if (!s) throw E("Numéro ou identifiant incorrect.", 404);
    if (s.phase !== "complet") throw E("Complétez d'abord votre dossier (informations et photo).");
    const amount = Math.round(+d.amount), trx = String(d.trx || "").trim().toUpperCase().slice(0, 60);
    if (!trx || !img(d.shot)) throw E("La référence et la capture du paiement sont obligatoires.");
    const ps = must(await db.from("payments").select("amount,st").eq("num", s.num)), used = sum(ps, "valide") + sum(ps, "attente");
    const P = await prc(s.num), off = await offerOf(s.num), rest = P.total - off - used; if (rest <= 0) throw E("Votre formation est déjà entièrement payée.");
    if (!(used === 0 && !off ? (P.t1 > 0 ? [P.total, P.t1] : [P.total]) : [rest]).includes(amount)) throw E(used === 0 && !off ? (P.t1 > 0 ? "Choisissez : " + P.total + " FCFA en une fois, ou " + P.t1 + " FCFA pour la 1re tranche (puis " + (P.total - P.t1) + " FCFA)." : "Le montant à payer est de " + P.total + " FCFA, en une seule fois.") : "Le montant à payer est de " + rest + " FCFA" + (off && used === 0 ? " en une seule fois." : "."));
    if (must(await db.from("payments").select("id").eq("trx", trx).neq("st", "rejete").neq("st", "annule").limit(1)).length) throw E("Cette référence de transaction a déjà été utilisée.");
    must(await db.from("payments").insert({ id: rnd(8), num: s.num, partner: s.partner, amount, trx, shot: d.shot, date: Date.now(), st: "attente" })); return { ok: true };
  },
  async receipt(d, c) {
    await limit("rc:" + c.ip, 40, 900e3);
    const r = await findStudent(d.num, d.id, COLS + ",photo");
    if (!r) throw E("Numéro ou identifiant incorrect.", 404);
    const pays = must(await db.from("payments").select("*").eq("num", r.num).order("date")).map(x => ({ ...payPub(x), shot: x.shot }));
    const gift = await isFree(r.num), off = await offerOf(r.num), cf = await fcfgFor(r.num); return { student: { ...enrich(r, pays, off, cf.pr), photo: r.photo, acces: gift, civ: await civOf(r.num), ...trackPub(await trackOf(r.num)), att: cf.pr.att || 0, pstart: cf.start }, pays, groupe: (sum(pays, "valide") + sum(pays, "attente") > 0 || gift) ? cf.grp : "", open: !!(await setting("open")), total: cf.pr.total - off, fx: fInfo(sum(pays, "valide"), sum(pays, "attente"), cf, gift, must(await db.from("formation_access").select("*").eq("num", r.num).maybeSingle()), off, await skipOf(r.num), await trackOf(r.num)) };
  },
  async replaceShot(d, c) {
    await limit("rs:" + c.ip, 30, 3600e3);
    const s = await findStudent(d.num, d.id, "num"); if (!s) throw E("Numéro ou identifiant incorrect.", 404);
    const x = must(await db.from("payments").select("id,num,amount,st").eq("id", String(d.pid || "")).maybeSingle());
    if (!x || x.num !== s.num) throw E("Paiement introuvable.", 404);
    if (!["attente", "rejete"].includes(x.st)) throw E("Cette transaction ne peut plus être modifiée : envoyez un nouveau paiement.", 403);
    if (!img(d.shot)) throw E("Capture invalide.");
    if (x.st === "rejete") { const o = must(await db.from("payments").select("id,amount,st").eq("num", s.num)).filter(p => p.id !== x.id); if (sum(o, "valide") + sum(o, "attente") + Number(x.amount) > (await prc(s.num)).total - (await offerOf(s.num))) throw E("Ce paiement n'est plus possible : envoyez un nouveau paiement.", 403); }
    must(await db.from("payments").update({ shot: d.shot, st: "attente", motif: null }).eq("id", x.id)); return { ok: true };
  },
  async newPhoto(d, c) {
    await limit("np:" + c.ip, 15, 3600e3);
    const s = await findStudent(d.num, d.id, "num,retire"); if (!s) throw E("Numéro ou identifiant incorrect.", 404);
    if (s.retire) throw E("Votre attestation est déjà retirée : la photo ne peut plus être modifiée.", 403);
    if (!img(d.photo)) throw E("Photo invalide.");
    must(await db.from("students").update({ photo: d.photo }).eq("num", s.num)); return { ok: true };
  },
  async retrait(d, c) {
    await limit("rt:" + c.ip, 40, 900e3);
    const r = await findStudent(d.num, d.id, "num,termine,retire"); if (!r) throw E("Numéro ou identifiant incorrect.", 404);
    const paid = sum(must(await db.from("payments").select("amount,st").eq("num", r.num)), "valide");
    if (paid < (await prc(r.num)).total - (await offerOf(r.num)) && !(await isFree(r.num))) throw E("Paiement non soldé : attestation indisponible.", 403);
    if (!(await passed30(r.num))) throw E("Attestation non valide ou formation incomplète : validez tous les jours de la formation (ou de votre module).", 403);
    if (!(await setting("open"))) throw E("Le retrait des attestations n'est pas encore ouvert.", 403);
    if (!r.retire) must(await db.from("students").update({ retire: true, date_retrait: Date.now() }).eq("num", r.num));
    return { ok: true };
  },
  async verify({ vc }, c) { await limit("vf:" + c.ip, 60, 900e3); const r = must(await db.from("students").select("num,nom,prenoms,status,termine,retire").eq("vc", String(vc || "").toUpperCase().slice(0, 12)).maybeSingle()); if (r && (r.status === "valide" || await isFree(r.num))) { if (await passed30(r.num)) return { ok: true, prenoms: r.prenoms, nom: r.nom }; return { ok: false, incomplete: true }; } return { ok: false }; },
  async adminLogin(d, c) {
    const nu = normId(String(d.user || "").slice(0, 40)), pw = String(d.pw || "");
    await failCheck("af:" + c.ip, 3, 900e3); await failCheck("afu:" + nu, 3, 900e3); await failCheck("af:*", 30, 1800e3);
    const bad = async () => { await failAdd("af:" + c.ip, 900e3); await failAdd("afu:" + nu, 900e3); await failAdd("af:*", 1800e3); await sleep(1000); throw E("Identifiants incorrects.", 401); };
    if (nu && nu === ROOT_ID()) { // administrateur principal : identifiant + mot de passe (+ code à 6 chiffres si activé)
      const a = Buffer.from(pw), b = Buffer.from(String(process.env.ADMIN_PASSWORD || ""));
      if (!b.length || a.length !== b.length || !crypto.timingSafeEqual(a, b) || !totpOk(d.otp)) return bad();
      await failClear("af:" + c.ip); await failClear("afu:" + nu);
      return { token: sign({ r: "a", u: "root", exp: Date.now() + 2 * 3600e3 }), name: "Administrateur principal", root: true, perms: Object.keys(PERMS), weakPw: !strongOk(String(process.env.ADMIN_PASSWORD || "")) };
    }
    const login = nu.replace(/\s/g, ""), a = login ? must(await db.from("admins").select("*").eq("login", login).maybeSingle()) : null;
    const ok = same(pw, (a && a.pass_hash) || DUMMY); if (!a || !a.active || !a.pass_hash || !ok) return bad();
    await failClear("af:" + c.ip); await failClear("afu:" + nu); must(await db.from("admins").update({ last_login: Date.now() }).eq("id", a.id));
    return { token: sign({ r: "a", u: a.id, exp: Date.now() + 2 * 3600e3 }), name: a.name, root: false, perms: (a.perms || []).filter(p => PERMS[p]), must: !!a.must_change };
  },
  async adminMe(d, c) { check(d.token, "a"); return { name: c.who.name, root: c.who.root, perms: c.who.pm, must: !!c.who.must, tfa: !!process.env.ADMIN_TOTP_SECRET, weakPw: c.who.root && !strongOk(String(process.env.ADMIN_PASSWORD || "")) }; },
  async adminChangePwd(d, c) {
    check(d.token, "a"); if (!c.who || c.who.root) throw E("Le mot de passe de l'administrateur principal se change dans Vercel (variable ADMIN_PASSWORD).");
    const a = must(await db.from("admins").select("*").eq("id", c.who.id).maybeSingle()), nw = String(d.new || "");
    await failCheck("ac:" + a.id, 3, 900e3); if (!same(d.old, a.pass_hash)) { await failAdd("ac:" + a.id, 900e3); throw E("Ancien mot de passe incorrect.", 401); }
    if (!strongOk(nw)) throw E(WEAK_MSG); if (nw === String(d.old)) throw E("Le nouveau mot de passe doit être différent de l'ancien.");
    must(await db.from("admins").update({ pass_hash: hash(nw), must_change: false }).eq("id", a.id)); return { ok: true };
  },
  async upgradeCode(d, c) { // l'étudiant remplace son ancien code faible par un code de 12 caractères
    await limit("uc:" + c.ip, 10, 3600e3);
    const s = await findStudent(d.num, d.id, "num,id"); if (!s) throw E("Numéro ou code incorrect.", 404);
    if (strongOk(s.id)) throw E("Votre code a déjà le niveau de sécurité requis.");
    const nid = strongCode(12); must(await db.from("students").update({ id: nid }).eq("num", s.num)); return { ok: true, id: nid };
  },
  async regenCode(d) { check(d.token, "a"); const num = String(d.num || "").toUpperCase().slice(0, 30), nid = strongCode(12); if (!must(await db.from("students").select("num").eq("num", num).maybeSingle())) throw E("Étudiant introuvable.", 404); must(await db.from("students").update({ id: nid }).eq("num", num)); return { ok: true, id: nid }; },
  async bulkCodes(d) { // remplace TOUS les codes faibles ; renvoie la liste à transmettre aux étudiants
    check(d.token, "a"); const out = [];
    for (const x of must(await db.from("students").select("num,nom,prenoms,wa,id"))) if (!strongOk(x.id)) { const nid = strongCode(12); must(await db.from("students").update({ id: nid }).eq("num", x.num)); out.push({ num: x.num, nom: x.nom, prenoms: x.prenoms, wa: x.wa || "", id: nid }); }
    return { list: out };
  },
  async unlock(d, c) { // débloque un compte après trop d'essais incorrects
    check(d.token, "a"); const k = String(d.key || "").trim().slice(0, 40);
    if (d.kind === "student") await failClear("sf:" + k.toUpperCase()); else if (d.kind === "partner") await failClear("pf:" + k.toLowerCase()); else if (d.kind === "admin") { needRoot(d, c); await failClear("afu:" + normId(k)); } else throw E("Type de compte inconnu.");
    return { ok: true };
  },
  async adminList(d, c) { needRoot(d, c); const r = must(await db.from("admins").select("id,login,name,perms,active,last_login,created,must_change").order("created")); return { list: r.map(x => ({ ...x, perms: x.perms || [], last_login: Number(x.last_login || 0), created: Number(x.created || 0) })), catalog: PERMS }; },
  async adminSave(d, c) {
    needRoot(d, c); const name = String(d.name || "").trim().slice(0, 60), login = String(d.login || "").trim().toLowerCase(), perms = (Array.isArray(d.perms) ? d.perms : []).filter(p => PERMS[p]);
    if (!name) throw E("Nom requis.");
    if (d.id) { must(await db.from("admins").update({ name, perms, active: d.active !== false }).eq("id", String(d.id))); return { ok: true }; }
    if (!/^[a-z0-9._-]{3,30}$/.test(login) || login === ROOT_ID().replace(/\s/g, "")) throw E("Identifiant invalide ou réservé (3 à 30 caractères : lettres minuscules, chiffres, point, tiret).");
    if (must(await db.from("admins").select("id").eq("login", login).maybeSingle())) throw E("Cet identifiant existe déjà.");
    const pwd = strongCode(12); must(await db.from("admins").insert({ id: rnd(8), login, name, perms, active: true, pass_hash: hash(pwd), must_change: true, created: Date.now() })); return { ok: true, login, pwd };
  },
  async adminReset(d, c) { needRoot(d, c); const pwd = strongCode(12); must(await db.from("admins").update({ pass_hash: hash(pwd), must_change: true }).eq("id", String(d.id))); return { ok: true, pwd }; },
  async adminDel(d, c) { needRoot(d, c); must(await db.from("admins").delete().eq("id", String(d.id))); return { ok: true }; },
  async audit(d, c) { needRoot(d, c); return { list: must(await db.from("admin_audit").select("*").order("at", { ascending: false }).limit(300)).map(x => ({ ...x, at: Number(x.at) })) }; },
  async backup(d, c) {
    needRoot(d, c); const T = ["students", "payments", "partners", "payouts", "dreq", "log", "settings", "formation_cfg", "formation_prog", "formation_free", "formation_access", "formation_skip", "formation_vid", "formation_notes", "admins", "admin_audit"], out = { date: Date.now(), tables: {}, note: "Les photos, captures et mots de passe ne sont pas inclus." };
    for (const t of T) { try { out.tables[t] = must(await db.from(t).select("*")).map(r => { const o = { ...r }; ["photo", "shot", "pin", "pin_hash", "pass_hash"].forEach(k => delete o[k]); if (o.data && o.data.shot) o.data = { ...o.data, shot: "(image non incluse)" }; if (o.data && o.data.shots) o.data = { ...o.data, shots: "(images non incluses)" }; return o; }); } catch (e) { out.tables[t] = "(table absente)"; } }
    return out;
  },
  async partnerLogin({ code, pin }, c) {
    const cd = String(code || "").trim().toLowerCase().slice(0, 12);
    await failCheck("pf:" + cd, 3, 900e3); await failCheck("pi:" + c.ip, 20, 900e3);
    const p = must(await db.from("partners").select("*").eq("code", cd).maybeSingle()), ok = p && pinOk(p, pin);
    if (!ok) { await failAdd("pf:" + cd, 900e3); await failAdd("pi:" + c.ip, 900e3); await sleep(1000); throw E("Code ou mot de passe incorrect.", 401); }
    if (p.rompu) throw E("Accès désactivé : le contrat avec MK-DIGIT GRAPH a pris fin.", 403);
    if (!p.pin_hash) must(await db.from("partners").update({ pin_hash: hash(String(pin).trim().toUpperCase()), pin: p.pin_changed ? null : pinEnc(String(p.pin)) }).eq("id", p.id)); // ancien code en clair : converti en empreinte
    return { token: sign({ r: "p", pid: p.id, exp: Date.now() + 8 * 3600e3 }), must: !p.pin_changed };
  },
  async partnerState(d, c) {
    let p, ro = false;
    if (c.who && d.pid) { p = await getPartner(String(d.pid)); ro = true; if (!p) throw E("Partenaire introuvable.", 404); } // l'administrateur voit l'espace d'un partenaire, en lecture seule
    else { const t = check(d.token, "p"); p = await getPartner(t.pid); if (!p || p.rompu) throw E("Accès désactivé.", 401); if (!p.pin_changed) return { mustChange: true, partner: { id: p.id, name: p.name } }; }
    const pays = must(await db.from("payments").select(PCOLS).eq("partner", p.id).order("date")).map(payPub);
    const OFFS = await offersMap(), T1M = await t1Map(), PM = await pricesMap(), CM = await cohortMap(), TMP = await trackMap(), st = must(await db.from("students").select(COLS).eq("partner", p.id).order("date")).map(r => forPartner(enrich(r, pays, OFFS[r.num] || 0, withT1(modPr(PM[CM[r.num] || 1], TMP[r.num]), T1M[r.num]))));
    const dreq = must(await db.from("dreq").select("*").eq("partner", p.id).order("date", { ascending: false }));
    const pouts = must(await db.from("payouts").select("*").eq("partner", p.id).order("date", { ascending: false })).map(payRow);
    return { ro, partner: part(p, false, pouts, baseOf(p, pays), commOf(p, pays)), students: st, payments: pays.map(payPart), dreq: dreq.map(dreqPart), payouts: pouts };
  },
  async changePin(d) {
    const t = check(d.token, "p"), p = await getPartner(t.pid), nw = String(d.new || "");
    await failCheck("pc:" + t.pid, 3, 900e3);
    if (!pinOk(p, d.old)) { await failAdd("pc:" + t.pid, 900e3); throw E("Ancien mot de passe incorrect.", 401); }
    if (nw === String(d.old || "")) throw E("Le nouveau mot de passe doit être différent de l'ancien.");
    if (!strongOk(nw)) throw E(WEAK_MSG);
    must(await db.from("partners").update({ pin_hash: hash(nw), pin_changed: true, pin: null }).eq("id", p.id)); return { ok: true };
  },
  async answerDel(d) {
    const t = check(d.token, "p"); await needSet(t); const r = must(await db.from("dreq").select("*").eq("id", d.id).maybeSingle());
    if (!r || r.partner !== t.pid || r.st !== "attente") throw E("Demande introuvable.", 404);
    const u = must(await db.from("dreq").update({ st: d.ok ? "ok" : "non" }).eq("id", d.id).eq("st", "attente").select("id")); if (!u.length) throw E("Demande introuvable ou déjà traitée.", 404); return { ok: true };
  },
  async answerPayout(d) {
    const t = check(d.token, "p"); await needSet(t); const x = must(await db.from("payouts").select("*").eq("id", d.id).maybeSingle());
    if (!x || x.partner !== t.pid || x.st !== "attente") throw E("Versement introuvable.", 404);
    const u = must(await db.from("payouts").update({ st: d.ok ? "recu" : "non", date_conf: Date.now() }).eq("id", d.id).eq("st", "attente").select("id")); if (!u.length) throw E("Versement introuvable ou annulé.", 404); return { ok: true };
  },
  async pshot(d) { const t = check(d.token, "p"); await needSet(t); const x = must(await db.from("payments").select("partner,shot").eq("id", String(d.id || "")).maybeSingle()); if (!x || x.partner !== t.pid) throw E("Introuvable.", 404); return { data: x.shot }; },
  async adminState(d, c) {
    check(d.token, "a");
    const [ps, st, dq, lg, py, pm, fp, fr] = await Promise.all([db.from("partners").select("*").order("name"), db.from("students").select(COLS + ",conf,conf_at,conf_by,cohort").order("date"), db.from("dreq").select("*").order("date", { ascending: false }), db.from("log").select("*").order("date", { ascending: false }).limit(100), db.from("payouts").select("*").order("date", { ascending: false }), db.from("payments").select(PCOLS).order("date", { ascending: false }), db.from("formation_prog").select("num,day,grade,sub"), db.from("formation_free").select("num")]);
    const pays = must(pm).map(payPub), pouts = must(py), cnt = {}, comp = {}, psd = {}; must(fp).forEach(r => { if (r.sub) comp[r.num] = (comp[r.num] || 0) + 1; if (r.grade != null && Number(r.grade) >= PASSM) { cnt[r.num] = (cnt[r.num] || 0) + 1; (psd[r.num] = psd[r.num] || new Set()).add(Number(r.day)); } }); const gf = new Set(must(fr).map(x => x.num));
    const hs = hasP(c, "students"), hp = hasP(c, "partners"), hd = hasP(c, "delete");
    const stRows = (() => { try { return must(st); } catch (err) { return null; } })() || must(await db.from("students").select(COLS).order("date")); // repli si le script SQL « confirmation » n'a pas encore été exécuté
    const OFFS = await offersMap(), T1M = await t1Map(), PM = await pricesMap(), CIVM = await civMap(), TM = await trackMap(), students = stRows.map(r => { const TK = TM[r.num] || DEF_TRACK, CR = courseOf(TK), e0 = enrich(r, pays, OFFS[r.num] || 0, withT1(modPr(PM[Number(r.cohort) || 1], TK), T1M[r.num])), e = { ...e0, form: TK.formation, module: TK.module, freq: CR.length, t1o: T1M[r.num] || 0, t1std: (PM[Number(r.cohort) || 1] || {}).t1 || 0, t1def: T1_REDUIT, civ: CIVM[r.num] || "", cohort: Number(r.cohort) || 1, conf: r.conf || "", conf_at: Number(r.conf_at || 0), conf_by: r.conf_by || "", fdone: CR.filter(x => psd[r.num] && psd[r.num].has(x.n)).length, fcomp: comp[r.num] || 0, gift: gf.has(r.num), attOk: (e0.solde || gf.has(r.num)) && CR.every(x => psd[r.num] && psd[r.num].has(x.n)) }; return hs ? e : { ...e, id: "", vc: "", nom: "Étudiant", prenoms: e.num, dob: "", lieu: "", email: "", wa: "", motif: "" }; });
    return { me: { name: c.who ? c.who.name : "", root: !c.who || c.who.root, perms: c.who ? c.who.pm : Object.keys(PERMS), tfa: !!process.env.ADMIN_TOTP_SECRET, weakPw: !!(c.who && c.who.root) && !strongOk(String(process.env.ADMIN_PASSWORD || "")) }, total: TOTAL, forms: FORMS_PUB, mods: MODS_PUB, modPrice: { total: MOD_TOTAL, formation: MOD_FORM, attestation: MOD_TOTAL - MOD_FORM }, payments: hasP(c, "payments") ? pays : [], partners: hp ? must(ps).map(p => part(p, true, pouts.filter(x => x.partner === p.id).map(payRow), baseOf(p, pays), commOf(p, pays))) : [], students, dreq: hd || hp ? must(dq).map(r => ({ ...r, date: Number(r.date) })) : [], log: hd ? must(lg).map(g => ({ ...g, date: Number(g.date) })) : [], payouts: hp ? pouts.map(payRow) : [], open: !!(await setting("open")), prod: !!(await setting("prod")), regClosed: !!(await setting("reg_closed")), cohorts: await cohortsList(stRows) };
  },
  async img(d) { check(d.token, "a"); const r = must(await db.from("students").select("photo").eq("num", String(d.num || "")).maybeSingle()); if (!r) throw E("Introuvable.", 404); return { data: r.photo }; },
  async pimg(d) { check(d.token, "a"); const r = must(await db.from("payments").select("shot").eq("id", String(d.id || "")).maybeSingle()); if (!r) throw E("Introuvable.", 404); return { data: r.shot }; },
  async setPayStatus(d) {
    check(d.token, "a"); if (!["attente", "valide", "rejete", "annule"].includes(d.st)) throw E("Statut invalide.");
    const x = must(await db.from("payments").select("*").eq("id", String(d.id || "")).maybeSingle()); if (!x) throw E("Paiement introuvable.", 404);
    if (d.st === "valide") { const tot = (await prc(x.num)).total - (await offerOf(x.num)), others = must(await db.from("payments").select("id,amount,st").eq("num", x.num)).filter(p => p.id !== x.id); if (sum(others, "valide") + Number(x.amount) > tot) throw E("Ce paiement dépasserait le total de " + tot + " FCFA."); }
    const motif = d.st === "rejete" ? String(d.motif || "").slice(0, 300) : d.st === "annule" ? (String(d.motif || "").trim().slice(0, 300) || "Transaction annulée par l'administration.") : null;
    must(await db.from("payments").update({ st: d.st, motif, dv: d.st === "valide" ? Date.now() : null }).eq("id", x.id));
    await syncStatus(x.num); return { ok: true };
  },
  async addPartner(d) { check(d.token, "a"); const n = String(d.name || "").trim(); if (!n) throw E("Nom requis."); const pin = strongCode(12), code = rnd(6).toLowerCase(); must(await db.from("partners").insert({ id: rnd(5), name: n.slice(0, 80), code, pin: pinEnc(pin), pin_hash: hash(pin), pin_changed: false, coef: +d.coef || 0, paid: 0, wa: String(d.wa || "").replace(/\D/g, "").slice(0, 20) })); return { ok: true, pin, code }; },
  async setCoef(d) { check(d.token, "a"); must(await db.from("partners").update({ coef: +d.v || 0 }).eq("id", d.id)); return { ok: true }; },
  async addPayout(d) {
    check(d.token, "a"); const p = await getPartner(d.id); if (!p) throw E("Partenaire introuvable."); const v = Math.round(+d.v);
    if (!(v > 0)) throw E("Montant invalide.");
    const pays = must(await db.from("payments").select(PCOLS).eq("partner", p.id).eq("st", "valide")).map(payPub);
    const used = must(await db.from("payouts").select("amount,st").eq("partner", p.id)).filter(x => x.st !== "non").reduce((a, x) => a + Number(x.amount), 0);
    const left = commOf(p, pays) - used;
    if (v > left) throw E("Montant supérieur au reste à verser (" + left + " FCFA).");
    must(await db.from("payouts").insert({ id: rnd(8), partner: p.id, amount: v, ref: String(d.ref || "").slice(0, 80), note: String(d.note || "").slice(0, 200), date: Date.now(), st: "attente" })); return { ok: true };
  },
  async cancelPayout(d) { check(d.token, "a"); must(await db.from("payouts").delete().eq("id", d.id).neq("st", "recu")); return { ok: true }; },
  async setTerm(d) { check(d.token, "a"); if (d.v && !(await passed30(d.num))) throw E("Cet étudiant n'a pas validé tous les jours de son parcours : impossible de le marquer terminé."); must(await db.from("students").update({ termine: !!d.v }).eq("num", d.num)); return { ok: true }; },
  async allTerm(d) { check(d.token, "a"); const cnt = {}; must(await db.from("formation_prog").select("num,grade")).forEach(r => { if (r.grade != null && Number(r.grade) >= PASSM) cnt[r.num] = (cnt[r.num] || 0) + 1; }); const ns = []; for (const k of Object.keys(cnt)) if (await passed30(k)) ns.push(k); for (const k of ns) must(await db.from("students").update({ termine: true }).eq("num", k)); return { ok: true, n: ns.length }; },
  async newCohort(d) { // d : name, date, price, t1, free, t1days // nouvelle promotion : nouveau mois, nouvelles inscriptions, calendrier indépendant des promotions en cours
    check(d.token, "a"); const name = String(d.name || "").trim().slice(0, 60), t = Date.parse(String(d.date || "").slice(0, 10) + "T00:00:00+01:00");
    if (!name) throw E("Donnez un nom à la promotion (ex. Promotion décembre 2026)."); if (isNaN(t)) throw E("Date de démarrage invalide."); if (t < Date.now()) throw E("La date de démarrage doit être dans le futur.");
    const pr = readPricing(d), id = Math.max(1, ...must(await db.from("formation_cfg").select("id")).map(r => Number(r.id))) + 1;
    const F = FORMS[d.formation] ? d.formation : "creation"; await unsetReg(F);
    const grp = readGroup(d.groupe), base = { id, name, start_at: t, launch_at: null, admin_day: 0, registering: true, created: Date.now(), ...pr, ...(F !== "creation" ? { formation: F } : {}) };
    let ins = await db.from("formation_cfg").insert(grp ? { ...base, group_link: grp } : base); if (ins.error && grp) ins = await db.from("formation_cfg").insert(base);
    if (ins.error && F !== "creation" && /formation|column|schema/i.test(String(ins.error.message))) throw E("Exécutez d'abord le fichier supabase_parcours.sql dans Supabase (colonne « formation » absente).");
    must(ins);
    await putSetting("reg_closed", false); return { ok: true, id };
  },
  async setCohortPricing(d) { // modifier le nom et la tarification d'une promotion (prix et tranche verrouillés dès le 1er paiement)
    check(d.token, "a"); const id = Math.round(+d.id) || 0, cur = must(await db.from("formation_cfg").select("*").eq("id", id).maybeSingle()); if (!cur) throw E("Promotion introuvable.", 404);
    const pr = readPricing(d), old = pricingOf(cur), name = String(d.name || "").trim().slice(0, 60) || cur.name || "Promotion " + id;
    const nums = new Set(must(await studentsC("num")).filter(x => (Number(x.cohort) || 1) === id).map(x => x.num));
    if (pr.price !== old.total || pr.t1 !== old.t1) {
      if (must(await db.from("payments").select("num")).some(p => nums.has(p.num))) throw E("Des paiements existent déjà dans cette promotion : le prix et la 1re tranche ne peuvent plus être modifiés (les jours gratuits et le nom le peuvent).");
      const om = await offersMap(); if (Object.keys(om).some(n => nums.has(n) && om[n] >= pr.price)) throw E("Une offre accordée dans cette promotion dépasse ce nouveau prix.");
    }
    const row = { id, name, ...pr }; if ("groupe" in d) row.group_link = readGroup(d.groupe);
    must(await db.from("formation_cfg").upsert(row)); return { ok: true };
  },
  async deleteCohort(d) { // supprimer une promotion : possible uniquement si elle ne contient aucun étudiant
    check(d.token, "a"); const id = Math.round(+d.id) || 0;
    const row = must(await db.from("formation_cfg").select("*").eq("id", id).maybeSingle()); if (!row) throw E("Promotion introuvable.", 404);
    const n = must(await studentsC("num,cohort")).filter(x => (Number(x.cohort) || 1) === id).length;
    if (n > 0) throw E("Cette promotion contient " + n + " étudiant(s) : elle ne peut pas être supprimée. Déplacez d'abord les étudiants vers une autre promotion.", 409);
    must(await db.from("formation_cfg").delete().eq("id", id)); return { ok: true, wasReg: !!row.registering };
  },
  async setRegCohort(d) { // choisir dans quelle promotion les nouveaux étudiants s'inscrivent
    check(d.token, "a"); const id = Math.round(+d.id) || 0; if (!must(await db.from("formation_cfg").select("id").eq("id", id).maybeSingle())) throw E("Promotion introuvable.", 404);
    await unsetReg(await formOfCohort(id)); must(await db.from("formation_cfg").update({ registering: true }).eq("id", id)); return { ok: true };
  },
  async setCiv(d) { // civilité d'un étudiant (utile pour les inscrits d'avant l'ajout de ce champ)
    check(d.token, "a"); const num = String(d.num || "").toUpperCase().slice(0, 30), civ = String(d.civ || "").trim();
    if (!CIVS.includes(civ)) throw E("Civilité invalide : M., Mme ou Mlle.");
    if (!must(await db.from("students").select("num").eq("num", num).maybeSingle())) throw E("Étudiant introuvable.", 404);
    must(await db.from("students").update({ civ }).eq("num", num)); return { ok: true };
  },
  async setTiers(d) { // paliers de commission d'un partenaire : [{from, to (null = sans limite), pct}]
    check(d.token, "a"); const p = await getPartner(String(d.id || "")); if (!p) throw E("Partenaire introuvable.", 404);
    const raw = Array.isArray(d.tiers) ? d.tiers : []; if (raw.length > 10) throw E("10 paliers maximum.");
    const T = raw.map(t => ({ from: Math.round(+t.from), to: t.to == null || t.to === "" ? null : Math.round(+t.to), pct: Math.round(+t.pct * 100) / 100 })).sort((a, b) => a.from - b.from);
    T.forEach((t, i) => {
      if (!(t.from >= 1) || (t.to != null && !(t.to >= t.from)) || !(t.pct >= 0 && t.pct <= 100)) throw E("Palier invalide : le rang de départ est d'au moins 1, la fin est supérieure au début, et le taux est compris entre 0 et 100 %.");
      if (i > 0 && (T[i - 1].to == null || t.from <= T[i - 1].to)) throw E("Les paliers se chevauchent : " + T[i - 1].from + "-" + (T[i - 1].to == null ? "…" : T[i - 1].to) + " et " + t.from + "-" + (t.to == null ? "…" : t.to) + ". Chaque étudiant ne peut avoir qu'un seul taux.");
    });
    must(await db.from("partners").update({ tiers: T }).eq("id", p.id)); return { ok: true };
  },
  async bulkDelStudents(d, c) { // suppression en lot, réservée aux étudiants qui n'ont NI payé NI composé. Les autres sont « mis de côté » : protégés, jamais supprimés ici.
    check(d.token, "a"); if (!hasP(c, "delete")) throw E("Vous n'avez pas le droit de supprimer des inscriptions.", 403);
    const nums = [...new Set((Array.isArray(d.nums) ? d.nums : []).map(x => String(x || "").toUpperCase().trim().slice(0, 30)).filter(Boolean))];
    if (!nums.length) throw E("Aucun étudiant sélectionné."); if (nums.length > 60) throw E("60 étudiants maximum par envoi.");
    const sts = must(await db.from("students").select("num,nom,prenoms,status,partner").in("num", nums)), pay = new Set(), comp = new Set(), gift = new Set();
    must(await db.from("payments").select("num,st").in("num", nums)).forEach(x => { if (x.st === "valide" || x.st === "attente") pay.add(x.num); });
    must(await db.from("formation_prog").select("num,sub,grade").in("num", nums)).forEach(x => { if (x.sub || x.grade != null) comp.add(x.num); });
    must(await db.from("formation_free").select("num").in("num", nums)).forEach(x => gift.add(x.num));
    const om = await offersMap(), deleted = [], kept = [];
    for (const s of sts) { const why = pay.has(s.num) ? "a payé" : comp.has(s.num) ? "a déjà composé" : gift.has(s.num) ? "accès offert" : om[s.num] > 0 ? "offre accordée" : ""; if (why) { kept.push({ num: s.num, why }); continue; }
      const p = s.partner ? await getPartner(s.partner) : null; await wipeStudent(s, p ? p.name : "Direct", "Supprimé en lot par l'administrateur (n'avait ni payé ni composé)"); deleted.push(s.num); }
    const found = new Set(sts.map(x => x.num)); return { ok: true, deleted, kept, missing: nums.filter(n => !found.has(n)) };
  },
  async moveStudent(d) { // affecter un ou plusieurs étudiants à une autre promotion
    check(d.token, "a"); const to = Math.round(+d.to) || 0, nums = [...new Set([].concat(d.nums || d.num || []).map(x => String(x || "").toUpperCase().trim().slice(0, 30)).filter(Boolean))].slice(0, 200);
    if (!nums.length) throw E("Indiquez au moins un numéro d'étudiant.");
    const dest = must(await db.from("formation_cfg").select("*").eq("id", to).maybeSingle()); if (!dest) throw E("Promotion de destination introuvable.", 404);
    const found = must(await db.from("students").select("num").in("num", nums)).map(x => x.num), missing = nums.filter(n => !found.includes(n));
    if (missing.length) throw E("Étudiant(s) introuvable(s) : " + missing.join(", ") + ".", 404);
    const P = pricingOf(dest), om = await offersMap(), ps = must(await db.from("payments").select("num,amount,st").in("num", nums));
    for (const n of nums) {
      const used = sum(ps.filter(x => x.num === n), "valide") + sum(ps.filter(x => x.num === n), "attente"), off = om[n] || 0;
      if (off >= P.total) throw E(n + " a une offre de " + off + " FCFA, supérieure ou égale au prix de la promotion de destination (" + P.total + " FCFA). Retirez ou réduisez l'offre d'abord.");
      if (used > P.total - off) throw E(n + " a déjà payé " + used + " FCFA, plus que le prix de la promotion de destination (" + (P.total - off) + " FCFA).");
    }
    must(await db.from("students").update({ cohort: to }).in("num", nums)); for (const n of nums) await syncStatus(n);
    return { ok: true, moved: nums.length };
  },
  async setReg(d) { check(d.token, "a"); await putSetting("reg_closed", !!d.v); return { ok: true }; }, // arrêter / rouvrir les inscriptions
  async setT1(d) { // 1re tranche réduite pour UN étudiant (par ex. 5 000 au lieu de 7 000) : le prix total ne change pas
    check(d.token, "a"); const num = String(d.num || "").toUpperCase().slice(0, 30), amt = Math.round(+d.amount || 0);
    if (!must(await db.from("students").select("num").eq("num", num).maybeSingle())) throw E("Aucun étudiant avec ce numéro.", 404);
    const base = modPr((await fcfg(await cohortOf(num))).pr, await trackOf(num)), ps = must(await db.from("payments").select("amount,st").eq("num", num)), used = sum(ps, "valide") + sum(ps, "attente"), cur = await t1Of(num);
    if (!amt) { if (!cur) return { ok: true, t1: 0 }; if (used > 0) throw E("Cet étudiant a déjà payé sous ce tarif : impossible de le retirer."); must(await db.from("formation_t1").delete().eq("num", num)); return { ok: true, t1: 0 }; }
    if (!(base.t1 > 0)) throw E("Cette promotion n'a pas de paiement en 2 tranches.");
    if (amt < 1 || amt >= base.t1) throw E("La 1re tranche réduite doit être comprise entre 1 et " + (base.t1 - 1) + " FCFA (tarif normal : " + base.t1 + " FCFA).");
    if (await offerOf(num)) throw E("Cet étudiant a une offre (paiement en une seule fois) : retirez-la d'abord.");
    if (used > 0) throw E("Cet étudiant a déjà un paiement enregistré : le tarif réduit ne peut être accordé qu'avant son premier paiement.");
    must(await db.from("formation_t1").upsert({ num, t1: amt, at: Date.now() })); return { ok: true, t1: amt, ensuite: base.total - amt };
  },
  async setOffer(d) { // montant offert à un étudiant : il paie (prix total - offre) en une seule fois
    check(d.token, "a"); const num = String(d.num || "").toUpperCase().slice(0, 30), amt = Math.round(+d.amount || 0), P = await prc(num);
    if (!must(await db.from("students").select("num").eq("num", num).maybeSingle())) throw E("Aucun étudiant avec ce numéro.", 404);
    if (amt < 0 || amt >= P.total) throw E("L'offre doit être comprise entre 0 et " + (P.total - 1) + " FCFA (pour un accès entièrement gratuit, utilisez « accès offert »).");
    if (!amt) { must(await db.from("offers").delete().eq("num", num)); return { ok: true, offer: 0 }; }
    if (await t1Of(num)) throw E("Cet étudiant a une 1re tranche réduite (paiement en 2 tranches) : retirez-la d'abord avant de lui accorder une offre.");
    const ps = must(await db.from("payments").select("amount,st").eq("num", num)), used = sum(ps, "valide") + sum(ps, "attente");
    if (used > P.total - amt) throw E("Cet étudiant a déjà payé " + used + " FCFA : l'offre dépasserait ce qu'il reste à payer.");
    must(await db.from("offers").upsert({ num, amount: amt, at: Date.now() })); await syncStatus(num); return { ok: true, offer: amt, apayer: P.total - amt };
  },
  async detachPartner(d) { // l'étudiant passe sur votre lien direct : ses prochains paiements ne génèrent plus de commission
    check(d.token, "a"); const num = String(d.num || "").toUpperCase().slice(0, 30), s = must(await db.from("students").select("num,partner").eq("num", num).maybeSingle());
    if (!s) throw E("Étudiant introuvable.", 404); if (!s.partner) throw E("Cet étudiant n'est lié à aucun partenaire.");
    must(await db.from("students").update({ partner: null }).eq("num", num)); return { ok: true };
  },
  async changeCode(d, c) { // l'étudiant choisit lui-même un nouveau code (12 caractères minimum)
    await limit("cc:" + c.ip, 10, 3600e3);
    const s = await findStudent(d.num, d.id, "num,id"); if (!s) throw E("Numéro ou code actuel incorrect.", 404);
    const nw = String(d.nw || ""); if (!strongOk(nw)) throw E(WEAK_MSG); if (nw === s.id) throw E("Le nouveau code doit être différent de l'ancien.");
    must(await db.from("students").update({ id: nw }).eq("num", s.num)); return { ok: true };
  },
  async setOpen(d) { check(d.token, "a"); await putSetting("open", !!d.v); return { ok: true }; },
  async setProd(d) {
    check(d.token, "a");
    if (!d.v) { const c = must(await db.from("students").select("num").limit(1)); if (c.length) throw E("Impossible de repasser en mode test : des inscriptions existent."); }
    await putSetting("prod", !!d.v); return { ok: true };
  },
  async resetPin(d) { check(d.token, "a"); const pin = strongCode(12); must(await db.from("partners").update({ pin: pinEnc(pin), pin_hash: hash(pin), pin_changed: false }).eq("id", d.id)); return { ok: true, pin }; },
  async breakContract(d) {
    check(d.token, "a"); must(await db.from("partners").update({ rompu: { date: Date.now(), motif: String(d.motif || "").slice(0, 300) } }).eq("id", d.id));
    must(await db.from("dreq").update({ st: "annule" }).eq("partner", d.id).eq("st", "attente")); return { ok: true };
  },
  async restoreContract(d) { check(d.token, "a"); must(await db.from("partners").update({ rompu: null }).eq("id", d.id)); return { ok: true }; },
  async closeReq(d) { check(d.token, "a"); must(await db.from("dreq").delete().eq("id", d.id)); return { ok: true }; },
  async purgeAll(d) {
    check(d.token, "a"); if (await setting("prod")) throw E("Interdit en mode production.", 403);
    must(await db.from("payments").delete().neq("id", "")); must(await db.from("formation_prog").delete().neq("num", "")); must(await db.from("students").delete().neq("num", "")); must(await db.from("dreq").delete().neq("id", "")); return { ok: true };
  },
  async delStudent(d) {
    check(d.token, "a"); const s = must(await db.from("students").select("num,nom,prenoms,status,partner").eq("num", String(d.num || "")).maybeSingle()); if (!s) throw E("Inscription introuvable.", 404);
    const p = s.partner ? await getPartner(s.partner) : null, label = s.nom + " " + s.prenoms, r = must(await db.from("dreq").select("*").eq("num", s.num).maybeSingle());
    // L'étudiant quitte immédiatement la liste des inscrits (chez vous comme chez le partenaire), que le partenaire ait accepté ou non.
    const acc = !p ? "inscription directe" : r && r.st === "ok" ? "accord du partenaire obtenu" : r && r.st === "attente" ? "demande au partenaire restée sans réponse" : r && r.st === "non" ? "refus du partenaire" : "accord du partenaire non demandé";
    await wipeStudent(s, p ? p.name : "Direct", "Supprimé immédiatement par l'administrateur (" + acc + ")");
    return { ok: true };
  },
  // ===== 2) confirmation de l'inscription par téléphone : Oui / Non =====
  async setConf(d, c) {
    check(d.token, "a"); const num = String(d.num || "").toUpperCase().slice(0, 30), v = d.v === "oui" ? "oui" : d.v === "non" ? "non" : null;
    if (!must(await db.from("students").select("num").eq("num", num).maybeSingle())) throw E("Inscription introuvable.", 404);
    must(await db.from("students").update({ conf: v, conf_at: v ? Date.now() : null, conf_by: v ? c.who.name : null }).eq("num", num)); return { ok: true };
  },
  async setTrack(d, c) { // choisir ou corriger la formation et le module d'un étudiant (module vide = formation complète d'origine)
    /* c.self est posé par le serveur (selfTrack), jamais par le client */
    if (!(c && c.self)) check(d.token, "a"); const num = String(d.num || "").toUpperCase().slice(0, 30);
    if (!must(await db.from("students").select("num").eq("num", num).maybeSingle())) throw E("Étudiant introuvable.", 404);
    const f = String(d.formation || "creation"), mraw = String(d.module || ""); if (!FORMS[f]) throw E("Formation inconnue."); if (mraw && !MODS[mraw]) throw E("Module inconnu.");
    if (f !== "creation" && mraw) throw E("Les modules existent seulement pour la formation « Création vidéo et web ».");
    const T = cleanTrack(f, mraw), cur = await trackOf(num); if (T.formation === cur.formation && T.module === cur.module) return { ok: true, same: true };
    const ps = must(await db.from("payments").select("amount,st").eq("num", num)), paid = sum(ps, "valide"), used = paid + sum(ps, "attente"), off = await offerOf(num); let cohort = null;
    if (T.formation !== cur.formation) {
      if (must(await db.from("formation_prog").select("day").eq("num", num).limit(1)).length) throw E("Cet étudiant a déjà commencé des cours dans sa formation actuelle : changer de formation effacerait son parcours. Changez plutôt son module.", 409);
      cohort = Math.round(+d.cohort) || await regCohort(T.formation); if (!cohort) throw E("Aucune promotion n'accepte les inscriptions pour cette formation : créez-en une d'abord (onglet Promotions).");
      if (await formOfCohort(cohort) !== T.formation) throw E("Cette promotion n'appartient pas à la formation choisie.");
    }
    const P = modPr((await fcfg(cohort || await cohortOf(num))).pr, T);
    if (off >= P.total) throw E("Cet étudiant a une offre de " + off + " FCFA qui atteint le prix de ce parcours (" + P.total + " FCFA) : retirez ou modifiez l'offre d'abord.");
    const u = await db.from("students").update({ formation: T.formation, module: T.module, ...(cohort ? { cohort } : {}) }).eq("num", num);
    if (u.error) throw E(/column|schema|formation|module/i.test(String(u.error.message)) ? "Exécutez d'abord le fichier supabase_parcours.sql dans Supabase (colonnes « formation » et « module » absentes)." : "Erreur serveur. Réessayez.");
    await syncStatus(num); const due = P.total - off;
    return { ok: true, formation: T.formation, module: T.module, total: due, paid, reste: Math.max(0, due - paid), surplus: Math.max(0, used - due) };
  },
  async selfTrack(d, c) { // l'étudiant change lui-même de formation / module, tant qu'il n'a encore rien composé
    await limit("st:" + c.ip, 20, 3600e3);
    const s = await findStudent(d.num, d.id, "num"); if (!s) throw E("Numéro ou identifiant incorrect.", 404);
    if (must(await db.from("formation_prog").select("day").eq("num", s.num).limit(1)).length) throw E("Vous avez déjà composé dans votre formation : votre choix est définitif. Seul l'administrateur peut encore le modifier : contactez MK-DIGIT GRAPH sur WhatsApp.", 409);
    return await A.setTrack({ num: s.num, formation: d.formation, module: d.module }, { ...c, self: true });
  },
  // ---------- Formation : étudiant ----------
  async fState(d, c) {
    const { s, fx, pm, ro } = await fctx(d, c, "fs");
    return { num: s.num, name: s.prenoms, ro: !!ro, preview: !!fx.preview, canSwitch: !ro && !Object.keys(pm).length, ...fx, days: CT.course.map(x => { const r = pm[x.n]; return { n: x.n, dn: x.n - (fx.mod ? fx.mod.off : 0), title: x.title, week: x.week, proj: x.proj, acc: dayAcc(x.n, fx, pm), sub: r && r.sub ? Number(r.sub) : 0, grade: r && r.grade != null ? Number(r.grade) : null, gp: r && r.gp != null ? Number(r.gp) : null, gt: r && r.gt != null ? Number(r.gt) : null }; }) };
  },
  async fDay(d, c) {
    const { s, fx, pm, ro } = await fctx(d, c, "fd"), n = needDay(d, fx, pm), L = CT.lessons[n], Q = quizOf(n);
    const r = must(await db.from("formation_prog").select("*").eq("num", s.num).eq("day", n).maybeSingle());
    const R = r && r.grade != null ? await rankInfo(await cohortOf(s.num)) : null, tc = CT.teach[n] || {}; const V = s.num === "APERCU" ? { list: [], docs: [], purged: 0 } : await vidsFor(s.num, n); return { form: curT().formation, len: fx.len || 30, mod: fx.mod ? { from: fx.mod.from, to: fx.mod.to } : null, view: dayAcc(n, fx, pm) === "view", vids: V.list, docs: V.docs || [], vidsPurged: V.purged, rk: R ? R.dayRank(n, r.grade) : null, dayAvg: R && R.dayAvg[n] != null ? R.dayAvg[n] : null, day: dayDef(n), lesson: L ? { parts: L.parts } : null, quiz: Q ? qpub(Q) : null, sites: CT.sites, rec: recOut(r), crit: { b: tc.b || [], a: tc.a || "" }, media: await mediaFor(n, s.num, s.num === "APERCU"), ro: !!ro };
  },
  // ---------- Formation : vidéos et images des cours (administrateur, droit « cours et notes ») ----------
  async fMediaList(d) {
    check(d.token, "a"); const rows = must(await db.from("formation_media").select("*").order("day", { ascending: true }).order("pos", { ascending: true })), u = await mSigned(rows.filter(x => x.ready));
    return { list: rows.filter(x => Number(x.day) >= NK() && Number(x.day) < NK() + 100).map(x => mAdminOut({ ...x, day: Number(x.day) - NK() }, u[x.path])), max: MMAX };
  },
  async fMediaInit(d) { // étape 1 : réserve l'emplacement et donne une adresse d'envoi signée (le fichier ne passe pas par le serveur)
    check(d.token, "a"); const day = Math.round(+d.day), mt = String(d.mime || "").toLowerCase(), M = MMIME[mt], size = Math.round(+d.size);
    if (!(day >= 1 && day <= 60)) throw E("Jour invalide.");
    if (!M) throw E("Format non accepté. Audio : MP3, M4A, WAV, OGG ou AAC. Vidéo : MP4, WebM ou MOV. Image : JPG, PNG, WEBP ou GIF.");
    if (!(size > 0 && size <= MMAX)) throw E("Fichier trop gros (" + Math.round(MMAX / 1048576) + " Mo maximum).");
    const id = rnd(12), path = id + "." + M[1], title = String(d.title || "").trim().slice(0, 120);
    const r = await db.storage.from(MBUCKET).createSignedUploadUrl(path); if (r.error || !r.data) throw E("Stockage indisponible : le bucket « " + MBUCKET + " » existe-t-il ? (voir supabase_formation.sql)", 500);
    must(await db.from("formation_media").insert({ id, day: day + NK(), kind: M[0], title, path, size, mime: mt, vis: "off", nums: [], ready: false, pos: Date.now(), created: Date.now() }));
    return { id, url: r.data.signedUrl };
  },
  async fMediaDone(d) { // étape 2 : vérifie que le fichier est bien arrivé, puis le déclare prêt (toujours masqué au départ)
    check(d.token, "a"); const id = String(d.id || "").slice(0, 20), x = must(await db.from("formation_media").select("*").eq("id", id).maybeSingle()); if (!x) throw E("Média introuvable.", 404);
    const t = await db.storage.from(MBUCKET).createSignedUrl(x.path, 60); if (t.error || !t.data) { must(await db.from("formation_media").delete().eq("id", id)); throw E("Le fichier n'est pas arrivé complet. Réessayez l'envoi."); }
    must(await db.from("formation_media").update({ ready: true }).eq("id", id)); return { ok: true };
  },
  async fMediaSet(d) {
    check(d.token, "a"); const id = String(d.id || "").slice(0, 20), x = must(await db.from("formation_media").select("id").eq("id", id).maybeSingle()); if (!x) throw E("Média introuvable.", 404);
    const up = {}; if (d.title != null) up.title = String(d.title).trim().slice(0, 120);
    if (d.day != null) { const day = Math.round(+d.day); if (!(day >= 1 && day <= 60)) throw E("Jour invalide."); up.day = day + NK(); }
    let unknown = [];
    if (d.vis != null) { if (!["off", "all", "some"].includes(d.vis)) throw E("Visibilité invalide."); up.vis = d.vis; }
    if (d.nums != null) { const want = mNums(d.nums), have = new Set(must(await db.from("students").select("num")).map(s => s.num)); up.nums = want.filter(n => have.has(n)); unknown = want.filter(n => !have.has(n)); }
    if (up.vis === "some" && up.nums && !up.nums.length) throw E("Indiquez au moins un numéro d'étudiant valide" + (unknown.length ? " (inconnu : " + unknown.join(", ") + ")" : "") + ".");
    must(await db.from("formation_media").update(up).eq("id", id)); return { ok: true, unknown };
  },
  async fMediaDel(d) {
    check(d.token, "a"); const id = String(d.id || "").slice(0, 20), x = must(await db.from("formation_media").select("path").eq("id", id).maybeSingle()); if (!x) throw E("Média introuvable.", 404);
    await db.storage.from(MBUCKET).remove([x.path]); must(await db.from("formation_media").delete().eq("id", id)); return { ok: true };
  },
  // ---------- Remises : vidéos envoyées par l'étudiant (envoi direct vers le stockage privé) ----------
  async fVidInit(d, c) { // étape 1 : contrôle les droits et les limites, réserve l'emplacement, donne l'adresse d'envoi signée
    const { s, fx, pm, ro } = await fctx(d, c, "fvi", 200); if (ro) throw E("Mode lecture (administrateur) : aucune modification.", 403);
    const n = needDay(d, fx, pm, true), p = pm[n]; if (p && p.sub && (p.grade == null || passedRow(p))) throw E("Ce travail est verrouillé.", 409);
    const pr = await db.from("formation_vid").select("id").limit(1); if (pr.error) throw E("L'envoi de vidéos n'est pas encore activé. Prévenez votre formateur.", 503);
    const nm = String(d.name || "").slice(0, 120), isD = d.kind === "doc", k = isD ? (isDocName(nm) ? { x: extOf(nm), mt: DOCX_[extOf(nm)] } : null) : vKind(nm, d.mime); if (!k) throw E(isD ? "Format non accepté. Envoyez un fichier Word, Excel, PowerPoint, PDF, texte ou ZIP (.docx, .xlsx, .pptx, .pdf, .txt, .csv, .zip…)." : "Ce fichier n'est pas une vidéo. Choisissez un fichier vidéo (MP4, MOV, WebM, AVI, MKV, 3GP…).");
    const x = k.x, mt = k.mt;
    const size = Math.round(+d.size); if (!(size > 0 && size <= (isD ? DMAX : VMAX))) throw E(isD ? "Fichier trop lourd (" + Math.round(DMAX / 1048576) + " Mo maximum). Réduisez les images du document puis réessayez." : "Vidéo trop lourde (" + Math.round(VMAX / 1048576) + " Mo maximum). Filmez plus court ou réduisez la qualité.");
    const old = must(await db.from("formation_vid").select("id,path").eq("num", s.num).eq("ready", false).lt("at", Date.now() - 3600e3)); // envois abandonnés
    if (old.length) { for (const B of [VBUCKET, MBUCKET]) { const op = old.filter(o => bkt(o) === B).map(o => o.path); if (op.length) await db.storage.from(B).remove(op); } must(await db.from("formation_vid").delete().in("id", old.map(o => o.id))); }
    const have = must(await db.from("formation_vid").select("id,name,purged_at").eq("num", s.num).eq("day", n)).filter(v => !v.purged_at && isDocName(v.name) === isD);
    if (have.length >= (isD ? DMAXN : VMAXN)) throw E(isD ? "Maximum " + DMAXN + " fichiers par jour. Retirez-en un pour en ajouter un autre." : "Maximum " + VMAXN + " vidéos par jour. Retirez-en une pour en ajouter une autre.");
    const id = rnd(12), path = (isD ? "docs/" : "") + safeNum(s.num) + "/" + n + "/" + id + "." + x, up = await db.storage.from(isD ? MBUCKET : VBUCKET).createSignedUploadUrl(path);
    if (up.error || !up.data) throw E("Stockage indisponible. Prévenez votre formateur.", 503);
    must(await db.from("formation_vid").insert({ id, num: s.num, day: n, path, name: nm || (isD ? "document." : "video.") + x, mime: mt, size, ready: false, at: Date.now() }));
    return { id, url: up.data.signedUrl };
  },
  async fVidDone(d, c) { // étape 2 : vérifie que la vidéo est bien arrivée (et sa vraie taille), puis la déclare prête
    const { s, ro } = await fctx(d, c, "fvd", 200); if (ro) throw E("Mode lecture (administrateur) : aucune modification.", 403);
    const id = String(d.vid || "").slice(0, 20), x = must(await db.from("formation_vid").select("*").eq("id", id).eq("num", s.num).maybeSingle()); if (!x) throw E("Vidéo introuvable.", 404);
    const i = x.path.lastIndexOf("/"), l = await db.storage.from(bkt(x)).list(x.path.slice(0, i), { search: x.path.slice(i + 1), limit: 5 }), o = (l.data || []).find(z => z.name === x.path.slice(i + 1));
    if (!o) { must(await db.from("formation_vid").delete().eq("id", id)); throw E("La vidéo n'est pas arrivée complète. Réessayez l'envoi."); }
    const size = Number(o.metadata && o.metadata.size) || Number(x.size) || 0;
    if (size > (isDocName(x.name) ? DMAX : VMAX)) { await db.storage.from(bkt(x)).remove([x.path]); must(await db.from("formation_vid").delete().eq("id", id)); throw E("Vidéo trop lourde (" + Math.round(VMAX / 1048576) + " Mo maximum)."); }
    must(await db.from("formation_vid").update({ ready: true, size, at: Date.now() }).eq("id", id));
    const v = await vidsFor(s.num, x.day); return { ok: true, vid: [...v.list, ...v.docs].find(z => z.id === id) || null };
  },
  async fVidDel(d, c) { // l'étudiant retire sa vidéo (tant que le travail n'est pas verrouillé)
    const { s, pm, ro } = await fctx(d, c, "fvx", 200); if (ro) throw E("Mode lecture (administrateur) : aucune modification.", 403);
    const id = String(d.vid || "").slice(0, 20), x = must(await db.from("formation_vid").select("*").eq("id", id).eq("num", s.num).maybeSingle()); if (!x) throw E("Vidéo introuvable.", 404);
    const p = pm[x.day]; if (p && p.sub && (p.grade == null || passedRow(p))) throw E("Ce travail est verrouillé : la vidéo ne peut plus être retirée.", 409);
    if (x.path && !x.purged_at) await db.storage.from(bkt(x)).remove([x.path]); must(await db.from("formation_vid").delete().eq("id", id)); return { ok: true };
  },
  // ---------- Remises : bibliothèque de tout ce que les étudiants ont envoyé (administrateur, droit « corriger les travaux ») ----------
  async fLib(d, ctx) { // liste légère : jamais les images elles-mêmes, seulement des compteurs et des tailles
    check(d.token, "a"); const cid = Math.round(+d.cohort) || await regCohort(), names = hasP(ctx, "students");
    const sts = must(await studentsC("num,nom,prenoms")).filter(x => (Number(x.cohort) || 1) === cid), inC = new Set(sts.map(x => x.num));
    const lv = await db.from("formation_lib_v").select("*"); if (lv.error) throw E("Exécutez d'abord le fichier supabase_remises.sql dans Supabase : la bibliothèque n'existe pas encore.");
    const vr = await db.from("formation_vid").select("num,day,size,ready,purged_at"), vids = vr.error ? [] : (vr.data || []), by = {};
    const cell = (num, day) => ((by[num] = by[num] || {})[day] = by[num][day] || { day, sub: 0, grade: null, img: 0, imgB: 0, imgP: 0, files: 0, ans: false, vid: 0, vidB: 0, vidP: 0 });
    (lv.data || []).filter(r => inC.has(r.num)).forEach(r => { const c = cell(r.num, Number(r.day)); c.sub = Number(r.sub || 0); c.grade = r.grade == null ? null : Number(r.grade); c.img = Number(r.n_img || 0); c.imgB = Number(r.img_bytes || 0); c.imgP = Number(r.img_purged || 0); c.files = Number(r.n_files || 0); c.ans = !!r.has_answer; });
    vids.filter(v => inC.has(v.num) && v.ready).forEach(v => { const c = cell(v.num, Number(v.day)); if (v.purged_at) c.vidP++; else { c.vid++; c.vidB += Number(v.size || 0); } });
    const list = sts.map(x => ({ num: x.num, name: names ? (x.nom + " " + x.prenoms).trim() : x.num, days: Object.values(by[x.num] || {}).filter(c => c.img || c.vid || c.files || c.ans || c.imgP || c.vidP).sort((a, b) => a.day - b.day).map(c => ({ ...c, title: (dayDef(c.day) || {}).title || "" })) })).filter(x => x.days.length);
    const tot = { students: list.length, img: 0, imgB: 0, imgP: 0, vid: 0, vidB: 0, vidP: 0 }; list.forEach(x => x.days.forEach(c => { tot.img += c.img; tot.imgB += c.imgB; tot.imgP += c.imgP; tot.vid += c.vid; tot.vidB += c.vidB; tot.vidP += c.vidP; }));
    return { cohort: cid, list, tot, vmax: VMAX };
  },
  async fGradeInfo(d, ctx) { // détail d'une note déjà donnée (pour la modifier rapidement depuis la section Résultats)
    check(d.token, "a"); const num = String(d.num || "").toUpperCase().slice(0, 30), n = Math.round(+d.day), x = dayDef(n); if (!x) throw E("Jour inconnu.", 404);
    const r = must(await db.from("formation_prog").select("sub,gp,gt,grade,comment,gat,att").eq("num", num).eq("day", n).maybeSingle()); if (!r || !r.sub) throw E("Aucune remise pour ce jour.", 404);
    const s = must(await db.from("students").select("nom,prenoms").eq("num", num).maybeSingle());
    return { num, name: hasP(ctx, "students") && s ? (s.nom + " " + s.prenoms).trim() : num, day: n, title: x.title, sub: Number(r.sub), gp: r.gp == null ? null : Number(r.gp), gt: r.gt == null ? null : Number(r.gt), grade: r.grade == null ? null : Number(r.grade), comment: r.comment || "", gat: Number(r.gat || 0), att: r.att || 0 };
  },
  async fLibGet(d, ctx) { // tout le contenu d'une remise (pour l'enregistrer sur l'ordinateur) : texte, code, images et liens de téléchargement des vidéos
    check(d.token, "a"); const num = String(d.num || "").toUpperCase().slice(0, 30), n = Math.round(+d.day), x = dayDef(n); if (!x) throw E("Jour inconnu.", 404);
    const r = must(await db.from("formation_prog").select("*").eq("num", num).eq("day", n).maybeSingle()), s = must(await db.from("students").select("nom,prenoms").eq("num", num).maybeSingle()); if (!s) throw E("Étudiant introuvable.", 404);
    const dt = (r && r.data) || {}, V = await vidsFor(num, n);
    return { num, name: hasP(ctx, "students") ? (s.nom + " " + s.prenoms).trim() : num, day: n, title: x.title, sub: r ? Number(r.sub || 0) : 0, att: r ? r.att || 0 : 0, gp: r && r.gp != null ? Number(r.gp) : null, gt: r && r.gt != null ? Number(r.gt) : null, grade: r && r.grade != null ? Number(r.grade) : null, comment: r ? r.comment || "" : "",
      data: { answer: dt.answer || "", files: dt.files || {}, shots: dt.shots && dt.shots.length ? dt.shots : (dt.shot ? [dt.shot] : []) }, vids: V.list, vidsPurged: V.purged, imgPurged: Number(dt.shots_purged || 0) };
  },
  async fPurge(d, ctx) { // libère de l'espace : supprime les vidéos et/ou les images. Ne touche JAMAIS aux notes, commentaires, bulletin, attestation, réponses écrites, codes ni questions théoriques.
    check(d.token, "a"); const kind = ["videos", "images", "both"].includes(d.kind) ? d.kind : ""; if (!kind) throw E("Choisissez ce qu'il faut supprimer.");
    const day = d.day ? Math.round(+d.day) : null; if (day != null && !(day >= 1 && day <= 60)) throw E("Jour invalide.");
    const before = d.before ? Date.parse(String(d.before).slice(0, 10) + "T00:00:00+01:00") : null; if (d.before && isNaN(before)) throw E("Date invalide.");
    let nums = null; if (d.num) nums = [String(d.num).toUpperCase().slice(0, 30)]; else if (d.cohort_only) { const cid = Math.round(+d.cohort) || 1; nums = must(await studentsC("num")).filter(x => (Number(x.cohort) || 1) === cid).map(x => x.num); if (!nums.length) nums = ["-"]; }
    const ok = (r, atK) => (!nums || nums.includes(r.num)) && (day == null || Number(r.day) === day) && (before == null || Number(r[atK] || 0) < before);
    const out = { videos: { n: 0, bytes: 0 }, images: { n: 0, rows: 0, bytes: 0 } }; let vrows = [];
    if (kind !== "images") { const r = await db.from("formation_vid").select("*"); if (!r.error) { vrows = (r.data || []).filter(x => x.ready && !x.purged_at && !isDocName(x.name) && ok(x, "at")); out.videos = { n: vrows.length, bytes: vrows.reduce((t, x) => t + Number(x.size || 0), 0) }; } }
    if (kind !== "videos") { const r = await db.from("formation_lib_v").select("*"); if (r.error) throw E("Exécutez d'abord le fichier supabase_remises.sql dans Supabase."); const rows = (r.data || []).filter(x => Number(x.n_img) > 0 && ok(x, "sub")); out.images = { n: rows.reduce((t, x) => t + Number(x.n_img), 0), rows: rows.length, bytes: rows.reduce((t, x) => t + Number(x.img_bytes || 0), 0) }; }
    if (!d.run) return { ok: true, dry: true, ...out };
    if (String(d.confirm || "") !== "VIDER") throw E("Tapez VIDER pour confirmer.");
    for (let i = 0; i < vrows.length; i += 100) { const ch = vrows.slice(i, i + 100); await db.storage.from(VBUCKET).remove(ch.map(x => x.path)); must(await db.from("formation_vid").update({ purged_at: Date.now() }).in("id", ch.map(x => x.id))); }
    if (kind !== "videos" && out.images.rows) { const r = await db.rpc("formation_purge_images", { p_nums: nums, p_day: day, p_before: before }); if (r.error) throw E("Erreur pendant la suppression des images : " + r.error.message); }
    return { ok: true, dry: false, ...out };
  },
  async fSave(d, c) {
    const { s, fx, pm, ro } = await fctx(d, c, "fv", 900); if (ro) throw E("Mode lecture (administrateur) : aucune modification.", 403); const n = needDay(d, fx, pm, true), p = pm[n];
    if (p && p.sub && (p.grade == null || passedRow(p))) throw E("Ce travail est verrouillé.", 409);
    must(await db.from("formation_prog").upsert({ num: s.num, day: n, data: cleanData(d.data || {}) })); return { ok: true };
  },
  async fCheck(d, c) {
    const { fx, pm } = await fctx(d, c, "fk"), n = needDay(d, fx, pm, true), Q = quizOf(n); if (!Q) throw E("Pas de questions ce jour-là.");
    const sc = qscore(n, cleanData({ qa: d.qa }).qa); return { ok: sc.ok, ex: Q.map(qexp), s: sc.s, t: sc.t, v: sc.v };
  },
  async fSubmit(d, c) {
    const { s, fx, pm, ro } = await fctx(d, c, "fu"); if (ro) throw E("Mode lecture (administrateur) : aucune modification.", 403); const n = needDay(d, fx, pm, true), p = pm[n];
    if (p && p.sub && p.grade == null) throw E("Votre travail est déjà en attente de correction.", 409);
    if (passedRow(p)) throw E("Ce jour est déjà validé.", 409);
    const r = must(await db.from("formation_prog").select("data").eq("num", s.num).eq("day", n).maybeSingle()), dt = (r && r.data) || {}, code = curT().formation === "creation" && n >= 16 && n <= 29;
    if (code && Object.values(dt.files || {}).reduce((t, x) => t + String(x).trim().length, 0) < 20) throw E("Écrivez d'abord votre code dans l'éditeur.");
    if (!code && String(dt.answer || "").trim().length < 5 && !dt.shot && !(dt.shots && dt.shots.length) && !(await vidsFor(s.num, n)).list.length && !(await vidsFor(s.num, n)).docs.length) throw E("Ajoutez un fichier, un lien, une description, une image ou une vidéo de votre travail.");
    const Q = quizOf(n), qa = dt.qa || {}; if (Q && Q.some((q, i) => qa[i] == null || qa[i] === "")) throw E("Répondez d'abord à toutes les questions théoriques.");
    const sc = qscore(n, qa);
    must(await db.from("formation_prog").upsert({ num: s.num, day: n, sub: Date.now(), grade: null, gp: null, gt: sc ? sc.v : null, comment: "", att: (p && p.att || 0) + 1 })); return { ok: true };
  },
  // ---------- Formation : administrateur ----------
  async fAdmin(d, ctx) {
    check(d.token, "a"); let cid = Math.round(+d.cohort) || 0; if (cid && !must(await db.from("formation_cfg").select("id").eq("id", cid).maybeSingle())) cid = 0; /* promotion supprimée ou inconnue : retour à la promotion par défaut */ cid = cid || await regCohort() || Number((must(await db.from("formation_cfg").select("id").order("id").limit(1))[0] || {}).id) || 1;
    const [c, rows, sts, ps, frs] = await Promise.all([fcfg(cid), db.from("formation_prog").select("num,day,sub,gt,gp,grade,att,gat").order("sub", { ascending: false }), studentsC("num,nom,prenoms,wa,email,termine,date"), db.from("payments").select("num,amount,st"), db.from("formation_free").select("num")]);
    const all = must(sts), st = all.filter(x => (Number(x.cohort) || 1) === cid), inC = new Set(st.map(x => x.num)), subs = must(rows).filter(r => inC.has(r.num)), pays = must(ps), gifts = new Set(must(frs).map(x => x.num)), name = {}; st.forEach(x => name[x.num] = x.nom + " " + x.prenoms);
    const names = hasP(ctx, "students"), OFS = await offersMap(), T1X = await t1Map(), PMX = await pricesMap(), RK = rankFrom(subs), SKM = await skipMap(), TMX = await trackMap();
    return { stats: { classAvg: RK.classAvg, nr: RK.nr, dayAvg: RK.dayAvg }, cohort: cid, cohorts: await cohortsList(all), me: { name: ctx.who.name, root: ctx.who.root, perms: ctx.who.root ? Object.keys(PERMS) : ctx.who.pm }, cfg: { now: Date.now(), launch: c.launch, manual: c.manual, start: c.start, adm: c.adm, sched: schedDay(c), openDay: openDayOf(c) },
      subs: !hasP(ctx, "f_corr") ? [] : subs.filter(r => r.sub).map(r => ({ num: r.num, name: names ? (name[r.num] || r.num) : r.num, day: r.day, sub: Number(r.sub), grade: r.grade == null ? null : Number(r.grade), gt: r.gt == null ? null : Number(r.gt), gp: r.gp == null ? null : Number(r.gp), att: Number(r.att || 0), gat: Number(r.gat || 0), title: (dayDef(r.day) || {}).title || "" })),
      students: !hasP(ctx, "f_view") ? [] : st.map(x => { const paid = sum(pays.filter(p => p.num === x.num), "valide"); return { num: x.num, name: names ? x.nom + " " + x.prenoms : x.num, wa: names ? x.wa || "" : "", email: names ? x.email || "" : "", termine: !!x.termine, since: Number(x.date || 0), paid, free: gifts.has(x.num), level: gifts.has(x.num) ? FLEN[(TMX[x.num] || DEF_TRACK).formation] : (() => { const TK = TMX[x.num] || DEF_TRACK, L0 = levelOf(paid, OFS[x.num] || 0, withT1(modPr(PMX[Number(x.cohort) || 1], TK), T1X[x.num])); return TK.module ? (L0 >= 30 ? 30 : L0 + MODS[TK.module].from - 1) : L0; })(), req: courseOf(TMX[x.num] || DEF_TRACK).length, mod: (TMX[x.num] || DEF_TRACK).module, form: (TMX[x.num] || DEF_TRACK).formation, done: subs.filter(r => r.num === x.num && passedRow(r) && inMod(Number(r.day), TMX[x.num] || DEF_TRACK)).length, avg: RK.avg[x.num] != null ? RK.avg[x.num] : null, rank: RK.genRank(x.num), skip: SKM[x.num] ? SKM[x.num].upto : 0, skipMode: SKM[x.num] ? SKM[x.num].mode : "free", skipDone: SKM[x.num] ? subs.filter(r => r.num === x.num && r.day <= SKM[x.num].upto && passedRow(r)).length : 0, skipNote: SKM[x.num] ? SKM[x.num].note : "", skipAt: SKM[x.num] ? SKM[x.num].at : 0 }; }) };
  },
  async fSub(d, c) {
    check(d.token, "a"); const n = Math.round(+d.day), x = dayDef(n), num = String(d.num || "").slice(0, 30);
    const r = must(await db.from("formation_prog").select("*").eq("num", num).eq("day", n).maybeSingle()), s = must(await db.from("students").select("nom,prenoms").eq("num", num).maybeSingle());
    if (!x || !r || !r.sub) throw E("Remise introuvable.", 404);
    const dt = r.data || {}, Q = quizOf(n), sc = Q ? qscore(n, dt.qa || {}) : null, ex = (x.s.find(z => /^Exercice/.test(z.h)) || { b: [{ i: [] }] }).b[0].i;
    const V = await vidsFor(num, n); return { vids: V.list, docs: V.docs, vidsPurged: V.purged, name: s && hasP(c, "students") ? s.nom + " " + s.prenoms : num, n, title: x.title, exercise: ex, data: dt, sub: Number(r.sub), att: r.att || 0, gt: r.gt == null ? null : Number(r.gt), gp: r.gp == null ? null : Number(r.gp), grade: r.grade == null ? null : Number(r.grade), comment: r.comment || "", gat: r.gat ? Number(r.gat) : 0,
      theory: Q ? { s: sc.s, t: sc.t, v: sc.v, items: Q.map((q, i) => ({ q: q[1], a: qans(q, (dt.qa || {})[i]), ok: sc.ok[i] })) } : null };
  },
  async fGrade(d) {
    check(d.token, "a"); const n = Math.round(+d.day), num = String(d.num || "").slice(0, 30), g = Number(d.gp);
    if (!(g >= 0 && g <= 20)) throw E("Note invalide (0 à 20).");
    const pv = must(await db.from("formation_prog").select("grade").eq("num", num).eq("day", n).maybeSingle()), fin = await gradeOne(num, n, g, d.comment); if (fin == null) throw E("Aucune remise à noter.", 404);
    return { ok: true, grade: fin, prev: pv && pv.grade != null ? Number(pv.grade) : null };
  },
  async fGradeBulk(d) { // même note de travail pour plusieurs remises (sélection ou toutes les remises affichées)
    check(d.token, "a"); const g = Number(d.gp); if (!(g >= 0 && g <= 20)) throw E("Note invalide (0 à 20).");
    const items = (Array.isArray(d.items) ? d.items : []).map(x => ({ num: String(x && x.num || "").slice(0, 30), day: Math.round(+(x && x.day)) })).filter(x => x.num && x.day >= 1 && x.day <= 60);
    if (!items.length) throw E("Aucun travail à noter."); if (items.length > 1000) throw E("1000 travaux maximum à la fois.");
    let done = 0, skipped = 0; for (const it of items) { const fin = await gradeOne(it.num, it.day, g, d.comment); if (fin == null) skipped++; else done++; }
    return { ok: true, done, skipped };
  },
  // ---------- Formation : bulletin de notes et fiches de correction (étudiant) ----------
  async fBulletin(d, c) {
    const { s, pm } = await fctx(d, c, "fb"), R = await rankInfo(await cohortOf(s.num)), rows = CT.course.map(x => { const r = pm[x.n]; return { rk: r && r.grade != null ? R.dayRank(x.n, r.grade) : null, cav: R.dayAvg[x.n] != null ? R.dayAvg[x.n] : null, n: x.n, title: x.title, week: x.week, proj: x.proj, sub: r && r.sub ? Number(r.sub) : 0, gp: r && r.gp != null ? Number(r.gp) : null, gt: r && r.gt != null ? Number(r.gt) : null, grade: r && r.grade != null ? Number(r.grade) : null, gat: r && r.gat ? Number(r.gat) : 0 }; });
    const gr = rows.filter(r => r.grade != null), ok = gr.filter(r => r.grade >= PASSM), avg = gr.length ? Math.round(gr.reduce((t, r) => t + r.grade, 0) / gr.length * 100) / 100 : null;
    return { rank: R.genRank(s.num), classAvg: R.classAvg, nr: R.nr, name: (s.nom + " " + s.prenoms).trim(), num: s.num, rows, validated: ok.length, total: CT.course.length, avg, complete: ok.length === CT.course.length, mention: ok.length === CT.course.length ? (avg >= 18 ? "Excellent" : avg >= 16 ? "Très bien" : "Bien") : "", date: Date.now() };
  },
  async fFiche(d, c) {
    const { s, pm } = await fctx(d, c, "ff"), n = Math.round(+d.day), x = dayDef(n); if (!x) throw E("Jour inconnu.", 404);
    const r = must(await db.from("formation_prog").select("*").eq("num", s.num).eq("day", n).maybeSingle());
    if (!r || r.grade == null) throw E("La fiche de correction sera disponible une fois votre travail corrigé.", 403);
    const R = await rankInfo(await cohortOf(s.num)), dt = r.data || {}, Q = quizOf(n), sc = Q ? qscore(n, dt.qa || {}) : null, tc = CT.teach[n] || {}, good = q => q[0] === "qcm" ? q[2][q[3]] : q[0] === "vf" ? (q[2] ? "Vrai" : "Faux") : q[2][0];
    return { rk: R.dayRank(n, r.grade), dayAvg: R.dayAvg[n] != null ? R.dayAvg[n] : null, n, title: x.title, week: x.week, proj: x.proj, name: (s.nom + " " + s.prenoms).trim(), num: s.num, exercise: (x.s.find(z => /^Exercice/.test(z.h)) || { b: [{ i: [] }] }).b[0].i, crit: { b: tc.b || [], a: tc.a || "" },
      sub: Number(r.sub || 0), gat: Number(r.gat || 0), gp: r.gp == null ? null : Number(r.gp), gt: r.gt == null ? null : Number(r.gt), grade: Number(r.grade), comment: r.comment || "", att: r.att || 0,
      ...(await vidDocs(s.num, n)), data: { answer: dt.answer || "", files: dt.files || {}, shots: dt.shots && dt.shots.length ? dt.shots : (dt.shot ? [dt.shot] : []), steps: dt.steps || [], ex: dt.ex || [] },
      theory: Q ? { s: sc.s, t: sc.t, v: sc.v, items: Q.map((q, i) => ({ q: q[1], a: qans(q, (dt.qa || {})[i]), ok: sc.ok[i], good: good(q), ex: qexp(q) })) } : null };
  },
  // ---------- Formation : accès offerts (confidentiel, administrateur uniquement) ----------
  async fFreeList(d) {
    check(d.token, "a"); const fr = must(await db.from("formation_free").select("*").order("at", { ascending: false })), st = must(await db.from("students").select("num,nom,prenoms")), nm = {}; st.forEach(x => nm[x.num] = x.nom + " " + x.prenoms);
    return { list: fr.map(x => ({ num: x.num, name: nm[x.num] || x.num, note: x.note || "", at: Number(x.at || 0) })) };
  },
  async fFreeSet(d) { // un ou plusieurs étudiants : d.num ou d.nums
    check(d.token, "a"); const nums = [...new Set([].concat(d.nums || d.num || []).map(x => String(x || "").toUpperCase().trim().slice(0, 30)).filter(Boolean))].slice(0, 300);
    if (!nums.length) throw E("Indiquez au moins un étudiant.");
    const found = must(await db.from("students").select("num").in("num", nums)).map(x => x.num), missing = nums.filter(n => !found.includes(n));
    if (missing.length) throw E("Aucun étudiant avec le numéro : " + missing.join(", ") + ".", 404);
    if (d.on) must(await db.from("formation_free").upsert(nums.map(num => ({ num, note: String(d.note || "").slice(0, 200), at: Date.now() })))); else must(await db.from("formation_free").delete().in("num", nums));
    return { ok: true, n: nums.length };
  },
  // ---------- Formation : cours complets avec notes pour professeur (administrateur) ----------
  async fCourses(d) {
    check(d.token, "a"); const nt = must(await db.from("formation_notes").select("day")), has = new Set(nt.filter(x => x.day >= NK() && x.day < NK() + 100).map(x => x.day - NK()));
    return { days: CT.course.map(x => ({ n: x.n, title: x.title, week: x.week, proj: x.proj, note: has.has(x.n), quiz: !!quizOf(x.n) })) };
  },
  async fCourse(d) {
    check(d.token, "a"); const n = Math.round(+d.day), x = dayDef(n); if (!x) throw E("Jour inconnu.", 404);
    const nt = must(await db.from("formation_notes").select("note").eq("day", n + NK()).maybeSingle()), L = CT.lessons[n];
    return { day: x, lesson: L ? { parts: L.parts } : null, quiz: quizOf(n), sites: CT.sites, teach: CT.teach[n] || null, note: nt ? nt.note || "" : "" };
  },
  async fNote(d) {
    check(d.token, "a"); const n = Math.round(+d.day); if (!dayDef(n)) throw E("Jour inconnu.", 404);
    must(await db.from("formation_notes").upsert({ day: n + NK(), note: String(d.note || "").slice(0, 6000) })); return { ok: true };
  },
  async fLaunch(d) {
    check(d.token, "a"); const cid = Math.round(+d.cohort) || 1, c = await fcfg(cid);
    if (d.reset) { must(await db.from("formation_cfg").upsert({ id: cid, launch_at: null, admin_day: 0 })); return { ok: true }; } // retour au démarrage automatique à la date prévue
    if (c.launch) throw E("La formation est déjà ouverte.");
    must(await db.from("formation_cfg").upsert({ id: cid, launch_at: Date.now(), admin_day: 0 })); return { ok: true };
  },
  async fSetDay(d) {
    check(d.token, "a"); const cid = Math.round(+d.cohort) || 1, c = await fcfg(cid); if (!c.launch) throw E("La formation n'est pas encore ouverte : ouvrez-la d'abord.");
    must(await db.from("formation_cfg").upsert({ id: cid, admin_day: Math.max(0, Math.min(60, Math.round(+d.day) || 0)) })); return { ok: true };
  },
  async fSetStart(d) { // date de démarrage automatique (minuit, heure du Bénin)
    check(d.token, "a"); const cid = Math.round(+d.cohort) || 1, t = Date.parse(String(d.date || "").slice(0, 10) + "T00:00:00+01:00"); if (isNaN(t)) throw E("Date invalide.");
    must(await db.from("formation_cfg").upsert({ id: cid, start_at: t })); return { ok: true, start: t };
  },
  async fSkipSet(d) { // avancer des étudiants sans qu'ils aient composé · rétablir à la normale · ou les faire composer les jours avancés
    check(d.token, "a");
    const nums = [...new Set((Array.isArray(d.nums) ? d.nums : [d.num]).map(x => String(x || "").toUpperCase().slice(0, 30)).filter(Boolean))];
    if (!nums.length) throw E("Aucun étudiant sélectionné."); if (nums.length > 1000) throw E("1000 étudiants maximum à la fois.");
    const miss = e => /formation_skip|relation|schema cache|does not exist|column/i.test(String(e && e.message)) ? E("Exécutez (ou ré-exécutez) le fichier supabase_avancer.sql dans Supabase : la table « formation_skip » est absente ou incomplète.") : e;
    const chunks = []; for (let i = 0; i < nums.length; i += 100) chunks.push(nums.slice(i, i + 100));
    if (d.compose) { // rétablissement n°2 : les jours avancés restent ouverts (tous le même jour si besoin) mais doivent être composés et validés pour continuer
      let n = 0; for (const ch of chunks) { const r = await db.from("formation_skip").update({ mode: "compose" }).in("num", ch).select("num"); if (r.error) throw miss(r.error); n += (r.data || []).length; }
      if (!n) throw E("Aucun des étudiants choisis n'est actuellement avancé.", 404);
      return { ok: true, n, skipped: nums.length - n };
    }
    if (!d.on) { for (const ch of chunks) { const r = await db.from("formation_skip").delete().in("num", ch); if (r.error) throw miss(r.error); } return { ok: true, n: nums.length }; } // rétablissement n°1 : règle normale
    const day = Math.round(+d.day); if (!(day >= 1 && day <= 60)) throw E("Jour invalide.");
    const known = new Set(); for (const ch of chunks) must(await db.from("students").select("num").in("num", ch)).forEach(x => known.add(x.num));
    const note = String(d.note || "").slice(0, 200), at = Date.now(), rows = nums.filter(n => known.has(n)).map(num => ({ num, upto: day, mode: "free", note, at }));
    if (!rows.length) throw E("Aucun étudiant valide dans la sélection.", 404);
    let r = await db.from("formation_skip").upsert(rows);
    if (r.error && /mode/i.test(String(r.error.message))) r = await db.from("formation_skip").upsert(rows.map(({ mode, ...o }) => o)); // base pas encore mise à jour : fonctionne comme avant
    if (r.error) throw miss(r.error);
    return { ok: true, n: rows.length, unknown: nums.length - rows.length };
  },
  async fAccessList(d) {
    check(d.token, "a"); const ac = must(await db.from("formation_access").select("*").order("at", { ascending: false })), st = must(await db.from("students").select("num,nom,prenoms")), nm = {}; st.forEach(x => nm[x.num] = x.nom + " " + x.prenoms);
    return { list: ac.map(x => ({ num: x.num, name: nm[x.num] || x.num, day: Number(x.open_day || 0), note: x.note || "", at: Number(x.at || 0) })) };
  },
  async fAccessSet(d, ctx) { // ouverture individuelle : une personne accède aux cours même avant la date de démarrage
    check(d.token, "a"); const num = String(d.num || "").toUpperCase().slice(0, 30);
    if (!d.on) { must(await db.from("formation_access").delete().eq("num", num)); return { ok: true }; }
    if (!must(await db.from("students").select("num").eq("num", num).maybeSingle())) throw E("Aucun étudiant avec ce numéro.", 404);
    must(await db.from("formation_access").upsert({ num, open_day: Math.max(1, Math.min(60, Math.round(+d.day) || 60)), note: String(d.note || "").slice(0, 200), at: Date.now() })); return { ok: true };
  },
};

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "GET") { let st = DEFAULT_START, pr = pricingOf(null); try { const rc = await fcfg(await regCohort()); st = rc.start; pr = rc.pr; } catch (e) { /* valeurs par défaut */ } return res.status(200).json({ serveur: "ok", version: "rangs-2026-11-02", tfa: !!process.env.ADMIN_TOTP_SECRET, now: Date.now(), start: st, pr }); }
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  try {
    const origin = req.headers.origin; if (origin && new URL(origin).host !== req.headers.host) throw E("Origine non autorisée.", 403);
    if (Number(req.headers["content-length"] || 0) > 4e6) throw E("Données trop volumineuses.", 413);
    const d = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim().slice(0, 60) || "?";
    const f = Object.prototype.hasOwnProperty.call(A, d.action) && A[d.action]; if (!f) throw E("Action inconnue.");
    let who = null; if (d.token && d.action !== "adminLogin") who = await adminCtx(d.token); // null si ce n'est pas un jeton administrateur
    if (who && !who.root) { // sous-administrateur : tout ce qui n'est pas explicitement autorisé est refusé
      const need = PERM[d.action];
      if (!need) throw E("Accès refusé.", 403);
      if (who.must && d.action !== "adminChangePwd" && d.action !== "adminMe") throw E("Changez d'abord votre mot de passe provisoire.", 403);
      if (need === ROOTONLY) throw E("Réservé à l'administrateur principal.", 403);
      if (need === "f_any" ? !who.pm.some(p => p.startsWith("f_")) : need !== "*" && !who.pm.includes(need)) throw E("Accès refusé : droit manquant (" + (PERMS[need] || need) + ").", 403);
    }
    let T = null;
    try { // quelle formation faut-il lire ? celle de l'étudiant (numéro), sinon celle de la promotion, sinon celle demandée par l'administrateur
      const nm = String(d.num || "").toUpperCase().slice(0, 30);
      if (nm && /^f[A-Z]/.test(d.action)) T = await trackOf(nm);
      else if (Number(d.cohort) > 0 && /^f[A-Z]/.test(d.action)) T = { formation: await formOfCohort(d.cohort), module: null };
      else if (FORMS[d.formation] && /^f[A-Z]/.test(d.action)) T = { formation: d.formation, module: null };
    } catch (e) { T = null; }
    const out = await als.run({ ip, T }, () => f(d, { ip, who }));
    if (who && PERM[d.action] && !READONLY.has(d.action)) await audit(who, d);
    res.status(200).json(out);
  } catch (e) { if (!e.st || e.st >= 500) console.error(e); res.status(e.st || 500).json({ error: e.st ? e.message : "Erreur serveur. Réessayez." }); }
};
