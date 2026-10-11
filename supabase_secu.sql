-- MISE À JOUR SÉCURITÉ + PAIEMENT PAR TRANCHES
-- À coller dans Supabase > SQL Editor > New query > Run
create table if not exists payments (
  id text primary key, num text not null, partner text, amount numeric not null,
  trx text, shot text, date bigint, st text default 'attente', motif text, dv bigint
);
create index if not exists payments_num on payments(num);
create index if not exists payments_partner on payments(partner);
create index if not exists payments_trx on payments(trx);
create table if not exists rate (k text primary key, n int, t bigint);
alter table students add column if not exists retire boolean default false;
alter table students add column if not exists date_retrait bigint;

-- Reprise des anciens paiements uniques (s'il y en a)
insert into payments (id, num, partner, amount, trx, shot, date, st, dv)
select 'M' || num, num, partner, montant, trx, shot, date, status, dv
from students where phase = 'complet' and coalesce(montant,0) > 0
on conflict do nothing;

-- Sécurité : aucune table lisible sans passer par le serveur
alter table payments enable row level security;
alter table rate enable row level security;
alter table settings enable row level security;
alter table partners enable row level security;
alter table students enable row level security;
alter table dreq enable row level security;
alter table log enable row level security;
alter table payouts enable row level security;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
