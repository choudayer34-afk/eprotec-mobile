import nodemailer from 'nodemailer';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const KNOWN_UIDS_PATH = 'data/known-uids.json';
const HISTORY_PATH = 'data/dps-history.json';

function unfoldIcs(text) {
  return text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

function cleanText(v) {
  return (v || '')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\n/gi, ' ')
    .trim();
}

function getField(block, field) {
  const re = new RegExp(`(?:^|\\n)${field}(?:;[^:\\n]*)?:(.*)`, 'i');
  const m = block.match(re);
  return m ? m[1].trim() : '';
}

function parseIcs(text) {
  const unfolded = unfoldIcs(text);
  const events = [];
  const veventRe = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
  let m;
  while ((m = veventRe.exec(unfolded))) {
    const block = m[1];
    events.push({
      uid: getField(block, 'UID'),
      dtstart: getField(block, 'DTSTART'),
      dtend: getField(block, 'DTEND'),
      summary: cleanText(getField(block, 'SUMMARY')),
      location: cleanText(getField(block, 'LOCATION')),
      description: cleanText(getField(block, 'DESCRIPTION')),
      url: cleanText(getField(block, 'URL'))
    });
  }
  return events;
}

function parseIcsDate(raw) {
  if (!raw) return null;
  const clean = raw.replace('Z', '');
  const y = clean.slice(0, 4), mo = clean.slice(4, 6), d = clean.slice(6, 8);
  const h = clean.slice(9, 11) || '00', mi = clean.slice(11, 13) || '00';
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:00`);
}

function getTag(summary) {
  if (/\[DPS/.test(summary)) return 'DPS';
  if (/\[FOR/.test(summary)) return 'FOR';
  if (/\[MAN/.test(summary)) return 'MAN';
  if (/\[MLA/.test(summary)) return 'MLA';
  if (/\[ALERT/.test(summary)) return 'ALERT';
  if (/\[AIP/.test(summary)) return 'AIP';
  if (/BENEVOLE/.test(summary)) return 'BENEVOLE';
  return 'AUTRE';
}

function formatDate(d) {
  if (!d) return 'date inconnue';
  return d.toLocaleString('fr-FR', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function loadJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

function updateDpsHistory(events) {
  const history = loadJson(HISTORY_PATH, {});
  const now = new Date();

  for (const e of events) {
    if (e.tag !== 'DPS' || !e.dejaInscrit) continue;

    const existing = history[e.uid];
    if (existing) {
      const existingDate = new Date(existing.dateDebut);
      if (existingDate < now) continue;
    }

    history[e.uid] = {
      uid: e.uid,
      titre: e.summary,
      lieu: e.location,
      dateDebut: e.startDate ? e.startDate.toISOString() : null,
      dureeHeures: e.startDate && e.endDate
        ? Math.round((e.endDate - e.startDate) / 3600000 * 10) / 10
        : null,
      statut: 'Inscrit'
    };
  }

  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
  return history;
}

async function sendMail(newEvents) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: false,
    requireTLS: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  const items = newEvents.map(e => `
    <div style="margin-bottom:14px;padding:10px;border:1px solid #ddd;border-radius:6px;">
      <b>[${e.tag}] ${e.summary}</b><br>
      Date : ${formatDate(e.startDate)}<br>
      Lieu : ${e.location || 'non renseigné'}<br>
      ${e.dejaInscrit ? '✅ Vous êtes déjà inscrit<br>' : ''}
      ${e.url ? `<a href="${e.url}">Voir l'événement</a>` : ''}
    </div>
  `).join('');

  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to: process.env.MAIL_TO,
    subject: `[Protection Civile] ${newEvents.length} nouvelle(s) activité(s) détectée(s)`,
    html: `<p>Bonjour,</p><p>Voici les nouveautés détectées :</p>${items}`
  });
}

async function fetchIcs(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Échec du téléchargement ICS (${res.status}) : ${url}`);
  return res.text();
}

async function main() {
  const [icsText, persoText] = await Promise.all([
    fetchIcs(process.env.EPROTEC_ICS_URL),
    fetchIcs(process.env.EPROTEC_PERSO_URL)
  ]);

  const persoEvents = parseIcs(persoText);
  const registeredUids = new Set(persoEvents.map(e => e.uid).filter(Boolean));

  const rawEvents = parseIcs(icsText);
  const events = rawEvents
    .filter(e => e.uid)
    .map(e => ({
      ...e,
      tag: getTag(e.summary),
      startDate: parseIcsDate(e.dtstart),
      endDate: parseIcsDate(e.dtend),
      dejaInscrit: registeredUids.has(e.uid)
    }));

  console.log(`Événements trouvés : ${events.length}`);
  console.log(`Dont déjà inscrits : ${events.filter(e => e.dejaInscrit).length}`);

  updateDpsHistory(events);

  const isFirstRun = !existsSync(KNOWN_UIDS_PATH);
  const knownUids = isFirstRun ? [] : JSON.parse(readFileSync(KNOWN_UIDS_PATH, 'utf8'));
  const knownSet = new Set(knownUids);

  const newEvents = events.filter(e => !knownSet.has(e.uid));

  if (isFirstRun) {
    console.log("Premier lancement : initialisation, aucun mail envoyé.");
  } else if (newEvents.length > 0) {
    console.log(`${newEvents.length} nouveauté(s), envoi du mail...`);
    await sendMail(newEvents);
    console.log('Mail envoyé.');
  } else {
    console.log('Aucune nouveauté aujourd\'hui.');
  }

  writeFileSync(KNOWN_UIDS_PATH, JSON.stringify(events.map(e => e.uid), null, 2));
}

main().catch(err => {
  console.error('ERREUR :', err.message);
  process.exit(1);
});
