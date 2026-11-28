-- Rattacher un partenaire à une promotion (à exécuter une fois dans Supabase > SQL Editor)
alter table partners add column if not exists cohort int; -- vide = le partenaire voit toutes les promotions
