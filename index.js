
Index · JS
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const URL_ = () => process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY_ = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
let _db;
const db = new Proxy({}, { get: (_, k) => { if (!_db) { if (!URL_() || !KEY_()) throw Object.assign(new Error("Configuration manquante : SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY."), { st: 500 }); _db = createClient(URL_(), KEY_(), { auth: { persistSession: false } }); } const v = _db[k]; return typeof v === "function" ? v.bind(_db) : v; } });
const SECRET = process.env.TOKEN_SECRET || process.env.ADMIN_PASSWORD || "change-me";
const E = (m, st = 400) => Object.assign(new Error(m), { st });
const rnd = n => { const c = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; return Array.from({ length: n }, () => c[crypto.randomInt(c.length)]).join(""); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mac = p => crypto.createHmac("sha256", SECRET).update(p).digest("base64url");
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
const setting = async k => { const r = must(await db.from("settings").select("value").eq("key", k).maybeSingle()); return r ? r.value : false; };
const putSetting = async (k, v) => must(await db.from("settings").upsert({ key: k, value: v }));
const pub = r => ({ num: r.num, id: r.id, vc: r.vc, nom: r.nom, prenoms: r.prenoms, dob: r.dob, lieu: r.lieu, email: r.email, montant: Number(r.montant), trx: r.trx, partner: r.partner, status: r.status, motif: r.motif, termine: !!r.termine, date: Number(r.date), dv: r.dv ? Number(r.dv) : 0 });
const COLS = "num,id,vc,nom,prenoms,dob,lieu,email,montant,trx,partner,status,motif,termine,date,dv";
const part = (p, withPin) => ({ id: p.id, name: p.name, code: p.code, coef: Number(p.coef), paid: Number(p.paid), rompu: p.rompu || null, pinChanged: !!p.pin_changed, ...(withPin && !p.pin_changed ? { pin: p.pin } : {}) });
const img = s => typeof s === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(s) && s.length < 900000;
const getPartner = async id => must(await db.from("partners").select("*").eq("id", id).maybeSingle());
 
const A = {
  async partnerInfo({ code }) { const p = must(await db.from("partners").select("rompu").eq("code", String(code || "").toLowerCase()).maybeSingle()); return { exists: !!p, active: !!p && !p.rompu }; },
  async register(d) {
    const nom = String(d.nom || "").trim(), prenoms = String(d.prenoms || "").trim();
    if (!nom || !prenoms || !d.dob || !String(d.lieu || "").trim() || !/^\S+@\S+\.\S+$/.test(d.email || "") || !(+d.montant > 0) || !String(d.trx || "").trim()) throw E("Veuillez remplir tous les champs correctement.");
    if (!img(d.photo) || !img(d.shot)) throw E("Photo ou capture invalide (image trop lourde ou format non pris en charge).");
    let partner = null;
    if (d.partnerCode) { const p = must(await db.from("partners").select("id,rompu").eq("code", String(d.partnerCode).toLowerCase()).maybeSingle()); if (p && !p.rompu) partner = p.id; }
    const n = must(await db.rpc("next_num"));
    const row = { num: "FORM-2026-" + String(n).padStart(5, "0"), id: rnd(6), vc: rnd(10), nom: nom.toUpperCase().slice(0, 80), prenoms: prenoms.slice(0, 120), dob: String(d.dob).slice(0, 10), lieu: String(d.lieu).trim().slice(0, 100), email: String(d.email).trim().slice(0, 120), montant: +d.montant, trx: String(d.trx).trim().toUpperCase().slice(0, 60), partner, status: "attente", termine: false, date: Date.now(), photo: d.photo, shot: d.shot };
    must(await db.from("students").insert(row)); return { num: row.num, id: row.id };
  },
  async receipt({ num, id }) {
    const r = must(await db.from("students").select(COLS + ",photo").eq("num", String(num || "").toUpperCase()).eq("id", String(id || "").toUpperCase()).maybeSingle());
    if (!r) throw E("Numéro ou identifiant incorrect.", 404);
    return { student: { ...pub(r), photo: r.photo }, open: !!(await setting("open")) };
  },
  async verify({ vc }) { const r = must(await db.from("students").select("nom,prenoms,status,termine").eq("vc", String(vc || "").toUpperCase()).maybeSingle()); return r && r.status === "valide" && r.termine ? { ok: true, prenoms: r.prenoms, nom: r.nom } : { ok: false }; },
  async adminLogin({ pw }) {
    const a = Buffer.from(String(pw || "")), b = Buffer.from(String(process.env.ADMIN_PASSWORD || ""));
    if (!b.length || a.length !== b.length || !crypto.timingSafeEqual(a, b)) { await sleep(800); throw E("Mot de passe incorrect.", 401); }
    return { token: sign({ r: "a", exp: Date.now() + 12 * 3600e3 }) };
  },
  async partnerLogin({ code, pin }) {
    const p = must(await db.from("partners").select("*").eq("code", String(code || "").trim().toLowerCase()).maybeSingle());
    const ok = p && (p.pin_changed ? same(pin, p.pin_hash) : String(pin || "").trim().toUpperCase() === String(p.pin).toUpperCase());
    if (!ok) { await sleep(800); throw E("Code ou mot de passe incorrect.", 401); }
    if (p.rompu) throw E("Accès désactivé : le contrat avec MK-DESIGN GRAPH a pris fin.", 403);
    return { token: sign({ r: "p", pid: p.id, exp: Date.now() + 12 * 3600e3 }) };
  },
  async partnerState(d) {
    const t = check(d.token, "p"), p = await getPartner(t.pid); if (!p || p.rompu) throw E("Accès désactivé.", 401);
    const st = must(await db.from("students").select(COLS).eq("partner", p.id).order("date"));
    const dreq = must(await db.from("dreq").select("*").eq("partner", p.id).order("date", { ascending: false }));
    return { partner: part(p), students: st.map(pub), dreq: dreq.map(r => ({ ...r, date: Number(r.date) })) };
  },
  async changePin(d) {
    const t = check(d.token, "p"), p = await getPartner(t.pid), nw = String(d.new || "");
    const ok = p.pin_changed ? same(d.old, p.pin_hash) : String(d.old || "").trim().toUpperCase() === String(p.pin).toUpperCase();
    if (!ok) throw E("Ancien mot de passe incorrect.", 401);
    if (nw.length < 6 || nw.length > 60) throw E("Le nouveau mot de passe doit contenir au moins 6 caractères.");
    must(await db.from("partners").update({ pin_hash: hash(nw), pin_changed: true, pin: null }).eq("id", p.id)); return { ok: true };
  },
  async answerDel(d) {
    const t = check(d.token, "p"), r = must(await db.from("dreq").select("*").eq("id", d.id).maybeSingle());
    if (!r || r.partner !== t.pid || r.st !== "attente") throw E("Demande introuvable.", 404);
    must(await db.from("dreq").update({ st: d.ok ? "ok" : "non" }).eq("id", d.id)); return { ok: true };
  },
  async adminState(d) {
    check(d.token, "a");
    const [ps, st, dq, lg] = await Promise.all([db.from("partners").select("*").order("name"), db.from("students").select(COLS).order("date"), db.from("dreq").select("*").order("date", { ascending: false }), db.from("log").select("*").order("date", { ascending: false }).limit(100)]);
    return { partners: must(ps).map(p => part(p, true)), students: must(st).map(pub), dreq: must(dq).map(r => ({ ...r, date: Number(r.date) })), log: must(lg).map(g => ({ ...g, date: Number(g.date) })), open: !!(await setting("open")), prod: !!(await setting("prod")) };
  },
  async img(d) { check(d.token, "a"); if (!["shot", "photo"].includes(d.field)) throw E("Champ invalide."); const r = must(await db.from("students").select(d.field).eq("num", d.num).maybeSingle()); if (!r) throw E("Introuvable.", 404); return { data: r[d.field] }; },
  async addPartner(d) { check(d.token, "a"); const n = String(d.name || "").trim(); if (!n) throw E("Nom requis."); must(await db.from("partners").insert({ id: rnd(5), name: n.slice(0, 80), code: rnd(6).toLowerCase(), pin: rnd(4), coef: +d.coef || 0, paid: 0 })); return { ok: true }; },
  async setCoef(d) { check(d.token, "a"); must(await db.from("partners").update({ coef: +d.v || 0 }).eq("id", d.id)); return { ok: true }; },
  async setPaid(d) { check(d.token, "a"); must(await db.from("partners").update({ paid: +d.v || 0 }).eq("id", d.id)); return { ok: true }; },
  async setTerm(d) { check(d.token, "a"); must(await db.from("students").update({ termine: !!d.v }).eq("num", d.num)); return { ok: true }; },
  async allTerm(d) { check(d.token, "a"); must(await db.from("students").update({ termine: true }).eq("status", "valide")); return { ok: true }; },
  async setOpen(d) { check(d.token, "a"); await putSetting("open", !!d.v); return { ok: true }; },
  async setProd(d) {
    check(d.token, "a");
    if (!d.v) { const c = must(await db.from("students").select("num").limit(1)); if (c.length) throw E("Impossible de repasser en mode test : des inscriptions existent."); }
    await putSetting("prod", !!d.v); return { ok: true };
  },
  async setStatus(d) {
    check(d.token, "a"); if (!["attente", "valide", "rejete"].includes(d.st)) throw E("Statut invalide.");
    must(await db.from("students").update({ status: d.st, motif: d.st === "rejete" ? String(d.motif || "").slice(0, 300) : null, dv: d.st === "valide" ? Date.now() : null }).eq("num", d.num)); return { ok: true };
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
    must(await db.from("students").delete().neq("num", "")); must(await db.from("dreq").delete().neq("id", "")); return { ok: true };
  },
  async delStudent(d) {
    check(d.token, "a"); const s = must(await db.from("students").select("num,nom,prenoms,status,partner").eq("num", d.num).maybeSingle()); if (!s) throw E("Inscription introuvable.", 404);
    const prod = !!(await setting("prod")), p = s.partner ? await getPartner(s.partner) : null, label = s.nom + " " + s.prenoms;
    const remove = async how => {
      must(await db.from("students").delete().eq("num", s.num)); must(await db.from("dreq").delete().eq("num", s.num));
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
};
 
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    let tables = "non testé";
    try { const r = await db.from("settings").select("key").limit(1); tables = r.error ? "ERREUR : " + r.error.message : "ok"; } catch (e) { tables = "ERREUR : " + e.message; }
    return res.status(200).json({ serveur: "ok", SUPABASE_URL: !!URL_(), SUPABASE_SERVICE_ROLE_KEY: !!KEY_(), ADMIN_PASSWORD: !!process.env.ADMIN_PASSWORD, TOKEN_SECRET: !!process.env.TOKEN_SECRET, tables });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  let d = {};
  try { d = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}; } catch (e) { return res.status(400).json({ error: "Requête invalide." }); }
  try { const f = Object.prototype.hasOwnProperty.call(A, d.action) && A[d.action]; if (!f) throw E("Action inconnue."); res.status(200).json(await f(d)); }
  catch (e) { console.error(e); res.status(e.st || 500).json({ error: e.st ? e.message : "Erreur serveur : " + (e.message || "inconnue") }); }
};
 
