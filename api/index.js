const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const TOTAL = +process.env.PRIX_TOTAL || 12000;
const URL_ = () => process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY_ = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
let _db;
const E = (m, st = 400) => Object.assign(new Error(m), { st });
const db = new Proxy({}, { get: (_, k) => { if (!_db) { if (!URL_() || !KEY_()) throw E("Configuration serveur incomplète.", 500); _db = createClient(URL_(), KEY_(), { auth: { persistSession: false } }); } const v = _db[k]; return typeof v === "function" ? v.bind(_db) : v; } });
const SECRET = () => { const s = process.env.TOKEN_SECRET; if (!s || s.length < 16) throw E("Configuration serveur incomplète.", 500); return s; };
const rnd = n => { const c = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; return Array.from({ length: n }, () => c[crypto.randomInt(c.length)]).join(""); };
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
const setting = async k => { const r = must(await db.from("settings").select("value").eq("key", k).maybeSingle()); return r ? r.value : false; };
const putSetting = async (k, v) => must(await db.from("settings").upsert({ key: k, value: v }));
const COLS = "num,id,vc,nom,prenoms,dob,lieu,email,partner,status,motif,termine,date,dv,wa,phase,retire,date_retrait";
const sum = (a, st) => a.filter(x => x.st === st).reduce((t, x) => t + Number(x.amount), 0);
const pub = r => ({ num: r.num, id: r.id, vc: r.vc, nom: r.nom, prenoms: r.prenoms, dob: r.dob, lieu: r.lieu, email: r.email, partner: r.partner, status: r.status, motif: r.motif, wa: r.wa, phase: r.phase || "complet", termine: !!r.termine, retire: !!r.retire, date_retrait: r.date_retrait ? Number(r.date_retrait) : 0, date: Number(r.date), dv: r.dv ? Number(r.dv) : 0 });
const enrich = (r, pays) => { const m = pays.filter(p => p.num === r.num), paid = sum(m, "valide"), pend = sum(m, "attente"); return { ...pub(r), paid, pend, reste: Math.max(0, TOTAL - paid), solde: paid >= TOTAL, nPay: m.length }; };
// Vue partenaire : AUCUN nom, AUCUN identifiant de connexion, AUCUNE référence de transaction.
const forPartner = s => ({ num: s.num, partner: s.partner, phase: s.phase, date: s.date, paid: s.paid, pend: s.pend, reste: s.reste, solde: s.solde });
const payPart = x => ({ id: x.id, num: x.num, amount: Number(x.amount), date: Number(x.date), st: x.st, dv: x.dv ? Number(x.dv) : 0 });
const dreqPart = r => ({ id: r.id, num: r.num, partner: r.partner, st: r.st, date: Number(r.date) });
const payPub = x => ({ id: x.id, num: x.num, partner: x.partner, amount: Number(x.amount), trx: x.trx, date: Number(x.date), st: x.st, motif: x.motif, dv: x.dv ? Number(x.dv) : 0 });
const PCOLS = "id,num,partner,amount,trx,date,st,motif,dv";
const baseOf = (p, pays) => pays.filter(x => x.st === "valide" && x.partner === p.id && (!p.rompu || x.dv <= p.rompu.date)).reduce((t, x) => t + x.amount, 0);
const part = (p, withPin, pouts = [], base = 0) => ({ id: p.id, name: p.name, code: p.code, wa: p.wa || "", coef: Number(p.coef), base, paid: pouts.filter(x => x.st === "recu").reduce((a, x) => a + Number(x.amount), 0), pending: pouts.filter(x => x.st === "attente").reduce((a, x) => a + Number(x.amount), 0), rompu: p.rompu || null, pinChanged: !!p.pin_changed, ...(withPin && !p.pin_changed ? { pin: p.pin } : {}) });
const payRow = x => ({ id: x.id, partner: x.partner, amount: Number(x.amount), ref: x.ref, note: x.note, date: Number(x.date), st: x.st, date_conf: x.date_conf ? Number(x.date_conf) : 0 });
const img = s => typeof s === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(s) && s.length < 900000;
const getPartner = async id => must(await db.from("partners").select("*").eq("id", id).maybeSingle());
const findStudent = async (num, id, cols = COLS) => must(await db.from("students").select(cols).eq("num", String(num || "").toUpperCase().slice(0, 30)).eq("id", String(id || "").toUpperCase().slice(0, 12)).maybeSingle());
async function syncStatus(num) {
  const ps = must(await db.from("payments").select("amount,st").eq("num", num)), paid = sum(ps, "valide");
  const cur = must(await db.from("students").select("status").eq("num", num).maybeSingle()); if (!cur) return;
  const st = paid >= TOTAL ? "valide" : "attente";
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
const fcfg = async () => { const r = must(await db.from("formation_cfg").select("*").eq("id", 1).maybeSingle()); return { launch: r && r.launch_at ? Number(r.launch_at) : 0, adm: r ? Number(r.admin_day || 0) : 0 }; };
const schedDay = c => c.launch ? Math.min(30, Math.floor((Date.now() - c.launch) / 864e5) + 1) : 0;
const openDayOf = c => c.launch ? Math.min(30, Math.max(schedDay(c), c.adm)) : 0;
const levelOf = paid => paid >= TOTAL ? 30 : paid >= T1 ? T1_DAYS : FREE_DAYS;
const fInfo = (paid, pend, c) => { const open = openDayOf(c); return { launched: !!c.launch, openDay: open, paid, pend, level: levelOf(paid), plan: paid >= TOTAL ? "complet" : paid >= T1 ? "tranche1" : "gratuit", remaining: paid >= T1 && paid < TOTAL ? Math.max(0, T1_DAYS - open) : null, freeLeft: paid < T1 ? Math.max(0, FREE_DAYS - open) : null, T1, TOTAL, free: FREE_DAYS, t1days: T1_DAYS }; };
const passedRow = r => !!r && r.grade != null && Number(r.grade) >= PASSM;
const dayAcc = (n, fx, pm) => !fx.launched ? "start" : n > fx.level ? "pay" : n > fx.openDay ? "wait" : n > 1 && !passedRow(pm[n - 1]) ? "prev" : "ok";
const reasonOf = (a, n, fx) => a === "start" ? "La formation n'a pas encore démarré. Vous y aurez accès dès son lancement officiel."
  : a === "wait" ? "Le jour " + n + " n'est pas encore ouvert. Il s'ouvrira sur l'ordre de MK-DESIGN GRAPH."
  : a === "pay" ? (fx.paid >= T1 ? "Votre 1re tranche couvre les " + T1_DAYS + " premiers jours. Réglez la 2e tranche (" + (TOTAL - T1) + " FCFA) pour continuer." : "Les " + FREE_DAYS + " jours gratuits sont terminés. Payez " + T1 + " FCFA (jours 1 à " + T1_DAYS + ") ou " + TOTAL + " FCFA (accès complet) pour continuer.")
  : "Validez d'abord le jour précédent (14/20 minimum).";
async function fctx(d, c, key, max = 300) {
  await limit(key + ":" + c.ip, max, 900e3);
  const s = await findStudent(d.num, d.id, "num,nom,prenoms"); if (!s) throw E("Numéro ou identifiant incorrect.", 404);
  const ps = must(await db.from("payments").select("amount,st").eq("num", s.num)), fx = fInfo(sum(ps, "valide"), sum(ps, "attente"), await fcfg()), pm = {};
  must(await db.from("formation_prog").select("day,sub,grade,gp,gt,comment,att").eq("num", s.num)).forEach(r => pm[r.day] = r);
  return { s, fx, pm };
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

const A = {
  async partnerInfo({ code }) { const p = must(await db.from("partners").select("rompu").eq("code", String(code || "").toLowerCase().slice(0, 12)).maybeSingle()); return { exists: !!p, active: !!p && !p.rompu }; },
  async register(d, c) {
    await limit("rg:" + c.ip, 20, 3600e3);
    const nom = String(d.nom || "").trim(), prenoms = String(d.prenoms || "").trim();
    let wa = String(d.wa || "").replace(/\D/g, "");
    if (!nom || !prenoms) throw E("Veuillez saisir votre nom et vos prénoms.");
    if (wa.length === 8) wa = "22901" + wa; else if (wa.length === 10 && wa.startsWith("01")) wa = "229" + wa;
    if (wa.length < 10 || wa.length > 15) throw E("Numéro WhatsApp invalide. Saisissez-le avec l'indicatif, par exemple 22901XXXXXXXX.");
    if (must(await db.from("students").select("num").eq("wa", wa).limit(1)).length) throw E("Ce numéro WhatsApp est déjà inscrit. Utilisez « Mon reçu » avec votre numéro d'attribution et votre identifiant, ou contactez-nous sur WhatsApp.");
    let partner = null;
    if (d.partnerCode) { const p = must(await db.from("partners").select("id,rompu").eq("code", String(d.partnerCode).toLowerCase().slice(0, 12)).maybeSingle()); if (p && !p.rompu) partner = p.id; }
    const n = must(await db.rpc("next_num"));
    const row = { num: "FORM-2026-" + String(n).padStart(5, "0"), id: rnd(6), vc: rnd(10), nom: nom.toUpperCase().slice(0, 80), prenoms: prenoms.slice(0, 120), wa, partner, phase: "inscrit", status: "attente", termine: false, retire: false, montant: 0, date: Date.now() };
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
    const rest = TOTAL - used; if (rest <= 0) throw E("Votre formation est déjà entièrement payée.");
    if (!(used === 0 ? [TOTAL, T1] : [rest]).includes(amount)) throw E(used === 0 ? "Choisissez : " + TOTAL + " FCFA en une fois, ou " + T1 + " FCFA pour la 1re tranche (puis " + (TOTAL - T1) + " FCFA)." : "Le montant à payer est de " + rest + " FCFA.");
    if (must(await db.from("payments").select("id").eq("trx", trx).neq("st", "rejete").limit(1)).length) throw E("Cette référence de transaction a déjà été utilisée.");
    must(await db.from("payments").insert({ id: rnd(8), num: s.num, partner: s.partner, amount, trx, shot: d.shot, date: Date.now(), st: "attente" })); return { ok: true };
  },
  async receipt(d, c) {
    await limit("rc:" + c.ip, 40, 900e3);
    const r = await findStudent(d.num, d.id, COLS + ",photo");
    if (!r) throw E("Numéro ou identifiant incorrect.", 404);
    const pays = must(await db.from("payments").select("*").eq("num", r.num).order("date")).map(x => ({ ...payPub(x), shot: x.shot }));
    return { student: { ...enrich(r, pays), photo: r.photo }, pays, open: !!(await setting("open")), total: TOTAL, fx: fInfo(sum(pays, "valide"), sum(pays, "attente"), await fcfg()) };
  },
  async retrait(d, c) {
    await limit("rt:" + c.ip, 40, 900e3);
    const r = await findStudent(d.num, d.id, "num,termine,retire"); if (!r) throw E("Numéro ou identifiant incorrect.", 404);
    const paid = sum(must(await db.from("payments").select("amount,st").eq("num", r.num)), "valide");
    if (paid < TOTAL) throw E("Paiement non soldé : attestation indisponible.", 403);
    if (!r.termine || !(await setting("open"))) throw E("Votre attestation n'est pas encore disponible.", 403);
    if (!r.retire) must(await db.from("students").update({ retire: true, date_retrait: Date.now() }).eq("num", r.num));
    return { ok: true };
  },
  async verify({ vc }, c) { await limit("vf:" + c.ip, 60, 900e3); const r = must(await db.from("students").select("nom,prenoms,status,termine,retire").eq("vc", String(vc || "").toUpperCase().slice(0, 12)).maybeSingle()); return r && r.status === "valide" && r.termine ? { ok: true, prenoms: r.prenoms, nom: r.nom } : { ok: false }; },
  async adminLogin({ pw }, c) {
    await limit("al:" + c.ip, 10, 900e3);
    const a = Buffer.from(String(pw || "")), b = Buffer.from(String(process.env.ADMIN_PASSWORD || ""));
    if (!b.length || a.length !== b.length || !crypto.timingSafeEqual(a, b)) { await sleep(1000); throw E("Mot de passe incorrect.", 401); }
    return { token: sign({ r: "a", exp: Date.now() + 4 * 3600e3 }) };
  },
  async partnerLogin({ code, pin }, c) {
    await limit("pl:" + c.ip, 12, 900e3);
    const p = must(await db.from("partners").select("*").eq("code", String(code || "").trim().toLowerCase().slice(0, 12)).maybeSingle());
    const ok = p && (p.pin_changed ? same(pin, p.pin_hash) : String(pin || "").trim().toUpperCase() === String(p.pin).toUpperCase());
    if (!ok) { await sleep(1000); throw E("Code ou mot de passe incorrect.", 401); }
    if (p.rompu) throw E("Accès désactivé : le contrat avec MK-DESIGN GRAPH a pris fin.", 403);
    return { token: sign({ r: "p", pid: p.id, exp: Date.now() + 8 * 3600e3 }) };
  },
  async partnerState(d) {
    const t = check(d.token, "p"), p = await getPartner(t.pid); if (!p || p.rompu) throw E("Accès désactivé.", 401);
    const pays = must(await db.from("payments").select(PCOLS).eq("partner", p.id).order("date")).map(payPub);
    const st = must(await db.from("students").select(COLS).eq("partner", p.id).order("date")).map(r => forPartner(enrich(r, pays)));
    const dreq = must(await db.from("dreq").select("*").eq("partner", p.id).order("date", { ascending: false }));
    const pouts = must(await db.from("payouts").select("*").eq("partner", p.id).order("date", { ascending: false })).map(payRow);
    return { partner: part(p, false, pouts, baseOf(p, pays)), students: st, payments: pays.map(payPart), dreq: dreq.map(dreqPart), payouts: pouts };
  },
  async changePin(d) {
    const t = check(d.token, "p"), p = await getPartner(t.pid), nw = String(d.new || "");
    const ok = p.pin_changed ? same(d.old, p.pin_hash) : String(d.old || "").trim().toUpperCase() === String(p.pin).toUpperCase();
    if (!ok) throw E("Ancien mot de passe incorrect.", 401);
    if (nw.length < 8 || nw.length > 60) throw E("Le nouveau mot de passe doit contenir au moins 8 caractères.");
    must(await db.from("partners").update({ pin_hash: hash(nw), pin_changed: true, pin: null }).eq("id", p.id)); return { ok: true };
  },
  async answerDel(d) {
    const t = check(d.token, "p"), r = must(await db.from("dreq").select("*").eq("id", d.id).maybeSingle());
    if (!r || r.partner !== t.pid || r.st !== "attente") throw E("Demande introuvable.", 404);
    const u = must(await db.from("dreq").update({ st: d.ok ? "ok" : "non" }).eq("id", d.id).eq("st", "attente").select("id")); if (!u.length) throw E("Demande introuvable ou déjà traitée.", 404); return { ok: true };
  },
  async answerPayout(d) {
    const t = check(d.token, "p"), x = must(await db.from("payouts").select("*").eq("id", d.id).maybeSingle());
    if (!x || x.partner !== t.pid || x.st !== "attente") throw E("Versement introuvable.", 404);
    const u = must(await db.from("payouts").update({ st: d.ok ? "recu" : "non", date_conf: Date.now() }).eq("id", d.id).eq("st", "attente").select("id")); if (!u.length) throw E("Versement introuvable ou annulé.", 404); return { ok: true };
  },
  async pshot(d) { const t = check(d.token, "p"), x = must(await db.from("payments").select("partner,shot").eq("id", String(d.id || "")).maybeSingle()); if (!x || x.partner !== t.pid) throw E("Introuvable.", 404); return { data: x.shot }; },
  async adminState(d) {
    check(d.token, "a");
    const [ps, st, dq, lg, py, pm] = await Promise.all([db.from("partners").select("*").order("name"), db.from("students").select(COLS).order("date"), db.from("dreq").select("*").order("date", { ascending: false }), db.from("log").select("*").order("date", { ascending: false }).limit(100), db.from("payouts").select("*").order("date", { ascending: false }), db.from("payments").select(PCOLS).order("date", { ascending: false })]);
    const pays = must(pm).map(payPub), pouts = must(py);
    return { total: TOTAL, payments: pays, partners: must(ps).map(p => part(p, true, pouts.filter(x => x.partner === p.id).map(payRow), baseOf(p, pays))), students: must(st).map(r => enrich(r, pays)), dreq: must(dq).map(r => ({ ...r, date: Number(r.date) })), log: must(lg).map(g => ({ ...g, date: Number(g.date) })), payouts: pouts.map(payRow), open: !!(await setting("open")), prod: !!(await setting("prod")) };
  },
  async img(d) { check(d.token, "a"); const r = must(await db.from("students").select("photo").eq("num", String(d.num || "")).maybeSingle()); if (!r) throw E("Introuvable.", 404); return { data: r.photo }; },
  async pimg(d) { check(d.token, "a"); const r = must(await db.from("payments").select("shot").eq("id", String(d.id || "")).maybeSingle()); if (!r) throw E("Introuvable.", 404); return { data: r.shot }; },
  async setPayStatus(d) {
    check(d.token, "a"); if (!["attente", "valide", "rejete"].includes(d.st)) throw E("Statut invalide.");
    const x = must(await db.from("payments").select("*").eq("id", String(d.id || "")).maybeSingle()); if (!x) throw E("Paiement introuvable.", 404);
    if (d.st === "valide") { const others = must(await db.from("payments").select("id,amount,st").eq("num", x.num)).filter(p => p.id !== x.id); if (sum(others, "valide") + Number(x.amount) > TOTAL) throw E("Ce paiement dépasserait le total de " + TOTAL + " FCFA."); }
    must(await db.from("payments").update({ st: d.st, motif: d.st === "rejete" ? String(d.motif || "").slice(0, 300) : null, dv: d.st === "valide" ? Date.now() : null }).eq("id", x.id));
    await syncStatus(x.num); return { ok: true };
  },
  async addPartner(d) { check(d.token, "a"); const n = String(d.name || "").trim(); if (!n) throw E("Nom requis."); must(await db.from("partners").insert({ id: rnd(5), name: n.slice(0, 80), code: rnd(6).toLowerCase(), pin: rnd(4), coef: +d.coef || 0, paid: 0, wa: String(d.wa || "").replace(/\D/g, "").slice(0, 20) })); return { ok: true }; },
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
  async setTerm(d) { check(d.token, "a"); must(await db.from("students").update({ termine: !!d.v }).eq("num", d.num)); return { ok: true }; },
  async allTerm(d) { check(d.token, "a"); must(await db.from("students").update({ termine: true }).eq("status", "valide")); return { ok: true }; },
  async setOpen(d) { check(d.token, "a"); await putSetting("open", !!d.v); return { ok: true }; },
  async setProd(d) {
    check(d.token, "a");
    if (!d.v) { const c = must(await db.from("students").select("num").limit(1)); if (c.length) throw E("Impossible de repasser en mode test : des inscriptions existent."); }
    await putSetting("prod", !!d.v); return { ok: true };
  },
  async resetPin(d) { check(d.token, "a"); must(await db.from("partners").update({ pin: rnd(4), pin_hash: null, pin_changed: false }).eq("id", d.id)); return { ok: true }; },
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
    check(d.token, "a"); const s = must(await db.from("students").select("num,nom,prenoms,status,partner").eq("num", d.num).maybeSingle()); if (!s) throw E("Inscription introuvable.", 404);
    const prod = !!(await setting("prod")), p = s.partner ? await getPartner(s.partner) : null, label = s.nom + " " + s.prenoms;
    const remove = async how => {
      must(await db.from("payments").delete().eq("num", s.num)); must(await db.from("formation_prog").delete().eq("num", s.num)); must(await db.from("students").delete().eq("num", s.num)); must(await db.from("dreq").delete().eq("num", s.num));
      must(await db.from("log").insert({ date: Date.now(), num: s.num, nom: label, statut: s.status, partner: p ? p.name : "Direct", how })); return {};
    };
    if (!prod) return remove("Mode test");
    if (!p) return remove("Inscription directe");
    if (p.rompu) return remove("Contrat rompu");
    const r = must(await db.from("dreq").select("*").eq("num", s.num).maybeSingle());
    if (r && r.st === "ok") return remove("Autorisé par " + p.name);
    if (r && r.st === "attente") return { pending: p.name };
    if (r && r.st === "non" && !d.retry) return { refused: p.name };
    if (r) must(await db.from("dreq").update({ st: "attente", date: Date.now() }).eq("id", r.id));
    else must(await db.from("dreq").insert({ id: rnd(8), num: s.num, nom: label, partner: p.id, date: Date.now(), st: "attente" }));
    return { requested: p.name };
  },
  // ---------- Formation : étudiant ----------
  async fState(d, c) {
    const { s, fx, pm } = await fctx(d, c, "fs");
    return { num: s.num, name: s.prenoms, ...fx, days: CT.course.map(x => { const r = pm[x.n]; return { n: x.n, title: x.title, week: x.week, proj: x.proj, acc: dayAcc(x.n, fx, pm), sub: r && r.sub ? Number(r.sub) : 0, grade: r && r.grade != null ? Number(r.grade) : null, gp: r && r.gp != null ? Number(r.gp) : null, gt: r && r.gt != null ? Number(r.gt) : null }; }) };
  },
  async fDay(d, c) {
    const { s, fx, pm } = await fctx(d, c, "fd"), n = needDay(d, fx, pm), L = CT.lessons[n], Q = quizOf(n);
    const r = must(await db.from("formation_prog").select("*").eq("num", s.num).eq("day", n).maybeSingle());
    return { day: dayDef(n), lesson: L ? { parts: L.parts } : null, quiz: Q ? qpub(Q) : null, sites: CT.sites, rec: recOut(r) };
  },
  async fSave(d, c) {
    const { s, fx, pm } = await fctx(d, c, "fv", 900), n = needDay(d, fx, pm), p = pm[n];
    if (p && p.sub && (p.grade == null || passedRow(p))) throw E("Ce travail est verrouillé.", 409);
    must(await db.from("formation_prog").upsert({ num: s.num, day: n, data: cleanData(d.data || {}) })); return { ok: true };
  },
  async fCheck(d, c) {
    const { fx, pm } = await fctx(d, c, "fk"), n = needDay(d, fx, pm), Q = quizOf(n); if (!Q) throw E("Pas de questions ce jour-là.");
    const sc = qscore(n, cleanData({ qa: d.qa }).qa); return { ok: sc.ok, ex: Q.map(qexp), s: sc.s, t: sc.t, v: sc.v };
  },
  async fSubmit(d, c) {
    const { s, fx, pm } = await fctx(d, c, "fu"), n = needDay(d, fx, pm), p = pm[n];
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
  async fAdmin(d) {
    check(d.token, "a");
    const [c, rows, sts, ps] = await Promise.all([fcfg(), db.from("formation_prog").select("num,day,sub,gt,gp,grade,att").order("sub", { ascending: false }), db.from("students").select("num,nom,prenoms"), db.from("payments").select("num,amount,st")]);
    const subs = must(rows), st = must(sts), pays = must(ps), name = {}; st.forEach(x => name[x.num] = x.nom + " " + x.prenoms);
    return { cfg: { launch: c.launch, adm: c.adm, sched: schedDay(c), openDay: openDayOf(c) },
      subs: subs.filter(r => r.sub).map(r => ({ num: r.num, name: name[r.num] || r.num, day: r.day, sub: Number(r.sub), grade: r.grade == null ? null : Number(r.grade), gt: r.gt == null ? null : Number(r.gt) })),
      students: st.map(x => { const paid = sum(pays.filter(p => p.num === x.num), "valide"); return { num: x.num, name: x.nom + " " + x.prenoms, paid, level: levelOf(paid), done: subs.filter(r => r.num === x.num && passedRow(r)).length }; }) };
  },
  async fSub(d) {
    check(d.token, "a"); const n = Math.round(+d.day), x = dayDef(n), num = String(d.num || "").slice(0, 30);
    const r = must(await db.from("formation_prog").select("*").eq("num", num).eq("day", n).maybeSingle()), s = must(await db.from("students").select("nom,prenoms").eq("num", num).maybeSingle());
    if (!x || !r || !r.sub) throw E("Remise introuvable.", 404);
    const dt = r.data || {}, Q = quizOf(n), sc = Q ? qscore(n, dt.qa || {}) : null, ex = (x.s.find(z => /^Exercice/.test(z.h)) || { b: [{ i: [] }] }).b[0].i;
    return { name: s ? s.nom + " " + s.prenoms : num, n, title: x.title, exercise: ex, data: dt, sub: Number(r.sub), att: r.att || 0, gt: r.gt == null ? null : Number(r.gt), gp: r.gp == null ? null : Number(r.gp), grade: r.grade == null ? null : Number(r.grade), comment: r.comment || "",
      theory: Q ? { s: sc.s, t: sc.t, v: sc.v, items: Q.map((q, i) => ({ q: q[1], a: qans(q, (dt.qa || {})[i]), ok: sc.ok[i] })) } : null };
  },
  async fGrade(d) {
    check(d.token, "a"); const n = Math.round(+d.day), num = String(d.num || "").slice(0, 30), g = Number(d.gp);
    if (!(g >= 0 && g <= 20)) throw E("Note invalide (0 à 20).");
    const r = must(await db.from("formation_prog").select("sub,gt").eq("num", num).eq("day", n).maybeSingle()); if (!r || !r.sub) throw E("Aucune remise à noter.", 404);
    const fin = r.gt == null ? g : Math.round((g * (1 - WT) + Number(r.gt) * WT) * 10) / 10;
    must(await db.from("formation_prog").update({ gp: g, grade: fin, comment: String(d.comment || "").slice(0, 600), gat: Date.now() }).eq("num", num).eq("day", n));
    if (n === 30 && fin >= PASSM) must(await db.from("students").update({ termine: true }).eq("num", num));
    return { ok: true, grade: fin };
  },
  async fLaunch(d) {
    check(d.token, "a"); const c = await fcfg();
    if (d.reset) { must(await db.from("formation_cfg").upsert({ id: 1, launch_at: null, admin_day: 0 })); return { ok: true }; }
    if (c.launch) throw E("La formation est déjà lancée.");
    must(await db.from("formation_cfg").upsert({ id: 1, launch_at: Date.now(), admin_day: 0 })); return { ok: true };
  },
  async fSetDay(d) {
    check(d.token, "a"); const c = await fcfg(); if (!c.launch) throw E("Lancez d'abord la formation.");
    must(await db.from("formation_cfg").upsert({ id: 1, launch_at: c.launch, admin_day: Math.max(0, Math.min(30, Math.round(+d.day) || 0)) })); return { ok: true };
  },
};

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "GET") return res.status(200).json({ serveur: "ok" });
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  try {
    const origin = req.headers.origin; if (origin && new URL(origin).host !== req.headers.host) throw E("Origine non autorisée.", 403);
    if (Number(req.headers["content-length"] || 0) > 4e6) throw E("Données trop volumineuses.", 413);
    const d = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim().slice(0, 60) || "?";
    const f = Object.prototype.hasOwnProperty.call(A, d.action) && A[d.action]; if (!f) throw E("Action inconnue.");
    res.status(200).json(await f(d, { ip }));
  } catch (e) { if (!e.st || e.st >= 500) console.error(e); res.status(e.st || 500).json({ error: e.st ? e.message : "Erreur serveur. Réessayez." }); }
};
