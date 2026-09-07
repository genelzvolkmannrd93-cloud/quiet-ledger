import { currencies, validateInput, type Subscription, type UserSettings } from './domain.ts';

export type Backup = { subscriptions: Subscription[]; settings: UserSettings };

export function serializeBackup(subscriptions: Subscription[], settings: UserSettings): string {
  return JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    subscriptions: subscriptions.map(({ id, name, amountCents, previousAmountCents, currency,
      billingPeriod, nextBillingDate, category, status, notes }) => ({ id, name, amountCents,
      previousAmountCents, currency, billingPeriod, nextBillingDate, category, status, notes })),
    settings: { baseCurrency: settings.baseCurrency, reminderDays: settings.reminderDays,
      notificationsEnabled: settings.notificationsEnabled },
  }, null, 2);
}

export function parseBackup(text: string): Backup {
  if (new TextEncoder().encode(text).byteLength > 2_000_000) throw new Error('Файл слишком большой (максимум 2 МБ)');
  const data = JSON.parse(text);
  if (data?.version !== undefined && data.version !== 1) throw new Error('Неподдерживаемая версия резервной копии');
  if (!data || !Array.isArray(data.subscriptions) || data.subscriptions.length > 400) throw new Error('В копии должно быть не более 400 подписок');
  const settings = data.settings;
  if (!settings || !currencies.includes(settings.baseCurrency) || !Number.isInteger(settings.reminderDays)
    || settings.reminderDays < 0 || settings.reminderDays > 30 || typeof settings.notificationsEnabled !== 'boolean') throw new Error('Некорректные настройки в копии');
  const ids = new Set<string>();
  const subscriptions = data.subscriptions.map((entry: Subscription) => {
    if (!entry || typeof entry.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(entry.id) || ids.has(entry.id)) throw new Error('Некорректный или повторный идентификатор подписки');
    ids.add(entry.id);
    if (typeof entry.name !== 'string' || typeof entry.notes !== 'string' || !Number.isInteger(entry.amountCents)) throw new Error('Некорректная запись в копии');
    const value = validateInput({ ...entry, amount: String(entry.amountCents / 100) });
    if (entry.previousAmountCents !== null && (!Number.isInteger(entry.previousAmountCents) || entry.previousAmountCents <= 0 || entry.previousAmountCents > 100_000_000)) throw new Error('Некорректная предыдущая цена');
    return { id: entry.id, name: value.name, notes: value.notes, amountCents: value.amountCents,
      previousAmountCents: entry.previousAmountCents, currency: value.currency, billingPeriod: value.billingPeriod,
      nextBillingDate: value.nextBillingDate, category: value.category, status: value.status };
  });
  return { subscriptions, settings: { baseCurrency: settings.baseCurrency, reminderDays: settings.reminderDays, notificationsEnabled: settings.notificationsEnabled } };
}
