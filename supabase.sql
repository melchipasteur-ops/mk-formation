-- À coller dans Supabase > SQL Editor > New query > Run
create table if not exists settings (key text primary key, value jsonb not null);
insert into settings (key, value) values ('open','false'), ('prod','false') on conflict do nothing;

create table if not exists partners (
  id text primary key, name text not null, code text unique not null,
  pin text, pin_hash text, pin_changed boolean default false,
  coef numeric default 0, paid numeric default 0, rompu jsonb
);
create table if not exists students (
  num text primary key, id text not null, vc text unique not null,
  nom text, prenoms text, dob text, lieu text, email text,
  montant numeric, trx text, partner text, status text default 'attente',
  motif text, termine boolean default false,
  date bigint, dv bigint, photo text, shot text
);
create table if not exists dreq (
  id text primary key, num text, nom text, partner text, date bigint, st text default 'attente'
);
create table if not exists log (
  id bigserial primary key, date bigint, num text, nom text, statut text, partner text, how text
);
create sequence if not exists student_seq;
create or replace function next_num() returns bigint language sql as $$ select nextval('student_seq') $$;

-- Sécurité : personne ne lit les tables sans passer par le serveur
alter table settings enable row level security;
alter table partners enable row level security;
alter table students enable row level security;
alter table dreq enable row level security;
alter table log enable row level security;
