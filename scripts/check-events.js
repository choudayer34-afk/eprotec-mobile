import nodemailer from 'nodemailer';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const KNOWN_UIDS_PATH = 'data/known-uids.json';
const HISTORY_PATH = 'data/registrations-history.json';
const GEOCACHE_PATH = 'data/geocache.json';

const HOME = { lat: 43.5675, lon: 3.9010 };
const MIN_GAP_DAYS = 14;

const W = {
  monthEmpty: 3,
  friday: 3,
  saturday: 3,
  sunday: 2,
  weekday: 0,
  eveningSlot: 2,
  badDuration: -2,
  goodDuration: 1,
  veryClose: 4,
  close: 2,
  far: -1,
  veryFar: -3,
  gapTooClosePenalty: -5,
  gapComfortable: 2
};

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

function updateRegistrationsHistory(events) {
  const history = loadJson(HISTORY_PATH, {});
  const now = new Date();

  for (const e of events) {
    if (!e.dejaInscrit) continue;

    const existing = history[e.uid];
    if (existing) {
      const existingDate = new Date(existing.dateDebut);
      if (existingDate < now) continue;
    }

    history[e.uid] = {
      uid: e.uid,
      tag: e.tag,
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

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = Math.PI * (lat2 - lat1) / 180;
  const dLon = Math.PI * (lon2 - lon1) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(Math.PI * lat1 / 180) * Math.cos(Math.PI * lat2 / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function geocode(address, cache) {
  if (!address) return null;
  if (cache[address]) return cache[address];

  const query = encodeURIComponent(`${address}, Hérault, France`);
  const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Eprotec-Mobile/1.0' } });
    await sleep(1100);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.length === 0) return null;
    const coord = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    cache[address] = coord;
    return coord;
  } catch {
    return null;
  }
}

function getMonthKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}`;
}

async function evaluateDpsCandidate(evt, monthIsOpen, registeredDps, geocache) {
  let score = 0;
  const reasons = [];
  const start = evt.startDate;
  if (!start) return { event: evt, score: -999, reasons: ['Date invalide'] };

  if (monthIsOpen) {
    score += W.monthEmpty;
    reasons.push('Mois sans DPS planifié');
  }

  const day = start.getDay();
  if (day === 5) { score += W.friday; reasons.push('Jour très favorable (vendredi)'); }
  else if (day === 6) { score += W.saturday; reasons.push('Jour très favorable (samedi)'); }
  else if (day === 0) { score += W.sunday; reasons.push('Jour favorable (dimanche)'); }
  else { score += W.weekday; reasons.push('Jour de semaine'); }

  if (start.getHours() >= 16) {
    score += W.eveningSlot;
    reasons.push("Créneau fin d'après-midi / soirée");
  }

  if (evt.dureeHeures != null) {
    if (evt.dureeHeures >= 8) { score += W.badDuration; reasons.push('DPS long (fatigue)'); }
    else { score += W.goodDuration; reasons.push('Durée raisonnable'); }
  }

  const coord = await geocode(evt.location, geocache);
  if (coord) {
    const dist = haversineKm(HOME.lat, HOME.lon, coord.lat, coord.lon);
    if (dist <= 15) { score += W.veryClose; reasons.push(`Très proche (${dist} km)`); }
    else if (dist <= 30) { score += W.close; reasons.push(`Distance raisonnable (${dist} km)`); }
    else if (dist <= 50) { score += W.far; reasons.push(`Assez éloigné (${dist} km)`); }
    else { score += W.veryFar; reasons.push(`Trop éloigné (${dist} km)`); }
  }

  if (registeredDps.length > 0) {
    const gaps = registeredDps.map(r => Math.abs((new Date(r.dateDebut) - start) / 86400000));
    const minGap = Math.round(Math.min(...gaps));
    if (minGap < MIN_GAP_DAYS) {
      score += W.gapTooClosePenalty;
      reasons.push(`Trop proche d'un DPS déjà planifié (${minGap} jours)`);
    } else {
      score += W.gapComfortable;
      reasons.push(`Espacement confortable (${minGap} jours)`);
    }
  }

  return { event: evt, score, reasons };
}

async function computeOadSuggestions(events, registrationsHistory, geocache) {
  const now = new Date();
  const registeredDps = Object.values(registrationsHistory).filter(r => r.tag === 'DPS');

  const candidates = events.filter(e =>
    e.tag === 'DPS' &&
    !e.dejaInscrit &&
    e.startDate && e.startDate > now &&
    !/recensement/i.test(e.summary)
  );

  const byMonth = {};
  for (const c of candidates) {
    const key = getMonthKey(c.startDate);
    (byMonth[key] ||= []).push(c);
  }

  const results = [];
  for (const monthEvents of Object.values(byMonth)) {
    const first = monthEvents[0].startDate;
    const registeredInMonth = registeredDps.filter(r => {
      const d = new Date(r.dateDebut);
      return d.getFullYear() === first.getFullYear() && d.getMonth() === first.getMonth();
    });
    if (registeredInMonth.length > 0) continue;

    for (const evt of monthEvents) {
      results.push(await evaluateDpsCandidate(evt, true, registeredDps, geocache));
    }
  }

  return results.filter(r => r.score > -500).sort((a, b) => b.score - a.score);
}

async function sendMail(newEvents, suggestions) {
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

  const suggestionHtml = suggestions.slice(0, 1).map(s => `
    <div style="margin-bottom:14px;padding:10px;border:2px solid #F5821F;border-radius:6px;">
      <b>🎯 Suggestion du mois : [DPS] ${s.event.summary}</b><br>
      Date : ${formatDate(s.event.startDate)}<br>
      Lieu : ${s.event.location || 'non renseigné'}<br>
      Score : ${s.score}<br>
      <ul>${s.reasons.map(r => `<li>${r}</li>`).join('')}</ul>
    </div>
  `).join('');

  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to: process.env.MAIL_TO,
    subject: `[Protection Civile] ${newEvents.length} nouvelle(s) activité(s) détectée(s)`,
    html: `<p>Bonjour,</p><p>Voici les nouveautés détectées :</p>${items}${suggestionHtml}`
  });
}

async function sendPushNotification(newEvents) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;

  const titles = newEvents.slice(0, 3).map(e => `[${e.tag}] ${e.summary}`).join('\n');
  const suffix = newEvents.length > 3 ? `\n...et ${newEvents.length - 3} autre(s)` : '';

  try {
    await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: {
        'Title': `${newEvents.length} nouvelle(s) activité(s) eProtec`,
        'Priority': 'default',
        'Tags': 'bell'
      },
      body: titles + suffix
    });
    console.log('Notification push envoyée.');
  } catch (err) {
    console.error('Erreur notification push :', err.message);
  }
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
  const now = new Date();
  const events = rawEvents
    .filter(e => e.uid)
    .map(e => ({
      ...e,
      tag: getTag(e.summary),
      startDate: parseIcsDate(e.dtstart),
      endDate: parseIcsDate(e.dtend),
      dejaInscrit: registeredUids.has(e.uid)
    }))
    .map(e => ({
      ...e,
      dureeHeures: e.startDate && e.endDate
        ? Math.round((e.endDate - e.startDate) / 3600000 * 10) / 10
        : null
    }));

  console.log(`Événements trouvés : ${events.length}`);

  const registrationsHistory = updateRegistrationsHistory(events);
  const registered = events.filter(e => e.dejaInscrit);
  console.log(`Dont déjà inscrits : ${registered.length}`);

  const geocache = loadJson(GEOCACHE_PATH, {});
  console.log('Calcul des suggestions OAD...');
  const suggestions = await computeOadSuggestions(events, registrationsHistory, geocache);
  writeFileSync(GEOCACHE_PATH, JSON.stringify(geocache, null, 2));
  console.log(`Suggestions calculées : ${suggestions.length}`);

  const isFirstRun = !existsSync(KNOWN_UIDS_PATH);
  const knownUids = isFirstRun ? [] : JSON.parse(readFileSync(KNOWN_UIDS_PATH, 'utf8'));
  const knownSet = new Set(knownUids);
  const newEvents = events.filter(e => !knownSet.has(e.uid));

  if (isFirstRun) {
    console.log("Premier lancement : initialisation, aucune alerte envoyée.");
  } else if (newEvents.length > 0) {
    console.log(`${newEvents.length} nouveauté(s), envoi des alertes...`);
    await sendMail(newEvents, suggestions);
    await sendPushNotification(newEvents);
    console.log('Alertes envoyées.');
  } else {
    console.log("Aucune nouveauté cette fois-ci.");
  }

  writeFileSync(KNOWN_UIDS_PATH, JSON.stringify(events.map(e => e.uid), null, 2));

  const upcoming = events.filter(e => e.startDate && e.startDate > now);
  const eventsForApp = upcoming.map(e => ({
    uid: e.uid,
    tag: e.tag,
    titre: e.summary,
    lieu: e.location,
    dateDebut: e.startDate ? e.startDate.toISOString() : null,
    dateFin: e.endDate ? e.endDate.toISOString() : null,
    dureeHeures: e.dureeHeures,
    dejaInscrit: e.dejaInscrit,
    nouveau: newEvents.some(n => n.uid === e.uid),
    url: e.url,
    description: e.description
  }));
  writeFileSync('data/events.json', JSON.stringify(eventsForApp, null, 2));

  const suggestionsForApp = suggestions.slice(0, 30).map(s => ({
    uid: s.event.uid,
    titre: s.event.summary,
    lieu: s.event.location,
    dateDebut: s.event.startDate ? s.event.startDate.toISOString() : null,
    score: s.score,
    reasons: s.reasons
  }));
  writeFileSync('data/suggestions.json', JSON.stringify(suggestionsForApp, null, 2));

  console.log(`Export terminé : ${eventsForApp.length} événements à venir, ${suggestionsForApp.length} suggestions.`);
}

main().catch(err => {
  console.error('ERREUR :', err.message);
  process.exit(1);
});
