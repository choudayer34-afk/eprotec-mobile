import { readFileSync, writeFileSync, existsSync } from 'fs';

const KNOWN_UIDS_PATH = 'data/known-uids.json';
const HISTORY_PATH = 'data/registrations-history.json';
const GEOCACHE_PATH = 'data/geocache.json';
const RECENT_NEW_PATH = 'data/recent-new.json';
const NEW_RETENTION_HOURS = 48;

const FIREBASE_URL = 'https://eprotec-favoris-default-rtdb.europe-west1.firebasedatabase.app';
import { createSign } from 'crypto';

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getGcpAccessToken(serviceAccountJson) {
  const key = JSON.parse(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/monitoring.read',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  const signInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signInput);
  signer.end();
  const signature = signer.sign(key.private_key).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = `${signInput}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  const data = await res.json();
  return data.access_token;
}

async function fetchGcpMetric(projectId, accessToken, metricType, startTime, endTime) {
  const url = `https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries?filter=metric.type%3D%22${encodeURIComponent(metricType)}%22&interval.startTime=${startTime}&interval.endTime=${endTime}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) {
    console.error(`Erreur métrique ${metricType} :`, JSON.stringify(data));
    return 0;
  }
  if (data.timeSeries && data.timeSeries.length > 0) {
    const points = data.timeSeries[0].points;
    if (points && points.length > 0) {
      const val = points[0].value;
      return val.int64Value ? Number(val.int64Value) : (val.doubleValue || 0);
    }
  }
  console.log(`Aucune donnée pour ${metricType}`);
  return 0;
}

async function fetchMailjetUsageStats() {
  try {
    const apiKey = process.env.SMTP_USER;
    const apiSecret = process.env.SMTP_PASS;
    if (!apiKey || !apiSecret) return null;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const fromTs = Math.floor(startOfMonth.getTime() / 1000);
    const toTs = Math.floor(now.getTime() / 1000);

    const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
    const url = `https://api.mailjet.com/v3/REST/statcounters?CounterSource=APIKey&CounterTiming=Message&CounterResolution=Month&FromTS=${fromTs}&ToTS=${toTs}`;

    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    const data = await res.json();

    if (!res.ok) {
      console.error('Erreur API Mailjet :', JSON.stringify(data));
      return null;
    }

    console.log('Réponse brute Mailjet :', JSON.stringify(data));

    let sentCount = 0;
    if (Array.isArray(data.Data)) {
      data.Data.forEach(entry => {
        sentCount += entry.MessageSentCount || entry.SentCount || entry.Total || 0;
      });
    }

    return { sentThisMonth: sentCount, monthlyLimit: 6000, dailyLimit: 200, fetchedAt: new Date().toISOString() };
  } catch (err) {
    console.error('Erreur récupération stats Mailjet :', err.message);
    return null;
  }
}

async function fetchFirebaseUsageStats() {
  try {
    const serviceAccountJson = process.env.GCP_MONITORING_KEY;
    if (!serviceAccountJson) return null;

    const key = JSON.parse(serviceAccountJson);
    const accessToken = await getGcpAccessToken(serviceAccountJson);
    const projectId = key.project_id;

const now = new Date();
    const past = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const startTime = past.toISOString();
    const endTime = now.toISOString();

    const storageBytes = await fetchGcpMetric(projectId, accessToken, 'firebasedatabase.googleapis.com/storage/total_bytes', startTime, endTime);
    const storageLimit = await fetchGcpMetric(projectId, accessToken, 'firebasedatabase.googleapis.com/storage/limit', startTime, endTime);

    return { storageBytes, storageLimit, fetchedAt: new Date().toISOString() };
  } catch (err) {
    console.error('Erreur récupération stats Firebase :', err.message);
    return null;
  }
}

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
    const res = await fetch(FIREBASE_URL + '/users/ch-houdayer_hotmail_fr/oad-settings.json');
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
const EPROTEC_BASE = 'https://eprotec.protection-civile.org/evenements.php';
const TYPE_EVENEMENT_FILTER = 'COOP,DPS,GAR,MED,AR,NAUT,AIP,ALSAN,ALERT,AH,CADI,VACCI,HEB,MAR,MSP,UKRAI,FOR,MAN,EXE,DIV,CADET,CER,COM,TEC,JMPC,MLA,REU,WEB';

function buildPersoUrlForCid(cid) {
  return `${EPROTEC_BASE}?cid=${cid}&perso=1`;
}

async function loadRegisteredUsers() {
  try {
    const res = await fetch(FIREBASE_URL + '/users.json');
    const data = await res.json();
    if (!data || typeof data !== 'object') return [];
    return Object.keys(data)
      .filter(uid => data[uid] && typeof data[uid]['eprotec-cid'] === 'string' && data[uid]['eprotec-cid'].length > 0)
      .map(uid => ({ uid, cid: data[uid]['eprotec-cid'] }));
  } catch (err) {
    console.error('Erreur chargement utilisateurs enregistrés :', err.message);
    return [];
  }
}

async function loadUserJson(uid, key, fallback) {
  try {
    const res = await fetch(`${FIREBASE_URL}/users/${uid}/data/${key}.json`);
    const data = await res.json();
    return (data === null || data === undefined) ? fallback : data;
  } catch {
    return fallback;
  }
}

async function saveUserJson(uid, key, value) {
  try {
    await fetch(`${FIREBASE_URL}/users/${uid}/data/${key}.json`, {
      method: 'PUT',
      body: JSON.stringify(value)
    });
  } catch (err) {
    console.error(`Erreur sauvegarde ${key} pour ${uid} :`, err.message);
  }
}

async function loadUserSettings(uid) {
  try {
    const res = await fetch(`${FIREBASE_URL}/users/${uid}/oad-settings.json`);
    const remote = await res.json();
    const settings = { ...DEFAULT_SETTINGS };
    if (remote && typeof remote === 'object') {
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (typeof remote[key] === 'number' && !Number.isNaN(remote[key])) {
          settings[key] = remote[key];
        }
      }
    }
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function loadUserDismissed(uid) {
  try {
    const res = await fetch(`${FIREBASE_URL}/users/${uid}/dismissed-suggestions.json`);
    const remote = await res.json();
    return new Set(Array.isArray(remote) ? remote : []);
  } catch {
    return new Set();
  }
}

function sanitizeFirebaseKey(str) {
  return str.replace(/[.#$\[\]\/]/g, '_');
}

function updateUserRegistrationsHistory(existingHistory, events, registeredUids) {
  const history = { ...existingHistory };
  const now = new Date();

  for (const e of events) {
    if (!registeredUids.has(e.uid)) continue;
    const key = sanitizeFirebaseKey(e.uid);

    const existing = history[key];
    if (existing) {
      const existingDate = new Date(existing.dateDebut);
      if (existingDate < now) continue;
    }

    history[key] = {
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

  const eventByUid = new Map(events.map(e => [sanitizeFirebaseKey(e.uid), e]));
  for (const key of Object.keys(history)) {
    const entry = history[key];
    const entryDate = entry.dateDebut ? new Date(entry.dateDebut) : null;
    if (!entryDate || entryDate <= now) continue;
    const matchingEvent = eventByUid.get(key);
    if (matchingEvent && !registeredUids.has(matchingEvent.uid)) {
      delete history[key];
    }
  }

  return history;
}


async function processUser(user, events, geocache) {
  const { uid, cid } = user;
  try {
    const persoText = await fetchIcs(buildPersoUrlForCid(cid));
    const persoEvents = parseIcs(persoText);
    const registeredUids = new Set(persoEvents.map(e => e.uid).filter(Boolean));

    const settings = await loadUserSettings(uid);
    const dismissedSet = await loadUserDismissed(uid);

    const existingHistory = await loadUserJson(uid, 'registrations-history', {});
    const registrationsHistory = updateUserRegistrationsHistory(existingHistory, events, registeredUids);
    await saveUserJson(uid, 'registrations-history', registrationsHistory);
    await saveUserJson(uid, 'registered-uids', Array.from(registeredUids));

    const suggestions = await computeOadSuggestions(events, registrationsHistory, geocache, settings, dismissedSet);
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
    await saveUserJson(uid, 'suggestions', suggestionsForApp);
    await saveUserJson(uid, 'last-update', new Date().toISOString());

    console.log(`Utilisateur ${uid} : ${registeredUids.size} inscription(s), ${suggestionsForApp.length} suggestion(s)`);
  } catch (err) {
    console.error(`Erreur traitement utilisateur ${uid} :`, err.message);
  }
}


async function loadDismissedSuggestions() {
  try {
    const res = await fetch(FIREBASE_URL + '/users/ch-houdayer_hotmail_fr/dismissed-suggestions.json');
    const remote = await res.json();
    if (Array.isArray(remote)) return new Set(remote);
  } catch (err) {
    console.error('Erreur chargement suggestions écartées :', err.message);
  }
  return new Set();
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
    console.log("Premier lancement : initialisation, aucune notification prévue.");
  } else if (newEvents.length > 0) {
    console.log(`${newEvents.length} nouveauté(s) détectée(s).`);
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
    nouveauDepuis: recentNewSet.has(e.uid) ? recentNew[e.uid] : null,
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

  const pendingNotification = {
    newEvents: isFirstRun ? [] : newEvents.map(e => ({
      tag: e.tag,
      titre: e.summary,
      lieu: e.location,
      url: e.url,
      dejaInscrit: e.dejaInscrit,
      dateDebutIso: e.startDate ? e.startDate.toISOString() : null
    })),
    topSuggestion: suggestions[0] ? {
      titre: suggestions[0].event.summary,
      lieu: suggestions[0].event.location,
      dateDebutIso: suggestions[0].event.startDate ? suggestions[0].event.startDate.toISOString() : null,
      score: suggestions[0].score,
      reasons: suggestions[0].reasons
    } : null
  };
  writeFileSync('data/pending-notification.json', JSON.stringify(pendingNotification, null, 2));

console.log('Récupération des statistiques Firebase...');
  const mailjetStats = await fetchMailjetUsageStats();
  if (mailjetStats) {
    await fetch(FIREBASE_URL + '/admin-stats-mailjet.json', { method: 'PUT', body: JSON.stringify(mailjetStats) });
    console.log(`Mailjet : ${mailjetStats.sentThisMonth} mail(s) envoyé(s) ce mois-ci`);
  } else {
    console.log('Statistiques Mailjet non disponibles.');
  }
  const usageStats = await fetchFirebaseUsageStats();
  if (usageStats) {
    await fetch(FIREBASE_URL + '/admin-stats.json', { method: 'PUT', body: JSON.stringify(usageStats) });
    console.log(`Stockage : ${(usageStats.storageBytes / 1024 / 1024).toFixed(2)} Mo / ${(usageStats.storageLimit / 1024 / 1024).toFixed(0)} Mo`);
  } else {
    console.log('Statistiques Firebase non disponibles (clé absente ou erreur).');
  }

 
  console.log('Traitement des utilisateurs enregistrés...');
  const registeredUsers = await loadRegisteredUsers();
  console.log(`${registeredUsers.length} utilisateur(s) avec un lien Eprotec configuré`);
  for (const user of registeredUsers) {
    await processUser(user, events, geocache);
  }

  console.log(`Export terminé : ${eventsForApp.length} événements à venir, ${suggestionsForApp.length} suggestions.`);
}

main().catch(err => {
  console.error('ERREUR :', err.message);
  process.exit(1);
});
