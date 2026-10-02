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
  
