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
