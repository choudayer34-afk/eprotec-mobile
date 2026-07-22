import nodemailer from 'nodemailer';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const KNOWN_UIDS_PATH = 'data/known-uids.json';
const HISTORY_PATH = 'data/registrations-history.json';
const GEOCACHE_PATH = 'data/geocache.json';
const RECENT_NEW_PATH = 'data/recent-new.json';
const NEW_RETENTION_HOURS = 48;

const FIREBASE_URL = 'https://eprotec-favoris-default-rtdb.europe-west1.firebasedatabase.app';

const HOME = { lat: 43.5675, lon: 3.9010 };

const DEFAULT_SETTINGS = {
  monthEmpty: 3,
  monday: 0,
  tuesday: 0,
  wednesday: 0,
  thursday: 0,
  friday: 3,
  saturday: 3,
  sunday: 2,
  eveningSlot: 2,
  badDuration: -2,
  goodDuration: 1,
  veryClose: 4,
  close: 2,
  far: -1,
  veryFar: -3,
  gapTooClosePenalty: -5,
  gapComfortable: 2,
  veryCloseKm: 15,
  closeKm: 30,
  farKm: 50,
  longDurationHours: 8,
  minGapDays: 14
};

async function loadSettings() {
  try {
    const res = await fetch(FIREBASE_URL + '/oad-settings.json');
    const remote = await res.json();
    if (remote && typeof remote === 'object') {
      const merged = { ...DEFAULT_SETTINGS };
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (typeof remote[key] === 'number' && !Number.isNaN(remote[key])) {
          merged[key] = remote[key];
        }
      }
      return merged;
    }
  } catch (err) {
    console.error('Erreur chargement réglages OAD, utilisation des valeurs par défaut :', err.message);
  }
  return { ...DEFAULT_SETTINGS };
}

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

function lastSundayOfMonthUTC(year, monthIndex) {
  const d = new Date(Date.UTC(year, monthIndex + 1, 0));
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - day);
  return d.getUTCDate();
}

function parisOffsetHours(year, monthIndex, day, hour, minute) {
  const guessUTCms = Date.UTC(year, monthIndex, day, hour - 1, minute);
  const marsDay = lastSundayOfMonthUTC(year, 2);
  const marsSwitchMs = Date.UTC(year, 2, marsDay, 1, 0, 0);
  const octDay = lastSundayOfMonthUTC(year, 9);
  const octSwitchMs = Date.UTC(year, 9, octDay, 1, 0, 0);
  if (guessUTCms >= marsSwitchMs && guessUTCms < octSwitchMs) return 2;
  return 1;
}

function parseIcsDate(raw) {
  if (!raw) return null;
  const isUtc = raw.endsWith('Z');
  const clean = raw.replace('Z', '');
  const y = parseInt(clean.slice(0, 4), 10);
  const mo = parseInt(clean.slice(4, 6), 10);
  const d = parseInt(clean.slice(6, 8), 10);
  const h = parseInt(clean.slice(9, 11) || '0', 10);
  const mi = parseInt(clean.slice(11, 13) || '0', 10);
  if (isUtc) {
    return new Date(Date.UTC(y, mo - 1, d, h, mi));
  }
  const offset = parisOffsetHours(y, mo - 1, d, h, mi);
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - offset * 3600000);
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

function updateRecentNew(newEvents, existingRecentNew) {
  const now = new Date();
  const recentNew = { ...existingRecentNew };

  for (const e of newEvents) {
    if (!recentNew[e.uid]) {
      recentNew[e.uid] = now.toISOString();
    }
  }

  const cutoff = now.getTime() - NEW_RETENTION_HOURS * 3600000;
  for (const uid of Object.keys(recentNew)) {
    if (new Date(recentNew[uid]).getTime() < cutoff) {
      delete recentNew[uid];
    }
  }

  return recentNew;
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

async function evaluateDpsCandidate(evt, monthIsOpen, registeredDps, geocache, S) {
  let score = 0;
  const reasons = [];
  const push = (text, category) => reasons.push({ text, category });
  const start = evt.startDate;
  if (!start) return { event: evt, score: -999, reasons: [{ text: 'Date invalide', category: 'negative' }] };

  if (monthIsOpen) {
    score += S.monthEmpty;
    push('Mois sans DPS planifié', 'positive');
  }

 const dayNamesFr = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const jsDay = start.getDay();
  const dayScore = S[dayKeys[jsDay]] || 0;
  score += dayScore;
  const dayLabel = dayNamesFr[jsDay].charAt(0).toUpperCase() + dayNamesFr[jsDay].slice(1);
  push(`Jour : ${dayLabel} (${dayScore >= 0 ? '+' : ''}${dayScore})`, dayScore > 0 ? 'positive' : dayScore < 0 ? 'negative' : 'neutral');
 
  if (start.getHours() >= 16) {
    score += S.eveningSlot;
    push("Créneau fin d'après-midi / soirée", 'positive');
  }

  if (evt.dureeHeures != null) {
    if (evt.dureeHeures >= S.longDurationHours) { score += S.badDuration; push('DPS long (fatigue)', 'negative'); }
    else { score += S.goodDuration; push('Durée raisonnable', 'positive'); }
  }

  const coord = await geocode(evt.location, geocache);
  if (coord) {
    const dist = haversineKm(HOME.lat, HOME.lon, coord.lat, coord.lon);
    if (dist <= S.veryCloseKm) { score += S.veryClose; push(`Très proche (${dist} km)`, 'positive'); }
    else if (dist <= S.closeKm) { score += S.close; push(`Distance raisonnable (${dist} km)`, 'positive'); }
    else if (dist <= S.farKm) { score += S.far; push(`Assez éloigné (${dist} km)`, 'negative'); }
    else { score += S.veryFar; push(`Trop éloigné (${dist} km)`, 'negative'); }
  }

  if (registeredDps.length > 0) {
    const gaps = registeredDps.map(r => Math.abs((new Date(r.dateDebut) - start) / 86400000));
    const minGap = Math.round(Math.min(...gaps));
    if (minGap < S.minGapDays) {
      score += S.gapTooClosePenalty;
      push(`Trop proche d'un DPS déjà planifié (${minGap} jours)`, 'negative');
    } else {
      score += S.gapComfortable;
      push(`Espacement confortable (${minGap} jours)`, 'positive');
    }
  }

  return { event: evt, score, reasons };
}

async function loadDismissedSuggestions() {
  try {
    const res = await fetch(FIREBASE_URL + '/dismissed-suggestions.json');
    const remote = await res.json();
    if (Array.isArray(remote)) return new Set(remote);
  } catch (err) {
    console.error('Erreur chargement suggestions écartées :', err.message);
  }
  return new Set();
}

async function computeOadSuggestions(events, registrationsHistory, geocache, S, dismissedSet) {
  const now = new Date();
  const registeredDps = Object.values(registrationsHistory).filter(r => r.tag === 'DPS');

  const candidates = events.filter(e =>
    e.tag === 'DPS' &&
    !e.dejaInscrit &&
    e.startDate && e.startDate > now &&
    !/recensement/i.test(e.summary) &&
    !dismissedSet.has(e.uid)
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
      results.push(await evaluateDpsCandidate(evt, true, registeredDps, geocache, S));
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

  function formatDate(d) {
    if (!d) return 'date inconnue';
    return d.toLocaleString('fr-FR', {
      weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

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
      <ul>${s.reasons.map(r => `<li>${r.category === 'positive' ? '✅' : r.category === 'negative' ? '⚠️' : '•'} ${r.text}</li>`).join('')}</ul>
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
  const appUrl = 'https://choudayer34-afk.github.io/eprotec-mobile/#nouveautes';

  await fetch(`https://ntfy.sh/${topic}`, {
    method: 'POST',
    headers: {
      'Title': `${newEvents.length} nouvelle(s) activité(s) eProtec`,
      'Priority': 'default',
      'Tags': 'bell',
      'Click': appUrl
    },
    body: titles + suffix
  });
}

async function fetchIcs(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Échec du téléchargement ICS (${res.status}) : ${url}`);
  return res.text();
}

async function main() {
  const settings = await loadSettings();
  console.log('Réglages OAD utilisés :', JSON.stringify(settings));

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
  const dismissedSuggestions = await loadDismissedSuggestions();
  console.log(`Suggestions écartées manuellement : ${dismissedSuggestions.size}`);
  console.log('Calcul des suggestions OAD...');
  const suggestions = await computeOadSuggestions(events, registrationsHistory, geocache, settings, dismissedSuggestions);
  writeFileSync(GEOCACHE_PATH, JSON.stringify(geocache, null, 2));
  console.log(`Suggestions calculées : ${suggestions.length}`);

  const isFirstRun = !existsSync(KNOWN_UIDS_PATH);
  const knownUids = isFirstRun ? [] : JSON.parse(readFileSync(KNOWN_UIDS_PATH, 'utf8'));
  const knownSet = new Set(knownUids);
  const newEvents = events.filter(e => !knownSet.has(e.uid));

  const existingRecentNew = loadJson(RECENT_NEW_PATH, {});
  const recentNew = isFirstRun ? {} : updateRecentNew(newEvents, existingRecentNew);
  writeFileSync(RECENT_NEW_PATH, JSON.stringify(recentNew, null, 2));
  const recentNewSet = new Set(Object.keys(recentNew));

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

  const historyCutoff = new Date(now.getTime() - 60 * 24 * 3600 * 1000);
  const upcoming = events.filter(e => e.startDate && e.startDate > historyCutoff);
  const eventsForApp = upcoming.map(e => ({
    uid: e.uid,
    tag: e.tag,
    titre: e.summary,
    lieu: e.location,
    dateDebut: e.startDate ? e.startDate.toISOString() : null,
    dateFin: e.endDate ? e.endDate.toISOString() : null,
    dureeHeures: e.dureeHeures,
    dejaInscrit: e.dejaInscrit,
    nouveau: recentNewSet.has(e.uid),
    url: e.url,
    description: e.description
  }));
  writeFileSync('data/events.json', JSON.stringify(eventsForApp, null, 2));

  const suggestionsForApp = suggestions.slice(0, 30).map(s => ({
    uid: s.event.uid,
    titre: s.event.summary,
    lieu: s.event.location,
    dateDebut: s.event.startDate ? s.event.startDate.toISOString() : null,
    dateFin: s.event.endDate ? s.event.endDate.toISOString() : null,
    description: s.event.description,
    tag: 'DPS',
    score: s.score,
    reasons: s.reasons,
    url: s.event.url
  }));
  writeFileSync('data/suggestions.json', JSON.stringify(suggestionsForApp, null, 2));

  writeFileSync('data/status.json', JSON.stringify({
    lastUpdate: new Date().toISOString()
  }, null, 2));

  console.log(`Export terminé : ${eventsForApp.length} événements à venir, ${suggestionsForApp.length} suggestions.`);
}

main().catch(err => {
  console.error('ERREUR :', err.message);
  process.exit(1);
});
