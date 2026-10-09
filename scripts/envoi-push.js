// Envoi immédiat des rappels sur l'application (et ntfy personnel) juste après le contrôle de 20 h.
// Réutilise exactement le code du Worker (worker/rappels.js) : mêmes règles, mêmes choix par appareil,
// et le marquage « déjà annoncé » évite tout doublon avec le passage horaire du Worker.
// Secrets GitHub nécessaires : FIREBASE_SERVICE_ACCOUNT, VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT.
import { readFileSync } from 'fs';
import { lancer } from '../worker/rappels.js';

// Remplace les fichiers publiés du site par les fichiers du dépôt (data/pending-notification.json, data/status.json).
const ASSETS = {
  fetch: async (adresse) => {
    const chemin = new URL(String(adresse)).pathname.replace(/^\/+/, '');
    if (!/^data\/[\w.-]+\.json$/.test(chemin)) return new Response('', { status: 404 });
    try {
      return new Response(readFileSync(chemin, 'utf8'), { headers: { 'Content-Type': 'application/json' } });
    } catch {
      return new Response('', { status: 404 });
    }
  }
};

async function main() {
  const env = {
    FIREBASE_SERVICE_ACCOUNT: process.env.FIREBASE_SERVICE_ACCOUNT,
    VAPID_PUBLIC: process.env.VAPID_PUBLIC,
    VAPID_PRIVATE: process.env.VAPID_PRIVATE,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT || 'mailto:ch-houdayer@hotmail.fr',
    SITE_URL: process.env.SITE_URL || 'https://eprotec-mobile.choudayer34.workers.dev',
    ASSETS
  };
  if (!env.FIREBASE_SERVICE_ACCOUNT) { console.log("Envoi sur l'application ignoré : FIREBASE_SERVICE_ACCOUNT absent."); return; }
  if (!env.VAPID_PRIVATE || !env.VAPID_PUBLIC) console.log("Clés VAPID absentes des secrets GitHub : seuls les appareils ntfy seront servis.");
  const bilan = await lancer(env);
  console.log(`Envoi sur l'application : ${JSON.stringify(bilan)}`);
}

// Une erreur ici ne doit jamais faire échouer le contrôle quotidien : le passage horaire du Worker prendra le relais.
main().catch((erreur) => console.error("Envoi sur l'application en échec (le Worker réessaiera) :", erreur.message));
