export const currencies = ['USD', 'EUR', 'RUB', 'GBP'] as const;
export const billingPeriods = ['monthly', 'yearly'] as const;
export const statuses = ['active', 'paused'] as const;
export const categories = ['entertainment', 'software', 'health', 'education', 'games', 'other'] as const;
export const locales = ['ru', 'en'] as const;

export type Currency = (typeof currencies)[number];
export type BillingPeriod = (typeof billingPeriods)[number];
export type SubscriptionStatus = (typeof statuses)[number];
export type Category = (typeof categories)[number];
export type Locale = (typeof locales)[number];

export type Subscription = {
  id: string;
  name: string;
  amountCents: number;
  previousAmountCents: number | null;
  currency: Currency;
  billingPeriod: BillingPeriod;
  nextBillingDate: string;
  category: Category;
  status: SubscriptionStatus;
  notes: string;
};

export type SubscriptionInput = Omit<Subscription, 'id' | 'amountCents' | 'previousAmountCents'> & {
  amount: string;
};

export type UserSettings = {
  baseCurrency: Currency;
  reminderDays: number;
  notificationsEnabled: boolean;
  language: Locale;
};

export const defaultSettings: UserSettings = {
  baseCurrency: 'RUB',
  reminderDays: 3,
  notificationsEnabled: true,
  language: 'ru',
};

export const categoryLabels: Record<Category, string> = {
  entertainment: 'Развлечения',
  software: 'Софт и ИИ',
  health: 'Здоровье',
  education: 'Обучение',
  games: 'Игры',
  other: 'Другое',
};

export const categoryColors: Record<Category, string> = {
  entertainment: '#86a98e',
  software: '#315b4e',
  health: '#d8b46d',
  education: '#819eb1',
  games: '#b58ca6',
  other: '#929c96',
};

export function monthlyAmount(item: Subscription) {
  return (item.amountCents / 100) / (item.billingPeriod === 'yearly' ? 12 : 1);
}

// Derive the next occurrence from the original anchor, without changing history.
export function nextOccurrence(item: Subscription, today = addDays(0)): string {
  const anchor = item.nextBillingDate;
  if (item.status === 'paused' || anchor >= today) return anchor;
  const [year, month, day] = anchor.split('-').map(Number);
  const [currentYear, currentMonth] = today.split('-').map(Number);
  const step = item.billingPeriod === 'yearly' ? 12 : 1;
  let offset = Math.max(0, Math.floor(((currentYear - year) * 12 + currentMonth - month) / step) * step);
  for (;;) {
    const start = new Date(Date.UTC(year, month - 1 + offset, 1));
    const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    start.setUTCDate(Math.min(day, lastDay));
    const candidate = start.toISOString().slice(0, 10);
    if (candidate >= today) return candidate;
    offset += step;
  }
}

function shiftIsoDate(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function shiftIsoMonths(value: string, months: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return first.toISOString().slice(0, 10);
}

export function upcomingOccurrences(item: Subscription, from = addDays(0), months = 12): Subscription[] {
  if (item.status !== 'active' || !Number.isInteger(months) || months < 1 || months > 60) return [];
  const endExclusive = shiftIsoMonths(from, months);
  const occurrences: Subscription[] = [];
  let searchFrom = from;
  while (occurrences.length < 61) {
    const date = nextOccurrence(item, searchFrom);
    if (date >= endExclusive) break;
    occurrences.push({ ...item, nextBillingDate: date });
    searchFrom = shiftIsoDate(date, 1);
  }
  return occurrences;
}

export function intlLocale(locale: Locale) {
  return locale === 'en' ? 'en-US' : 'ru-RU';
}

export function money(value: number, currency: Currency, locale: Locale = 'ru') {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'currency',
    currency,
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

export function addDays(days: number, now = new Date()) {
  const target = new Date(now);
  target.setDate(target.getDate() + days);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
}

export function daysUntil(value: string, now = new Date()) {
  const [year, month, day] = value.split('-').map(Number);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((Date.UTC(year, month - 1, day) - today) / 86_400_000);
}

export function validateInput(value: SubscriptionInput) {
  const name = value.name.trim();
  const notes = value.notes.trim();
  const amountText = value.amount.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(amountText)) throw new Error('Укажите корректную сумму: не более двух знаков после запятой');
  const [whole, fraction = ''] = amountText.split('.');
  const amountCents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

  if (name.length < 2 || name.length > 80) throw new Error('Название должно содержать от 2 до 80 символов');
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 100_000_000) throw new Error('Укажите корректную сумму');
  if (!currencies.includes(value.currency)) throw new Error('Неподдерживаемая валюта');
  if (!billingPeriods.includes(value.billingPeriod)) throw new Error('Некорректная периодичность');
  if (!categories.includes(value.category)) throw new Error('Некорректная категория');
  if (!statuses.includes(value.status)) throw new Error('Некорректный статус');
  const parsedDate = new Date(`${value.nextBillingDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.nextBillingDate)
    || value.nextBillingDate.startsWith('0000-')
    || Number.isNaN(parsedDate.getTime())
    || parsedDate.toISOString().slice(0, 10) !== value.nextBillingDate) {
    throw new Error('Укажите корректную дату');
  }
  if (notes.length > 500) throw new Error('Заметка не должна превышать 500 символов');

  return { ...value, name, notes, amountCents };
}

export function formatDate(value: string, locale: Locale = 'ru') {
  return new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
}

// Firestore records are untrusted, including records written by older clients.
export function parseStoredSubscription(id: string, raw: unknown): Subscription {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid subscription');
  const value = raw as Subscription;
  if (typeof value.name !== 'string' || typeof value.notes !== 'string'
    || typeof value.nextBillingDate !== 'string'
    || !Number.isSafeInteger(value.amountCents)
    || (value.previousAmountCents !== null && (!Number.isSafeInteger(value.previousAmountCents)
      || value.previousAmountCents < 1 || value.previousAmountCents > 100_000_000))) throw new Error('Invalid subscription');
  const checked = validateInput({ ...value, amount: (value.amountCents / 100).toFixed(2) });
  return { id, name: checked.name, notes: checked.notes, amountCents: checked.amountCents,
    previousAmountCents: value.previousAmountCents, currency: checked.currency,
    billingPeriod: checked.billingPeriod, nextBillingDate: checked.nextBillingDate,
    category: checked.category, status: checked.status };
}
