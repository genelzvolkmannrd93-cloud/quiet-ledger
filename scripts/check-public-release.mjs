import { readFile } from 'node:fs/promises';

async function readOptional(path) {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1).trim()]; }));
}

const env = {
  ...parseEnv(await readOptional('.env.public')),
  ...parseEnv(await readOptional('.env.local')),
  ...parseEnv(await readOptional('.env.public.local')),
};
const required = [
  'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET', 'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_FIREBASE_APP_ID',
  'VITE_RECAPTCHA_ENTERPRISE_SITE_KEY', 'VITE_SUPPORT_EMAIL',
];
const missing = required.filter((key) => !env[key]);
if (env.VITE_ACCESS_MODE !== 'public') missing.push('VITE_ACCESS_MODE=public');
if (missing.length) throw new Error(`Public release is blocked; missing: ${missing.join(', ')}`);
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.VITE_SUPPORT_EMAIL)) throw new Error('Public release is blocked; VITE_SUPPORT_EMAIL is invalid');
if (env.VITE_PAID_FEATURES_ENABLED !== 'false') {
  throw new Error('Public release is blocked; paid features require a trusted billing and entitlement backend');
}
const firebaseConfig = JSON.parse(await readFile('firebase.public.json', 'utf8'));
if (firebaseConfig.firestore?.rules !== 'firestore.public.rules') throw new Error('Public release must deploy firestore.public.rules');
if (firebaseConfig.hosting?.public !== 'dist-public') throw new Error('Public release must deploy dist-public');
const privateConfig = JSON.parse(await readFile('firebase.json', 'utf8'));
if (privateConfig.firestore?.rules !== '.generated/firestore.private.rules') throw new Error('Private deploy must use generated private rules');
if (privateConfig.hosting?.public !== 'dist') throw new Error('Private deploy must deploy dist');
if (privateConfig.hosting.public === firebaseConfig.hosting.public) throw new Error('Private and public builds must use different directories');
const html = await readFile('dist-public/index.html', 'utf8');
if (!html.includes('name="robots" content="index, follow"')) throw new Error('Public build does not have its explicit indexing policy');

console.log('Public release configuration is complete.');
