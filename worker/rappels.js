// Rappels : exécutés toutes les heures par le déclencheur du Worker.
//
// Chaque appareil (ou le canal ntfy) a deux créneaux par jour, à l'heure de Paris :
//   • le matin (par défaut 7 h)  : « aujourd'hui » → tes inscriptions du jour
//   • le soir  (par défaut 19 h) : « demain » → tes inscriptions du lendemain et la suggestion du moment
//   • les nouvelles activités : annoncées dès le premier passage horaire qui suit le contrôle de 20 h (entre 7 h et 22 h), sans attendre le soir suivant
// Un créneau est envoyé une seule fois par jour. Si l'envoi échoue, il est retenté à l'heure suivante (une seule fois).
// L'horloge de Cloudflare peut avoir quelques minutes de retard : sans importance, on raisonne à l'heure près.
import { lire, ecrire, supprimer } from './firebase.js';
import { clesVapidConfigurees } from './push.js';
import { diffuser, HEURE_DEFAUT, HEURE_MATIN_DEFAUT } from './notifs.js';

const FUSEAU = 'Europe/Paris';
const MAX_LIGNES = 3;
const HEURE_NOUVEAUTES_DEBUT = 7;
const HEURE_NOUVEAUTES_FIN = 22;
const AGE_MAX_NOUVEAUTES_MS = 30 * 3600 * 1000;

export function maintenant(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, heure: +p.hour };
}

const jourParis = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : maintenant(d).date;
};
const jourSuivant = (date) => {
  const [a, m, j] = date.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, j + 1)).toISOString().slice(0, 10);
};
const heureTexte = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU, hour: '2-digit', minute: '2-digit' }).format(new Date(iso)).replace(':', ' h ');
const dateTexte = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));

const avecTag = (e) => (String(e.titre || '').trim().startsWith('[') ? String(e.titre).trim() : `[${e.tag || 'EVT'}] ${String(e.titre || '').trim()}`);
const ligneInscription = (e) => `${avecTag(e)}${e.dateDebut ? ` — ${heureTexte(e.dateDebut)}` : ''}${e.lieu ? `, ${e.lieu}` : ''}`;

function groupe(prefixe, liste, formater) {
  const lignes = liste.slice(0, MAX_LIGNES).map((e) => `${prefixe} : ${formater(e)}`);
  if (liste.length > MAX_LIGNES) lignes.push(`${prefixe} : + ${liste.length - MAX_LIGNES} autre(s)`);
  return lignes;
}

// Détermine les créneaux à envoyer maintenant pour un appareil.
export function creneauxDus(d, quand, globales = null) {
  const dans = (h) => quand.heure >= h && quand.heure <= Math.min(h + 1, 23);
  const heure = Number.isInteger(d.heure) ? d.heure : HEURE_DEFAUT;
  const heureMatin = Number.isInteger(d.heureMatin) ? d.heureMatin : HEURE_MATIN_DEFAUT;
  const r = d.rappels || {};
  const nouv = !!(globales && globales.nouveaux.length && globales.majId && d.derniereMajVue !== globales.majId && r.nouveautes !== false
    && quand.heure >= HEURE_NOUVEAUTES_DEBUT && quand.heure <= HEURE_NOUVEAUTES_FIN);
  return { matin: d.envoyeMatin !== quand.date && dans(heureMatin), soir: d.envoyeSoir !== quand.date && dans(heure), nouv };
}

// Construit le message d'un appareil, ou null s'il n'y a rien à dire.
export function composer({ inscriptions, suggestions }, globales, d, quand, creneaux) {
  const r = d.rappels || {};
  const lignes = [];
  const marques = {};
  let nbInscriptions = 0, premiereInscription = null, nouveautes = false;
  const futures = (Array.isArray(inscriptions) ? inscriptions : Object.values(inscriptions || {})).filter((e) => e && e.dateDebut && e.statut !== 'Annulé');

  if (creneaux.matin && r.jourJ !== false) {
    const duJour = futures.filter((e) => jourParis(e.dateDebut) === quand.date).sort((a, b) => a.dateDebut.localeCompare(b.dateDebut));
    if (duJour.length) { lignes.push(...groupe("Aujourd'hui", duJour, ligneInscription)); nbInscriptions += duJour.length; premiereInscription ||= duJour[0]; }
  }
  if (creneaux.soir) {
    if (r.veille !== false) {
      const demain = jourSuivant(quand.date);
      const duLendemain = futures.filter((e) => jourParis(e.dateDebut) === demain).sort((a, b) => a.dateDebut.localeCompare(b.dateDebut));
      if (duLendemain.length) { lignes.push(...groupe('Demain', duLendemain, ligneInscription)); nbInscriptions += duLendemain.length; premiereInscription ||= duLendemain[0]; }
    }
  }
  if (creneaux.soir || creneaux.nouv) {
    if (r.nouveautes !== false && globales.nouveaux.length && globales.majId && d.derniereMajVue !== globales.majId) {
      const noms = globales.nouveaux.slice(0, MAX_LIGNES).map((e) => avecTag({ tag: e.tag, titre: e.titre }));
      const reste = globales.nouveaux.length > MAX_LIGNES ? ` + ${globales.nouveaux.length - MAX_LIGNES}` : '';
      lignes.push(`${globales.nouveaux.length} nouvelle(s) activité(s) : ${noms.join(', ')}${reste}`);
      marques.derniereMajVue = globales.majId;
      nouveautes = true;
    }
  }
  if (creneaux.soir) {
    const meilleure = Array.isArray(suggestions) ? suggestions[0] : null;
    if (r.suggestions !== false && meilleure && meilleure.uid && meilleure.uid !== d.derniereSuggestion) {
      lignes.push(`Suggestion : ${avecTag({ tag: meilleure.tag || 'DPS', titre: meilleure.titre })}${meilleure.dateDebut ? ` — ${dateTexte(meilleure.dateDebut)}, ${heureTexte(meilleure.dateDebut)}` : ''}${meilleure.lieu ? `, ${meilleure.lieu}` : ''}`);
      marques.derniereSuggestion = meilleure.uid;
    }
  }
  if (!lignes.length) return null;
  let url = './';
  if (nbInscriptions === 1 && !nouveautes && !marques.derniereSuggestion && premiereInscription && premiereInscription.uid) url = `./#event-${encodeURIComponent(premiereInscription.uid)}`;
  else if (nouveautes && nbInscriptions === 0 && !marques.derniereSuggestion) url = './#nouveautes';
  return { titre: 'eProtec', corps: lignes.join('\n'), url, tag: 'eprotec-rappel', marques };
}

async function lireStatique(env, chemin) {
  try {
    const reponse = await env.ASSETS.fetch(`https://fichiers.invalid/${chemin}`);
    return reponse.ok ? await reponse.json() : null;
  } catch {
    return null;
  }
}

async function chargerGlobales(env) {
  const [attente, statut] = await Promise.all([lireStatique(env, 'data/pending-notification.json'), lireStatique(env, 'data/status.json')]);
  const majId = (statut && statut.lastUpdate) || '';
  let nouveaux = Array.isArray(attente && attente.newEvents) ? attente.newEvents : [];
  // Une mise à jour trop ancienne n'est plus une nouveauté (évite d'annoncer de vieilles activités à un appareil tout juste activé).
  const date = /^\d{4}-\d{2}-\d{2}T/.test(majId) ? Date.parse(majId) : NaN;
  if (!Number.isNaN(date) && Date.now() - date > AGE_MAX_NOUVEAUTES_MS) nouveaux = [];
  return { nouveaux, majId };
}

export async function lancer(env, quand = maintenant()) {
  const tout = (await lire(env, 'notifs')) || {};
  const pushPret = clesVapidConfigurees(env);
  const globales = await chargerGlobales(env);
  const bilan = { appareilsTraites: 0, envoyes: 0, supprimes: 0, echecs: 0 };

  for (const [uid, noeud] of Object.entries(tout)) {
    const dus = [];
    for (const [id, d] of Object.entries((noeud && noeud.appareils) || {})) {
      if (!d || typeof d !== 'object' || d.actif === false) continue;
      if (d.canal !== 'ntfy' && !pushPret) continue;
      const c = creneauxDus(d, quand, globales);
      if (c.matin || c.soir || c.nouv) dus.push([id, d, c]);
    }
    if (!dus.length) continue;
    try {
      const donnees = {
        inscriptions: (await lire(env, `users/${uid}/data/registrations-history`)) || {},
        suggestions: (await lire(env, `users/${uid}/data/suggestions`)) || []
      };
      for (const [id, d, c] of dus) {
        bilan.appareilsTraites++;
        const chemin = `notifs/${uid}/appareils/${id}`;
        try {
          const message = composer(donnees, globales, d, quand, c);
          let reussi = true;
          if (message) {
            const { marques: _, ...visible } = message;
            const { st, expire } = await diffuser(d, visible, env);
            if (expire) { await supprimer(env, chemin); bilan.supprimes++; continue; }
            reussi = st > 0 && st < 300;
            if (reussi) bilan.envoyes++;
          }
          if (!reussi) { bilan.echecs++; continue; }
          const marques = { ...(message ? message.marques : {}) };
          if (c.matin) marques.envoyeMatin = quand.date;
          if (c.soir) marques.envoyeSoir = quand.date;
          await ecrire(env, chemin, marques, 'PATCH');
        } catch (erreur) {
          bilan.echecs++;
          console.error(`Rappel en échec (${id}) :`, erreur.message);
        }
      }
    } catch (erreur) {
      console.error('Rappels : utilisateur ignoré :', erreur.message);
    }
  }
  console.log(`Rappels ${quand.date} ${quand.heure} h : ${JSON.stringify(bilan)}`);
  return bilan;
}
