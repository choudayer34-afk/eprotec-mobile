// Accès authentifié à la base Firebase depuis le Worker (compte de service Google).
//
// Secret requis (Cloudflare → eprotec-mobile → Settings → Variables and Secrets) :
//   FIREBASE_SERVICE_ACCOUNT = contenu complet du fichier JSON du compte de service.
// La clé n'est jamais écrite dans un fichier, ni renvoyée dans une réponse, ni affichée dans un journal.
export const URL_BASE = 'https://eprotec-favoris-default-rtdb.europe-west1.firebasedatabase.app';
const ADRESSE_JETON = 'https://oauth2.googleapis.com/token';
const PORTEE = 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email';
const MARGE_SECONDES = 300;

let jeton = null;
let expiration = 0;
let clePrivee = null;
let empreinteCle = '';

const encodeur = new TextEncoder();
const b64url = (octets) => btoa(String.fromCharCode(...new Uint8Array(octets))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function lireCompte(env) {
  const brut = env.FIREBASE_SERVICE_ACCOUNT;
  if (!brut || !String(brut).trim()) {
    const e = new Error('Secret FIREBASE_SERVICE_ACCOUNT absent');
    e.code = 'CONFIG';
    throw e;
  }
  let compte;
  try { compte = JSON.parse(brut); } catch {
    const e = new Error('Secret FIREBASE_SERVICE_ACCOUNT : JSON invalide');
    e.code = 'CONFIG';
    throw e;
  }
  if (!compte.client_email || !compte.private_key) {
    const e = new Error('Secret FIREBASE_SERVICE_ACCOUNT incomplet');
    e.code = 'CONFIG';
    throw e;
  }
  return compte;
}

async function importerCle(pem) {
  const corps = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const der = Uint8Array.from(atob(corps), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

async function obtenirJeton(env) {
  const maintenant = Math.floor(Date.now() / 1000);
  if (jeton && maintenant < expiration - MARGE_SECONDES) return jeton;

  const compte = lireCompte(env);
  if (!clePrivee || empreinteCle !== compte.private_key) {
    clePrivee = await importerCle(compte.private_key);
    empreinteCle = compte.private_key;
  }
  const entete = b64url(encodeur.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const contenu = b64url(encodeur.encode(JSON.stringify({ iss: compte.client_email, scope: PORTEE, aud: ADRESSE_JETON, iat: maintenant, exp: maintenant + 3600 })));
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', clePrivee, encodeur.encode(`${entete}.${contenu}`));
  const reponse = await fetch(ADRESSE_JETON, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${entete}.${contenu}.${b64url(signature)}`
  });
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok || !donnees.access_token) throw new Error(`Jeton Firebase refusé (${reponse.status} ${donnees.error || ''})`);
  jeton = donnees.access_token;
  expiration = maintenant + (Number(donnees.expires_in) || 3600);
  return jeton;
}

// Lecture d'un chemin de la base. `options` : chaîne de paramètres, par exemple « ?shallow=true ».
export async function lire(env, chemin, options = '') {
  const reponse = await fetch(`${URL_BASE}/${chemin}.json${options}`, { headers: { Authorization: `Bearer ${await obtenirJeton(env)}` } });
  if (!reponse.ok) throw new Error(`Firebase ${reponse.status}`);
  return reponse.json();
}
