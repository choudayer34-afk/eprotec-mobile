// Vérification de l'identité Cloudflare Access.
//
// Cloudflare Access ajoute à chaque requête autorisée un jeton signé (en-tête Cf-Access-Jwt-Assertion).
// On ne fait JAMAIS confiance à l'adresse e-mail seule : on vérifie la signature du jeton avec les clés
// publiques de Cloudflare, l'émetteur (iss), l'application visée (aud) et la date d'expiration.
//
// Variables de configuration (wrangler.jsonc, ce ne sont pas des secrets) :
//   CF_ACCESS_TEAM_DOMAIN : domaine d'équipe, de la forme xxx.cloudflareaccess.com
//   CF_ACCESS_AUD         : « Application Audience (AUD) Tag » de l'application Access
const DUREE_CACHE_CLES_MS = 60 * 60 * 1000;
let cache = { domaine: '', cles: null, expire: 0 };

const decoder = new TextDecoder();
function b64uVersOctets(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
const b64uVersJson = (s) => JSON.parse(decoder.decode(b64uVersOctets(s)));

function erreurConfig(message) {
  const e = new Error(message);
  e.code = 'CONFIG';
  return e;
}

export function lireConfig(env) {
  const domaine = String(env.CF_ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/+$/, '').trim();
  const aud = String(env.CF_ACCESS_AUD || '').trim();
  if (!domaine || !aud || domaine.includes('A_REMPLACER') || aud.includes('A_REMPLACER')) {
    throw erreurConfig('CF_ACCESS_TEAM_DOMAIN et CF_ACCESS_AUD doivent être renseignés dans wrangler.jsonc');
  }
  return { domaine, aud };
}

async function chargerCles(domaine, forcer) {
  if (!forcer && cache.cles && cache.domaine === domaine && Date.now() < cache.expire) return cache.cles;
  const reponse = await fetch(`https://${domaine}/cdn-cgi/access/certs`);
  if (!reponse.ok) throw new Error(`Clés Cloudflare Access indisponibles (${reponse.status})`);
  const { keys } = await reponse.json();
  cache = { domaine, cles: keys || [], expire: Date.now() + DUREE_CACHE_CLES_MS };
  return cache.cles;
}

// Renvoie { email } si le jeton est valide, sinon null. Lève une erreur de code CONFIG si la configuration est incomplète.
export async function identite(requete, env) {
  const { domaine, aud } = lireConfig(env);
  const jeton = requete.headers.get('Cf-Access-Jwt-Assertion');
  if (!jeton) return null;
  const parties = jeton.split('.');
  if (parties.length !== 3) return null;

  let entete, contenu;
  try {
    entete = b64uVersJson(parties[0]);
    contenu = b64uVersJson(parties[1]);
  } catch {
    return null;
  }
  if (entete.alg !== 'RS256' || !entete.kid) return null;

  let cles = await chargerCles(domaine, false);
  let jwk = cles.find((k) => k.kid === entete.kid);
  if (!jwk) {
    cles = await chargerCles(domaine, true); // rotation possible des clés : une seule nouvelle tentative
    jwk = cles.find((k) => k.kid === entete.kid);
  }
  if (!jwk) return null;

  let valide = false;
  try {
    const cle = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    valide = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cle, b64uVersOctets(parties[2]), new TextEncoder().encode(`${parties[0]}.${parties[1]}`));
  } catch {
    return null;
  }
  if (!valide) return null;

  const maintenant = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(contenu.aud) ? contenu.aud : [contenu.aud];
  if (contenu.iss !== `https://${domaine}`) return null;
  if (!audiences.includes(aud)) return null;
  if (typeof contenu.exp !== 'number' || contenu.exp <= maintenant) return null;
  if (typeof contenu.nbf === 'number' && contenu.nbf > maintenant + 60) return null;
  if (typeof contenu.email !== 'string' || !contenu.email) return null;
  return { email: contenu.email };
}
