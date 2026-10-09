// Routes /api/push/* : gestion des appareils qui reçoivent les rappels, et envoi des messages (notifications, ntfy).
//
// Stockage dans la base Firebase, hors de « users » (qui reste lisible par tous tant que les règles ne sont pas durcies) :
//   notifs/{uid}/appareils/{appareil}  → un appareil (canal « push », abonnement chiffré) ou « ntfy » (sujet personnel)
// Seul le Worker (compte de service) peut lire et écrire ce chemin : les règles Firebase le laissent fermé.
import { identite } from './acces.js';
import { lire, ecrire, supprimer } from './firebase.js';
import { envoyer, adresseAbonnementValide, clesVapidConfigurees } from './push.js';
import { json } from './http.js';

const MAX_APPAREILS = 5;
const ID_APPAREIL = /^[a-z0-9]{8,32}$/;
const ID_NTFY = 'ntfy';
const CLES_RAPPELS = ['veille', 'jourJ', 'suggestions', 'nouveautes'];
export const RAPPELS_DEFAUT = { veille: true, jourJ: true, suggestions: true, nouveautes: true };
export const HEURE_DEFAUT = 19;
export const HEURE_MATIN_DEFAUT = 7;

// Même transformation que dans l'application (sanitizeUid) : l'identifiant d'un utilisateur est son e-mail nettoyé.
export const uidDepuisEmail = (email) => email.replace(/[.#$\[\]@]/g, '_');

const entierHeure = (v) => Number.isInteger(v) && v >= 0 && v <= 23;

function origineValide(requete) {
  const origine = requete.headers.get('Origin');
  return origine !== null && origine === new URL(requete.url).origin;
}

async function utilisateur(requete, env) {
  let moi;
  try {
    moi = await identite(requete, env);
  } catch {
    return { reponse: json({ erreur: 'Identité indisponible ou configuration incomplète' }, 503) };
  }
  if (!moi) return { reponse: json({ erreur: 'Non authentifié' }, 401) };
  const admin = env.ADMIN_EMAIL && moi.email.toLowerCase() === String(env.ADMIN_EMAIL).toLowerCase();
  if (String(env.NOTIFS_OUVERTES_A_TOUS).toLowerCase() !== 'true' && !admin) {
    return { reponse: json({ erreur: "Fonction pas encore ouverte à ton compte" }, 403) };
  }
  return { uid: uidDepuisEmail(moi.email), email: moi.email };
}

async function lireCorps(requete) {
  if (Number(requete.headers.get('Content-Length') || 0) > 8192) return null;
  try {
    const corps = await requete.json();
    return corps && typeof corps === 'object' && !Array.isArray(corps) ? corps : null;
  } catch {
    return null;
  }
}

// Valide les réglages envoyés par l'application ; renvoie { valeurs } ou { erreur }.
export function validerReglages(corps, existant = {}) {
  const valeurs = {};
  if (corps.heure !== undefined) {
    if (!entierHeure(corps.heure)) return { erreur: "Heure d'envoi du soir invalide" };
    valeurs.heure = corps.heure;
  }
  if (corps.heureMatin !== undefined) {
    if (!entierHeure(corps.heureMatin)) return { erreur: "Heure d'envoi du matin invalide" };
    valeurs.heureMatin = corps.heureMatin;
  }
  if (corps.actif !== undefined) {
    if (typeof corps.actif !== 'boolean') return { erreur: 'Valeur « actif » invalide' };
    valeurs.actif = corps.actif;
  }
  if (corps.rappels !== undefined) {
    const r = corps.rappels;
    if (!r || typeof r !== 'object' || Array.isArray(r)) return { erreur: 'Choix de rappels invalide' };
    const fusion = { ...RAPPELS_DEFAUT, ...(existant.rappels || {}) };
    for (const [cle, valeur] of Object.entries(r)) {
      if (!CLES_RAPPELS.includes(cle) || typeof valeur !== 'boolean') return { erreur: 'Choix de rappels invalide' };
      fusion[cle] = valeur;
    }
    valeurs.rappels = fusion;
  }
  return { valeurs };
}

function vue(id, d) {
  return {
    id,
    canal: d.canal === 'ntfy' ? 'ntfy' : 'push',
    libelle: d.libelle || '',
    heure: entierHeure(d.heure) ? d.heure : HEURE_DEFAUT,
    heureMatin: entierHeure(d.heureMatin) ? d.heureMatin : HEURE_MATIN_DEFAUT,
    rappels: { ...RAPPELS_DEFAUT, ...(d.rappels || {}) },
    actif: d.actif !== false,
    ...(d.canal === 'ntfy' ? { topic: d.topic } : {})
  };
}

function sujetAleatoire() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let sujet = '';
  while (sujet.length < 24) {
    for (const octet of crypto.getRandomValues(new Uint8Array(32))) {
      if (octet < 252 && sujet.length < 24) sujet += alphabet[octet % 36]; // 252 = 36 × 7 : pas de biais
    }
  }
  return `eprotec-${sujet}`;
}

async function envoyerNtfy(appareil, message, env) {
  let clic;
  try { clic = new URL(message.url || './', `${String(env.SITE_URL || '').replace(/\/+$/, '')}/`).href; } catch { clic = undefined; }
  const reponse = await fetch('https://ntfy.sh/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: appareil.topic, title: message.titre, message: message.corps, tags: ['ambulance'], ...(clic ? { click: clic } : {}) }),
    signal: AbortSignal.timeout(10000)
  });
  return reponse.status;
}

// Envoie un message à un appareil. Renvoie { st: code HTTP, expire: true si l'abonnement n'existe plus (404 ou 410) }.
export async function diffuser(appareil, message, env) {
  if (appareil.canal === 'ntfy') {
    if (!appareil.topic) return { st: 400, expire: false };
    return { st: await envoyerNtfy(appareil, message, env), expire: false };
  }
  const st = await envoyer(appareil.sub, message, env);
  return { st, expire: st === 404 || st === 410 };
}

export async function routePush(requete, env, chemin) {
  // Clé publique d'envoi : nécessaire à l'application pour s'abonner (ce n'est pas un secret).
  if (chemin === '/api/push/cle' && requete.method === 'GET') {
    const cle = String(env.VAPID_PUBLIC || '');
    if (cle.length < 20 || cle.includes('A_REMPLACER')) return json({ erreur: "Clés d'envoi non configurées" }, 503);
    return json({ cle });
  }

  const moi = await utilisateur(requete, env);
  if (moi.reponse) return moi.reponse;
  const { uid } = moi;
  const base = `notifs/${uid}/appareils`;

  try {
    if (chemin === '/api/push/etat' && requete.method === 'GET') {
      const tout = (await lire(env, base)) || {};
      return json({ appareils: Object.entries(tout).filter(([, d]) => d && typeof d === 'object').map(([id, d]) => vue(id, d)) });
    }

    if (requete.method !== 'POST') return json({ erreur: 'Introuvable' }, 404);
    if (!origineValide(requete)) return json({ erreur: 'Origine refusée' }, 403);
    const corps = await lireCorps(requete);
    if (!corps) return json({ erreur: 'Demande invalide' }, 400);

    if (chemin === '/api/push/inscrire') {
      const { appareil, sub } = corps;
      if (typeof appareil !== 'string' || !ID_APPAREIL.test(appareil)) return json({ erreur: "Identifiant d'appareil invalide" }, 400);
      const cles = sub && sub.keys;
      const base64url = (v) => typeof v === 'string' && v.length >= 8 && v.length <= 200 && /^[A-Za-z0-9_-]+$/.test(v);
      if (!sub || typeof sub.endpoint !== 'string' || sub.endpoint.length > 600 || !adresseAbonnementValide(sub.endpoint) || !cles || !base64url(cles.p256dh) || !base64url(cles.auth)) {
        return json({ erreur: 'Abonnement invalide ou service de notification non reconnu' }, 400);
      }
      const tout = (await lire(env, base)) || {};
      const existant = tout[appareil];
      const nbPush = Object.values(tout).filter((d) => d && d.canal !== 'ntfy').length;
      if (!existant && nbPush >= MAX_APPAREILS) return json({ erreur: `Maximum ${MAX_APPAREILS} appareils : supprime-en un d'abord` }, 409);
      const libelle = typeof corps.libelle === 'string' ? corps.libelle.trim().slice(0, 40) : '';
      const enregistrement = {
        canal: 'push',
        sub: { endpoint: sub.endpoint, keys: { p256dh: cles.p256dh, auth: cles.auth } },
        libelle: libelle || (existant && existant.libelle) || 'Appareil',
        heure: entierHeure(existant && existant.heure) ? existant.heure : HEURE_DEFAUT,
        heureMatin: entierHeure(existant && existant.heureMatin) ? existant.heureMatin : HEURE_MATIN_DEFAUT,
        rappels: { ...RAPPELS_DEFAUT, ...((existant && existant.rappels) || {}) },
        actif: true,
        creeLe: (existant && existant.creeLe) || new Date().toISOString(),
        majLe: new Date().toISOString()
      };
      await ecrire(env, `${base}/${appareil}`, enregistrement);
      return json({ ok: true, appareil: vue(appareil, enregistrement) });
    }

    if (chemin === '/api/push/reglages') {
      const { appareil } = corps;
      if (typeof appareil !== 'string' || (!ID_APPAREIL.test(appareil) && appareil !== ID_NTFY)) return json({ erreur: "Identifiant d'appareil invalide" }, 400);
      const existant = await lire(env, `${base}/${appareil}`);
      if (!existant) return json({ erreur: 'Appareil inconnu' }, 404);
      const { valeurs, erreur } = validerReglages(corps, existant);
      if (erreur) return json({ erreur }, 400);
      await ecrire(env, `${base}/${appareil}`, { ...valeurs, majLe: new Date().toISOString() }, 'PATCH');
      return json({ ok: true, appareil: vue(appareil, { ...existant, ...valeurs }) });
    }

    if (chemin === '/api/push/supprimer') {
      const { appareil } = corps;
      if (typeof appareil !== 'string' || (!ID_APPAREIL.test(appareil) && appareil !== ID_NTFY)) return json({ erreur: "Identifiant d'appareil invalide" }, 400);
      await supprimer(env, `${base}/${appareil}`);
      return json({ ok: true });
    }

    if (chemin === '/api/push/test') {
      const { appareil } = corps;
      if (typeof appareil !== 'string' || (!ID_APPAREIL.test(appareil) && appareil !== ID_NTFY)) return json({ erreur: "Identifiant d'appareil invalide" }, 400);
      const existant = await lire(env, `${base}/${appareil}`);
      if (!existant) return json({ erreur: 'Appareil non enregistré' }, 404);
      if (existant.canal !== 'ntfy' && !clesVapidConfigurees(env)) return json({ erreur: "Clés d'envoi absentes de la configuration Cloudflare" }, 503);
      const { st, expire } = await diffuser(existant, { titre: 'eProtec', corps: 'Notification de test : tout fonctionne.', url: './', tag: 'eprotec-test' }, env);
      if (expire) {
        await supprimer(env, `${base}/${appareil}`);
        return json({ erreur: "Cet appareil n'est plus joignable : réactive les notifications." }, 410);
      }
      return st > 0 && st < 300 ? json({ ok: true }) : json({ erreur: `Refus du service de notification (${st || 'aucun envoi'})` }, 502);
    }

    if (chemin === '/api/push/ntfy') {
      if (corps.action === 'activer') {
        const existant = await lire(env, `${base}/${ID_NTFY}`);
        const enregistrement = existant && existant.topic ? existant : {
          canal: 'ntfy',
          topic: sujetAleatoire(),
          libelle: 'ntfy',
          heure: HEURE_DEFAUT,
          heureMatin: HEURE_MATIN_DEFAUT,
          rappels: { ...RAPPELS_DEFAUT },
          actif: true,
          creeLe: new Date().toISOString()
        };
        if (!existant) await ecrire(env, `${base}/${ID_NTFY}`, enregistrement);
        return json({ ok: true, appareil: vue(ID_NTFY, enregistrement) });
      }
      if (corps.action === 'desactiver') {
        await supprimer(env, `${base}/${ID_NTFY}`);
        return json({ ok: true });
      }
      return json({ erreur: 'Action invalide' }, 400);
    }
  } catch (erreur) {
    console.error('Erreur route notifications :', erreur.message);
    return json({ erreur: 'Traitement impossible côté serveur' }, erreur.code === 'CONFIG' ? 503 : 502);
  }
  return json({ erreur: 'Introuvable' }, 404);
}
