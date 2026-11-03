-- ===== AJOUT : 1re tranche réduite (accordée par l'administrateur, étudiant par étudiant) =====
-- Un seul bloc DO = une seule commande (compatible avec les éditeurs qui refusent plusieurs commandes).
do $$
begin
  create table if not exists public.formation_t1 (
    num text primary key,          -- numéro d'attribution de l'étudiant
    t1 int not null check (t1 > 0),-- montant de sa 1re tranche (ex. 5000 au lieu de 7000)
    at bigint                      -- date d'attribution
  );
  alter table public.formation_t1 enable row level security;
  revoke all on public.formation_t1 from anon, authenticated;
end
$$;
