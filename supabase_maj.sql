-- MISE À JOUR : à coller dans Supabase > SQL Editor > New query > Run
alter table students add column if not exists wa text;
alter table students add column if not exists phase text default 'complet';
alter table partners add column if not exists wa text;
create table if not exists payouts (
  id text primary key, partner text not null, amount numeric not null,
  ref text, note text, date bigint, st text default 'attente', date_conf bigint
);
alter table payouts enable row level security;
-- Repartir de zéro (efface inscriptions, demandes, historique et versements ; garde les partenaires)
truncate table students, dreq, log, payouts;
update partners set paid = 0;
alter sequence student_seq restart with 1;
