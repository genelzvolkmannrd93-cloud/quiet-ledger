import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const projectId = 'demo-quiet-ledger';
const origin = 'http://127.0.0.1:4174';
const authOrigin = 'http://127.0.0.1:9099';

async function firstExisting(paths) {
  for (const path of paths) {
    try { await access(path); return path; } catch { /* try the next known installation */ }
  }
  throw new Error('Chrome or Chromium was not found for the public browser test');
}

async function waitForUrl(url, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function verifyNewestEmail(email) {
  const response = await fetch(`${authOrigin}/emulator/v1/projects/${projectId}/oobCodes`);
  if (!response.ok) throw new Error(`Could not read Auth emulator OOB codes: ${response.status}`);
  const payload = await response.json();
  const code = [...(payload.oobCodes || [])].reverse().find((entry) => entry.email === email && entry.requestType === 'VERIFY_EMAIL');
  if (!code?.oobCode) throw new Error(`Verification code was not generated for ${email}`);
  const apply = await fetch(`${authOrigin}/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ oobCode: code.oobCode, returnSecureToken: true }),
  });
  if (!apply.ok) throw new Error(`Auth emulator rejected email verification: ${apply.status}`);
}

async function createVerifiedAccount(page, email, password) {
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await page.getByRole('heading', { name: 'Подтвердите email' }).waitFor();
  await verifyNewestEmail(email);
  await page.getByRole('button', { name: 'Я подтвердил email' }).click();
  await page.getByText('Бесплатный тариф').waitFor();
}

async function addSubscription(page, name, amount) {
  await page.getByRole('button', { name: 'Добавить подписку' }).first().click();
  await page.getByLabel('Название сервиса').fill(name);
  await page.getByLabel('Сумма').fill(amount);
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByText('Подписка добавлена').waitFor();
}

const executablePath = await firstExisting(process.platform === 'win32' ? [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']);

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--mode', 'public-emulator', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], {
  cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let viteErrors = '';
vite.stderr.on('data', (chunk) => { viteErrors += chunk.toString(); });

let browser;
try {
  await waitForUrl(origin);
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(origin, { waitUntil: 'networkidle' });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error(`Public landing overflows the mobile viewport by ${overflow}px`);
  await page.getByLabel('Количество подписок').fill('2');
  await page.getByLabel('Средняя цена в месяц, ₽').fill('1000');
  await page.getByText(/24\s?000\s?₽/).waitFor();

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const firstEmail = `alice-${suffix}@example.com`;
  const secondEmail = `bob-${suffix}@example.com`;
  const password = 'Local-test-password-42';
  await createVerifiedAccount(page, firstEmail, password);
  await addSubscription(page, 'Alice private subscription', '499');
  await page.getByRole('button', { name: 'Настройки' }).last().click();
  await page.getByLabel('Напоминать заранее').fill('7');
  await page.getByRole('button', { name: 'Сохранить настройки' }).click();
  await page.getByText('Настройки сохранены').waitFor();
  await page.getByRole('button', { name: 'Выйти из аккаунта' }).click();

  await createVerifiedAccount(page, secondEmail, password);
  if (await page.getByText('Alice private subscription').count()) throw new Error('A second account could see the first account subscription');
  await page.getByText('Пока здесь тихо').first().waitFor();
  await addSubscription(page, 'Bob private subscription', '799');
  await page.getByRole('button', { name: 'Настройки' }).last().click();
  await page.getByRole('button', { name: 'Удалить аккаунт и данные' }).click();
  await page.getByRole('button', { name: 'Удалить аккаунт', exact: true }).click();
  await page.getByRole('heading', { name: 'Ваши подписки — только для вас' }).waitFor();
  await page.getByLabel('Email').fill(secondEmail);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти по email' }).click();
  await page.getByText('Неверный email или пароль.').waitFor();

  await page.getByLabel('Email').fill(firstEmail);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти по email' }).click();
  await page.getByText('Alice private subscription').first().waitFor();
  if (await page.getByText('Bob private subscription').count()) throw new Error('The first account could see the second account subscription');
  await page.getByRole('button', { name: 'Настройки' }).last().click();
  if (await page.getByLabel('Напоминать заранее').inputValue() !== '7') throw new Error('Saved settings were not restored after sign-in');
  if (await page.getByRole('button', { name: /резервн/i }).count()) throw new Error('Removed backup controls remain visible');
  if ((await page.locator('body').innerText()).includes('ЛЁД')) throw new Error('Internal ICE branding remains visible');
  await page.getByLabel('Язык интерфейса').selectOption('en');
  await page.getByRole('heading', { name: 'Settings' }).waitFor();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByText('Settings saved').waitFor();
  await page.getByRole('button', { name: 'Sign out of account' }).click();
  await page.getByRole('heading', { name: 'Your subscriptions are yours alone' }).waitFor();
  await page.getByLabel('Email').fill(firstEmail);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in with email' }).click();
  await page.getByRole('button', { name: 'Settings' }).last().click();
  if (await page.getByLabel('Interface language').inputValue() !== 'en') throw new Error('Saved language was not restored after sign-in');
  if (pageErrors.length) throw new Error(`Browser page error: ${pageErrors.join('; ')}`);
  console.log('Public browser flow passed: mobile layout, auth, CRUD, language, deletion and isolation.');
} finally {
  if (browser) await browser.close();
  const viteWasRunning = vite.exitCode === null && vite.signalCode === null;
  vite.kill();
  await new Promise((resolve) => { vite.once('exit', resolve); setTimeout(resolve, 2_000); });
  if (!viteWasRunning && vite.exitCode && vite.exitCode !== 0) throw new Error(`Vite exited with ${vite.exitCode}: ${viteErrors}`);
}
