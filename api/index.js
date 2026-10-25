const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const { AsyncLocalStorage } = require("async_hooks");
const als = new AsyncLocalStorage(); // adresse IP de la requête en cours (pour le blocage des essais)
const TOTAL = +process.env.PRIX_TOTAL || 12000;
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
async function failCheck(key, max, win) { const r = must(await db.from("rate").select("*").eq("k", key).maybeSingle()); if (r && Date.now() - Number(r.t) <= win && r.n >= max) throw E("Trop d'essais incorrects (3 maximum). Réessayez dans 15 minutes ou contactez MK-DESIGN GRAPH.", 429); }
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
const COLS = "num,id,vc,nom,prenoms,dob,lieu,email,partner,status,motif,termine,date,dv,wa,phase,retire,date_retrait";
const sum = (a, st) => a.filter(x => x.st === st).reduce((t, x) => t + Number(x.amount), 0);
const pub = r => ({ num: r.num, id: r.id, vc: r.vc, nom: r.nom, prenoms: r.prenoms, dob: r.dob, lieu: r.lieu, email: r.email, partner: r.partner, status: r.status, motif: r.motif, wa: r.wa, phase: r.phase || "complet", termine: !!r.termine, retire: !!r.retire, date_retrait: r.date_retrait ? Number(r.date_retrait) : 0, date: Number(r.date), dv: r.dv ? Number(r.dv) : 0 });
const enrich = (r, pays, off = 0) => { const m = pays.filter(p => p.num === r.num), paid = sum(m, "valide"), pend = sum(m, "attente"); return { ...pub(r), paid, pend, reste: Math.max(0, TOTAL - off - paid), solde: paid >= TOTAL - off, nPay: m.length, offer: off, total: TOTAL - off }; };
// Vue partenaire : AUCUN nom, AUCUN identifiant de connexion, AUCUNE référence de transaction.
const forPartner = s => ({ num: s.num, partner: s.partner, phase: s.phase, date: s.date, paid: s.paid, pend: s.pend, reste: s.reste, solde: s.solde });
const payPart = x => ({ id: x.id, num: x.num, amount: Number(x.amount), date: Number(x.date), st: x.st, dv: x.dv ? Number(x.dv) : 0 });
const dreqPart = r => ({ id: r.id, num: r.num, partner: r.partner, st: r.st, date: Number(r.date) });
const payPub = x => ({ id: x.id, num: x.num, partner: x.partner, amount: Number(x.amount), trx: x.trx, date: Number(x.date), st: x.st, motif: x.motif, dv: x.dv ? Number(x.dv) : 0 });
const PCOLS = "id,num,partner,amount,trx,date,st,motif,dv";
const baseOf = (p, pays) => pays.filter(x => x.st === "valide" && x.partner === p.id && (!p.rompu || x.dv <= p.rompu.date)).reduce((t, x) => t + x.amount, 0);
const part = (p, withPin, pouts = [], base = 0) => ({ id: p.id, name: p.name, code: p.code, wa: p.wa || "", coef: Number(p.coef), base, paid: pouts.filter(x => x.st === "recu").reduce((a, x) => a + Number(x.amount), 0), pending: pouts.filter(x => x.st === "attente").reduce((a, x) => a + Number(x.amount), 0), rompu: p.rompu || null, pinChanged: !!p.pin_changed, ...(withPin && !p.pin_changed && p.pin ? { pin: pinDec(p.pin) } : {}) });
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
  const st = paid >= TOTAL - (await offerOf(num)) ? "valide" : "attente";
  if (cur.status !== st) must(await db.from("students").update({ status: st, dv: st === "valide" ? Date.now() : null }).eq("num", num));
}

// ===================== FORMATION : accès, paiement par tranches, cours, notes =====================
const CT = require("./formation_content.json"); // cours + leçons + réponses : lu uniquement par le serveur
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
const regCohort = async () => { try { const r = must(await db.from("formation_cfg").select("id").eq("registering", true).order("id", { ascending: false }).limit(1)); return r.length ? Number(r[0].id) : 1; } catch (e) { return 1; } };
const studentsC = async cols => { const r = await db.from("students").select(cols + ",cohort"); return r.error ? db.from("students").select(cols) : r; };
const cohortsList = async (all = []) => {
  let rows; try { rows = must(await db.from("formation_cfg").select("id,name,start_at,launch_at,registering").order("id")); } catch (e) { rows = must(await db.from("formation_cfg").select("id,start_at,launch_at").order("id")); }
  const rc = await regCohort();
  return rows.map(r => { const id = Number(r.id); return { id, name: r.name || "Promotion " + id, start: r.start_at ? Number(r.start_at) : DEFAULT_START, launched: !!r.launch_at, registering: id === rc, n: all.filter(x => (Number(x.cohort) || 1) === id).length }; });
};
const fcfg = async (cid = 1) => {
  const r = must(await db.from("formation_cfg").select("*").eq("id", cid).maybeSingle()), manual = r && r.launch_at ? Number(r.launch_at) : 0, start = r && r.start_at ? Number(r.start_at) : DEFAULT_START;
  return { launch: manual || (Date.now() >= start ? start : 0), manual: !!manual, start, adm: r ? Number(r.admin_day || 0) : 0 };
};
const schedDay = c => c.launch ? Math.min(30, Math.floor((Date.now() - c.launch) / 864e5) + 1) : 0;
const openDayOf = c => c.launch ? Math.min(30, Math.max(schedDay(c), c.adm)) : 0;
const levelOf = (paid, off = 0) => paid >= TOTAL - off ? 30 : paid >= T1 ? T1_DAYS : FREE_DAYS;
const passed30 = async num => must(await db.from("formation_prog").select("day,grade").eq("num", String(num || ""))).filter(x => x.grade != null && Number(x.grade) >= PASSM).length >= 30;
const isFree = async num => !!must(await db.from("formation_free").select("num").eq("num", String(num || "")).maybeSingle());
// "gift" = accès offert : jamais exposé à l'étudiant (il voit simplement « accès complet »)
const fInfo = (paid, pend, c, gift, ov, off = 0) => { const open = Math.min(30, Math.max(openDayOf(c), ov ? Number(ov.open_day || 0) : 0)), full = gift || paid >= TOTAL - off; return { launched: !!c.launch || !!ov, startAt: c.start, now: Date.now(), nextAt: c.launch && schedDay(c) < 30 ? c.launch + schedDay(c) * 864e5 : 0, early: !!ov, openDay: open, paid, pend, level: full ? 30 : levelOf(paid, off), plan: full ? "complet" : paid >= T1 ? "tranche1" : "gratuit", remaining: !full && paid >= T1 ? Math.max(0, T1_DAYS - open) : null, freeLeft: !full && paid < T1 ? Math.max(0, FREE_DAYS - open) : null, T1, TOTAL: TOTAL - off, offer: off, free: FREE_DAYS, t1days: T1_DAYS }; };
const passedRow = r => !!r && r.grade != null && Number(r.grade) >= PASSM;
const dayAcc = (n, fx, pm) => !fx.launched ? "start" : n > fx.level ? "pay" : n > fx.openDay ? "wait" : n > 1 && !fx.preview && !passedRow(pm[n - 1]) ? "prev" : "ok";
const reasonOf = (a, n, fx) => a === "start" ? "La formation n'a pas encore démarré. Vous y aurez accès dès son lancement officiel."
  : a === "wait" ? "Le jour " + n + " n'est pas encore ouvert. Il s'ouvrira sur l'ordre de MK-DESIGN GRAPH."
  : a === "pay" ? (fx.offer > 0 ? "Les " + FREE_DAYS + " jours gratuits sont terminés. Payez " + fx.TOTAL + " FCFA en une seule fois pour continuer." : fx.paid >= T1 ? "Votre 1re tranche couvre les " + T1_DAYS + " premiers jours. Réglez la 2e tranche (" + (TOTAL - T1) + " FCFA) pour continuer." : "Les " + FREE_DAYS + " jours gratuits sont terminés. Payez " + T1 + " FCFA (jours 1 à " + T1_DAYS + ") ou " + TOTAL + " FCFA (accès complet) pour continuer.")
  : "Validez d'abord le jour précédent (14/20 minimum).";
async function fctx(d, c, key, max = 300) {
  await limit(key + ":" + c.ip, max, 900e3);
  let adm = false; if (d.token) { try { check(d.token, "a"); adm = true; } catch (e) { adm = false; } }
  const cfg = await fcfg(), pm = {}, cols = "day,sub,grade,gp,gt,comment,att,gat";
  if (adm && !d.num) { // aperçu administrateur : tout est ouvert, lecture seule
    for (let i = 1; i <= 30; i++) pm[i] = null;
    return { s: { num: "APERCU", nom: "Aperçu", prenoms: "Administrateur" }, fx: { ...fInfo(0, 0, cfg, true), launched: true, openDay: 30, preview: true }, pm, ro: true };
  }
  const s = adm ? must(await db.from("students").select("num,nom,prenoms").eq("num", String(d.num).toUpperCase().slice(0, 30)).maybeSingle()) : await findStudent(d.num, d.id, "num,nom,prenoms");
  if (!s) throw E(adm ? "Étudiant introuvable." : "Numéro ou identifiant incorrect.", 404);
  const ps = must(await db.from("payments").select("amount,st").eq("num", s.num)), fx = fInfo(sum(ps, "valide"), sum(ps, "attente"), await fcfg(await cohortOf(s.num)), await isFree(s.num), must(await db.from("formation_access").select("*").eq("num", s.num).maybeSingle()), await offerOf(s.num));
  must(await db.from("formation_prog").select(cols).eq("num", s.num)).forEach(r => pm[r.day] = r);
  return { s, fx, pm, ro: adm };
}
function needDay(d, fx, pm) { const n = Math.round(+d.day); if (!dayDef(n)) throw E("Jour inconnu.", 404); const a = dayAcc(n, fx, pm); if (a !== "ok") throw E(reasonOf(a, n, fx), 403); return n; }
function cleanData(d) {
  const o = {}, arr = a => Array.isArray(a) ? a.slice(0, 60).map(Boolean) : [];
  o.steps = arr(d.steps); o.ex = arr(d.ex); o.answer = String(d.answer || "").slice(0, 4000); o.files = {};
  if (d.files && typeof d.files === "object") Object.entries(d.files).slice(0, 10).forEach(([k, v]) => { if (/^[\w\-]{1,40}\.(html|css|js|php|txt)$/i.test(k)) o.files[k] = String(v).slice(0, 60000); });
  o.shot = img(d.shot) ? d.shot : ""; o.qa = {};
  if (d.qa && typeof d.qa === "object") Object.entries(d.qa).slice(0, 20).forEach(([k, v]) => { if (/^\d{1,2}$/.test(k) && ["number", "boolean", "string"].includes(typeof v)) o.qa[k] = typeof v === "string" ? v.slice(0, 200) : v; });
  return o;
}
const recOut = r => r ? { ...(r.data || {}), sub: Number(r.sub || 0), grade: r.grade == null ? null : Number(r.grade), gp: r.gp == null ? null : Number(r.gp), gt: r.gt == null ? null : Number(r.gt), comment: r.comment || "", att: r.att || 0 } : {};

// ===================== ADMINISTRATEURS ET DROITS D'ACCÈS =====================
const PERMS = { dash: "Tableau de bord (statistiques, listes)", students: "Informations confidentielles des étudiants (noms, contacts, naissance, photo, identifiants)", payments: "Paiements : historique, validation, captures", partners: "Partenaires, commissions et versements", delete: "Supprimer des inscriptions", attest: "Attestations et ouverture du retrait", f_ctl: "Formation : démarrer et ouvrir les jours", f_corr: "Formation : corriger les travaux", f_view: "Formation : voir comme un étudiant", f_courses: "Formation : cours et notes pour professeur", f_gift: "Formation : accès offerts" };
const ROOTONLY = "root";
const PERM = { adminState: "dash", img: "students", pimg: "payments", setPayStatus: "payments", addPartner: "partners", setCoef: "partners", addPayout: "partners", cancelPayout: "partners", breakContract: "partners", restoreContract: "partners", resetPin: "partners", partnerState: "partners", closeReq: "delete", delStudent: "delete", setConf: "students", setTerm: "attest", allTerm: "attest", setOpen: "attest", setOffer: "f_gift", newCohort: "f_ctl", setRegCohort: "f_ctl", detachPartner: "partners",
  fAdmin: "f_any", fSub: "f_corr", fGrade: "f_corr", fLaunch: "f_ctl", fSetDay: "f_ctl", fSetStart: "f_ctl", fAccessList: "f_ctl", fAccessSet: "f_ctl", fCourses: "f_courses", fCourse: "f_courses", fNote: "f_courses", fFreeList: "f_gift", fFreeSet: "f_gift", fState: "f_view", fDay: "f_view", fCheck: "f_view", fBulletin: "f_view", fFiche: "f_view",
  adminMe: "*", adminChangePwd: "*", regenCode: "students", bulkCodes: "students", unlock: "students", adminList: ROOTONLY, adminSave: ROOTONLY, adminReset: ROOTONLY, adminDel: ROOTONLY, audit: ROOTONLY, backup: ROOTONLY, purgeAll: ROOTONLY, setProd: ROOTONLY, setReg: ROOTONLY };
const READONLY = new Set(["fAccessList", "adminState", "fAdmin", "fCourses", "fCourse", "fFreeList", "fState", "fDay", "fCheck", "fBulletin", "fFiche", "img", "pimg", "adminMe", "adminList", "audit", "partnerState"]);
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
  async regState() { const rc = await regCohort(), c = await fcfg(rc); return { closed: !!(await setting("reg_closed")), start: c.start, cohort: rc }; },
  async partnerInfo({ code }) { const p = must(await db.from("partners").select("rompu").eq("code", String(code || "").toLowerCase().slice(0, 12)).maybeSingle()); return { exists: !!p, active: !!p && !p.rompu }; },
  async register(d, c) {
    await limit("rg:" + c.ip, 20, 3600e3);
    if (await setting("reg_closed")) throw E("Les inscriptions sont fermées pour le moment. Contactez MK-DESIGN GRAPH sur WhatsApp.", 403);
    const nom = String(d.nom || "").trim(), prenoms = String(d.prenoms || "").trim();
    let wa = String(d.wa || "").replace(/\D/g, "");
    if (!nom || !prenoms) throw E("Veuillez saisir votre nom et vos prénoms.");
    if (wa.length === 8) wa = "22901" + wa; else if (wa.length === 10 && wa.startsWith("01")) wa = "229" + wa;
    if (wa.length < 10 || wa.length > 15) throw E("Numéro WhatsApp invalide. Saisissez-le avec l'indicatif, par exemple 22901XXXXXXXX.");
    if (must(await db.from("students").select("num").eq("wa", wa).limit(1)).length) throw E("Ce numéro WhatsApp est déjà inscrit. Utilisez « Mon reçu » avec votre numéro d'attribution et votre identifiant, ou contactez-nous sur WhatsApp.");
    let partner = null;
    if (d.partnerCode) { const p = must(await db.from("partners").select("id,rompu").eq("code", String(d.partnerCode).toLowerCase().slice(0, 12)).maybeSingle()); if (p && !p.rompu) partner = p.id; }
    const rc = await regCohort(), n = must(await db.rpc("next_num"));
    const row = { num: "FORM-2026-" + String(n).padStart(5, "0"), id: strongCode(12), vc: rnd(10), nom: nom.toUpperCase().slice(0, 80), prenoms: prenoms.slice(0, 120), wa, partner, phase: "inscrit", status: "attente", termine: false, retire: false, montant: 0, date: Date.now(), ...(rc !== 1 ? { cohort: rc } : {}) };
    must(await db.from("students").insert(row)); return { num: row.num, id: row.id };
  },
  async complete(d, c) {
    await limit("cp:" + c.ip, 20, 3600e3);
    const s = await findStudent(d.num, d.id, "num,phase");
    if (!s) throw E("Numéro ou identifiant incorrect.", 404);
    if (s.phase !== "inscrit") throw E("Votre dossier est déjà complété.");
    const nom = String(d.nom || "").trim(), prenoms = String(d.prenoms || "").trim();
    if (!nom || !prenoms || !d.dob || !String(d.lieu || "").trim() || !/^\S+@\S+\.\S+$/.test(d.email || "")) throw E("Veuillez remplir tous les champs correctement.");
    if (!img(d.photo)) throw E("Photo invalide (image trop lourde ou format non pris en charge).");
    must(await db.from("students").update({ nom: nom.toUpperCase().slice(0, 80), prenoms: prenoms.slice(0, 120), dob: String(d.dob).slice(0, 10), lieu: String(d.lieu).trim().slice(0, 100), email: String(d.email).trim().slice(0, 120), photo: d.photo, phase: "complet" }).eq("num", s.num)); return { ok: true };
  },
  async pay(d, c) {
    await limit("py:" + c.ip, 25, 3600e3);
    const s = await findStudent(d.num, d.id, "num,phase,partner");
    if (!s) throw E("Numéro ou identifiant incorrect.", 404);
    if (s.phase !== "complet") throw E("Complétez d'abord votre dossier (informations et photo).");
    const amount = Math.round(+d.amount), trx = String(d.trx || "").trim().toUpperCase().slice(0, 60);
    if (!trx || !img(d.shot)) throw E("La référence et la capture du paiement sont obligatoires.");
    const ps = must(await db.from("payments").select("amount,st").eq("num", s.num)), used = sum(ps, "valide") + sum(ps, "attente");
    const off = await offerOf(s.num), rest = TOTAL - off - used; if (rest <= 0) throw E("Votre formation est déjà entièrement payée.");
    if (!(used === 0 && !off ? [TOTAL, T1] : [rest]).includes(amount)) throw E(used === 0 && !off ? "Choisissez : " + TOTAL + " FCFA en une fois, ou " + T1 + " FCFA pour la 1re tranche (puis " + (TOTAL - T1) + " FCFA)." : "Le montant à payer est de " + rest + " FCFA" + (off && used === 0 ? " en une seule fois." : "."));
    if (must(await db.from("payments").select("id").eq("trx", trx).neq("st", "rejete").neq("st", "annule").limit(1)).length) throw E("Cette référence de transaction a déjà été utilisée.");
    must(await db.from("payments").insert({ id: rnd(8), num: s.num, partner: s.partner, amount, trx, shot: d.shot, date: Date.now(), st: "attente" })); return { ok: true };
  },
  async receipt(d, c) {
    await limit("rc:" + c.ip, 40, 900e3);
    const r = await findStudent(d.num, d.id, COLS + ",photo");
    if (!r) throw E("Numéro ou identifiant incorrect.", 404);
    const pays = must(await db.from("payments").select("*").eq("num", r.num).order("date")).map(x => ({ ...payPub(x), shot: x.shot }));
    const gift = await isFree(r.num), off = await offerOf(r.num); return { student: { ...enrich(r, pays, off), photo: r.photo, acces: gift }, pays, open: !!(await setting("open")), total: TOTAL - off, fx: fInfo(sum(pays, "valide"), sum(pays, "attente"), await fcfg(await cohortOf(r.num)), gift, must(await db.from("formation_access").select("*").eq("num", r.num).maybeSingle()), off) };
  },
  async replaceShot(d, c) {
    await limit("rs:" + c.ip, 30, 3600e3);
    const s = await findStudent(d.num, d.id, "num"); if (!s) throw E("Numéro ou identifiant incorrect.", 404);
    const x = must(await db.from("payments").select("id,num,amount,st").eq("id", String(d.pid || "")).maybeSingle());
    if (!x || x.num !== s.num) throw E("Paiement introuvable.", 404);
    if (!["attente", "rejete"].includes(x.st)) throw E("Cette transaction ne peut plus être modifiée : envoyez un nouveau paiement.", 403);
    if (!img(d.shot)) throw E("Capture invalide.");
    if (x.st === "rejete") { const o = must(await db.from("payments").select("id,amount,st").eq("num", s.num)).filter(p => p.id !== x.id); if (sum(o, "valide") + sum(o, "attente") + Number(x.amount) > TOTAL - (await offerOf(s.num))) throw E("Ce paiement n'est plus possible : envoyez un nouveau paiement.", 403); }
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
    if (paid < TOTAL - (await offerOf(r.num)) && !(await isFree(r.num))) throw E("Paiement non soldé : attestation indisponible.", 403);
    if (!(await passed30(r.num))) throw E("Attestation non valide ou formation incomplète : validez les 30 jours de la formation.", 403);
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
    needRoot(d, c); const T = ["students", "payments", "partners", "payouts", "dreq", "log", "settings", "formation_cfg", "formation_prog", "formation_free", "formation_access", "formation_notes", "admins", "admin_audit"], out = { date: Date.now(), tables: {}, note: "Les photos, captures et mots de passe ne sont pas inclus." };
    for (const t of T) { try { out.tables[t] = must(await db.from(t).select("*")).map(r => { const o = { ...r }; ["photo", "shot", "pin", "pin_hash", "pass_hash"].forEach(k => delete o[k]); if (o.data && o.data.shot) o.data = { ...o.data, shot: "(image non incluse)" }; return o; }); } catch (e) { out.tables[t] = "(table absente)"; } }
    return out;
  },
  async partnerLogin({ code, pin }, c) {
    const cd = String(code || "").trim().toLowerCase().slice(0, 12);
    await failCheck("pf:" + cd, 3, 900e3); await failCheck("pi:" + c.ip, 20, 900e3);
    const p = must(await db.from("partners").select("*").eq("code", cd).maybeSingle()), ok = p && pinOk(p, pin);
    if (!ok) { await failAdd("pf:" + cd, 900e3); await failAdd("pi:" + c.ip, 900e3); await sleep(1000); throw E("Code ou mot de passe incorrect.", 401); }
    if (p.rompu) throw E("Accès désactivé : le contrat avec MK-DESIGN GRAPH a pris fin.", 403);
    if (!p.pin_hash) must(await db.from("partners").update({ pin_hash: hash(String(pin).trim().toUpperCase()), pin: p.pin_changed ? null : pinEnc(String(p.pin)) }).eq("id", p.id)); // ancien code en clair : converti en empreinte
    return { token: sign({ r: "p", pid: p.id, exp: Date.now() + 8 * 3600e3 }), must: !p.pin_changed };
  },
  async partnerState(d, c) {
    let p, ro = false;
    if (c.who && d.pid) { p = await getPartner(String(d.pid)); ro = true; if (!p) throw E("Partenaire introuvable.", 404); } // l'administrateur voit l'espace d'un partenaire, en lecture seule
    else { const t = check(d.token, "p"); p = await getPartner(t.pid); if (!p || p.rompu) throw E("Accès désactivé.", 401); if (!p.pin_changed) return { mustChange: true, partner: { id: p.id, name: p.name } }; }
    const pays = must(await db.from("payments").select(PCOLS).eq("partner", p.id).order("date")).map(payPub);
    const OFFS = await offersMap(), st = must(await db.from("students").select(COLS).eq("partner", p.id).order("date")).map(r => forPartner(enrich(r, pays, OFFS[r.num] || 0)));
    const dreq = must(await db.from("dreq").select("*").eq("partner", p.id).order("date", { ascending: false }));
    const pouts = must(await db.from("payouts").select("*").eq("partner", p.id).order("date", { ascending: false })).map(payRow);
    return { ro, partner: part(p, false, pouts, baseOf(p, pays)), students: st, payments: pays.map(payPart), dreq: dreq.map(dreqPart), payouts: pouts };
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
    const [ps, st, dq, lg, py, pm, fp, fr] = await Promise.all([db.from("partners").select("*").order("name"), db.from("students").select(COLS + ",conf,conf_at,conf_by,cohort").order("date"), db.from("dreq").select("*").order("date", { ascending: false }), db.from("log").select("*").order("date", { ascending: false }).limit(100), db.from("payouts").select("*").order("date", { ascending: false }), db.from("payments").select(PCOLS).order("date", { ascending: false }), db.from("formation_prog").select("num,grade"), db.from("formation_free").select("num")]);
    const pays = must(pm).map(payPub), pouts = must(py), cnt = {}; must(fp).forEach(r => { if (r.grade != null && Number(r.grade) >= PASSM) cnt[r.num] = (cnt[r.num] || 0) + 1; }); const gf = new Set(must(fr).map(x => x.num));
    const hs = hasP(c, "students"), hp = hasP(c, "partners"), hd = hasP(c, "delete");
    const stRows = (() => { try { return must(st); } catch (err) { return null; } })() || must(await db.from("students").select(COLS).order("date")); // repli si le script SQL « confirmation » n'a pas encore été exécuté
    const OFFS = await offersMap(), students = stRows.map(r => { const e0 = enrich(r, pays, OFFS[r.num] || 0), e = { ...e0, cohort: Number(r.cohort) || 1, conf: r.conf || "", conf_at: Number(r.conf_at || 0), conf_by: r.conf_by || "", fdone: cnt[r.num] || 0, attOk: (e0.solde || gf.has(r.num)) && (cnt[r.num] || 0) >= 30 }; return hs ? e : { ...e, id: "", vc: "", nom: "Étudiant", prenoms: e.num, dob: "", lieu: "", email: "", wa: "", motif: "" }; });
    return { me: { name: c.who ? c.who.name : "", root: !c.who || c.who.root, perms: c.who ? c.who.pm : Object.keys(PERMS), tfa: !!process.env.ADMIN_TOTP_SECRET, weakPw: !!(c.who && c.who.root) && !strongOk(String(process.env.ADMIN_PASSWORD || "")) }, total: TOTAL, payments: hasP(c, "payments") ? pays : [], partners: hp ? must(ps).map(p => part(p, true, pouts.filter(x => x.partner === p.id).map(payRow), baseOf(p, pays))) : [], students, dreq: hd || hp ? must(dq).map(r => ({ ...r, date: Number(r.date) })) : [], log: hd ? must(lg).map(g => ({ ...g, date: Number(g.date) })) : [], payouts: hp ? pouts.map(payRow) : [], open: !!(await setting("open")), prod: !!(await setting("prod")), regClosed: !!(await setting("reg_closed")), cohorts: await cohortsList(stRows) };
  },
  async img(d) { check(d.token, "a"); const r = must(await db.from("students").select("photo").eq("num", String(d.num || "")).maybeSingle()); if (!r) throw E("Introuvable.", 404); return { data: r.photo }; },
  async pimg(d) { check(d.token, "a"); const r = must(await db.from("payments").select("shot").eq("id", String(d.id || "")).maybeSingle()); if (!r) throw E("Introuvable.", 404); return { data: r.shot }; },
  async setPayStatus(d) {
    check(d.token, "a"); if (!["attente", "valide", "rejete", "annule"].includes(d.st)) throw E("Statut invalide.");
    const x = must(await db.from("payments").select("*").eq("id", String(d.id || "")).maybeSingle()); if (!x) throw E("Paiement introuvable.", 404);
    if (d.st === "valide") { const tot = TOTAL - (await offerOf(x.num)), others = must(await db.from("payments").select("id,amount,st").eq("num", x.num)).filter(p => p.id !== x.id); if (sum(others, "valide") + Number(x.amount) > tot) throw E("Ce paiement dépasserait le total de " + tot + " FCFA."); }
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
    const left = Math.round(baseOf(p, pays) * Number(p.coef) / 100) - used;
    if (v > left) throw E("Montant supérieur au reste à verser (" + left + " FCFA).");
    must(await db.from("payouts").insert({ id: rnd(8), partner: p.id, amount: v, ref: String(d.ref || "").slice(0, 80), note: String(d.note || "").slice(0, 200), date: Date.now(), st: "attente" })); return { ok: true };
  },
  async cancelPayout(d) { check(d.token, "a"); must(await db.from("payouts").delete().eq("id", d.id).neq("st", "recu")); return { ok: true }; },
  async setTerm(d) { check(d.token, "a"); if (d.v && !(await passed30(d.num))) throw E("Cet étudiant n'a pas validé les 30 jours : impossible de le marquer terminé."); must(await db.from("students").update({ termine: !!d.v }).eq("num", d.num)); return { ok: true }; },
  async allTerm(d) { check(d.token, "a"); const cnt = {}; must(await db.from("formation_prog").select("num,grade")).forEach(r => { if (r.grade != null && Number(r.grade) >= PASSM) cnt[r.num] = (cnt[r.num] || 0) + 1; }); const ns = Object.keys(cnt).filter(k => cnt[k] >= 30); for (const k of ns) must(await db.from("students").update({ termine: true }).eq("num", k)); return { ok: true, n: ns.length }; },
  async newCohort(d) { // nouvelle promotion : nouveau mois, nouvelles inscriptions, calendrier indépendant des promotions en cours
    check(d.token, "a"); const name = String(d.name || "").trim().slice(0, 60), t = Date.parse(String(d.date || "").slice(0, 10) + "T00:00:00+01:00");
    if (!name) throw E("Donnez un nom à la promotion (ex. Promotion décembre 2026)."); if (isNaN(t)) throw E("Date de démarrage invalide."); if (t < Date.now()) throw E("La date de démarrage doit être dans le futur.");
    const id = Math.max(1, ...must(await db.from("formation_cfg").select("id")).map(r => Number(r.id))) + 1;
    must(await db.from("formation_cfg").update({ registering: false }).gte("id", 0));
    must(await db.from("formation_cfg").insert({ id, name, start_at: t, launch_at: null, admin_day: 0, registering: true, created: Date.now() }));
    await putSetting("reg_closed", false); return { ok: true, id };
  },
  async setRegCohort(d) { // choisir dans quelle promotion les nouveaux étudiants s'inscrivent
    check(d.token, "a"); const id = Math.round(+d.id) || 0; if (!must(await db.from("formation_cfg").select("id").eq("id", id).maybeSingle())) throw E("Promotion introuvable.", 404);
    must(await db.from("formation_cfg").update({ registering: false }).gte("id", 0)); must(await db.from("formation_cfg").update({ registering: true }).eq("id", id)); return { ok: true };
  },
  async setReg(d) { check(d.token, "a"); await putSetting("reg_closed", !!d.v); return { ok: true }; }, // arrêter / rouvrir les inscriptions
  async setOffer(d) { // montant offert à un étudiant : il paie (prix total - offre) en une seule fois
    check(d.token, "a"); const num = String(d.num || "").toUpperCase().slice(0, 30), amt = Math.round(+d.amount || 0);
    if (!must(await db.from("students").select("num").eq("num", num).maybeSingle())) throw E("Aucun étudiant avec ce numéro.", 404);
    if (amt < 0 || amt >= TOTAL) throw E("L'offre doit être comprise entre 0 et " + (TOTAL - 1) + " FCFA (pour un accès entièrement gratuit, utilisez « accès offert »).");
    if (!amt) { must(await db.from("offers").delete().eq("num", num)); return { ok: true, offer: 0 }; }
    const ps = must(await db.from("payments").select("amount,st").eq("num", num)), used = sum(ps, "valide") + sum(ps, "attente");
    if (used > TOTAL - amt) throw E("Cet étudiant a déjà payé " + used + " FCFA : l'offre dépasserait ce qu'il reste à payer.");
    must(await db.from("offers").upsert({ num, amount: amt, at: Date.now() })); await syncStatus(num); return { ok: true, offer: amt, apayer: TOTAL - amt };
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
    must(await db.from("payments").delete().eq("num", s.num)); must(await db.from("formation_prog").delete().eq("num", s.num)); must(await db.from("formation_free").delete().eq("num", s.num)); must(await db.from("formation_access").delete().eq("num", s.num)); must(await db.from("dreq").delete().eq("num", s.num)); must(await db.from("students").delete().eq("num", s.num));
    must(await db.from("log").insert({ date: Date.now(), num: s.num, nom: label, statut: s.status, partner: p ? p.name : "Direct", how: "Supprimé immédiatement par l'administrateur (" + acc + ")" }));
    return { ok: true };
  },
  // ===== 2) confirmation de l'inscription par téléphone : Oui / Non =====
  async setConf(d, c) {
    check(d.token, "a"); const num = String(d.num || "").toUpperCase().slice(0, 30), v = d.v === "oui" ? "oui" : d.v === "non" ? "non" : null;
    if (!must(await db.from("students").select("num").eq("num", num).maybeSingle())) throw E("Inscription introuvable.", 404);
    must(await db.from("students").update({ conf: v, conf_at: v ? Date.now() : null, conf_by: v ? c.who.name : null }).eq("num", num)); return { ok: true };
  },
  // ---------- Formation : étudiant ----------
  async fState(d, c) {
    const { s, fx, pm, ro } = await fctx(d, c, "fs");
    return { num: s.num, name: s.prenoms, ro: !!ro, preview: !!fx.preview, ...fx, days: CT.course.map(x => { const r = pm[x.n]; return { n: x.n, title: x.title, week: x.week, proj: x.proj, acc: dayAcc(x.n, fx, pm), sub: r && r.sub ? Number(r.sub) : 0, grade: r && r.grade != null ? Number(r.grade) : null, gp: r && r.gp != null ? Number(r.gp) : null, gt: r && r.gt != null ? Number(r.gt) : null }; }) };
  },
  async fDay(d, c) {
    const { s, fx, pm, ro } = await fctx(d, c, "fd"), n = needDay(d, fx, pm), L = CT.lessons[n], Q = quizOf(n);
    const r = must(await db.from("formation_prog").select("*").eq("num", s.num).eq("day", n).maybeSingle());
    const tc = CT.teach[n] || {}; return { day: dayDef(n), lesson: L ? { parts: L.parts } : null, quiz: Q ? qpub(Q) : null, sites: CT.sites, rec: recOut(r), crit: { b: tc.b || [], a: tc.a || "" }, ro: !!ro };
  },
  async fSave(d, c) {
    const { s, fx, pm, ro } = await fctx(d, c, "fv", 900); if (ro) throw E("Mode lecture (administrateur) : aucune modification.", 403); const n = needDay(d, fx, pm), p = pm[n];
    if (p && p.sub && (p.grade == null || passedRow(p))) throw E("Ce travail est verrouillé.", 409);
    must(await db.from("formation_prog").upsert({ num: s.num, day: n, data: cleanData(d.data || {}) })); return { ok: true };
  },
  async fCheck(d, c) {
    const { fx, pm } = await fctx(d, c, "fk"), n = needDay(d, fx, pm), Q = quizOf(n); if (!Q) throw E("Pas de questions ce jour-là.");
    const sc = qscore(n, cleanData({ qa: d.qa }).qa); return { ok: sc.ok, ex: Q.map(qexp), s: sc.s, t: sc.t, v: sc.v };
  },
  async fSubmit(d, c) {
    const { s, fx, pm, ro } = await fctx(d, c, "fu"); if (ro) throw E("Mode lecture (administrateur) : aucune modification.", 403); const n = needDay(d, fx, pm), p = pm[n];
    if (p && p.sub && p.grade == null) throw E("Votre travail est déjà en attente de correction.", 409);
    if (passedRow(p)) throw E("Ce jour est déjà validé.", 409);
    const r = must(await db.from("formation_prog").select("data").eq("num", s.num).eq("day", n).maybeSingle()), dt = (r && r.data) || {}, code = n >= 16 && n <= 29;
    if (code && Object.values(dt.files || {}).reduce((t, x) => t + String(x).trim().length, 0) < 20) throw E("Écrivez d'abord votre code dans l'éditeur.");
    if (!code && String(dt.answer || "").trim().length < 5 && !dt.shot) throw E("Ajoutez un lien, une description ou une capture d'écran.");
    const Q = quizOf(n), qa = dt.qa || {}; if (Q && Q.some((q, i) => qa[i] == null || qa[i] === "")) throw E("Répondez d'abord à toutes les questions théoriques.");
    const sc = qscore(n, qa);
    must(await db.from("formation_prog").upsert({ num: s.num, day: n, sub: Date.now(), grade: null, gp: null, gt: sc ? sc.v : null, comment: "", att: (p && p.att || 0) + 1 })); return { ok: true };
  },
  // ---------- Formation : administrateur ----------
  async fAdmin(d, ctx) {
    check(d.token, "a"); const cid = Math.round(+d.cohort) || await regCohort();
    const [c, rows, sts, ps, frs] = await Promise.all([fcfg(cid), db.from("formation_prog").select("num,day,sub,gt,gp,grade,att").order("sub", { ascending: false }), studentsC("num,nom,prenoms"), db.from("payments").select("num,amount,st"), db.from("formation_free").select("num")]);
    const all = must(sts), st = all.filter(x => (Number(x.cohort) || 1) === cid), inC = new Set(st.map(x => x.num)), subs = must(rows).filter(r => inC.has(r.num)), pays = must(ps), gifts = new Set(must(frs).map(x => x.num)), name = {}; st.forEach(x => name[x.num] = x.nom + " " + x.prenoms);
    const names = hasP(ctx, "students"), OFS = await offersMap();
    return { cohort: cid, cohorts: await cohortsList(all), me: { name: ctx.who.name, root: ctx.who.root, perms: ctx.who.root ? Object.keys(PERMS) : ctx.who.pm }, cfg: { now: Date.now(), launch: c.launch, manual: c.manual, start: c.start, adm: c.adm, sched: schedDay(c), openDay: openDayOf(c) },
      subs: !hasP(ctx, "f_corr") ? [] : subs.filter(r => r.sub).map(r => ({ num: r.num, name: names ? (name[r.num] || r.num) : r.num, day: r.day, sub: Number(r.sub), grade: r.grade == null ? null : Number(r.grade), gt: r.gt == null ? null : Number(r.gt) })),
      students: !hasP(ctx, "f_view") ? [] : st.map(x => { const paid = sum(pays.filter(p => p.num === x.num), "valide"); return { num: x.num, name: names ? x.nom + " " + x.prenoms : x.num, paid, free: gifts.has(x.num), level: gifts.has(x.num) ? 30 : levelOf(paid, OFS[x.num] || 0), done: subs.filter(r => r.num === x.num && passedRow(r)).length }; }) };
  },
  async fSub(d, c) {
    check(d.token, "a"); const n = Math.round(+d.day), x = dayDef(n), num = String(d.num || "").slice(0, 30);
    const r = must(await db.from("formation_prog").select("*").eq("num", num).eq("day", n).maybeSingle()), s = must(await db.from("students").select("nom,prenoms").eq("num", num).maybeSingle());
    if (!x || !r || !r.sub) throw E("Remise introuvable.", 404);
    const dt = r.data || {}, Q = quizOf(n), sc = Q ? qscore(n, dt.qa || {}) : null, ex = (x.s.find(z => /^Exercice/.test(z.h)) || { b: [{ i: [] }] }).b[0].i;
    return { name: s && hasP(c, "students") ? s.nom + " " + s.prenoms : num, n, title: x.title, exercise: ex, data: dt, sub: Number(r.sub), att: r.att || 0, gt: r.gt == null ? null : Number(r.gt), gp: r.gp == null ? null : Number(r.gp), grade: r.grade == null ? null : Number(r.grade), comment: r.comment || "",
      theory: Q ? { s: sc.s, t: sc.t, v: sc.v, items: Q.map((q, i) => ({ q: q[1], a: qans(q, (dt.qa || {})[i]), ok: sc.ok[i] })) } : null };
  },
  async fGrade(d) {
    check(d.token, "a"); const n = Math.round(+d.day), num = String(d.num || "").slice(0, 30), g = Number(d.gp);
    if (!(g >= 0 && g <= 20)) throw E("Note invalide (0 à 20).");
    const r = must(await db.from("formation_prog").select("sub,gt").eq("num", num).eq("day", n).maybeSingle()); if (!r || !r.sub) throw E("Aucune remise à noter.", 404);
    const fin = r.gt == null ? g : Math.round((g * (1 - WT) + Number(r.gt) * WT) * 10) / 10;
    must(await db.from("formation_prog").update({ gp: g, grade: fin, comment: String(d.comment || "").slice(0, 600), gat: Date.now() }).eq("num", num).eq("day", n));
    if (fin >= PASSM) { const all = must(await db.from("formation_prog").select("day,grade").eq("num", num)); if (all.filter(x => x.grade != null && Number(x.grade) >= PASSM).length >= 30) must(await db.from("students").update({ termine: true }).eq("num", num)); }
    return { ok: true, grade: fin };
  },
  // ---------- Formation : bulletin de notes et fiches de correction (étudiant) ----------
  async fBulletin(d, c) {
    const { s, pm } = await fctx(d, c, "fb"), rows = CT.course.map(x => { const r = pm[x.n]; return { n: x.n, title: x.title, week: x.week, proj: x.proj, sub: r && r.sub ? Number(r.sub) : 0, gp: r && r.gp != null ? Number(r.gp) : null, gt: r && r.gt != null ? Number(r.gt) : null, grade: r && r.grade != null ? Number(r.grade) : null, gat: r && r.gat ? Number(r.gat) : 0 }; });
    const gr = rows.filter(r => r.grade != null), ok = gr.filter(r => r.grade >= PASSM), avg = gr.length ? Math.round(gr.reduce((t, r) => t + r.grade, 0) / gr.length * 10) / 10 : null;
    return { name: (s.nom + " " + s.prenoms).trim(), num: s.num, rows, validated: ok.length, total: CT.course.length, avg, complete: ok.length === CT.course.length, mention: ok.length === CT.course.length ? (avg >= 18 ? "Excellent" : avg >= 16 ? "Très bien" : "Bien") : "", date: Date.now() };
  },
  async fFiche(d, c) {
    const { s, pm } = await fctx(d, c, "ff"), n = Math.round(+d.day), x = dayDef(n); if (!x) throw E("Jour inconnu.", 404);
    const r = must(await db.from("formation_prog").select("*").eq("num", s.num).eq("day", n).maybeSingle());
    if (!r || r.grade == null) throw E("La fiche de correction sera disponible une fois votre travail corrigé.", 403);
    const dt = r.data || {}, Q = quizOf(n), sc = Q ? qscore(n, dt.qa || {}) : null, tc = CT.teach[n] || {}, good = q => q[0] === "qcm" ? q[2][q[3]] : q[0] === "vf" ? (q[2] ? "Vrai" : "Faux") : q[2][0];
    return { n, title: x.title, week: x.week, proj: x.proj, name: (s.nom + " " + s.prenoms).trim(), num: s.num, exercise: (x.s.find(z => /^Exercice/.test(z.h)) || { b: [{ i: [] }] }).b[0].i, crit: { b: tc.b || [], a: tc.a || "" },
      sub: Number(r.sub || 0), gat: Number(r.gat || 0), gp: r.gp == null ? null : Number(r.gp), gt: r.gt == null ? null : Number(r.gt), grade: Number(r.grade), comment: r.comment || "", att: r.att || 0,
      data: { answer: dt.answer || "", files: dt.files || {}, shot: dt.shot || "", steps: dt.steps || [], ex: dt.ex || [] },
      theory: Q ? { s: sc.s, t: sc.t, v: sc.v, items: Q.map((q, i) => ({ q: q[1], a: qans(q, (dt.qa || {})[i]), ok: sc.ok[i], good: good(q), ex: qexp(q) })) } : null };
  },
  // ---------- Formation : accès offerts (confidentiel, administrateur uniquement) ----------
  async fFreeList(d) {
    check(d.token, "a"); const fr = must(await db.from("formation_free").select("*").order("at", { ascending: false })), st = must(await db.from("students").select("num,nom,prenoms")), nm = {}; st.forEach(x => nm[x.num] = x.nom + " " + x.prenoms);
    return { list: fr.map(x => ({ num: x.num, name: nm[x.num] || x.num, note: x.note || "", at: Number(x.at || 0) })) };
  },
  async fFreeSet(d) {
    check(d.token, "a"); const num = String(d.num || "").toUpperCase().slice(0, 30);
    const s = must(await db.from("students").select("num").eq("num", num).maybeSingle()); if (!s) throw E("Aucun étudiant avec ce numéro.", 404);
    if (d.on) must(await db.from("formation_free").upsert({ num, note: String(d.note || "").slice(0, 200), at: Date.now() })); else must(await db.from("formation_free").delete().eq("num", num));
    return { ok: true };
  },
  // ---------- Formation : cours complets avec notes pour professeur (administrateur) ----------
  async fCourses(d) {
    check(d.token, "a"); const nt = must(await db.from("formation_notes").select("day")), has = new Set(nt.map(x => x.day));
    return { days: CT.course.map(x => ({ n: x.n, title: x.title, week: x.week, proj: x.proj, note: has.has(x.n), quiz: !!quizOf(x.n) })) };
  },
  async fCourse(d) {
    check(d.token, "a"); const n = Math.round(+d.day), x = dayDef(n); if (!x) throw E("Jour inconnu.", 404);
    const nt = must(await db.from("formation_notes").select("note").eq("day", n).maybeSingle()), L = CT.lessons[n];
    return { day: x, lesson: L ? { parts: L.parts } : null, quiz: quizOf(n), sites: CT.sites, teach: CT.teach[n] || null, note: nt ? nt.note || "" : "" };
  },
  async fNote(d) {
    check(d.token, "a"); const n = Math.round(+d.day); if (!dayDef(n)) throw E("Jour inconnu.", 404);
    must(await db.from("formation_notes").upsert({ day: n, note: String(d.note || "").slice(0, 6000) })); return { ok: true };
  },
  async fLaunch(d) {
    check(d.token, "a"); const cid = Math.round(+d.cohort) || 1, c = await fcfg(cid);
    if (d.reset) { must(await db.from("formation_cfg").upsert({ id: cid, launch_at: null, admin_day: 0 })); return { ok: true }; } // retour au démarrage automatique à la date prévue
    if (c.launch) throw E("La formation est déjà ouverte.");
    must(await db.from("formation_cfg").upsert({ id: cid, launch_at: Date.now(), admin_day: 0 })); return { ok: true };
  },
  async fSetDay(d) {
    check(d.token, "a"); const cid = Math.round(+d.cohort) || 1, c = await fcfg(cid); if (!c.launch) throw E("La formation n'est pas encore ouverte : ouvrez-la d'abord.");
    must(await db.from("formation_cfg").upsert({ id: cid, admin_day: Math.max(0, Math.min(30, Math.round(+d.day) || 0)) })); return { ok: true };
  },
  async fSetStart(d) { // date de démarrage automatique (minuit, heure du Bénin)
    check(d.token, "a"); const cid = Math.round(+d.cohort) || 1, t = Date.parse(String(d.date || "").slice(0, 10) + "T00:00:00+01:00"); if (isNaN(t)) throw E("Date invalide.");
    must(await db.from("formation_cfg").upsert({ id: cid, start_at: t })); return { ok: true, start: t };
  },
  async fAccessList(d) {
    check(d.token, "a"); const ac = must(await db.from("formation_access").select("*").order("at", { ascending: false })), st = must(await db.from("students").select("num,nom,prenoms")), nm = {}; st.forEach(x => nm[x.num] = x.nom + " " + x.prenoms);
    return { list: ac.map(x => ({ num: x.num, name: nm[x.num] || x.num, day: Number(x.open_day || 0), note: x.note || "", at: Number(x.at || 0) })) };
  },
  async fAccessSet(d, ctx) { // ouverture individuelle : une personne accède aux cours même avant la date de démarrage
    check(d.token, "a"); const num = String(d.num || "").toUpperCase().slice(0, 30);
    if (!d.on) { must(await db.from("formation_access").delete().eq("num", num)); return { ok: true }; }
    if (!must(await db.from("students").select("num").eq("num", num).maybeSingle())) throw E("Aucun étudiant avec ce numéro.", 404);
    must(await db.from("formation_access").upsert({ num, open_day: Math.max(1, Math.min(30, Math.round(+d.day) || 30)), note: String(d.note || "").slice(0, 200), at: Date.now() })); return { ok: true };
  },
};

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "GET") { let st = DEFAULT_START; try { st = (await fcfg(await regCohort())).start; } catch (e) { /* date par défaut */ } return res.status(200).json({ serveur: "ok", version: "promotions-2026-10-25", tfa: !!process.env.ADMIN_TOTP_SECRET, now: Date.now(), start: st }); }
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
    const out = await als.run({ ip }, () => f(d, { ip, who }));
    if (who && PERM[d.action] && !READONLY.has(d.action)) await audit(who, d);
    res.status(200).json(out);
  } catch (e) { if (!e.st || e.st >= 500) console.error(e); res.status(e.st || 500).json({ error: e.st ? e.message : "Erreur serveur. Réessayez." }); }
};
