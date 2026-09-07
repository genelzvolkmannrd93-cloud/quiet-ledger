import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { App } from '../src/App';
import { deleteUserData, editSubscription, restoreBackup, toggleSubscription } from '../src/data';
import { deleteCurrentAccount, getUserPlan, refreshVerifiedUser, registerWithEmail, requestPasswordReset, sendVerificationEmail, signInWithEmail } from '../src/firebase';

const harness = vi.hoisted(() => ({
  authChanged: undefined as undefined | ((user: unknown) => void),
  streams: [] as Array<{ uid: string; next: (items: unknown[]) => void; stop: ReturnType<typeof vi.fn> }>,
}));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => {
  harness.authChanged = callback;
  return vi.fn();
} }));
vi.mock('../src/firebase', () => ({
  auth: {}, db: {}, deleteCurrentAccount: vi.fn(), firebaseConfigured: true, publicAccess: true, supportEmail: '',
  getUserPlan: vi.fn().mockResolvedValue('free'), isAllowedOwner: () => true, ownerEmail: 'owner@example.com', leaveAccount: vi.fn(),
  refreshVerifiedUser: vi.fn(), registerWithEmail: vi.fn(), requestPasswordReset: vi.fn(), sendVerificationEmail: vi.fn(),
  signInWithEmail: vi.fn(), signInWithGoogle: vi.fn(),
}));
vi.mock('../src/data', () => ({
  ensureOwnerDocuments: vi.fn().mockResolvedValue(undefined),
  watchSubscriptions: (_db: unknown, uid: string, next: (items: unknown[]) => void) => {
    const stop = vi.fn(); harness.streams.push({ uid, next, stop }); return stop;
  },
  watchSettings: () => vi.fn(),
  createSubscription: vi.fn(), deleteUserData: vi.fn(), restoreBackup: vi.fn(), editSubscription: vi.fn(),
  removeSubscription: vi.fn(), toggleSubscription: vi.fn(), updateSettings: vi.fn(),
}));
afterEach(() => {
  cleanup();
  harness.streams.length = 0;
  vi.mocked(restoreBackup).mockReset();
  vi.mocked(deleteUserData).mockReset();
  vi.mocked(deleteCurrentAccount).mockReset();
  vi.mocked(editSubscription).mockReset();
  vi.mocked(toggleSubscription).mockReset();
  vi.mocked(refreshVerifiedUser).mockReset();
  vi.mocked(registerWithEmail).mockReset();
  vi.mocked(requestPasswordReset).mockReset();
  vi.mocked(sendVerificationEmail).mockReset();
  vi.mocked(signInWithEmail).mockReset();
  window.history.replaceState(null, '', '/');
});

const user = (uid: string, emailVerified = true) => ({ uid, displayName: uid, email: `${uid}@example.com`, emailVerified });
const subscription = (name: string) => ({ id: 'sample', name, amountCents: 500, previousAmountCents: null,
  currency: 'RUB', billingPeriod: 'monthly', nextBillingDate: '2026-09-06', category: 'software',
  status: 'active', notes: '' });

test('public landing calculator works locally before authentication', async () => {
  render(<App />);
  await act(async () => { harness.authChanged!(null); });
  expect(screen.getByRole('heading', { name: 'Подписки не должны становиться неожиданностью' })).toBeTruthy();
  expect(screen.getByText(/35\s?940/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Количество подписок'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Средняя цена в месяц, ₽'), { target: { value: '1000' } });
  expect(screen.getByText(/24\s?000/)).toBeTruthy();
  expect(screen.getByText(/только в браузере и никуда не отправляется/)).toBeTruthy();
});

test('privacy notice is available before authentication and documents the launch blocker', () => {
  window.history.replaceState(null, '', '/?legal=privacy');
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Политика конфиденциальности' })).toBeTruthy();
  expect(screen.getByText(/не даёт сервису доступа к содержимому вашей почты/)).toBeTruthy();
  expect(screen.getByText(/техническая отметка UID без email/)).toBeTruthy();
  expect(screen.getByText(/обязательный пункт перед открытым запуском/)).toBeTruthy();
  expect(harness.streams).toHaveLength(0);
});

test('account switch clears prior records and ignores a late previous-account snapshot', async () => {
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  const alice = harness.streams[0];
  await act(async () => { alice.next([{ ...subscription('Alice private service'), id: 'free-1' }]); });
  expect(screen.getAllByText('Alice private service').length).toBeGreaterThan(0);
  await act(async () => { harness.authChanged!(user('bob')); });
  expect(screen.queryByText('Alice private service')).toBeNull();
  expect(alice.stop).toHaveBeenCalledOnce();
  await act(async () => { alice.next([{ ...subscription('Stale private service'), id: 'free-1' }]); });
  expect(screen.queryByText('Stale private service')).toBeNull();
  await act(async () => { harness.streams[1].next([{ ...subscription('Bob service'), id: 'free-1' }]); });
  expect(screen.getAllByText('Bob service').length).toBeGreaterThan(0);
  await act(async () => { harness.authChanged!(null); });
  expect(screen.queryByText('Bob service')).toBeNull();
});

test('dashboard keeps different currencies separate instead of applying a stale rate', async () => {
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  await act(async () => { harness.streams[0].next([
    { ...subscription('Ruble service'), id: 'free-1' },
    { ...subscription('Dollar service'), id: 'free-2', currency: 'USD', amountCents: 2_000 },
  ]); });
  const metric = screen.getByText('В месяц').closest('article')?.textContent || '';
  expect(metric).toContain('5,00 ₽');
  expect(metric).toContain('20,00 $');
  expect(metric).toContain('валюты отдельно');
});

test('free plan exposes its three-record limit and disables every add entry point', async () => {
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  await act(async () => { harness.streams[0].next([
    { ...subscription('One'), id: 'free-1' },
    { ...subscription('Two'), id: 'free-2' },
    { ...subscription('Three'), id: 'free-3' },
  ]); });
  expect(screen.getByText('3 из 3 подписок')).toBeTruthy();
  for (const button of screen.getAllByRole('button', { name: 'Добавить подписку' })) {
    expect((button as HTMLButtonElement).disabled).toBe(true);
  }
});

test('settings disclose that Gmail access is unavailable until separate consent and review', async () => {
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  await act(async () => { harness.streams[0].next([]); });
  fireEvent.click(screen.getAllByRole('button', { name: 'Настройки' })[0]);
  expect(screen.getByText('Автообнаружение через Gmail')).toBeTruthy();
  expect(screen.getByText(/почта не подключается и её содержимое не читается/)).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Подключить позже' }) as HTMLButtonElement).disabled).toBe(true);
});

test('free plan keeps legacy paid records as read-only archive and excludes them from totals', async () => {
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  await act(async () => { harness.streams[0].next([
    { ...subscription('Free record'), id: 'free-1' },
    { ...subscription('Legacy paid record'), id: 'legacy-paid', amountCents: 10_000 },
  ]); });
  expect(screen.getByText('1 из 3 подписок')).toBeTruthy();
  expect(screen.getByText(/1 в архиве/)).toBeTruthy();
  const metric = screen.getByText('В месяц').closest('article')?.textContent || '';
  expect(metric).toContain('5,00 ₽');
  expect(metric).not.toContain('105');
  fireEvent.click(screen.getAllByRole('button', { name: 'Подписки' })[0]);
  expect(screen.getByText('Архив')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Изменить Legacy paid record' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Поставить на паузу' })).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Удалить Legacy paid record' })).toBeTruthy();
  expect(editSubscription).not.toHaveBeenCalled();
  expect(toggleSubscription).not.toHaveBeenCalled();
});

test('paid token claim removes the client-side creation limit', async () => {
  vi.mocked(getUserPlan).mockResolvedValueOnce('paid');
  render(<App />);
  await act(async () => { harness.authChanged!(user('paid')); await Promise.resolve(); });
  await act(async () => { harness.streams[0].next([
    subscription('One'), { ...subscription('Two'), id: 'two' }, { ...subscription('Three'), id: 'three' },
  ]); });
  expect(screen.queryByText('3 из 3 подписок')).toBeNull();
  for (const button of screen.getAllByRole('button', { name: 'Добавить подписку' })) {
    expect((button as HTMLButtonElement).disabled).toBe(false);
  }
  fireEvent.click(screen.getAllByRole('button', { name: 'Настройки' })[0]);
  expect(screen.getByText('Платный')).toBeTruthy();
});

test('email login reports a generic credential error without starting data streams', async () => {
  vi.mocked(signInWithEmail).mockRejectedValueOnce(Object.assign(new Error('internal details'), { code: 'auth/invalid-credential' }));
  render(<App />);
  await act(async () => { harness.authChanged!(null); });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'person@example.com' } });
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'private-password' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Войти по email' })); });
  expect(signInWithEmail).toHaveBeenCalledWith('person@example.com', 'private-password');
  expect(screen.getByRole('alert').textContent).toBe('Неверный email или пароль.');
  expect(harness.streams).toHaveLength(0);
});

test('email registration requires explicit acceptance of terms and privacy policy', async () => {
  render(<App />);
  await act(async () => { harness.authChanged!(null); });
  fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
  const submit = screen.getByRole('button', { name: 'Создать аккаунт' });
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getAllByRole('link', { name: 'условия использования' })).toHaveLength(2);
  expect(screen.getAllByRole('link', { name: 'политику конфиденциальности' })).toHaveLength(2);
  fireEvent.click(screen.getByRole('checkbox'));
  expect((submit as HTMLButtonElement).disabled).toBe(false);
});

test('email registration requests a verified account', async () => {
  vi.mocked(registerWithEmail).mockResolvedValueOnce(undefined);
  render(<App />);
  await act(async () => { harness.authChanged!(null); });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'safe-password' } });
  fireEvent.click(screen.getByRole('checkbox'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' })); });
  expect(registerWithEmail).toHaveBeenCalledWith('new@example.com', 'safe-password');
  expect(harness.streams).toHaveLength(0);
});

test('password reset is available without loading user data', async () => {
  vi.mocked(requestPasswordReset).mockResolvedValueOnce(undefined);
  render(<App />);
  await act(async () => { harness.authChanged!(null); });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'person@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Забыли пароль?' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Отправить ссылку' })); });
  expect(requestPasswordReset).toHaveBeenCalledWith('person@example.com');
  expect(screen.getByRole('alert').textContent).toBe('Ссылка для восстановления отправлена. Проверьте также папку «Спам».');
  expect(harness.streams).toHaveLength(0);
});

test('unverified email cannot load data until the refreshed token is verified', async () => {
  vi.mocked(refreshVerifiedUser).mockResolvedValueOnce(true);
  render(<App />);
  await act(async () => { harness.authChanged!(user('new', false)); });
  expect(screen.getByRole('heading', { name: 'Подтвердите email' })).toBeTruthy();
  expect(harness.streams).toHaveLength(0);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Я подтвердил email' })); });
  expect(refreshVerifiedUser).toHaveBeenCalledOnce();
  expect(harness.streams).toHaveLength(1);
  expect(harness.streams[0].uid).toBe('new');
});

test('verification email can be sent again while data remains sealed', async () => {
  vi.mocked(sendVerificationEmail).mockResolvedValueOnce(undefined);
  render(<App />);
  await act(async () => { harness.authChanged!(user('new', false)); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Отправить письмо повторно' })); });
  expect(sendVerificationEmail).toHaveBeenCalledOnce();
  expect(screen.getByText('Новое письмо отправлено. Проверьте также папку «Спам».')).toBeTruthy();
  expect(harness.streams).toHaveLength(0);
});

test('restore requires confirmation and allows retry after a network error', async () => {
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  await act(async () => { harness.streams[0].next([]); });
  fireEvent.click(screen.getAllByRole('button', { name: 'Настройки' })[0]);
  const text = JSON.stringify({ subscriptions: [subscription('Backup service')],
    settings: { baseCurrency: 'RUB', reminderDays: 3, notificationsEnabled: true } });
  const file = new File([text], 'backup.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => text });
  await act(async () => { fireEvent.change(screen.getByLabelText('Выберите резервную копию JSON'), { target: { files: [file] } }); });
  expect(screen.getByRole('dialog', { name: 'Восстановление резервной копии' })).toBeTruthy();
  expect(restoreBackup).not.toHaveBeenCalled();
  vi.mocked(restoreBackup).mockRejectedValueOnce(Object.assign(new Error('Offline'), { code: 'unavailable' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Восстановить', exact: true })); });
  expect(screen.getByText('Нет связи с Google. Проверьте интернет и попробуйте ещё раз.')).toBeTruthy();
  expect(screen.getByRole('dialog', { name: 'Восстановление резервной копии' })).toBeTruthy();
  vi.mocked(restoreBackup).mockResolvedValueOnce(1);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Восстановить', exact: true })); });
  expect(restoreBackup).toHaveBeenCalledTimes(2);
  expect(vi.mocked(restoreBackup).mock.calls[1][1]).toBe('alice');
  expect(vi.mocked(restoreBackup).mock.calls[1][3]).toBe('free');
  expect(screen.queryByRole('dialog', { name: 'Восстановление резервной копии' })).toBeNull();
  expect(screen.getByText('Восстановлено подписок: 1. Существующие записи сохранены, настройки восстановлены.')).toBeTruthy();
});

test('deleting an account and its data requires an explicit destructive confirmation', async () => {
  vi.mocked(deleteUserData).mockResolvedValueOnce(undefined);
  vi.mocked(deleteCurrentAccount).mockResolvedValueOnce(undefined);
  render(<App />);
  const alice = user('alice');
  await act(async () => { harness.authChanged!(alice); });
  await act(async () => { harness.streams[0].next([]); });
  fireEvent.click(screen.getAllByRole('button', { name: 'Настройки' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Удалить аккаунт и данные' }));
  expect(screen.getByRole('alertdialog', { name: 'Удаление аккаунта и всех данных' })).toBeTruthy();
  expect(screen.getByText(/останется только техническая отметка удалённого UID/)).toBeTruthy();
  expect(deleteUserData).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Удалить аккаунт' })); });
  expect(deleteUserData).toHaveBeenCalledWith({}, 'alice');
  expect(deleteCurrentAccount).toHaveBeenCalledWith(alice);
});

test('account switch cannot retarget an in-flight account deletion', async () => {
  let finishDeletion!: () => void;
  vi.mocked(deleteUserData).mockImplementationOnce(() => new Promise<void>((resolve) => { finishDeletion = resolve; }));
  vi.mocked(deleteCurrentAccount).mockResolvedValueOnce(undefined);
  render(<App />);
  const alice = user('alice');
  await act(async () => { harness.authChanged!(alice); });
  await act(async () => { harness.streams[0].next([]); });
  fireEvent.click(screen.getAllByRole('button', { name: 'Настройки' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Удалить аккаунт и данные' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Удалить аккаунт' })); });
  await act(async () => { harness.authChanged!(user('bob')); });
  await act(async () => { finishDeletion(); await Promise.resolve(); });
  expect(deleteCurrentAccount).toHaveBeenCalledWith(alice);
  expect(deleteCurrentAccount).not.toHaveBeenCalledWith(expect.objectContaining({ uid: 'bob' }));
});

test('Escape dismisses an idle subscription form without saving', async () => {
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  await act(async () => { harness.streams[0].next([]); });
  fireEvent.click(screen.getAllByRole('button', { name: 'Добавить подписку' })[0]);
  expect(screen.getByRole('dialog', { name: 'Новая подписка' })).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Новая подписка' })).toBeNull();
});

test('calendar renders a year of occurrences but edits the stored recurrence anchor', async () => {
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  const recurring = { ...subscription('Forecast service'), id: 'free-1', nextBillingDate: '2024-01-31' };
  await act(async () => { harness.streams[0].next([recurring]); });
  fireEvent.click(screen.getAllByRole('button', { name: 'Календарь' })[0]);
  const occurrences = screen.getAllByRole('button', { name: /Forecast service/ });
  expect(occurrences).toHaveLength(12);
  fireEvent.click(occurrences[0]);
  expect(screen.getByRole('dialog', { name: 'Изменить подписку' })).toBeTruthy();
  expect((screen.getByLabelText('Следующее списание') as HTMLInputElement).value).toBe('2024-01-31');
});
