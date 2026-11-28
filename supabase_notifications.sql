-- MK-DIGIT GRAPH : notifications push (à exécuter UNE fois dans Supabase > SQL Editor)
-- Ne modifie aucune table existante.
create table if not exists push_subs (
  endpoint text primary key,          -- adresse unique du téléphone (fournie par le navigateur)
  keys jsonb not null,                -- clés de chiffrement du téléphone
  role text not null check (role in ('a','s')),  -- a = administration, s = étudiant
  ref text not null,                  -- 'root', identifiant du sous-administrateur, ou numéro de l'étudiant
  ua text,
  at bigint
);
create index if not exists push_subs_role_ref on push_subs (role, ref);
alter table push_subs enable row level security;

create table if not exists push_vapid (   -- clés du serveur, créées automatiquement au premier usage
  id int primary key,
  pub text not null,
  priv text not null
);
alter table push_vapid enable row level security;
-- Aucune règle d'accès public : seule l'API (clé service_role) lit ces tables.
