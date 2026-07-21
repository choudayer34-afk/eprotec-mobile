import nodemailer from 'nodemailer';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const KNOWN_UIDS_PATH = 'data/known-uids.json';

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

async function main() {
  const icsUrl = process.env.EPROTEC_ICS_URL;
  const res = await fetch(icsUrl);
  if (!res.ok) throw new Error(`Échec du téléchargement ICS : ${res.status}`);
  const icsText = await res.text();

  const rawEvents = parseIcs(icsText);
  const events = rawEvents
    .filter(e => e.uid)
    .map(e => ({ ...e, tag: getTag(e.summary), startDate: parseIcsDate(e.dtstart) }));

  console.log(`Événements trouvés dans le calendrier : ${events.length}`);

  const isFirstRun = !existsSync(KNOWN_UIDS_PATH);
  const knownUids = isFirstRun ? [] : JSON.parse(readFileSync(KNOWN_UIDS_PATH, 'utf8'));
  const knownSet = new Set(knownUids);

  const newEvents = events.filter(e => !knownSet.has(e.uid));

  if (isFirstRun) {
    console.log('Premier lancement : initialisation de la liste, aucun mail envoyé.');
  } else if (newEvents.length > 0) {
    console.log(`${newEvents.length} nouveauté(s) détectée(s), envoi du mail...`);
    await sendMail(newEvents);
    console.log('Mail envoyé avec succès.');
  } else {
    console.log('Aucune nouveauté aujourd\'hui.');
  }

  writeFileSync(KNOWN_UIDS_PATH, JSON.stringify(events.map(e => e.uid), null, 2));
}

main().catch(err => {
  console.error('ERREUR :', err.message);
  process.exit(1);
});
