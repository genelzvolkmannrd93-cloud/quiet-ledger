import { mkdir, readFile, writeFile } from 'node:fs/promises';

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1).trim()]; }));
}

const testMode = process.argv.includes('--test');
let ownerUid = 'demo-owner';
let ownerEmail = 'owner@example.com';
if (!testMode) {
  const env = parseEnv(await readFile('.env.local', 'utf8'));
  ownerUid = (env.VITE_OWNER_UID || '').trim();
  ownerEmail = (env.VITE_OWNER_EMAIL || '').trim().toLowerCase();
}
if (!/^[A-Za-z0-9_-]{1,128}$/.test(ownerUid)) throw new Error('Private rules require a valid VITE_OWNER_UID');
if (!/^[^\s@']+@[^\s@']+\.[^\s@']+$/.test(ownerEmail)) throw new Error('Private rules require a valid VITE_OWNER_EMAIL');

const template = await readFile('firestore.private.rules.template', 'utf8');
const rules = template.replaceAll('__OWNER_UID__', ownerUid).replaceAll('__OWNER_EMAIL__', ownerEmail);
if (rules.includes('__OWNER_')) throw new Error('Private rules template still contains unresolved placeholders');
await mkdir('.generated', { recursive: true });
await writeFile('.generated/firestore.private.rules', rules, { encoding: 'utf8', mode: 0o600 });
console.log(`Private Firestore rules generated for ${testMode ? 'isolated tests' : 'local deployment'}.`);
