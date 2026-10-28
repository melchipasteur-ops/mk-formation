-- FORMATION EN LIGNE : démarrage, ouverture des jours, travaux et notes
-- À coller dans Supabase > SQL Editor > New query > Run (une seule fois)
create table if not exists formation_cfg (
  id int primary key,
  launch_at bigint,            -- date du lancement officiel (vide = pas encore démarré)
  admin_day int default 0      -- jour ouvert à l'avance par l'administrateur
);
insert into formation_cfg (id, launch_at, admin_day) values (1, null, 0) on conflict do nothing;

create table if not exists formation_prog (
  num text not null,           -- numéro d'attribution de l'étudiant
  day int not null,            -- jour de la formation (1 à 30)
  data jsonb default '{}'::jsonb,  -- étapes cochées, code, capture, réponses aux questions
  sub bigint,                  -- date de remise
  gt numeric,                  -- note de théorie (automatique, /20)
  gp numeric,                  -- note pratique (donnée par l'administrateur, /20)
  grade numeric,               -- note finale (/20)
  comment text,
  att int default 0,           -- nombre de remises
  gat bigint,                  -- date de notation
  primary key (num, day)
);
create index if not exists formation_prog_num on formation_prog(num);

-- Sécurité : aucune lecture directe, tout passe par le serveur
alter table formation_cfg enable row level security;
alter table formation_prog enable row level security;
revoke all on formation_cfg from anon, authenticated;
revoke all on formation_prog from anon, authenticated;

-- ===== AJOUT : accès offerts (confidentiel) et notes du professeur =====
create table if not exists formation_free (
  num text primary key,        -- étudiant qui bénéficie d'un accès gratuit (invisible pour les autres)
  note text,
  at bigint
);
create table if not exists formation_notes (
  day int primary key,         -- vos notes personnelles de professeur pour chaque jour
  note text
);
alter table formation_free enable row level security;
alter table formation_notes enable row level security;
revoke all on formation_free from anon, authenticated;
revoke all on formation_notes from anon, authenticated;

-- ===== AJOUT SÉCURITÉ : administrateurs avec droits précis + journal des actions =====
create table if not exists admins (
  id text primary key,
  login text unique not null,          -- identifiant de connexion
  name text not null,
  perms jsonb default '[]'::jsonb,     -- droits accordés par l'administrateur principal
  active boolean default true,
  pass_hash text,                      -- mot de passe haché (jamais en clair)
  must_change boolean default true,    -- doit changer son mot de passe provisoire
  last_login bigint,
  created bigint
);
create table if not exists admin_audit (
  id bigint generated always as identity primary key,
  at bigint,
  who text,
  action text,
  target text
);
alter table admins enable row level security;
alter table admin_audit enable row level security;
revoke all on admins from anon, authenticated;
revoke all on admin_audit from anon, authenticated;

-- ===== AJOUT : démarrage automatique le 1er novembre + ouverture individuelle =====
alter table formation_cfg add column if not exists start_at bigint;   -- date de démarrage automatique (vide = 1er novembre 2026)
create table if not exists formation_access (
  num text primary key,        -- étudiant à qui vous ouvrez les cours à l'avance
  open_day int default 30,     -- jusqu'à quel jour
  note text,
  at bigint
);
alter table formation_access enable row level security;
revoke all on formation_access from anon, authenticated;

-- ===== AJOUT : confirmation de l'inscription par téléphone (Oui / Non) =====
alter table students add column if not exists conf text;       -- 'oui', 'non' ou vide (pas encore appelé)
alter table students add column if not exists conf_at bigint;  -- date de l'appel
alter table students add column if not exists conf_by text;    -- qui a appelé

-- ===== AJOUT : offres (montant offert, le reste se paie en une seule fois) =====
create table if not exists offers (
  num text primary key,        -- étudiant concerné
  amount int not null,         -- montant offert en FCFA (le total à payer = prix total - amount)
  at bigint
);
alter table offers enable row level security;
revoke all on offers from anon, authenticated;

-- ===== AJOUT : un seul compte par numéro WhatsApp (verrou contre les doublons) =====
-- Si cette commande échoue, des doublons existent déjà : listez-les avec
--   select wa, count(*) from students group by wa having count(*) > 1;
create unique index if not exists students_wa_uniq on students(wa);

-- ===== AJOUT : promotions (un nouveau mois de formation sans toucher aux étudiants en cours) =====
-- Chaque ligne de formation_cfg = une promotion. La ligne 1 = la formation actuelle.
alter table formation_cfg add column if not exists name text;
alter table formation_cfg add column if not exists registering boolean default false;  -- promotion dans laquelle les nouveaux s'inscrivent
alter table formation_cfg add column if not exists created bigint;
update formation_cfg set name = 'Promotion 1' where id = 1 and name is null;
update formation_cfg set registering = true where id = 1 and not exists (select 1 from formation_cfg where registering = true);
alter table students add column if not exists cohort int default 1;   -- promotion de l'étudiant
update students set cohort = 1 where cohort is null;

-- ===== AJOUT : tarification par promotion (prix, tranche, jours gratuits) =====
-- Laisser vide = valeurs d'origine (12 000 / 7 000 / 2 jours / 10 jours).
alter table formation_cfg add column if not exists price int;       -- prix total en FCFA
alter table formation_cfg add column if not exists t1 int;          -- 1re tranche (0 = paiement en une seule fois)
alter table formation_cfg add column if not exists free_days int;   -- jours gratuits avant paiement
alter table formation_cfg add column if not exists t1_days int;     -- jours couverts par la 1re tranche

-- ===== AJOUT : civilité de l'étudiant (M., Mme, Mlle) imprimée sur l'attestation =====
alter table students add column if not exists civ text;
