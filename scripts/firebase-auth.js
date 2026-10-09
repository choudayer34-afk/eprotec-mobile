// Accès authentifié à Firebase pour les programmes GitHub Actions (compte de service).
//
// Fonctionnement : ce fichier est chargé AVANT les scripts (option « node --import »).
// Il ajoute automatiquement l'en-tête d'authentification aux appels destinés à la base
// Firebase eprotec-favoris, et UNIQUEMENT à ceux-là : aucun autre site ne reçoit le jeton.
// Les scripts check-events.js et send-notifications.js n'ont donc pas à être modifiés.
//
// Secret requis (GitHub → Settings → Secrets and variables → Actions) :
//   FIREBASE_SERVICE_ACCOUNT = contenu complet du fichier JSON du compte de service.
// La clé n'est jamais écrite dans un fichier ni dans le journal.
import { createSign } from 'node:crypto';

const HOTE_BASE = 'eprotec-favoris-default-rtdb.europe-west1.firebasedatabase.app';
const ADRESSE_JETON = 'https://oauth2.googleapis.com/token';
const PORTEE = 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email';
const MARGE_SECONDES = 300; // on renouvelle le jeton 5 minutes avant son expiration

const fetchOrigine = globalThis.fetch.bind(globalThis);
const brut = process.env.FIREBASE_SERVICE_ACCOUNT;

const base64url = (donnees) => Buffer.from(donnees).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

if (!brut || !brut.trim()) {
  console.warn("⚠️ FIREBASE_SERVICE_ACCOUNT absent : les appels Firebase partent SANS authentification (acceptable uniquement tant que les règles de la base sont ouvertes).");
} else {
  let compte;
  try {
    compte = JSON.parse(brut);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT n'est pas un JSON valide : colle le contenu complet du fichier téléchargé depuis Google Cloud.");
  }
  if (!compte.client_email || !compte.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT incomplet : les champs client_email et private_key sont obligatoires.");
  }

  let jeton = null;
  let expiration = 0; // en secondes depuis 1970

  async function obtenirJeton() {
    const maintenant = Math.floor(Date.now() / 1000);
    if (jeton && maintenant < expiration - MARGE_SECONDES) return jeton;

    const entete = { alg: 'RS256', typ: 'JWT' };
    const contenu = { iss: compte.client_email, scope: PORTEE, aud: ADRESSE_JETON, iat: maintenant, exp: maintenant + 3600 };
    const aSigner = `${base64url(JSON.stringify(entete))}.${base64url(JSON.stringify(contenu))}`;
    const signataire = createSign('RSA-SHA256');
    signataire.update(aSigner);
    signataire.end();
    const assertion = `${aSigner}.${base64url(signataire.sign(compte.private_key))}`;

    const reponse = await fetchOrigine(ADRESSE_JETON, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}`
    });
    const donnees = await reponse.json().catch(() => ({}));
    if (!reponse.ok || !donnees.access_token) {
      // On n'affiche que le code d'erreur renvoyé par Google, jamais la clé.
      throw new Error(`Jeton Firebase refusé (${reponse.status} ${donnees.error || ''}). Vérifie le secret FIREBASE_SERVICE_ACCOUNT.`);
    }
    jeton = donnees.access_token;
    expiration = maintenant + (Number(donnees.expires_in) || 3600);
    return jeton;
  }

  globalThis.fetch = async (entree, init = {}) => {
    let hote = '';
    try { hote = new URL(typeof entree === 'string' || entree instanceof URL ? entree : entree.url).hostname; } catch { /* adresse invalide : on laisse passer */ }
    if (hote !== HOTE_BASE || entree instanceof Request) return fetchOrigine(entree, init);
    const entetes = new Headers(init.headers || {});
    if (!entetes.has('Authorization')) entetes.set('Authorization', `Bearer ${await obtenirJeton()}`);
    return fetchOrigine(entree, { ...init, headers: entetes });
  };

  console.log('🔐 Accès Firebase authentifié (compte de service).');
}
