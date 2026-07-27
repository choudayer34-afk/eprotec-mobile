import nodemailer from 'nodemailer';
import { readFileSync, existsSync } from 'fs';

const FIREBASE_URL = 'https://eprotec-favoris-default-rtdb.europe-west1.firebasedatabase.app';

async function loadNotificationRecipients() {
  try {
    const res = await fetch(FIREBASE_URL + '/users.json');
    const data = await res.json();
    if (!data || typeof data !== 'object') return [];
    return Object.keys(data)
      .map(uid => {
        const prefs = data[uid]['notif-prefs'];
        const fallbackEmail = data[uid].email;
        if (prefs) {
          if (prefs.enabled === false || !prefs.email) return null;
          return { uid, email: prefs.email };
        }
        if (fallbackEmail) return { uid, email: fallbackEmail };
        return null;
      })
      .filter(Boolean);
  } catch (err) {
    console.error('Erreur chargement destinataires :', err.message);
    return [];
  }
}

async function loadUserTopSuggestion(uid) {
  try {
    const res = await fetch(`${FIREBASE_URL}/users/${uid}/data/suggestions.json`);
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  } catch {
    return null;
  }
}

function formatDate(iso) {
  if (!iso) return 'date inconnue';
  return new Date(iso).toLocaleString('fr-FR', {
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
      <b>[${e.tag}] ${e.titre}</b><br>
      Date : ${formatDate(e.dateDebutIso)}<br>
      Lieu : ${e.lieu || 'non renseigné'}<br>
      ${e.dejaInscrit ? '✅ Vous êtes déjà inscrit<br>' : ''}
      ${e.url ? `<a href="${e.url}">Voir l'événement</a>` : ''}
    </div>
  `).join('');

  const recipients = await loadNotificationRecipients();

  if (recipients.length === 0 && process.env.MAIL_TO) {
    console.log('Aucun destinataire trouvé dans Firebase, repli sur MAIL_TO.');
    recipients.push({ uid: null, email: process.env.MAIL_TO });
  }

  for (const recipient of recipients) {
    const personalTop = recipient.uid ? await loadUserTopSuggestion(recipient.uid) : null;
    const suggestionHtml = personalTop ? `
      <div style="margin-bottom:14px;padding:10px;border:2px solid #F5821F;border-radius:6px;">
        <b>🎯 Votre suggestion du mois : [${personalTop.tag || 'DPS'}] ${personalTop.titre}</b><br>
        Date : ${formatDate(personalTop.dateDebut || personalTop.dateDebutIso)}<br>
        Lieu : ${personalTop.lieu || 'non renseigné'}<br>
        Score : ${personalTop.score}<br>
        <ul>${(personalTop.reasons || []).map(r => `<li>${r.category === 'positive' ? '✅' : r.category === 'negative' ? '⚠️' : '•'} ${r.text}</li>`).join('')}</ul>
      </div>
    ` : '';

    try {
      await transporter.sendMail({
        from: process.env.MAIL_FROM,
        to: recipient.email,
        subject: `[Protection Civile] ${newEvents.length} nouvelle(s) activité(s) détectée(s)`,
        html: `<p>Bonjour,</p><p>Voici les nouveautés détectées :</p>${items}${suggestionHtml}`
      });
      console.log(`Mail envoyé à ${recipient.email}`);
    } catch (err) {
      console.error(`Erreur envoi mail à ${recipient.email} :`, err.message);
    }
  }
}

async function sendPushNotification(newEvents) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  const titles = newEvents.slice(0, 3).map(e => `[${e.tag}] ${e.titre}`).join('\n');
  const suffix = newEvents.length > 3 ? `\n...et ${newEvents.length - 3} autre(s)` : '';
  const appUrl = 'https://eprotec-mobile.choudayer34.workers.dev/#nouveautes';
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

async function main() {
  const path = 'data/pending-notification.json';
  if (!existsSync(path)) {
    console.log('Aucune notification en attente.');
    return;
  }
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const newEvents = data.newEvents || [];
  if (newEvents.length === 0) {
    console.log('Aucune nouveauté à notifier.');
    return;
  }
  console.log(`Envoi des alertes pour ${newEvents.length} nouveauté(s)...`);
  await sendMail(newEvents);
  await sendPushNotification(newEvents);
  console.log('Alertes envoyées.');
}

main().catch(err => {
  console.error('ERREUR notifications :', err.message);
  process.exit(1);
});
