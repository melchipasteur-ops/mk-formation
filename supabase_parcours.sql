-- ===== PARCOURS : plusieurs formations + modules =====
-- À coller dans Supabase > SQL Editor > New query > Run (une seule fois).
-- Un seul bloc DO = une seule commande (compatible avec les éditeurs qui refusent plusieurs commandes).
-- Sans danger pour les étudiants existants : ils gardent « Création vidéo et web », les 30 jours et leur tarif.
do $$
begin
  -- Chaque étudiant a une formation et, pour « creation », un module (video ou web). Module vide = formation complète d'origine.
  alter table public.students add column if not exists formation text default 'creation';
  alter table public.students add column if not exists module text;
  update public.students set formation = 'creation' where formation is null;

  -- Chaque promotion appartient à une formation (une promotion d'inscription ouverte par formation).
  alter table public.formation_cfg add column if not exists formation text default 'creation';
  update public.formation_cfg set formation = 'creation' where formation is null;
end
$$;
-- Ensuite : Administration > Promotions, créez la première promotion « Informatique ».
