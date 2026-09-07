import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const root = process.cwd();
const tracked = execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0').filter(Boolean);
const patterns = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['service-account private key', /"private_key"\s*:\s*"-----BEGIN/],
  ['Google OAuth authorization code', /\b4\/0A[0-9A-Za-z_-]{20,}/],
  ['Google access or refresh token', /\b(?:ya29\.|1\/\/)[0-9A-Za-z._-]{20,}/],
  ['GitHub token', /\b(?:ghp_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{40,})/],
  ['Stripe secret key', /\bsk_(?:live|test)_[0-9A-Za-z]{16,}/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
];

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => { const index = line.indexOf('='); return [line.slice(0, index).trim(), line.slice(index + 1).trim()]; }));
}

let localEnv = {};
try { localEnv = parseEnv(await readFile('.env.local', 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const privateIdentifiers = [localEnv.VITE_OWNER_EMAIL, localEnv.VITE_OWNER_UID].filter((value) => value && value.length >= 4);
const findings = [];
for (const path of tracked) {
  let content;
  try { content = await readFile(path, 'utf8'); } catch { continue; }
  if (content.includes('\0')) continue;
  for (const [label, pattern] of patterns) if (pattern.test(content)) findings.push(`${path}: ${label}`);
  for (const value of privateIdentifiers) if (content.includes(value)) findings.push(`${path}: private owner identifier`);
  if (/(^|\/)\.env(?:\.|$)/.test(path)) {
    const values = parseEnv(content);
    for (const [key, value] of Object.entries(values)) {
      if (value && /(?:SECRET|PASSWORD|TOKEN|PRIVATE_KEY|SERVICE_ACCOUNT|SHOP_ID)/i.test(key)) findings.push(`${path}: non-empty sensitive environment variable ${key}`);
    }
  }
}
if (findings.length) throw new Error(`Repository source contains sensitive material:\n${[...new Set(findings)].join('\n')}`);
console.log(`Repository secret check passed for ${tracked.length} source files.`);
