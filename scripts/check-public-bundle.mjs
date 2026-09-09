import { readFile, readdir } from 'node:fs/promises';

async function readOptional(path) {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1).trim()]; }));
}

async function filesBelow(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory()
    ? filesBelow(`${path}/${entry.name}`)
    : Promise.resolve([`${path}/${entry.name}`])));
  return nested.flat();
}

const env = parseEnv(await readOptional('.env.local'));
const files = (await filesBelow('dist-public')).filter((path) => /\.(?:html|js|css)$/.test(path));
const bundle = (await Promise.all(files.map((path) => readFile(path, 'utf8')))).join('\n');
if (!bundle.includes('Создайте личный аккаунт')) throw new Error('Public account UI is missing from the public bundle');
if (!bundle.includes('name="robots" content="index, follow"')) throw new Error('Public indexing policy is missing');
for (const removedLabel of ['ЛЁД', 'Скачать резервную копию', 'Восстановить резервную копию']) {
  if (bundle.includes(removedLabel)) throw new Error(`Removed UI label remains in the public bundle: ${removedLabel}`);
}
if (env.VITE_OWNER_UID && bundle.includes(env.VITE_OWNER_UID)) throw new Error('Private owner UID leaked into the public bundle');
if (env.VITE_OWNER_EMAIL && env.VITE_OWNER_EMAIL !== env.VITE_SUPPORT_EMAIL && bundle.includes(env.VITE_OWNER_EMAIL)) {
  throw new Error('Private owner email leaked into the public bundle');
}
console.log('Public bundle contains public UI, no removed labels and no private owner identity.');
