# Notifications sur le téléphone (guide de mise en ligne)

Cette mise à jour ajoute les **notifications push**. Elles arrivent sur le téléphone même quand l'application est fermée, comme un message WhatsApp.

## Ordre de mise en ligne (sans rien casser)
1. **Supabase > SQL Editor** : exécutez `supabase_notifications.sql` (une seule fois). Il crée 2 nouvelles tables et ne touche à aucune table existante.
2. Déployez ce dossier sur le **même projet Vercel**. Vercel installe tout seul le module `web-push`, déjà ajouté dans `package.json`.
3. Aucune variable à ajouter : les clés de notification sont créées automatiquement au premier usage et gardées dans Supabase.
4. Testez :
   - Ouvrez l'administration sur votre téléphone, depuis l'application installée.
   - Touchez **🔔 Activer les notifications** en bas à gauche, puis **Autoriser**.
   - Touchez de nouveau 🔔, puis **Envoyer un essai**.

Avant l'étape 1, le site continue de fonctionner comme avant. Le bouton 🔔 affiche alors un message qui demande d'exécuter le fichier SQL.

## Qui reçoit quoi
**Vous (administration)**
- 🆕 Nouvelle inscription
- 📋 Dossier complété (informations + photo)
- 💰 Paiement à valider, ou capture de paiement renvoyée
- 📝 Nouveau travail à corriger
- 🎓 Attestation retirée
- 🤝 Réponse d'un partenaire : demande de suppression, versement confirmé ou contesté

Un sous-administrateur ne reçoit que ce que ses droits lui permettent de voir :
- « Corriger les travaux » → les travaux à corriger ;
- « Paiements » → les paiements ;
- « Tableau de bord » → les inscriptions et les dossiers ;
- « Attestations » → les retraits ;
- « Partenaires » → les réponses des partenaires.

**Les étudiants**
- ✍️ Travail corrigé, avec la note et un lien direct vers la fiche de correction (aussi pour les corrections groupées)
- ✅ Paiement validé, ⚠️ refusé (avec le motif) ou annulé
- 🚀 Formation ouverte, puis 📚 nouveau jour de cours ouvert (toute la promotion)
- 🔓 Accès individuel ouvert
- 🎓 Retrait des attestations ouvert (étudiants ayant terminé)
- 📣 Vos messages libres

## Message libre à tous les étudiants
Dans l'administration, touchez 🔔 (bouton vert) puis **Message aux étudiants**. Vous écrivez un titre et un texte de 240 caractères maximum, puis **Envoyer**. Le panneau affiche le nombre de téléphones abonnés. Cette fonction est réservée à l'administrateur principal.

## Bon à savoir
- **Android** : fonctionne dans Chrome et dans l'application installée.
- **iPhone** : fonctionne uniquement dans l'application ajoutée à l'écran d'accueil (iOS 16.4 ou plus récent). Dans Safari, le bouton 🔔 explique comment faire.
- Chaque personne doit toucher **Activer** une fois sur chaque téléphone.
- Les étudiants voient le bouton dès qu'ils sont connectés, sur l'espace formation ou sur « Mon reçu ».
- Un téléphone désinstallé ou désabonné est retiré automatiquement de la liste.
- Une notification ne bloque jamais une action : si l'envoi échoue, l'inscription, la note ou le paiement sont quand même enregistrés.

## Réglages facultatifs (Vercel > Environment Variables)
- `VAPID_SUBJECT` : votre adresse de contact, par exemple `mailto:vous@exemple.com`.
- `VAPID_PUBLIC_KEY` et `VAPID_PRIVATE_KEY` : à définir seulement si vous voulez gérer vous-même les clés. Si vous les changez plus tard, chacun devra réactiver les notifications.

## Fichiers ajoutés ou modifiés
- **Ajoutés** :
  - `push.js` (le bouton 🔔) ;
  - `supabase_notifications.sql` ;
  - ce guide.
- **Modifiés** :
  - `api/index.js` (envoi des notifications et 6 nouvelles actions `push…`) ;
  - `sw.js` (affichage des notifications) ;
  - `index.html` et `formation.html` (une ligne chacun pour charger `push.js`) ;
  - `package.json` (module `web-push`) ;
  - `vercel.json` (pas de cache pour `push.js`).
- **Inchangés** : sécurité, base existante, icônes, manifestes.
