import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { App } from '../src/App';
import { createSubscription, deleteUserData, editSubscription, ensureOwnerDocuments, removeSubscription, toggleSubscription, updateSettings } from '../src/data';
import { completeGoogleRedirect, deleteCurrentAccount, getUserPlan, refreshVerifiedUser, registerWithEmail, requestPasswordReset, sendVerificationEmail, signInWithEmail, signInWithGoogle } from '../src/firebase';

const harness = vi.hoisted(() => ({
  authChanged: undefined as undefined | ((user: unknown) => void),
  streams: [] as Array<{ uid: string; next: (items: unknown[]) => void; stop: ReturnType<typeof vi.fn> }>,
}));
vi.stubGlobal('scrollTo', vi.fn());
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => {
  harness.authChanged = callback;
  return vi.fn();
} }));
vi.mock('../src/firebase', () => ({
  auth: {}, db: {}, deleteCurrentAccount: vi.fn(), firebaseConfigured: true, publicAccess: true, supportEmail: '',
  completeGoogleRedirect: vi.fn().mockResolvedValue(null),
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
  createSubscription: vi.fn(), deleteUserData: vi.fn(), editSubscription: vi.fn(),
  removeSubscription: vi.fn(), toggleSubscription: vi.fn(), updateSettings: vi.fn(),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(ensureOwnerDocuments).mockReset().mockResolvedValue(true);
  vi.useRealTimers();
  cleanup();
  harness.streams.length = 0;
  vi.mocked(deleteUserData).mockReset();
  vi.mocked(removeSubscription).mockReset();
  vi.mocked(createSubscription).mockReset();
  vi.mocked(deleteCurrentAccount).mockReset();
  vi.mocked(editSubscription).mockReset();
  vi.mocked(toggleSubscription).mockReset();
  vi.mocked(updateSettings).mockReset();
  vi.mocked(refreshVerifiedUser).mockReset();
  vi.mocked(registerWithEmail).mockReset();
  vi.mocked(requestPasswordReset).mockReset();
  vi.mocked(sendVerificationEmail).mockReset();
  vi.mocked(signInWithEmail).mockReset();
  vi.mocked(signInWithGoogle).mockReset();
  vi.mocked(completeGoogleRedirect).mockReset().mockResolvedValue(null);
  window.localStorage.removeItem('quiet-ledger-language');
  document.documentElement.lang = 'ru';
  window.history.replaceState(null, '', '/');
});

const user = (uid: string, emailVerified = true) => ({ uid, displayName: uid, email: `${uid}@example.com`, emailVerified });
const subscription = (name: string) => ({ id: 'sample', name, amountCents: 500, previousAmountCents: null,
  currency: 'RUB', billingPeriod: 'monthly', nextBillingDate: '2026-09-06', category: 'software',
  status: 'active', notes: '' });

test('calendar day selection shows its payments and bounds month navigation', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  await act(async () => { harness.streams[0].next([{ ...subscription('Calendar service'), id: 'free-1', nextBillingDate: '2026-10-05', amountCents: 149950 }]); });
  fireEvent.click(screen.getAllByRole('button', { name: 'Календарь' })[0]);
  expect((screen.getByRole('button', { name: 'Предыдущий месяц' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /5 октября 2026.*Платежей: 1/ }));
  const details = document.querySelector('.day-detail') as HTMLElement;
  expect(within(details).getByText('Calendar service')).toBeTruthy();
  expect(details.textContent).toContain('1 499,50');
  fireEvent.click(screen.getByRole('button', { name: 'Сегодня', exact: true }));
  expect(screen.getByText('На этот день списаний не запланировано.')).toBeTruthy();
  for (let index = 0; index < 11; index++) fireEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }));
  expect((screen.getByRole('button', { name: 'Следующий месяц' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Сегодня', exact: true }));
  expect((screen.getByRole('button', { name: 'Предыдущий месяц' }) as HTMLButtonElement).disabled).toBe(true);
});

test('currency filter resets cleanly without mixing currencies', async () => {
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  await act(async () => { harness.streams[0].next([
    { ...subscription('Ruble service'), id: 'free-1' },
    { ...subscription('Dollar service'), id: 'free-2', currency: 'USD' },
  ]); });
  fireEvent.click(screen.getAllByRole('button', { name: 'Подписки' })[0]);
  fireEvent.change(screen.getByLabelText('Фильтр валюты'), { target: { value: 'USD' } });
  expect(screen.queryByText('Ruble service')).toBeNull();
  expect(screen.getByText('Dollar service')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: 'Сбросить фильтры' })[0]);
  expect(screen.getByText('Ruble service')).toBeTruthy();
  expect((screen.getByLabelText('Фильтр валюты') as HTMLSelectElement).value).toBe('all');
});

test('rapid pause clicks send only one request until it finishes', async () => {
  let finish!: () => void;
  vi.mocked(toggleSubscription).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  await act(async () => { harness.streams[0].next([{ ...subscription('Spotify'), id: 'free-1' }]); });
  fireEvent.click(screen.getAllByRole('button', { name: 'Подписки' })[0]);
  const pause = screen.getByRole('button', { name: 'Поставить на паузу' });
  fireEvent.click(pause);
  fireEvent.click(pause);
  expect(toggleSubscription).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
});

test('repeated form submits cannot create duplicate subscriptions', async () => {
  let finish!: () => void;
  vi.mocked(createSubscription).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  await act(async () => { harness.streams[0].next([]); });
  fireEvent.click(screen.getAllByRole('button', { name: 'Добавить подписку' })[0]);
  const form = screen.getByRole('dialog').querySelector('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(createSubscription).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
});

test('quick add fills only service identity, preserving entered price and date', async () => {
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  await act(async () => { harness.streams[0].next([]); });
  fireEvent.click(screen.getAllByRole('button', { name: 'Добавить подписку' })[0]);
  fireEvent.change(screen.getByLabelText('Сумма'), { target: { value: '319' } });
  fireEvent.change(screen.getByLabelText('Следующее списание'), { target: { value: '2026-12-31' } });
  fireEvent.click(screen.getByRole('button', { name: 'Spotify' }));
  expect((screen.getByLabelText('Название сервиса') as HTMLInputElement).value).toBe('Spotify');
  expect((screen.getByLabelText('Сумма') as HTMLInputElement).value).toBe('319');
  expect((screen.getByLabelText('Следующее списание') as HTMLInputElement).value).toBe('2026-12-31');
});

test('subscription deletion can be undone without ever writing to the database', async () => {
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  await act(async () => { harness.streams[0].next([subscription('Spotify')]); });
  vi.useFakeTimers();
  fireEvent.click(screen.getAllByRole('button', { name: 'Подписки' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Удалить Spotify' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Удалить', exact: true })); });
  expect(removeSubscription).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Отменить удаление' }));
  expect(screen.getByText('Удаление отменено')).toBeTruthy();
  await act(async () => { vi.advanceTimersByTime(9000); });
  expect(removeSubscription).not.toHaveBeenCalled();
});

test('confirmed deletion writes once after grace period and cancels on account switch', async () => {
  vi.mocked(removeSubscription).mockResolvedValue(undefined);
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  await act(async () => { harness.streams[0].next([subscription('Spotify')]); });
  vi.useFakeTimers();
  fireEvent.click(screen.getAllByRole('button', { name: 'Подписки' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Удалить Spotify' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Удалить', exact: true })); });
  await act(async () => { vi.advanceTimersByTime(7999); });
  expect(removeSubscription).not.toHaveBeenCalled();
  await act(async () => { vi.advanceTimersByTime(1); });
  expect(removeSubscription).toHaveBeenCalledExactlyOnceWith({}, 'alice', 'sample');
  fireEvent.click(screen.getByRole('button', { name: 'Удалить Spotify' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Удалить', exact: true })); });
  await act(async () => { harness.authChanged!(null); vi.advanceTimersByTime(0); });
  await act(async () => { vi.advanceTimersByTime(9000); });
  expect(removeSubscription).toHaveBeenCalledTimes(1);
});

test('subscription search includes private notes', async () => {
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  await act(async () => { harness.streams[0].next([{ ...subscription('Spotify'), notes: 'family plan' }]); });
  fireEvent.click(screen.getAllByRole('button', { name: 'Подписки' })[0]);
  fireEvent.change(screen.getByLabelText('Найти подписку'), { target: { value: 'family' } });
  expect(screen.getByText('Spotify')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Найти подписку'), { target: { value: 'nonexistent' } });
  expect(screen.getByText('Ничего не найдено')).toBeTruthy();
});

test('failed deferred deletion reports an error instead of claiming success', async () => {
  vi.mocked(removeSubscription).mockRejectedValueOnce({ code: 'permission-denied' });
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  await act(async () => { harness.streams[0].next([subscription('Spotify')]); });
  vi.useFakeTimers();
  fireEvent.click(screen.getAllByRole('button', { name: 'Подписки' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Удалить Spotify' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Удалить', exact: true })); });
  await act(async () => { vi.advanceTimersByTime(8000); });
  expect(screen.queryByText('Подписка удалена')).toBeNull();
  expect(screen.getByRole('alert').className).toContain('error-toast');
  expect(screen.getByRole('button', { name: 'Удалить Spotify' })).toBeTruthy();
  // A failed request releases the single-action guard so the user can retry.
  fireEvent.click(screen.getByRole('button', { name: 'Удалить Spotify' }));
  expect(screen.getByRole('alertdialog')).toBeTruthy();
});

test('editing a subscription cancels its queued deletion', async () => {
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  await act(async () => { harness.streams[0].next([{ ...subscription('Spotify'), id: 'free-1' }]); });
  vi.useFakeTimers();
  fireEvent.click(screen.getAllByRole('button', { name: 'Подписки' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Удалить Spotify' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Удалить', exact: true })); });
  fireEvent.click(screen.getByRole('button', { name: 'Изменить Spotify' }));
  await act(async () => { vi.advanceTimersByTime(9000); });
  expect(removeSubscription).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.queryByText('Быстрое добавление')).toBeNull();
});

test('offline mode keeps loaded data visible and prevents mutations, then recovers', async () => {
  const network = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  await act(async () => { harness.streams[0].next([{ ...subscription('Spotify'), id: 'free-1' }]); });
  network.mockReturnValue(false);
  fireEvent(window, new Event('offline'));
  expect(screen.getByText('Вы не в сети')).toBeTruthy();
  expect((screen.getAllByRole('button', { name: 'Добавить подписку' })[0] as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getAllByRole('button', { name: 'Подписки' })[0]);
  expect(screen.getByText('Spotify')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Поставить на паузу' }));
  expect(toggleSubscription).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('Нет соединения');
  fireEvent.click(screen.getAllByRole('button', { name: 'Настройки' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
  expect(updateSettings).not.toHaveBeenCalled();
  network.mockReturnValue(true);
  fireEvent(window, new Event('online'));
  expect(screen.queryByText('Вы не в сети')).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: 'Подписки' })[0]);
  expect((screen.getAllByRole('button', { name: 'Добавить подписку' })[0] as HTMLButtonElement).disabled).toBe(false);
});

test('loss of connection during deletion grace period does not queue a database write', async () => {
  const network = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  await act(async () => { harness.streams[0].next([subscription('Spotify')]); });
  vi.useFakeTimers();
  fireEvent.click(screen.getAllByRole('button', { name: 'Подписки' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Удалить Spotify' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Удалить', exact: true })); });
  network.mockReturnValue(false);
  await act(async () => { vi.advanceTimersByTime(8000); });
  expect(removeSubscription).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('Нет соединения');
});

test('a deletion tombstone offers account deletion recovery instead of recreating data', async () => {
  vi.mocked(ensureOwnerDocuments).mockResolvedValueOnce(false);
  vi.mocked(deleteUserData).mockResolvedValueOnce(undefined);
  vi.mocked(deleteCurrentAccount).mockResolvedValueOnce(undefined);
  render(<App />);
  const alice = user('alice');
  await act(async () => { harness.authChanged!(alice); });
  expect(screen.getByRole('heading', { name: 'Завершите удаление аккаунта' })).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Завершить удаление' })); });
  expect(deleteUserData).toHaveBeenCalledWith({}, 'alice');
  expect(deleteCurrentAccount).toHaveBeenCalledWith(alice);
});

test('deletion recovery explains a required recent login and permits a retry', async () => {
  vi.mocked(ensureOwnerDocuments).mockResolvedValueOnce(false);
  vi.mocked(deleteUserData).mockResolvedValue(undefined);
  vi.mocked(deleteCurrentAccount).mockRejectedValueOnce({ code: 'auth/requires-recent-login' }).mockResolvedValueOnce(undefined);
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  const button = screen.getByRole('button', { name: 'Завершить удаление' });
  await act(async () => { fireEvent.click(button); });
  expect(screen.getByRole('alert').textContent).toContain('Выйдите и войдите заново');
  expect(button.hasAttribute('disabled')).toBe(false);
  await act(async () => { fireEvent.click(button); });
  expect(deleteCurrentAccount).toHaveBeenCalledTimes(2);
});

test('failed popup gives a translated alternative and releases the login button', async () => {
  vi.mocked(signInWithGoogle).mockRejectedValueOnce({ code: 'auth/internal-error' });
  render(<App />);
  await act(async () => { harness.authChanged!(null); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Продолжить с Google/ })); });
  expect(screen.getByRole('alert').textContent).toContain('вход без всплывающего окна');
  expect(screen.getByRole('button', { name: /Продолжить с Google/ }).hasAttribute('disabled')).toBe(false);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Войти без всплывающего окна' })); });
  expect(signInWithGoogle).toHaveBeenLastCalledWith('redirect');
});

test('redirect failure survives the initial signed-out notification', async () => {
  vi.mocked(completeGoogleRedirect).mockRejectedValueOnce({ code: 'auth/unauthorized-domain' });
  render(<App />);
  await act(async () => {});
  await act(async () => { harness.authChanged!(null); });
  expect(screen.getByRole('alert').textContent).toContain('адрес не разрешён');
});

test('rapid login clicks do not start concurrent popup requests', async () => {
  let finish!: () => void;
  vi.mocked(signInWithGoogle).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  render(<App />);
  await act(async () => { harness.authChanged!(null); });
  const button = screen.getByRole('button', { name: /Продолжить с Google/ });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(signInWithGoogle).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
  expect(button.hasAttribute('disabled')).toBe(false);
});

test('login does not reject existing shorter passwords while registration requires eight characters', async () => {
  render(<App />);
  await act(async () => { harness.authChanged!(null); });
  expect(screen.getByLabelText('Пароль').getAttribute('minlength')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
  expect(screen.getByLabelText('Пароль').getAttribute('minlength')).toBe('8');
});

test('public landing calculator works locally before authentication', async () => {
  render(<App />);
  await act(async () => { harness.authChanged!(null); });
  expect(screen.queryByText(/ЛЁД/i)).toBeNull();
  expect(screen.getByRole('heading', { name: 'Подписки не должны становиться неожиданностью' })).toBeTruthy();
  expect(screen.getByText(/35\s?940/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Количество подписок'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Средняя цена в месяц, ₽'), { target: { value: '1000' } });
  expect(screen.getByText(/24\s?000/)).toBeTruthy();
  expect(screen.getByText(/только в браузере и никуда не отправляется/)).toBeTruthy();
});

test('stalled Google initialization becomes a retry screen instead of an endless spinner', async () => {
  vi.useFakeTimers();
  render(<App />);
  await act(async () => { vi.advanceTimersByTime(10_000); });
  expect(screen.getByRole('heading', { name: 'Проверка входа не завершилась' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Повторить проверку' })).toBeTruthy();
});

test('public account keeps internal ICE branding out of the interface', async () => {
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  await act(async () => { harness.streams[0].next([]); });
  fireEvent.click(screen.getAllByRole('button', { name: 'Настройки' })[0]);
  expect(screen.getByRole('heading', { name: 'Аккаунт' })).toBeTruthy();
  expect(screen.queryByText(/ЛЁД/i)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Скачать резервную копию' })).toBeNull();
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

test('language changes the full interface and saves to the current account', async () => {
  vi.mocked(updateSettings).mockResolvedValueOnce(undefined);
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  await act(async () => { harness.streams[0].next([]); });
  fireEvent.click(screen.getAllByRole('button', { name: 'Настройки' })[0]);
  fireEvent.change(screen.getByLabelText('Язык интерфейса'), { target: { value: 'en' } });
  expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
  expect(screen.getByText('Totals and reminders')).toBeTruthy();
  expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy();
  expect(document.documentElement.lang).toBe('en');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save settings' })); });
  expect(updateSettings).toHaveBeenCalledWith({}, 'alice', expect.objectContaining({ language: 'en' }));
  expect(window.localStorage.getItem('quiet-ledger-language')).toBe('en');
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

test('a stalled data stream shows a persistent retry notice and recovers when data arrives', async () => {
  vi.useFakeTimers();
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  expect(screen.getByRole('status').textContent).toContain('Загружаем');
  await act(async () => { vi.advanceTimersByTime(15_000); });
  expect(screen.getByRole('alert').textContent).toContain('Данные не загрузились вовремя');
  expect(screen.getByRole('button', { name: 'Повторить загрузку' })).toBeTruthy();
  await act(async () => { vi.advanceTimersByTime(5_000); });
  expect(screen.getByRole('alert')).toBeTruthy();
  await act(async () => { harness.streams[0].next([]); });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getAllByText('Пока здесь тихо').length).toBeGreaterThan(0);
});

test('subscription dialog traps keyboard focus and restores it on close', async () => {
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  await act(async () => { harness.streams[0].next([]); });
  const opener = screen.getAllByRole('button', { name: 'Добавить подписку' })[0];
  opener.focus();
  fireEvent.click(opener);
  const first = screen.getByRole('button', { name: 'Закрыть' });
  const last = screen.getByRole('button', { name: 'Добавить', exact: true });
  last.focus();
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(last);
  expect(document.body.style.overflow).toBe('hidden');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(document.activeElement).toBe(opener);
  expect(document.body.style.overflow).not.toBe('hidden');
});

test('filtered subscriptions explain missing matches and reset every filter', async () => {
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  await act(async () => { harness.streams[0].next([subscription('Figma')]); });
  fireEvent.click(screen.getAllByRole('button', { name: /^Подписки/ })[0]);
  const search = screen.getByRole('textbox', { name: 'Найти подписку' });
  fireEvent.change(search, { target: { value: 'missing' } });
  fireEvent.change(screen.getByLabelText('Статус'), { target: { value: 'paused' } });
  expect(screen.getByText('Ничего не найдено')).toBeTruthy();
  expect(screen.queryByText('Добавьте первую подписку, чтобы увидеть расчёты.')).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: 'Сбросить фильтры' })[0]);
  expect((search as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText('Статус') as HTMLSelectElement).value).toBe('all');
  expect(screen.getByText('Figma')).toBeTruthy();
  fireEvent.change(search, { target: { value: 'Fi' } });
  fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }));
  expect((search as HTMLInputElement).value).toBe('');
});

test('settings save has a busy state and prevents duplicate writes', async () => {
  let finish!: () => void;
  vi.mocked(updateSettings).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  render(<App />);
  await act(async () => { harness.authChanged!(user('alice')); });
  await act(async () => { harness.streams[0].next([]); });
  fireEvent.click(screen.getAllByRole('button', { name: 'Настройки' })[0]);
  const save = screen.getByRole('button', { name: 'Сохранить настройки' });
  fireEvent.click(save);
  fireEvent.click(save);
  expect(updateSettings).toHaveBeenCalledTimes(1);
  expect(save.hasAttribute('disabled')).toBe(true);
  expect(save.getAttribute('aria-busy')).toBe('true');
  await act(async () => { finish(); });
  expect(save.hasAttribute('disabled')).toBe(false);
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
