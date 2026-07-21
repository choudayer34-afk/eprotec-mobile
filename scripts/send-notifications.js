import nodemailer from 'nodemailer';
import { readFileSync, existsSync } from 'fs';

function formatDate(iso) {
  if (!iso) return 'date inconnue';
  return new Date(iso).toLocaleString('fr-FR', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

async function sendMail(newEvents, topSuggestion) {
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

  const suggestionHtml = topSuggestion ? `
    <div style="margin-bottom:14px;padding:10px;border:2px solid #F5821F;border-radius:6px;">
      <b>🎯 Suggestion du mois : [DPS] ${topSuggestion.titre}</b><br>
      Date : ${formatDate(topSuggestion.dateDebutIso)}<br>
      Lieu : ${topSuggestion.lieu || 'non renseigné'}<br>
      Score : ${topSuggestion.score}<br>
      <ul>${topSuggestion.reasons.map(r => `<li>${r}</li>`).join('')}</ul>
    </div>
  ` : '';

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

  const titles = newEvents.slice(0, 3).map(e => `[${e.tag}] ${e.titre}`).join('\n');
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
  await sendMail(newEvents, data.topSuggestion);
  await sendPushNotification(newEvents);
  console.log('Alertes envoyées.');
}

main().catch(err => {
  console.error('ERREUR notifications :', err.message);
  process.exit(1);
});
