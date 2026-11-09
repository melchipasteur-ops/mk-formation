# Site unique : plusieurs formations + modules (guide de mise en ligne)

Ce dossier remplace les deux projets. C'est votre site actuel (mk-formation) auquel on a ajouté :
- le choix de la formation à l'accueil : « Création de vidéos et de sites web » ou « Informatique administrative » ;
- pour la création : le choix d'un module (vidéo = jours 1 à 14, web = jours 15 à 29) à 7 000 FCFA = 5 000 (formation) + 2 000 (attestation) ;
- pour l'administrateur : le bouton « 🎯 Parcours » sur chaque étudiant, pour choisir ou corriger sa formation / son module.

## Ordre de mise en ligne (sans rien casser)
1. **Supabase > SQL Editor** : exécutez `supabase_parcours.sql` (une seule fois). Il ajoute 3 colonnes ; les étudiants existants gardent leur formation, leurs 30 jours et leur tarif.
2. Déployez ce dossier sur le **même projet Vercel** (mêmes variables d'environnement : rien à changer).
3. Administration > Promotions > « Nouvelle promotion » : choisissez la formation **Informatique** (nom, date de début à venir, prix). Tant que cette promotion n'existe pas, le bouton Informatique reste grisé (« inscriptions bientôt ouvertes »).
4. Testez : inscrivez un compte test dans chaque module, puis changez-lui son parcours depuis l'administration.

Avant l'étape 1, le site continue de fonctionner comme avant (l'inscription classique marche, un module est refusé proprement avec un message).

## Règles appliquées
- **Module** : tarif fixe 7 000 FCFA. Paiement en une fois (7 000) ou 5 000 puis 2 000. Les 5 000 ouvrent tous les jours du module ; les 2 000 d'attestation sont requis pour retirer l'attestation. Les 2 premiers jours restent gratuits.
- **Attestation du module** : exige la validation de tous les jours du module (14 ou 15), pas 30.
- **Changement par l'administrateur** : les paiements enregistrés sont conservés ; le total à payer et les jours accessibles changent aussitôt, un message indique le reste à payer ou un éventuel trop-perçu. Changer de **formation** (création ↔ informatique) n'est permis que si l'étudiant n'a rien remis ; changer de **module** est toujours possible (les travaux déjà remis restent).
- Les étudiants actuels (sans module) ne sont pas modifiés : 30 jours, 12 000 FCFA / 7 000 en 1re tranche.
- Une promotion d'inscription ouverte **par formation** : en créer une pour l'informatique ne touche pas celle de la création.

## Réglages facultatifs (Vercel > Environment Variables)
`PRIX_MODULE_TOTAL` (défaut 7000) et `PRIX_MODULE_FORMATION` (défaut 5000). Le tarif de l'informatique se règle dans la promotion.

## Fichiers ajoutés ou modifiés
- Ajoutés : `supabase_parcours.sql`, `formation_content_informatique.json` (racine et `api/`), ce guide.
- Modifiés : `api/index.js`, `index.html`, `formation.html`.
- Inchangés : sécurité, icônes, vercel.json, manifestes, base existante.

## À savoir
- Le texte « Début de la formation : 01 novembre 2026 » du motif de paiement de la création est inchangé.
- Pour lire les cours et notes de l'informatique côté administrateur, sélectionnez une promotion informatique dans le sélecteur de promotion.

## Nouveau cours d'informatique professionnelle (60 jours, 8 modules)
- **Module 1 (jours 1–10)** Fondations : allumer l'ordinateur, bureau et icônes, fenêtres, souris/clavier, fichiers, Internet/sécurité, paramètres Windows, matériel, logiciels et formats, outils Windows + projet.
- **Module 2 (11–18)** Word · **Module 3 (19–24)** Excel · **Module 4 (25–34)** Excel données, analyse, gestion + projet · **Module 5 (35–40)** PowerPoint + projet · **Module 6 (41–43)** messagerie pro, cloud, bureautique en ligne · **Module 7 (44–50)** réseaux, sécurité, maintenance, dépannage, installation de Windows · **Module 8 (51–60)** bases de données, algorithmique, web (HTML/CSS), IA au bureau, gestion de projet, communication et éthique, emploi, projet intégré, soutenance, évaluation finale.
- Chaque jour : 20 questions théoriques (QCM, vrai/faux, réponse courte), 5 à 7 parties détaillées et illustrées (86 schémas intégrés), exercice précis, grille de notation pour le correcteur.
- La durée est propre à chaque formation : 60 jours pour l'informatique, 30 pour la création. Les tarifs (jours gratuits, jours de la 1re tranche) se règlent par promotion dans l'administration : vérifiez-les pour vos promotions d'informatique, car le parcours est passé de 30 à 60 jours. Les étudiants d'informatique déjà inscrits retrouvent le nouveau programme (la numérotation des jours a changé).
- **Remise des travaux** : zone « Remise de mon travail pratique » (Word, Excel, PowerPoint, PDF, texte, CSV, ZIP ; 6 fichiers de 15 Mo max par jour) + zone d'images.
- **Audios de l'enseignant** : en administration, dans « Audios, vidéos et images du cours », ajoutez des fichiers mp3, m4a, aac, wav, ogg (500 Mo max). Les étudiants les écoutent dans le cours du jour.
- Aucun nouveau SQL : les fichiers déposés utilisent le bucket existant `formation-media` (préfixe `docs/`).
