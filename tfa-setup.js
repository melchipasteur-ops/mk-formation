// Génère la clé de double vérification de l'administrateur principal.
// Utilisation : node tfa-setup.js
const crypto = require("crypto");
const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
let bits = "", secret = "";
for (const b of crypto.randomBytes(20)) bits += b.toString(2).padStart(8, "0");
for (let i = 0; i < bits.length; i += 5) secret += A[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
const uri = "otpauth://totp/MK-DESIGN%20GRAPH:Administrateur?secret=" + secret + "&issuer=MK-DESIGN%20GRAPH&digits=6&period=30";
console.log("\n1) Ouvrez Google Authenticator (ou Authy, Microsoft Authenticator) > + > « Saisir une clé de configuration »");
console.log("   Nom du compte : MK-DESIGN GRAPH      Clé : " + secret + "      Type : basé sur l'heure\n");
console.log("2) Dans Vercel > Settings > Environment Variables, créez :");
console.log("   ADMIN_TOTP_SECRET = " + secret + "\n");
console.log("3) Redéployez. À la connexion administrateur, entrez aussi le code à 6 chiffres affiché dans l'application.\n");
console.log("(Lien pour les applications compatibles : " + uri + ")\n");
console.log("⚠️  Gardez cette clé secrète. Si vous perdez votre téléphone, supprimez la variable ADMIN_TOTP_SECRET dans Vercel pour désactiver la double vérification.\n");
