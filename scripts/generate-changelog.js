import { readFileSync, writeFileSync, existsSync } from 'fs';

const CHANGELOG_PATH = 'data/changelog.json';
const fullMessage = process.env.COMMIT_MESSAGE || '';
const lines = fullMessage.split('\n').map(l => l.trim());
const title = lines[0] || 'Mise à jour';
const items = lines.slice(1).filter(l => l.length > 0);

if (items.length === 0) {
  console.log("Pas de description étendue sur ce commit, changelog non modifié.");
  process.exit(0);
}

const changelog = existsSync(CHANGELOG_PATH) ? JSON.parse(readFileSync(CHANGELOG_PATH, 'utf8')) : [];
const lastVersion = changelog[0] ? parseFloat(changelog[0].version) : 1.0;
const newVersion = (lastVersion + 0.1).toFixed(1);

changelog.unshift({
  version: newVersion,
  date: new Date().toISOString(),
  title,
  items
});

writeFileSync(CHANGELOG_PATH, JSON.stringify(changelog, null, 2));
console.log(`Changelog mis à jour : version ${newVersion}`);
