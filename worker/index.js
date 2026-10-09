// Worker « eprotec-mobile » : sert le site (fichiers publics) et fournit les routes /api/*.
//
// Routes :
//   GET  /api/sante                  → test de fonctionnement (public, ne renvoie aucune donnée)
//   GET  /api/admin/utilisateurs     → liste des utilisateurs et de leur activité (administrateur seul)
//   GET  /api/admin/stats            → statistiques Firebase et Mailjet + nombre d'utilisateurs (administrateur seul)
//   GET  /api/admin/vapid-generer    → génère UNE FOIS les clés d'envoi des notifications (administrateur seul, refusé si déjà configurées)
//   GET  /api/push/cle, /api/push/etat ; POST /api/push/inscrire|reglages|supprimer|test|ntfy → notifications de l'application
//
// Variables (wrangler.jsonc) : CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD, ADMIN_EMAIL, VAPID_PUBLIC, VAPID_SUBJECT, SITE_URL, NOTIFS_OUVERTES_A_TOUS.
// Secrets (Cloudflare) : FIREBASE_SERVICE_ACCOUNT, VAPID_PRIVATE. Aucune clé n'est écrite dans le code.
import { identite } from './acces.js';
import { lire } from './firebase.js';
import { json } from './http.js';
import { routePush } from './notifs.js';
import { genererClesVapid } from './push.js';
import { lancer } from './rappels.js';

const MAX_UTILISATEURS = 200;

async function listerUtilisateurs(env) {
  const cles = Object.keys((await lire(env, 'users', '?shallow=true')) || {}).slice(0, MAX_UTILISATEURS);
  const lignes = await Promise.all(cles.map(async (uid) => {
    const [activite, email, nom] = await Promise.all([
      lire(env, `users/${uid}/activity`),
      lire(env, `users/${uid}/email`),
      lire(env, `users/${uid}/mon-nom`)
    ]);
    return { uid, activity: activite || null, email: typeof email === 'string' ? email : '', nom: typeof nom === 'string' ? nom : '' };
  }));
  return { utilisateurs: lignes };
}

async function statistiques(env) {
  const [stats, mailjet, cles] = await Promise.all([
    lire(env, 'admin-stats'),
    lire(env, 'admin-stats-mailjet'),
    lire(env, 'users', '?shallow=true')
  ]);
  return { stats: stats || null, mailjet: mailjet || null, nbUtilisateurs: cles ? Object.keys(cles).length : 0 };
}

async function routeAdmin(requete, env, chemin) {
  if (requete.method !== 'GET') return json({ erreur: 'Méthode non autorisée' }, 405);

  let moi;
  try {
    moi = await identite(requete, env);
  } catch {
    return json({ erreur: "Identité indisponible ou configuration incomplète" }, 503);
  }
  if (!moi) return json({ erreur: 'Non authentifié' }, 401);
  if (!env.ADMIN_EMAIL || moi.email.toLowerCase() !== String(env.ADMIN_EMAIL).toLowerCase()) return json({ erreur: "Réservé à l'administrateur" }, 403);

  try {
    if (chemin === '/api/admin/vapid-generer') {
      if (env.VAPID_PRIVATE) return json({ erreur: "Les clés d'envoi sont déjà configurées : route désactivée." }, 409);
      return json(await genererClesVapid());
    }
    if (chemin === '/api/admin/utilisateurs') return json(await listerUtilisateurs(env));
    if (chemin === '/api/admin/stats') return json(await statistiques(env));
  } catch (erreur) {
    console.error('Erreur route admin :', erreur.message);
    return json({ erreur: 'Lecture Firebase impossible' }, erreur.code === 'CONFIG' ? 503 : 502);
  }
  return json({ erreur: 'Introuvable' }, 404);
}

export default {
  async fetch(requete, env) {
    const chemin = new URL(requete.url).pathname;
    if (chemin === '/api/sante') return json({ ok: true });
    if (chemin.startsWith('/api/admin/')) return routeAdmin(requete, env, chemin);
    if (chemin.startsWith('/api/push/')) return routePush(requete, env, chemin);
    if (chemin.startsWith('/api/')) return json({ erreur: 'Introuvable' }, 404);
    return env.ASSETS.fetch(requete);
  },

  // Déclenché toutes les heures (voir wrangler.jsonc) : envoie les rappels dus à cette heure (heure de Paris).
  async scheduled(evenement, env, ctx) {
    console.log(`Déclenchement horaire reçu (${new Date(evenement.scheduledTime).toISOString()}).`);
    ctx.waitUntil(lancer(env).catch((erreur) => console.error('Rappels en échec :', erreur.message)));
  }
};
