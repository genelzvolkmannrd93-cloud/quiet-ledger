import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { completeGoogleRedirect } from './firebase';
import {
  Bell,
  CalendarDays,
  Check,
  CirclePause,
  CirclePlay,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  WalletCards,
  X,
} from 'lucide-react';
import { auth, db, deleteCurrentAccount, firebaseConfigured, getUserPlan, isAllowedOwner, leaveAccount, ownerEmail, publicAccess, refreshVerifiedUser, registerWithEmail, requestPasswordReset, sendVerificationEmail, signInWithEmail, signInWithGoogle, supportEmail, type UserPlan } from './firebase';
import {
  createSubscription,
  deleteUserData,
  editSubscription,
  ensureOwnerDocuments,
  removeSubscription,
  toggleSubscription,
  updateSettings,
  watchSettings,
  watchSubscriptions,
} from './data';
import {
  addDays,
  categories,
  categoryColors,
  categoryLabels,
  currencies,
  daysUntil,
  defaultSettings,
  formatDate,
  intlLocale,
  money,
  monthlyAmount,
  nextOccurrence,
  upcomingOccurrences,
  type Category,
  type Currency,
  type Locale,
  type Subscription,
  type SubscriptionInput,
  type UserSettings,
} from './domain';
import { readPreferredLocale, rememberLocale, translate as tr } from './i18n';

type View = 'overview' | 'subscriptions' | 'calendar' | 'settings';
type Sort = 'date' | 'amount' | 'name';
type AuthState = 'loading' | 'auth-timeout' | 'signed-out' | 'verify-email' | 'denied' | 'ready';
type CurrencyTotals = Partial<Record<Currency, number>>;
const freeSubscriptionIds = new Set(['free-1', 'free-2', 'free-3']);

function canUseSubscription(item: Subscription, plan: UserPlan) {
  return plan === 'paid' || freeSubscriptionIds.has(item.id);
}

const emptyForm = (): SubscriptionInput => ({
  name: '',
  amount: '',
  currency: 'RUB',
  billingPeriod: 'monthly',
  nextBillingDate: addDays(7),
  category: 'software',
  status: 'active',
  notes: '',
});

export function App() {
  useEffect(() => {
    let preference = 'system';
    try { preference = localStorage.getItem('quiet-ledger-theme') || 'system'; } catch { /* Storage may be disabled. */ }
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const apply = () => { document.documentElement.dataset.theme = preference === 'dark' || (preference === 'system' && media?.matches) ? 'dark' : 'light'; };
    const changed = (event: Event) => { preference = (event as CustomEvent<string>).detail; apply(); };
    apply();
    media?.addEventListener('change', apply);
    window.addEventListener('quiet-ledger-theme', changed);
    return () => { media?.removeEventListener('change', apply); window.removeEventListener('quiet-ledger-theme', changed); };
  }, []);
  const locale = readPreferredLocale();
  const legal = new URLSearchParams(window.location.search).get('legal');
  if (legal === 'privacy' || legal === 'terms') return <LegalScreen kind={legal} locale={locale} />;
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === '1') {
    return <Tracker user={previewUser} plan="paid" items={previewItems} settings={{ ...defaultSettings, language: locale }} loading={false} externalError={null} />;
  }
  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const [authState, setAuthState] = useState<AuthState>(firebaseConfigured ? 'loading' : 'signed-out');
  const [user, setUser] = useState<User | null>(null);
  const [items, setItems] = useState<Subscription[]>([]);
  const [settings, setSettings] = useState<UserSettings>(() => ({ ...defaultSettings, language: readPreferredLocale() }));
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [deletionStarted, setDeletionStarted] = useState(false);
  const [plan, setPlan] = useState<UserPlan>(publicAccess ? 'free' : 'paid');
  const sessionRevision = useRef(0);

  useEffect(() => {
    if (!auth) return;
    let resolved = false;
    let active = true;
    const timeout = window.setTimeout(() => {
      if (!resolved) setAuthState('auth-timeout');
    }, 10_000);
    void completeGoogleRedirect().catch((reason) => {
      if (!active) return;
      resolved = true;
      window.clearTimeout(timeout);
      setAuthError(friendlyError(reason));
      setAuthState('signed-out');
    });
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      resolved = true;
      window.clearTimeout(timeout);
      sessionRevision.current++;
      setItems([]);
      setSettings({ ...defaultSettings, language: readPreferredLocale() });
      setError(null);
      setDeletionStarted(false);
      setPlan(publicAccess ? 'free' : 'paid');
      setLoadingData(true);
      setUser(nextUser);
      if (nextUser) setAuthError(null);
      if (!nextUser) {
        window.history.replaceState(null, '', '/');
        setAuthState('signed-out');
        setItems([]);
        return;
      }
      if (publicAccess && nextUser.email && !nextUser.emailVerified) {
        setAuthState('verify-email');
        return;
      }
      setAuthState(isAllowedOwner(nextUser) ? 'ready' : 'denied');
    }, (reason) => {
      resolved = true;
      window.clearTimeout(timeout);
      setAuthError(friendlyError(reason));
      setAuthState('signed-out');
    });
    return () => { active = false; window.clearTimeout(timeout); unsubscribe(); };
  }, []);

  useEffect(() => {
    if (authState !== 'ready' || !user) return;
    if (!publicAccess) {
      setPlan('paid');
      return;
    }
    const revision = sessionRevision.current;
    void getUserPlan(user).then((value) => {
      if (revision === sessionRevision.current) setPlan(value);
    }).catch(() => {
      if (revision === sessionRevision.current) setPlan('free');
    });
  }, [authState, user]);

  useEffect(() => {
    if (authState !== 'ready' || !user || !db) return;
    const revision = sessionRevision.current;
    let cancelled = false;
    let timedOut = false;
    const current = () => !cancelled && revision === sessionRevision.current;
    setLoadingData(true);
    setError(null);
    const timeout = window.setTimeout(() => {
      if (current()) {
        timedOut = true;
        setLoadingData(false);
        setError(tr(readPreferredLocale(), 'Данные не загрузились вовремя. Проверьте соединение и повторите загрузку.'));
      }
    }, 15_000);
    void ensureOwnerDocuments(db, user, readPreferredLocale(), publicAccess).then((result) => {
      if (current() && result === false) setDeletionStarted(true);
    }).catch((reason: Error) => {
      if (current()) setError(friendlyError(reason, settings.language));
    });
    const unsubscribeItems = watchSubscriptions(db, user.uid, (values) => {
      if (!current()) return;
      window.clearTimeout(timeout);
      if (timedOut) { timedOut = false; setError(null); }
      setItems(values);
      setLoadingData(false);
    }, (reason) => {
      if (!current()) return;
      window.clearTimeout(timeout);
      setError(friendlyError(reason, settings.language));
      setLoadingData(false);
    });
    const unsubscribeSettings = watchSettings(db, user.uid, (value) => {
      if (current()) setSettings(value);
    }, (reason) => { if (current()) setError(friendlyError(reason, settings.language)); });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      unsubscribeItems();
      unsubscribeSettings();
    };
  }, [authState, user]);

  const locale = settings.language;
  if (!firebaseConfigured) return <SetupScreen locale={locale} />;
  if (authState === 'loading') return <LoadingScreen locale={locale} />;
  if (authState === 'auth-timeout') return <AuthTimeoutScreen locale={locale} />;
  if (authState === 'signed-out') return <LoginScreen locale={locale} initialMessage={authError} />;
  if (authState === 'verify-email') return <VerifyEmailScreen user={user!} locale={locale} onVerified={() => setAuthState('ready')} />;
  if (authState === 'denied') return <DeniedScreen email={user?.email ?? ''} locale={locale} />;
  if (deletionStarted) return <DeletionRecovery key={user!.uid} user={user!} locale={locale} />;

  return <Tracker key={user!.uid} user={user!} plan={plan} items={items} settings={settings} loading={loadingData} externalError={error} />;
}

function DeletionRecovery({ user, locale }: { user: User; locale: Locale }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pending = useRef(false);
  async function finish() {
    if (!db || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await deleteUserData(db, user.uid);
      await deleteCurrentAccount(user);
    } catch (reason) {
      setMessage(friendlyError(reason, locale));
    } finally { pending.current = false; setBusy(false); }
  }
  return <main className="gate"><section className="login-card"><Logo locale={locale} />
    <h1>{locale === 'en' ? 'Finish deleting your account' : 'Завершите удаление аккаунта'}</h1>
    <p className="login-copy">{locale === 'en' ? 'Data deletion has already started. Complete the account deletion below. If a recent login is required, sign out and sign in again.' : 'Удаление данных уже начато. Завершите удаление аккаунта. Если требуется повторный вход, выйдите и войдите заново.'}</p>
    <button className="danger-button wide" disabled={busy} onClick={() => void finish()}>{locale === 'en' ? 'Finish deletion' : 'Завершить удаление'}</button>
    {message && <p role="alert" className="login-error">{message}</p>}
    <button className="secondary-button wide" disabled={busy} onClick={() => void leaveAccount()}>{locale === 'en' ? 'Sign out' : 'Выйти'}</button>
  </section></main>;
}

const previewUser = {
  uid: 'local-preview-owner',
  email: ownerEmail,
  emailVerified: true,
  displayName: 'Дмитрий',
  photoURL: null,
} as User;

const previewItems: Subscription[] = [
  { id: 'spotify', name: 'Spotify', amountCents: 34900, previousAmountCents: null, currency: 'RUB', billingPeriod: 'monthly', nextBillingDate: addDays(2), category: 'entertainment', status: 'active', notes: '' },
  { id: 'chatgpt', name: 'ChatGPT Plus', amountCents: 2000, previousAmountCents: null, currency: 'USD', billingPeriod: 'monthly', nextBillingDate: addDays(7), category: 'software', status: 'active', notes: '' },
  { id: 'figma', name: 'Figma', amountCents: 1500, previousAmountCents: 1200, currency: 'USD', billingPeriod: 'monthly', nextBillingDate: addDays(11), category: 'software', status: 'active', notes: '' },
  { id: 'kinopoisk', name: 'Кинопоиск', amountCents: 29900, previousAmountCents: null, currency: 'RUB', billingPeriod: 'monthly', nextBillingDate: addDays(18), category: 'entertainment', status: 'active', notes: '' },
  { id: 'headspace', name: 'Headspace', amountCents: 6999, previousAmountCents: null, currency: 'USD', billingPeriod: 'yearly', nextBillingDate: addDays(28), category: 'health', status: 'active', notes: '' },
  { id: 'duolingo', name: 'Duolingo', amountCents: 8399, previousAmountCents: null, currency: 'USD', billingPeriod: 'yearly', nextBillingDate: addDays(44), category: 'education', status: 'paused', notes: '' },
];

function Tracker({ user, plan, items, settings, loading, externalError }: { user: User; plan: UserPlan; items: Subscription[]; settings: UserSettings; loading: boolean; externalError: string | null }) {
  const initialView = (new URLSearchParams(window.location.search).get('view') as View) || 'overview';
  const [view, setView] = useState<View>(['overview', 'subscriptions', 'calendar', 'settings'].includes(initialView) ? initialView : 'overview');
  const [queryText, setQueryText] = useState('');
  const [category, setCategory] = useState<'all' | Category>('all');
  const [status, setStatus] = useState<'all' | 'active' | 'paused'>('all');
  const [sort, setSort] = useState<Sort>('date');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [form, setForm] = useState<SubscriptionInput>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const preferencesBusy = useRef(false);
  const [pendingDelete, setPendingDelete] = useState<Subscription | null>(null);
  const [localSettings, setLocalSettings] = useState(settings);
  const [toast, setToast] = useState<string | null>(null);
  const [deleteDataOpen, setDeleteDataOpen] = useState(false);
  const locale = localSettings.language;
  useEffect(() => {
    if (!dialogOpen && !pendingDelete && !deleteDataOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const modal = document.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
    const focusables = () => Array.from(modal?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? []);
    focusables()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const elements = focusables();
        const first = elements[0];
        const last = elements.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || !modal?.contains(document.activeElement))) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !modal?.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
        return;
      }
      if (event.key !== 'Escape' || saving) return;
      event.preventDefault();
      setDialogOpen(false);
      setPendingDelete(null);
      setDeleteDataOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [dialogOpen, pendingDelete, deleteDataOpen, saving]);
  const [today, setToday] = useState(() => addDays(0));

  useEffect(() => {
    const refreshDay = () => setToday(addDays(0));
    const timer = window.setInterval(refreshDay, 30_000);
    window.addEventListener('focus', refreshDay);
    document.addEventListener('visibilitychange', refreshDay);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshDay);
      document.removeEventListener('visibilitychange', refreshDay);
    };
  }, []);

  useEffect(() => setLocalSettings(settings), [settings]);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const entitledItems = useMemo(() => items.filter((item) => canUseSubscription(item, plan)), [items, plan]);
  const lockedCount = items.length - entitledItems.length;
  const active = useMemo(() => entitledItems.filter((item) => item.status === 'active'), [entitledItems]);
  const monthlyTotals = useMemo(() => totalsByCurrency(active), [active]);
  const projected = useMemo(() => items.map((item) => ({ ...item, nextBillingDate: nextOccurrence(item, today) })), [items, today]);
  const upcoming = useMemo(() => projected.filter((item) => canUseSubscription(item, plan) && item.status === 'active').sort((a, b) => a.nextBillingDate.localeCompare(b.nextBillingDate)), [projected, plan]);
  const calendarItems = useMemo(() => active.flatMap((item) => upcomingOccurrences(item, today))
    .sort((a, b) => a.nextBillingDate.localeCompare(b.nextBillingDate) || a.name.localeCompare(b.name, intlLocale(locale))), [active, today, locale]);
  const reminders = useMemo(() => upcoming.filter((item) => {
    const days = daysUntil(item.nextBillingDate);
    return settings.notificationsEnabled && days >= 0 && days <= settings.reminderDays;
  }), [upcoming, settings.notificationsEnabled, settings.reminderDays, today]);
  const canAdd = !loading && !externalError && (plan === 'paid' || entitledItems.length < 3);
  const categoryTotals = useMemo(() => categories.map((key) => {
    const categoryItems = active.filter((item) => item.category === key);
    return { key, count: categoryItems.length, totals: totalsByCurrency(categoryItems) };
  }).filter((entry) => entry.count > 0).sort((a, b) => b.count - a.count), [active]);
  const filtered = useMemo(() => projected.filter((item) => {
    const matchesText = item.name.toLowerCase().includes(queryText.trim().toLowerCase());
    return matchesText && (category === 'all' || item.category === category) && (status === 'all' || item.status === status);
  }).sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, intlLocale(locale));
    if (sort === 'amount') return a.currency.localeCompare(b.currency) || monthlyAmount(b) - monthlyAmount(a);
    return a.nextBillingDate.localeCompare(b.nextBillingDate);
  }), [projected, queryText, category, status, sort, locale]);

  function navigate(next: View) {
    if (next === view) return;
    setView(next);
    window.history.replaceState(null, '', next === 'overview' ? '/' : `/?view=${next}`);
    window.scrollTo?.({ top: 0, behavior: 'instant' });
  }

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyForm(), currency: settings.baseCurrency });
    setDialogOpen(true);
  }

  function openEdit(item: Subscription) {
    item = items.find((original) => original.id === item.id) || item;
    if (!canUseSubscription(item, plan)) {
      setToast(tr(locale, 'Архивная подписка доступна только для просмотра или удаления.'));
      return;
    }
    setEditing(item);
    setForm({
      name: item.name,
      amount: String(item.amountCents / 100),
      currency: item.currency,
      billingPeriod: item.billingPeriod,
      nextBillingDate: item.nextBillingDate,
      category: item.category,
      status: item.status,
      notes: item.notes,
    });
    setDialogOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!db) return;
    setSaving(true);
    try {
      if (editing) await editSubscription(db, user.uid, editing, form);
      else await createSubscription(db, user.uid, form, plan);
      setDialogOpen(false);
      setToast(tr(locale, editing ? 'Изменения сохранены' : 'Подписка добавлена'));
    } catch (reason) {
      setToast(friendlyError(reason, locale));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(item: Subscription) {
    if (!db) return;
    if (!canUseSubscription(item, plan)) {
      setToast(tr(locale, 'Архивную подписку нельзя изменять на бесплатном тарифе.'));
      return;
    }
    try {
      await toggleSubscription(db, user.uid, item);
      setToast(tr(locale, item.status === 'active' ? 'Подписка поставлена на паузу' : 'Подписка возобновлена'));
    } catch (reason) {
      setToast(friendlyError(reason, locale));
    }
  }

  async function confirmDelete() {
    if (!db || !pendingDelete) return;
    setSaving(true);
    try {
      await removeSubscription(db, user.uid, pendingDelete.id);
      setPendingDelete(null);
      setToast(tr(locale, 'Подписка удалена'));
    } catch (reason) {
      setToast(friendlyError(reason, locale));
    } finally {
      setSaving(false);
    }
  }

  async function savePreferences() {
    if (!db || preferencesBusy.current) return;
    preferencesBusy.current = true;
    setSavingPreferences(true);
    try {
      await updateSettings(db, user.uid, localSettings);
      rememberLocale(localSettings.language);
      setToast(tr(locale, 'Настройки сохранены'));
    } catch (reason) {
      setToast(friendlyError(reason, locale));
    } finally {
      preferencesBusy.current = false;
      setSavingPreferences(false);
    }
  }

  async function confirmDeleteData() {
    if (!db || !publicAccess) return;
    setSaving(true);
    let dataDeleted = false;
    try {
      await deleteUserData(db, user.uid);
      dataDeleted = true;
      setDeleteDataOpen(false);
      await deleteCurrentAccount(user);
    } catch (reason) {
      const code = (reason as { code?: string }).code || '';
      setDeleteDataOpen(false);
      if (dataDeleted && code.includes('requires-recent-login')) {
        setToast(tr(locale, 'Данные удалены. Войдите заново и сразу повторите удаление, чтобы удалить сам аккаунт.'));
        await leaveAccount();
      } else setToast(friendlyError(reason, locale));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Logo locale={locale} />
        <nav className="nav" aria-label={tr(locale, 'Основная навигация')}>
          <NavButton active={view === 'overview'} icon={<LayoutDashboard />} onClick={() => navigate('overview')}>{tr(locale, 'Обзор')}</NavButton>
          <NavButton active={view === 'subscriptions'} icon={<ReceiptText />} onClick={() => navigate('subscriptions')}>{tr(locale, 'Подписки')} <span className="nav-count">{items.length}</span></NavButton>
          <NavButton active={view === 'calendar'} icon={<CalendarDays />} onClick={() => navigate('calendar')}>{tr(locale, 'Календарь')}</NavButton>
          <NavButton active={view === 'settings'} icon={<Settings />} onClick={() => navigate('settings')}>{tr(locale, 'Настройки')}</NavButton>
        </nav>
        <button className="account-row" onClick={() => void leaveAccount()}>
          <Avatar user={user} />
          <span><strong>{user.displayName || tr(locale, 'Владелец')}</strong><small>{user.email}</small></span>
          <LogOut aria-label={tr(locale, 'Выйти')} />
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-logo"><Logo compact locale={locale} /></div>
          <p className="today">{new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</p>
          <div className="top-actions">
            <div className={`reminder-pill ${reminders.length ? 'attention' : ''}`}><Bell />{reminders.length ? tr(locale, '{count} напомин.', { count: reminders.length }) : tr(locale, 'Всё спокойно')}</div>
            <button className="top-account" onClick={() => void leaveAccount()} aria-label={tr(locale, 'Выйти из аккаунта')}><Avatar user={user} /></button>
          </div>
        </header>

        <div className="content">
          <div className="page-heading">
            <div><p className="eyebrow">{tr(locale, 'Ваш финансовый ритм')}</p><h1>{viewTitle(view, user, locale)}</h1><p>{viewSubtitle(view, upcoming, locale)}</p></div>
            {(view === 'overview' || view === 'subscriptions') && <button className="primary-button" onClick={openCreate} disabled={!canAdd} title={!canAdd ? tr(locale, 'Лимит бесплатного тарифа — три подписки') : undefined}><Plus />{tr(locale, 'Добавить подписку')}</button>}
          </div>

          {publicAccess && plan === 'free' && <div className="plan-strip"><span>{tr(locale, 'Бесплатный тариф')}</span><strong>{tr(locale, '{count} из 3 подписок', { count: entitledItems.length })}</strong><small>{lockedCount ? tr(locale, '{count} в архиве · доступны просмотр и удаление', { count: lockedCount }) : tr(locale, 'Увеличение лимита появится после подключения защищённой оплаты.')}</small></div>}

          {externalError && <section className="connection-notice" role="alert"><Bell /><div><strong>{tr(locale, 'Не удалось обновить данные')}</strong><p>{externalError}</p></div><button className="secondary-button" onClick={() => window.location.reload()}>{tr(locale, 'Повторить загрузку')}</button></section>}

          {loading ? <DataSkeleton locale={locale} /> : (
            <div className="view-stage" key={view} hidden={Boolean(externalError) && items.length === 0}>
              {view === 'overview' && <Overview locale={locale} items={entitledItems} active={active} upcoming={upcoming} reminders={reminders} categoryTotals={categoryTotals} monthlyTotals={monthlyTotals} onEdit={openEdit} onNavigate={navigate} />}
              {view === 'subscriptions' && <SubscriptionsView locale={locale} items={filtered} plan={plan} query={queryText} category={category} status={status} sort={sort} onQuery={setQueryText} onCategory={setCategory} onStatus={setStatus} onSort={setSort} onEdit={openEdit} onToggle={(item) => void toggle(item)} onDelete={setPendingDelete} />}
              {view === 'calendar' && <CalendarView locale={locale} items={calendarItems} onEdit={openEdit} />}
              {view === 'settings' && <SettingsView locale={locale} user={user} plan={plan} settings={localSettings} saving={savingPreferences} onChange={setLocalSettings} onSave={() => void savePreferences()} onDeleteData={() => setDeleteDataOpen(true)} />}
            </div>
          )}
        </div>
      </section>

      <nav className="mobile-nav" aria-label={tr(locale, 'Мобильная навигация')}>
        <MobileButton active={view === 'overview'} icon={<LayoutDashboard />} onClick={() => navigate('overview')}>{tr(locale, 'Обзор')}</MobileButton>
        <MobileButton active={view === 'subscriptions'} icon={<ReceiptText />} onClick={() => navigate('subscriptions')}>{tr(locale, 'Подписки')}</MobileButton>
        <button className="mobile-add" onClick={openCreate} aria-label={tr(locale, 'Добавить подписку')} disabled={!canAdd} title={!canAdd ? tr(locale, 'Лимит бесплатного тарифа — три подписки') : undefined}><Plus /></button>
        <MobileButton active={view === 'calendar'} icon={<CalendarDays />} onClick={() => navigate('calendar')}>{tr(locale, 'Календарь')}</MobileButton>
        <MobileButton active={view === 'settings'} icon={<Settings />} onClick={() => navigate('settings')}>{tr(locale, 'Настройки')}</MobileButton>
      </nav>

      {dialogOpen && <SubscriptionDialog locale={locale} form={form} editing={Boolean(editing)} saving={saving} onChange={setForm} onClose={() => { if (!saving) setDialogOpen(false); }} onSubmit={submit} />}
      {pendingDelete && <ConfirmDialog locale={locale} item={pendingDelete} saving={saving} onCancel={() => { if (!saving) setPendingDelete(null); }} onConfirm={() => void confirmDelete()} />}
      {deleteDataOpen && <div className="modal-backdrop"><section className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-label={tr(locale, 'Удаление аккаунта и всех данных')}><div className="danger-icon"><Trash2 /></div><h2>{tr(locale, 'Удалить аккаунт и все данные?')}</h2><p>{tr(locale, 'Аккаунт приложения, все подписки и настройки будут удалены без возможности восстановления. Для защиты от восстановления данных старой сессией останется только техническая отметка удалённого UID — без email, подписок и настроек.')}</p><div className="modal-actions"><button className="secondary-button" disabled={saving} onClick={() => setDeleteDataOpen(false)}>{tr(locale, 'Отмена')}</button><button className="danger-button" disabled={saving} onClick={() => void confirmDeleteData()}>{saving && <LoaderCircle className="spin" />}{tr(locale, 'Удалить аккаунт')}</button></div></section></div>}
      {toast && <div className="toast" role="status"><Check /><span>{toast}</span><button onClick={() => setToast(null)} aria-label={tr(locale, 'Закрыть')}><X /></button></div>}
    </main>
  );
}

function Overview({ locale, items, active, upcoming, reminders, categoryTotals, monthlyTotals, onEdit, onNavigate }: { locale: Locale; items: Subscription[]; active: Subscription[]; upcoming: Subscription[]; reminders: Subscription[]; categoryTotals: { key: Category; count: number; totals: CurrencyTotals }[]; monthlyTotals: CurrencyTotals; onEdit: (item: Subscription) => void; onNavigate: (view: View) => void }) {
  const maxCategory = Math.max(...categoryTotals.map((entry) => entry.count), 1);
  return <>
    <section className="rhythm-hero">
      <div className="rhythm-copy"><span className="rhythm-kicker">QUIET LEDGER / {locale === 'en' ? 'YOUR PERSONAL SPACE' : 'ВАШЕ ЛИЧНОЕ ПРОСТРАНСТВО'}</span>
        <h2>{locale === 'en' ? 'Less noise. More clarity.' : 'Меньше шума. Больше ясности.'}</h2>
        <p>{locale === 'en' ? 'Your subscriptions, dates and spending — in one calm place.' : 'Подписки, даты и расходы — в одном спокойном пространстве.'}</p>
        <button className="rhythm-link" onClick={() => onNavigate('calendar')}><CalendarDays />{locale === 'en' ? 'Explore your calendar' : 'Посмотреть свой календарь'}<span aria-hidden="true">↗</span></button>
      </div>
      <div className="rhythm-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit-core"><WalletCards /></div><span className="orbit-dot dot-one" /><span className="orbit-dot dot-two" /><div className="orbit-caption"><span>{locale === 'en' ? 'Next payment' : 'Ближайшее списание'}</span><strong>{upcoming[0] ? formatDate(upcoming[0].nextBillingDate, locale) : (locale === 'en' ? 'A clear horizon' : 'Свободный горизонт')}</strong></div></div>
    </section>
    <div className="metrics">
      <Metric label={tr(locale, 'В месяц')} value={formatTotals(monthlyTotals, locale)} note={tr(locale, '{count} активных · валюты отдельно', { count: active.length })} accent />
      <Metric label={tr(locale, 'В год')} value={formatTotals(scaleTotals(monthlyTotals, 12), locale)} note={tr(locale, 'прогноз без конвертации валют')} />
      <Metric label={tr(locale, 'На паузе')} value={String(items.length - active.length)} note={tr(locale, 'не входят в расчёт')} />
      <Metric label={tr(locale, 'Ближайшее')} value={upcoming[0] ? money(upcoming[0].amountCents / 100, upcoming[0].currency, locale) : '—'} note={upcoming[0] ? tr(locale, 'через {days} дн.', { days: Math.max(0, daysUntil(upcoming[0].nextBillingDate)) }) : tr(locale, 'списаний нет')} />
    </div>
    {reminders.length > 0 && <section className="notice-card"><Bell /><div><strong>{tr(locale, 'Скоро спишутся средства')}</strong><span>{reminders.map((item) => item.name).join(', ')}</span></div><button onClick={() => onNavigate('calendar')}>{tr(locale, 'Посмотреть')}</button></section>}
    <SpendingChart locale={locale} items={active} />
    <div className="overview-grid">
      <section className="surface upcoming-card">
        <div className="section-heading"><div><h2>{tr(locale, 'Ближайшие списания')}</h2><p>{tr(locale, 'Следующие регулярные платежи')}</p></div><button onClick={() => onNavigate('calendar')}>{tr(locale, 'Все даты')}</button></div>
        {upcoming.length ? upcoming.slice(0, 5).map((item) => <SubscriptionRow key={item.id} locale={locale} item={item} onClick={() => onEdit(item)} />) : <EmptyState locale={locale} />}
      </section>
      <section className="surface category-card">
        <div className="section-heading"><div><h2>{tr(locale, 'По категориям')}</h2><p>{tr(locale, 'Среднее за месяц, без смешивания валют')}</p></div></div>
        {categoryTotals.length ? <div className="category-list">{categoryTotals.map((entry) => <div className="category-line" key={entry.key}><div className="category-meta"><span style={{ background: categoryColors[entry.key] }} /><strong>{tr(locale, categoryLabels[entry.key])}</strong><b>{formatTotals(entry.totals, locale)}</b></div><div className="bar"><i style={{ width: `${Math.max(8, entry.count / maxCategory * 100)}%`, background: categoryColors[entry.key] }} /></div></div>)}</div> : <EmptyState locale={locale} />}
      </section>
    </div>
  </>;
}

function SubscriptionsView({ locale, items, plan, query, category, status, sort, onQuery, onCategory, onStatus, onSort, onEdit, onToggle, onDelete }: { locale: Locale; items: Subscription[]; plan: UserPlan; query: string; category: 'all' | Category; status: 'all' | 'active' | 'paused'; sort: Sort; onQuery: (value: string) => void; onCategory: (value: 'all' | Category) => void; onStatus: (value: 'all' | 'active' | 'paused') => void; onSort: (value: Sort) => void; onEdit: (item: Subscription) => void; onToggle: (item: Subscription) => void; onDelete: (item: Subscription) => void }) {
  const hasFilters = Boolean(query.trim() || category !== 'all' || status !== 'all');
  function resetFilters() { onQuery(''); onCategory('all'); onStatus('all'); }
  return <section className="surface subscriptions-surface">
    <div className="filters">
      <div className="search-field"><Search aria-hidden="true" /><input aria-label={tr(locale, 'Найти подписку')} value={query} onChange={(event) => onQuery(event.target.value)} placeholder={tr(locale, 'Найти подписку')} />{query && <button type="button" aria-label={tr(locale, 'Очистить поиск')} onClick={() => onQuery('')}><X /></button>}</div>
      <select value={category} onChange={(event) => onCategory(event.target.value as 'all' | Category)} aria-label={tr(locale, 'Категория')}><option value="all">{tr(locale, 'Все категории')}</option>{categories.map((key) => <option key={key} value={key}>{tr(locale, categoryLabels[key])}</option>)}</select>
      <select value={status} onChange={(event) => onStatus(event.target.value as 'all' | 'active' | 'paused')} aria-label={tr(locale, 'Статус')}><option value="all">{tr(locale, 'Все статусы')}</option><option value="active">{tr(locale, 'Активные')}</option><option value="paused">{tr(locale, 'На паузе')}</option></select>
      <select value={sort} onChange={(event) => onSort(event.target.value as Sort)} aria-label={tr(locale, 'Сортировка')}><option value="date">{tr(locale, 'Сначала ближайшие')}</option><option value="amount">{tr(locale, 'По сумме внутри валюты')}</option><option value="name">{tr(locale, 'По названию')}</option></select>
    </div>
    <div className="results-toolbar"><span role="status">{tr(locale, 'В списке: {count}', { count: items.length })}</span>{hasFilters && <button onClick={resetFilters}>{tr(locale, 'Сбросить фильтры')}<X aria-hidden="true" /></button>}</div>
    <div className="table-head"><span>{tr(locale, 'Сервис')}</span><span>{tr(locale, 'Категория')}</span><span>{tr(locale, 'Сумма')}</span><span>{tr(locale, 'Статус')}</span><span>{tr(locale, 'Действия')}</span></div>
    {items.length ? items.map((item) => {
      const editable = canUseSubscription(item, plan);
      return <div className={`manage-row ${editable ? '' : 'locked'}`} key={item.id}><SubscriptionIdentity locale={locale} item={item} /><span className="category-label"><i style={{ background: categoryColors[item.category] }} />{tr(locale, categoryLabels[item.category])}</span><div><strong>{money(item.amountCents / 100, item.currency, locale)}</strong><small>/{tr(locale, item.billingPeriod === 'monthly' ? 'мес.' : 'год')}</small>{item.previousAmountCents && item.previousAmountCents < item.amountCents ? <em>{tr(locale, 'Цена выросла')}</em> : null}</div>{editable ? <button className={`status-chip ${item.status}`} onClick={() => onToggle(item)}>{tr(locale, item.status === 'active' ? 'Активна' : 'На паузе')}</button> : <span className="status-chip locked">{tr(locale, 'Архив')}</span>}<div className="row-actions">{editable && <><button onClick={() => onEdit(item)} aria-label={tr(locale, 'Изменить {name}', { name: item.name })}><Pencil /></button><button onClick={() => onToggle(item)} aria-label={tr(locale, item.status === 'active' ? 'Поставить на паузу' : 'Возобновить')}>{item.status === 'active' ? <CirclePause /> : <CirclePlay />}</button></>}<button className="delete" onClick={() => onDelete(item)} aria-label={tr(locale, 'Удалить {name}', { name: item.name })}><Trash2 /></button></div></div>;
    }) : hasFilters ? <div className="empty filtered-empty"><Search /><strong>{tr(locale, 'Ничего не найдено')}</strong><span>{tr(locale, 'Попробуйте другое название или сбросьте фильтры.')}</span><button className="secondary-button" onClick={resetFilters}>{tr(locale, 'Сбросить фильтры')}</button></div> : <EmptyState locale={locale} />}
  </section>;
}

function CalendarView({ locale, items, onEdit }: { locale: Locale; items: Subscription[]; onEdit: (item: Subscription) => void }) {
  const groups = items.reduce<Record<string, Subscription[]>>((result, item) => {
    const key = item.nextBillingDate.slice(0, 7);
    (result[key] ||= []).push(item);
    return result;
  }, {});
  return <div className="calendar-layout">
    <section className="surface timeline-card"><div className="section-heading"><div><h2>{tr(locale, 'Лента платежей')}</h2><p>{tr(locale, 'Прогноз повторений на 12 месяцев')}</p></div></div>{Object.keys(groups).length ? Object.entries(groups).map(([month, monthItems]) => <div className="month-group" key={month}><h3>{new Intl.DateTimeFormat(intlLocale(locale), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`))}</h3>{monthItems.map((item) => <button key={`${item.id}-${item.nextBillingDate}`} className="timeline-row" onClick={() => onEdit(item)}><span className="date-box"><strong>{item.nextBillingDate.slice(8)}</strong><small>{new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${item.nextBillingDate}T12:00:00Z`))}</small></span><SubscriptionIdentity locale={locale} item={item} compact /><strong className="timeline-money">{money(item.amountCents / 100, item.currency, locale)}</strong></button>)}</div>) : <EmptyState locale={locale} />}</section>
    <aside className="surface calendar-tip"><CalendarDays /><h2>{tr(locale, 'Без сюрпризов')}</h2><p>{tr(locale, 'Все даты хранятся в вашем закрытом пространстве. Напоминания появятся на главной за выбранное число дней.')}</p></aside>
  </div>;
}

function SettingsView({ locale, user, plan, settings, saving, onChange, onSave, onDeleteData }: { locale: Locale; user: User; plan: UserPlan; settings: UserSettings; saving: boolean; onChange: (value: UserSettings) => void; onSave: () => void; onDeleteData: () => void }) {
  return <div className="settings-grid">
    <ThemePicker locale={locale} />
    <section className="surface settings-card"><div className="section-heading"><div><h2>{tr(locale, 'Расчёты и напоминания')}</h2><p>{tr(locale, 'Настройте приложение под себя')}</p></div></div><div className="setting-row"><div><strong>{tr(locale, 'Язык интерфейса')}</strong><span>{tr(locale, 'Выбор сохраняется для этого аккаунта')}</span></div><select aria-label={tr(locale, 'Язык интерфейса')} value={settings.language} onChange={(event) => onChange({ ...settings, language: event.target.value as Locale })}><option value="ru">Русский</option><option value="en">English</option></select></div><div className="setting-row"><div><strong>{tr(locale, 'Валюта новых подписок')}</strong><span>{tr(locale, 'Итоги по разным валютам показываются отдельно без неточного курса')}</span></div><select aria-label={tr(locale, 'Валюта новых подписок')} value={settings.baseCurrency} onChange={(event) => onChange({ ...settings, baseCurrency: event.target.value as Currency })}>{currencies.map((value) => <option key={value}>{value}</option>)}</select></div><div className="setting-row"><div><strong>{tr(locale, 'Напоминать заранее')}</strong><span>{tr(locale, 'От 0 до 30 дней перед списанием')}</span></div><div className="number-field"><input aria-label={tr(locale, 'Напоминать заранее')} type="number" min="0" max="30" value={settings.reminderDays} onChange={(event) => onChange({ ...settings, reminderDays: Number(event.target.value) })} /><span>{tr(locale, 'дн.')}</span></div></div><div className="setting-row"><div><strong>{tr(locale, 'Напоминания внутри сайта')}</strong><span>{tr(locale, 'Показывать ближайшие списания')}</span></div><button className={`switch ${settings.notificationsEnabled ? 'on' : ''}`} onClick={() => onChange({ ...settings, notificationsEnabled: !settings.notificationsEnabled })} role="switch" aria-label={tr(locale, 'Напоминания внутри сайта')} aria-checked={settings.notificationsEnabled}><i /></button></div>{publicAccess && <div className="setting-row"><div><strong>{tr(locale, 'Автообнаружение через Gmail')}</strong><span>{tr(locale, 'Сейчас почта не подключается и её содержимое не читается. Функция появится только после отдельного согласия и проверки Google.')}</span></div><button className="future-button" type="button" disabled>{tr(locale, 'Подключить позже')}</button></div>}<button className="primary-button save-settings" onClick={onSave} disabled={saving} aria-busy={saving}>{saving && <LoaderCircle className="spin" />}{tr(locale, saving ? 'Сохраняем настройки' : 'Сохранить настройки')}</button></section>
    <section className="surface security-card"><h2>{tr(locale, 'Аккаунт')}</h2><dl><div><dt>{tr(locale, 'Аккаунт')}</dt><dd>{user.email}</dd></div><div><dt>{tr(locale, publicAccess ? 'Тариф' : 'Режим')}</dt><dd>{tr(locale, publicAccess ? plan === 'paid' ? 'Платный' : 'Бесплатный · до 3 подписок' : 'Личный доступ без лимита')}</dd></div><div><dt>{tr(locale, 'Проверка почты')}</dt><dd className="safe">{tr(locale, 'Подтверждена')}</dd></div></dl>{publicAccess && <button className="delete-data-button" onClick={onDeleteData}>{tr(locale, 'Удалить аккаунт и данные')}</button>}</section>
  </div>;
}

function ThemePicker({ locale }: { locale: Locale }) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('quiet-ledger-theme') || 'system'; } catch { return 'system'; }
  });
  function change(value: string) {
    setTheme(value);
    try { localStorage.setItem('quiet-ledger-theme', value); } catch { /* Still apply for this session. */ }
    window.dispatchEvent(new CustomEvent('quiet-ledger-theme', { detail: value }));
  }
  return <section className="surface settings-card"><div className="section-heading"><div><h2>{locale === 'en' ? 'Appearance' : 'Оформление'}</h2><p>{locale === 'en' ? 'Saved on this device. Applied immediately.' : 'Сохраняется на этом устройстве. Применяется сразу.'}</p></div></div><div className="setting-row"><strong>{locale === 'en' ? 'Color theme' : 'Цветовая тема'}</strong><select aria-label={locale === 'en' ? 'Color theme' : 'Цветовая тема'} value={theme} onChange={(event) => change(event.target.value)}><option value="system">{locale === 'en' ? 'System' : 'Как в системе'}</option><option value="light">{locale === 'en' ? 'Light' : 'Светлая'}</option><option value="dark">{locale === 'en' ? 'Dark' : 'Тёмная'}</option></select></div></section>;
}

function SpendingChart({ locale, items }: { locale: Locale; items: Subscription[] }) {
  const [currency, setCurrency] = useState<Currency>('RUB');
  const [selected, setSelected] = useState(0);
  const today = addDays(0);
  const forecast = useMemo(() => {
    const [year, month] = today.split('-').map(Number);
    const months = Array.from({ length: 6 }, (_, offset) => {
      const date = new Date(Date.UTC(year, month - 1 + offset, 1));
      return { key: date.toISOString().slice(0, 7), label: new Intl.DateTimeFormat(intlLocale(locale), { month: 'short', timeZone: 'UTC' }).format(date), items: [] as Subscription[], cents: 0 };
    });
    for (const item of items.filter((item) => item.currency === currency)) {
      for (const occurrence of upcomingOccurrences(item, today, 6)) {
        const bucket = months.find((entry) => entry.key === occurrence.nextBillingDate.slice(0, 7));
        if (bucket) { bucket.items.push(occurrence); bucket.cents += occurrence.amountCents; }
      }
    }
    return months;
  }, [items, currency, today, locale]);
  const max = Math.max(...forecast.map((entry) => entry.cents), 1);
  const current = forecast[selected];
  return <section className="surface forecast-card"><div className="section-heading"><div><h2>{locale === 'en' ? 'Spending horizon' : 'Горизонт расходов'}</h2><p>{locale === 'en' ? 'Upcoming charges · six calendar months · no currency conversion' : 'Предстоящие списания · шесть календарных месяцев · без конвертации'}</p></div><select aria-label={locale === 'en' ? 'Chart currency' : 'Валюта графика'} value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}>{currencies.map((value) => <option key={value}>{value}</option>)}</select></div>
    <div className="forecast-bars">{forecast.map((entry, index) => <button key={entry.key} className={`forecast-column ${index === selected ? 'selected' : ''}`} aria-pressed={index === selected} aria-label={`${entry.label}: ${money(entry.cents / 100, currency, locale)}`} onClick={() => setSelected(index)}><span className="forecast-track"><i style={{ height: `${entry.cents ? Math.max(3, entry.cents / max * 100) : 0}%` }} /></span><span>{entry.label}</span></button>)}</div>
    <div className="forecast-detail" aria-live="polite"><strong>{current.label} · {money(current.cents / 100, currency, locale)}</strong><span>{current.items.length ? current.items.map((item) => `${item.name} (${item.nextBillingDate.slice(8)})`).join(' · ') : (locale === 'en' ? 'No upcoming charges in this currency' : 'В этой валюте списаний не запланировано')}</span><small>{locale === 'en' ? 'The current month includes only today and future dates. This is a forecast, not payment history.' : 'В текущем месяце учитываются только сегодняшние и будущие даты. Это прогноз, не история оплат.'}</small></div>
  </section>;
}

function SubscriptionDialog({ locale, form, editing, saving, onChange, onClose, onSubmit }: { locale: Locale; form: SubscriptionInput; editing: boolean; saving: boolean; onChange: (value: SubscriptionInput) => void; onClose: () => void; onSubmit: (event: FormEvent) => void }) {
return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="subscription-dialog-title"><div className="modal-heading"><div><h2 id="subscription-dialog-title">{tr(locale, editing ? 'Изменить подписку' : 'Новая подписка')}</h2><p>{tr(locale, 'Укажите данные о регулярном платеже.')}</p></div><button onClick={onClose} aria-label={tr(locale, 'Закрыть')}><X /></button></div><form onSubmit={onSubmit} className="subscription-form"><Field label={tr(locale, 'Название сервиса')}><input required minLength={2} maxLength={80} value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} placeholder={tr(locale, 'Например, Spotify')} /></Field><div className="form-grid amount-grid"><Field label={tr(locale, 'Сумма')}><input required min="0.01" max="1000000" step="0.01" type="number" value={form.amount} onChange={(event) => onChange({ ...form, amount: event.target.value })} placeholder="499" /></Field><Field label={tr(locale, 'Валюта')}><select value={form.currency} onChange={(event) => onChange({ ...form, currency: event.target.value as Currency })}>{currencies.map((value) => <option key={value}>{value}</option>)}</select></Field></div><div className="form-grid"><Field label={tr(locale, 'Период')}><select value={form.billingPeriod} onChange={(event) => onChange({ ...form, billingPeriod: event.target.value as 'monthly' | 'yearly' })}><option value="monthly">{tr(locale, 'Каждый месяц')}</option><option value="yearly">{tr(locale, 'Каждый год')}</option></select></Field><Field label={tr(locale, 'Следующее списание')}><input required type="date" value={form.nextBillingDate} onChange={(event) => onChange({ ...form, nextBillingDate: event.target.value })} /></Field></div><div className="form-grid"><Field label={tr(locale, 'Категория')}><select value={form.category} onChange={(event) => onChange({ ...form, category: event.target.value as Category })}>{categories.map((key) => <option key={key} value={key}>{tr(locale, categoryLabels[key])}</option>)}</select></Field><Field label={tr(locale, 'Статус')}><select value={form.status} onChange={(event) => onChange({ ...form, status: event.target.value as 'active' | 'paused' })}><option value="active">{tr(locale, 'Активна')}</option><option value="paused">{tr(locale, 'На паузе')}</option></select></Field></div><Field label={tr(locale, 'Заметка')}><textarea maxLength={500} value={form.notes} onChange={(event) => onChange({ ...form, notes: event.target.value })} placeholder={tr(locale, 'Необязательно')} /></Field><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>{tr(locale, 'Отмена')}</button><button className="primary-button" type="submit" disabled={saving}>{saving && <LoaderCircle className="spin" />}{tr(locale, editing ? 'Сохранить' : 'Добавить')}</button></div></form></section></div>;
}

function ConfirmDialog({ locale, item, saving, onCancel, onConfirm }: { locale: Locale; item: Subscription; saving: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="modal-backdrop"><section className="modal confirm-modal" role="alertdialog" aria-modal="true"><div className="danger-icon"><Trash2 /></div><h2>{tr(locale, 'Удалить «{name}»?', { name: item.name })}</h2><p>{tr(locale, 'Запись исчезнет из списка и расчётов. Это действие нельзя отменить.')}</p><div className="modal-actions"><button className="secondary-button" onClick={onCancel}>{tr(locale, 'Оставить')}</button><button className="danger-button" onClick={onConfirm} disabled={saving}>{saving && <LoaderCircle className="spin" />}{tr(locale, 'Удалить')}</button></div></section></div>;
}

function LoginScreen({ locale, initialMessage }: { locale: Locale; initialMessage?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(initialMessage ?? null);
  const inFlight = useRef(false);
  useEffect(() => { setMessage(initialMessage ?? null); }, [initialMessage]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [sampleCount, setSampleCount] = useState(5);
  const [sampleMonthly, setSampleMonthly] = useState(599);
  async function login(method: 'popup' | 'redirect' = 'popup') {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try { await signInWithGoogle(method); }
    catch (reason) { setMessage(friendlyError(reason, locale)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function emailAuth() {
    if (inFlight.current) return;
    if (mode === 'register' && !acceptedTerms) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      if (mode === 'register') await registerWithEmail(email, password);
      else if (mode === 'reset') {
        await requestPasswordReset(email);
        setMessage(tr(locale, 'Ссылка для восстановления отправлена. Проверьте также папку «Спам».'));
        setBusy(false);
      } else await signInWithEmail(email, password);
    } catch (reason) { setMessage(friendlyError(reason, locale)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const switchMode = (next: 'login' | 'register' | 'reset') => {
    setMode(next);
    setPassword('');
    setAcceptedTerms(false);
    setMessage(null);
  };
  const loginCard = <section className="login-card" id="login">
    <Logo locale={locale} />
    <div className="gate-illustration"><span><LockKeyhole /></span><i /><i /><i /></div>
    <p className="eyebrow">{tr(locale, publicAccess ? 'Личное пространство' : 'Закрытое пространство')}</p>
    <h1>{tr(locale, mode === 'register' ? 'Создайте личный аккаунт' : mode === 'reset' ? 'Восстановите пароль' : 'Ваши подписки — только для вас')}</h1>
    <p className="login-copy">{tr(locale, publicAccess ? mode === 'reset' ? 'Укажите email — Firebase отправит защищённую ссылку для выбора нового пароля.' : 'Войдите, чтобы управлять своими подписками. Обычный вход не даёт приложению доступ к содержимому почтового ящика.' : 'Войдите через разрешённый Google-аккаунт. Посторонним доступ к сайту и данным закрыт.')}</p>
    {publicAccess && <form className="email-auth" onSubmit={(event) => { event.preventDefault(); void emailAuth(); }}>
      <Field label="Email"><input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
      {mode !== 'reset' && <Field label={tr(locale, 'Пароль')}><input required minLength={mode === 'register' ? 8 : undefined} type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} /></Field>}
      {mode === 'register' && <label className="terms-consent"><input required type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} /><span>{tr(locale, 'Я принимаю ')}<a href="/?legal=terms">{tr(locale, 'условия использования')}</a> {locale === 'en' ? 'and' : 'и'} <a href="/?legal=privacy">{tr(locale, 'политику конфиденциальности')}</a>.</span></label>}
      <button className="primary-button wide" type="submit" disabled={busy || (mode === 'register' && !acceptedTerms)}>{busy ? <LoaderCircle className="spin" /> : null}{tr(locale, mode === 'register' ? 'Создать аккаунт' : mode === 'reset' ? 'Отправить ссылку' : 'Войти по email')}</button>
      {mode === 'login' ? <><button className="secondary-button wide" type="button" disabled={busy} onClick={() => switchMode('register')}>{tr(locale, 'Создать аккаунт')}</button><button className="text-button compact" type="button" disabled={busy} onClick={() => switchMode('reset')}>{tr(locale, 'Забыли пароль?')}</button></> : <button className="text-button compact" type="button" disabled={busy} onClick={() => switchMode('login')}>{tr(locale, 'Вернуться ко входу')}</button>}
      {mode !== 'reset' && <div className="auth-divider"><span>{tr(locale, 'или')}</span></div>}
    </form>}
    {mode !== 'reset' && <><button className="google-button" onClick={() => void login()} disabled={busy}><span>G</span>{tr(locale, busy ? 'Подождите…' : 'Продолжить с Google')}</button>{publicAccess && <p className="google-consent">{tr(locale, 'Продолжая с Google, вы принимаете ')}<a href="/?legal=terms">{tr(locale, 'условия использования')}</a> {locale === 'en' ? 'and' : 'и'} <a href="/?legal=privacy">{tr(locale, 'политику конфиденциальности')}</a>.</p>}</>}
    {message && <p className="login-error" role="alert">{message}</p>}
    {mode !== 'reset' && <button className="text-button compact" disabled={busy} onClick={() => void login('redirect')}>{tr(locale, 'Войти без всплывающего окна')}</button>}
    {publicAccess && <LegalLinks locale={locale} />}
    {!publicAccess && <small>{tr(locale, 'Разрешённый аккаунт: {email}', { email: maskEmail(ownerEmail) })}</small>}
  </section>;

  if (!publicAccess) return <main className="gate">{loginCard}</main>;
  const yearlySample = Math.max(0, sampleCount) * Math.max(0, sampleMonthly) * 12;
  return <main className="public-gate">
    <section className="public-intro">
      <Logo locale={locale} />
      <p className="eyebrow">{tr(locale, 'Спокойный контроль регулярных расходов')}</p>
      <h1>{tr(locale, 'Подписки не должны становиться неожиданностью')}</h1>
      <p className="public-copy">{tr(locale, 'Соберите даты и суммы в одном личном пространстве. «Тихий счёт» покажет ближайшие списания, годовой ритм и рост цены.')}</p>
      <div className="sample-calculator" aria-labelledby="sample-title">
        <div><span>{tr(locale, 'Быстрый расчёт')}</span><strong id="sample-title">{tr(locale, 'Сколько уходит за год?')}</strong></div>
        <label><span>{tr(locale, 'Количество подписок')}</span><input type="number" min="0" max="100" value={sampleCount} onChange={(event) => setSampleCount(Math.min(100, Math.max(0, Number(event.target.value) || 0)))} /></label>
        <label><span>{tr(locale, 'Средняя цена в месяц, ₽')}</span><input type="number" min="0" max="1000000" value={sampleMonthly} onChange={(event) => setSampleMonthly(Math.min(1_000_000, Math.max(0, Number(event.target.value) || 0)))} /></label>
        <output>{tr(locale, '{amount} в год', { amount: new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(yearlySample) })}</output>
        <small>{tr(locale, 'Расчёт выполняется только в браузере и никуда не отправляется.')}</small>
      </div>
      <div className="public-points"><span><Check />{tr(locale, 'До 3 подписок бесплатно')}</span><span><Check />{tr(locale, 'Данные каждого аккаунта изолированы')}</span><span><Check />{tr(locale, 'Удаление аккаунта и данных')}</span></div>
      <a className="primary-button public-cta" href="#login">{tr(locale, 'Начать бесплатно')}</a>
    </section>
    {loginCard}
  </main>;
}

function LegalLinks({ locale }: { locale: Locale }) {
  return <nav className="legal-links" aria-label={tr(locale, 'Правовая информация')}><a href="/?legal=privacy">{tr(locale, 'Конфиденциальность')}</a><a href="/?legal=terms">{tr(locale, 'Условия использования')}</a></nav>;
}

function LegalScreen({ kind, locale }: { kind: 'privacy' | 'terms'; locale: Locale }) {
  const privacy = kind === 'privacy';
  return <main className="legal-page"><article className="surface legal-document"><Logo locale={locale} /><a className="legal-back" href="/">{tr(locale, '← Вернуться в приложение')}</a><p className="eyebrow">{tr(locale, 'Редакция от 7 сентября 2026 года')}</p><h1>{tr(locale, privacy ? 'Политика конфиденциальности' : 'Условия использования')}</h1>{privacy ? <>
    <h2>{tr(locale, 'Какие данные обрабатываются')}</h2><p>{tr(locale, 'Для работы сервиса используются email, имя профиля, технический идентификатор аккаунта, версия и серверное время принятия условий, введённые вами подписки и настройки. Пароли обрабатывает Firebase Authentication; приложение их не хранит.')}</p>
    <h2>{tr(locale, 'Зачем нужны данные')}</h2><p>{tr(locale, 'Они нужны только для входа, показа ваших записей, расчёта прогноза и защиты доступа. Обычный вход через Google или email не даёт сервису доступа к содержимому вашей почты.')}</p>
    <h2>{tr(locale, 'Где хранятся данные')}</h2><p>{tr(locale, 'Авторизация, база и защита приложения работают на сервисах Google Firebase. Каждая ветка базы доступна только подтверждённому владельцу соответствующего аккаунта.')}</p>
    <h2>{tr(locale, 'Ваш контроль')}</h2><p>{tr(locale, 'В настройках можно безвозвратно удалить подписки, настройки, профиль приложения и учётную запись Firebase Authentication. После начала удаления сохраняется только техническая отметка UID без email и пользовательского содержимого: она нужна, чтобы ранее открытая сессия не смогла создать данные заново. Для давно открытой сессии Firebase может потребовать сначала войти заново и завершить удаление.')}</p>
  </> : <>
    <h2>{tr(locale, 'Назначение сервиса')}</h2><p>{tr(locale, '«Тихий счёт» помогает вручную учитывать регулярные платежи. Он не является банком, платёжной системой или финансовым консультантом и сам не списывает деньги.')}</p>
    <h2>{tr(locale, 'Точность прогноза')}</h2><p>{tr(locale, 'Даты и суммы зависят от данных, которые вводит пользователь. Сервис не смешивает разные валюты по неточному курсу: итоги для каждой валюты показываются отдельно.')}</p>
    <h2>{tr(locale, 'Безопасное использование')}</h2><p>{tr(locale, 'Нельзя пытаться получить доступ к чужим данным, нарушать работу сервиса или использовать его в незаконных целях. Не вводите в заметки пароли, полные реквизиты карт и другие секреты.')}</p>
    <h2>{tr(locale, 'Изменения и доступность')}</h2><p>{tr(locale, 'Функции могут обновляться, а работа иногда прерываться для обслуживания.')}</p>
  </>}<h2>{tr(locale, 'Связь')}</h2><p>{supportEmail ? <>{tr(locale, 'По вопросам данных и сервиса: ')}<a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</> : tr(locale, 'Публичный контактный адрес ещё не указан. Это обязательный пункт перед открытым запуском.')}</p><LegalLinks locale={locale} /></article></main>;
}

function VerifyEmailScreen({ user, locale, onVerified }: { user: User; locale: Locale; onVerified: () => void }) {
  const [busy, setBusy] = useState<'check' | 'send' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function check() {
    setBusy('check'); setMessage(null);
    try {
      if (await refreshVerifiedUser()) onVerified();
      else setMessage(tr(locale, 'Адрес ещё не подтверждён. Откройте ссылку из письма и повторите проверку.'));
    } catch (reason) { setMessage(friendlyError(reason, locale)); }
    finally { setBusy(null); }
  }
  async function resend() {
    setBusy('send'); setMessage(null);
    try { await sendVerificationEmail(); setMessage(tr(locale, 'Новое письмо отправлено. Проверьте также папку «Спам».')); }
    catch (reason) { setMessage(friendlyError(reason, locale)); }
    finally { setBusy(null); }
  }
  return <main className="gate"><section className="login-card"><Logo locale={locale} /><div className="denied-icon muted"><Bell /></div><p className="eyebrow">{tr(locale, 'Защита аккаунта')}</p><h1>{tr(locale, 'Подтвердите email')}</h1><p className="login-copy">{tr(locale, 'Мы отправили ссылку на {email}. Пока адрес не подтверждён, данные не загружаются.', { email: maskEmail(user.email || '') })}</p><button className="primary-button wide" disabled={Boolean(busy)} onClick={() => void check()}>{busy === 'check' && <LoaderCircle className="spin" />}{tr(locale, 'Я подтвердил email')}</button><button className="secondary-button wide" disabled={Boolean(busy)} onClick={() => void resend()}>{busy === 'send' && <LoaderCircle className="spin" />}{tr(locale, 'Отправить письмо повторно')}</button>{message && <p className="login-error" role="status">{message}</p>}<button className="text-button" disabled={Boolean(busy)} onClick={() => void leaveAccount()}>{tr(locale, 'Выйти и указать другой email')}</button></section></main>;
}

function DeniedScreen({ email, locale }: { email: string; locale: Locale }) {
  return <main className="gate"><section className="login-card"><div className="denied-icon"><LockKeyhole /></div><p className="eyebrow">{tr(locale, 'Доступ закрыт')}</p><h1>{tr(locale, 'Этот аккаунт не разрешён')}</h1><p className="login-copy">{tr(locale, 'Вы вошли как {email}. Данные не загружались.', { email: email || tr(locale, 'неизвестный пользователь') })}</p><button className="secondary-button wide" onClick={() => void leaveAccount()}><LogOut />{tr(locale, 'Выйти и выбрать другой аккаунт')}</button></section></main>;
}

function SetupScreen({ locale }: { locale: Locale }) {
  return <main className="gate"><section className="login-card"><Logo locale={locale} /><div className="denied-icon muted"><Settings /></div><p className="eyebrow">{tr(locale, 'Подготовка Google-версии')}</p><h1>{tr(locale, 'Приложение собрано')}</h1><p className="login-copy">{tr(locale, 'Осталось связать его с вашим проектом Firebase. До подключения конфигурации никакие данные не отправляются.')}</p></section></main>;
}

function LoadingScreen({ locale }: { locale: Locale }) { return <main className="gate"><div className="loading-gate"><LoaderCircle className="spin" /><span>{tr(locale, 'Проверяем вход…')}</span></div></main>; }
function AuthTimeoutScreen({ locale }: { locale: Locale }) { return <main className="gate"><section className="login-card"><Logo locale={locale} /><div className="denied-icon muted"><Bell /></div><h1>{tr(locale, 'Проверка входа не завершилась')}</h1><p className="login-copy">{tr(locale, 'Google не ответил вовремя. Проверьте интернет, блокировщик рекламы или доступ к reCAPTCHA и попробуйте снова.')}</p><button className="primary-button wide" onClick={() => window.location.reload()}>{tr(locale, 'Повторить проверку')}</button></section></main>; }
function DataSkeleton({ locale }: { locale: Locale }) {
  return <section className="data-skeleton" role="status" aria-live="polite"><p><LoaderCircle className="spin" />{tr(locale, 'Загружаем ваши данные…')}</p><div className="metrics" aria-hidden="true">{[0, 1, 2, 3].map((index) => <div className="metric skeleton-card" key={index}><i /><i /><i /></div>)}</div><div className="surface skeleton-list" aria-hidden="true">{[0, 1, 2].map((index) => <i key={index} />)}</div></section>;
}
function Metric({ label, value, note, accent = false }: { label: string; value: string; note: string; accent?: boolean }) { return <article className={`metric ${accent ? 'accent' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }
function EmptyState({ locale }: { locale: Locale }) { return <div className="empty"><ReceiptText /><strong>{tr(locale, 'Пока здесь тихо')}</strong><span>{tr(locale, 'Добавьте первую подписку, чтобы увидеть расчёты.')}</span></div>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
function Logo({ compact = false, locale }: { compact?: boolean; locale: Locale }) { return <div className="logo"><span><WalletCards /></span>{!compact && <strong>{tr(locale, 'Тихий счёт')}</strong>}</div>; }
function Avatar({ user }: { user: User }) { return user.photoURL ? <img className="avatar" src={user.photoURL} referrerPolicy="no-referrer" alt="" /> : <span className="avatar fallback">{initials(user.displayName || user.email || 'ТС')}</span>; }
function SubscriptionIdentity({ item, locale, compact = false }: { item: Subscription; locale: Locale; compact?: boolean }) { return <div className={`identity ${compact ? 'compact' : ''}`}><span style={{ background: `${categoryColors[item.category]}22`, color: categoryColors[item.category] }}>{item.name.slice(0, 2).toUpperCase()}</span><div><strong>{item.name}</strong><small>{formatDate(item.nextBillingDate, locale)}</small></div></div>; }
function SubscriptionRow({ item, locale, onClick }: { item: Subscription; locale: Locale; onClick: () => void }) { return <button className="subscription-row" onClick={onClick}><SubscriptionIdentity item={item} locale={locale} /><div><strong>{money(item.amountCents / 100, item.currency, locale)}</strong>{item.previousAmountCents && item.previousAmountCents < item.amountCents ? <em>{tr(locale, 'Цена выросла')}</em> : <small>{tr(locale, item.billingPeriod === 'monthly' ? 'ежемесячно' : 'ежегодно')}</small>}</div></button>; }
function NavButton({ active, icon, onClick, children }: { active: boolean; icon: ReactNode; onClick: () => void; children: ReactNode }) { return <button className={`nav-button ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}>{icon}{children}</button>; }
function MobileButton({ active, icon, onClick, children }: { active: boolean; icon: ReactNode; onClick: () => void; children: ReactNode }) { return <button className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={onClick}>{icon}<span>{children}</span></button>; }
function initials(value: string) { return value.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'ТС'; }
function firstName(user: User, locale: Locale) { return (user.displayName || user.email || (locale === 'en' ? 'user' : 'владелец')).split(/[\s@]/)[0]; }
function maskEmail(email: string) { const [name, domain] = email.split('@'); return `${name.slice(0, 3)}•••@${domain}`; }
function viewTitle(view: View, user: User, locale: Locale) { if (view === 'overview') return tr(locale, 'Добрый день, {name}', { name: firstName(user, locale) }); if (view === 'subscriptions') return tr(locale, 'Все подписки'); if (view === 'calendar') return tr(locale, 'Календарь списаний'); return tr(locale, 'Настройки'); }
function viewSubtitle(view: View, upcoming: Subscription[], locale: Locale) { if (view === 'overview') return upcoming[0] ? tr(locale, 'Всё под контролем. Ближайшее списание через {days} дн.', { days: Math.max(0, daysUntil(upcoming[0].nextBillingDate)) }) : tr(locale, 'Добавьте первую подписку — расчёты появятся автоматически.'); if (view === 'subscriptions') return tr(locale, 'Редактируйте суммы, даты и статусы в одном месте.'); if (view === 'calendar') return tr(locale, 'Спокойный взгляд на будущие регулярные расходы.'); return tr(locale, 'Управляйте расчётами, напоминаниями, языком и аккаунтом.'); }
function totalsByCurrency(items: Subscription[]): CurrencyTotals {
  return items.reduce<CurrencyTotals>((totals, item) => {
    totals[item.currency] = (totals[item.currency] || 0) + monthlyAmount(item);
    return totals;
  }, {});
}
function scaleTotals(totals: CurrencyTotals, factor: number): CurrencyTotals {
  return Object.fromEntries(Object.entries(totals).map(([currency, value]) => [currency, value! * factor])) as CurrencyTotals;
}
function formatTotals(totals: CurrencyTotals, locale: Locale) {
  const values = currencies.filter((currency) => totals[currency] !== undefined)
    .map((currency) => money(totals[currency]!, currency, locale));
  return values.length ? values.join(' · ') : '—';
}
function friendlyError(reason: unknown, locale: Locale = readPreferredLocale()) {
  const code = (reason as { code?: string }).code || '';
  if (code.includes('requires-recent-login')) return locale === 'en' ? 'Sign out and sign in again, then finish deleting your account.' : 'Выйдите и войдите заново, затем завершите удаление аккаунта.';
  if (reason instanceof Error && reason.message.startsWith('Некорректные данные подписки')) return locale === 'en' ? 'Invalid subscription data. Contact support; your data has not been changed.' : reason.message;
  if (code.includes('permission-denied')) return tr(locale, 'Запрос отклонён. Обновите страницу и войдите снова.');
  if (code.includes('network-request-failed') || code.includes('unavailable')) return tr(locale, 'Нет связи с Google. Проверьте интернет и попробуйте ещё раз.');
  if (code.includes('popup-closed')) return tr(locale, 'Окно входа было закрыто.');
  if (code === 'auth/local-app-check-required') return tr(locale, 'Для локального входа ещё не настроено подтверждение защиты. Используйте онлайн-сайт или настройте локальный App Check.');
  if (code === 'auth/internal-error' || code === 'auth/popup-blocked') return tr(locale, 'Браузер не смог открыть окно Google. Попробуйте вход без всплывающего окна.');
  if (code === 'auth/cancelled-popup-request') return tr(locale, 'Предыдущая попытка входа отменена. Попробуйте снова.');
  if (code === 'auth/unauthorized-domain') return tr(locale, 'Этот адрес не разрешён для входа. Откройте сайт через localhost или официальный адрес сайта.');
  if (code === 'auth/web-storage-unsupported') return tr(locale, 'Разрешите cookies и хранение данных для этого сайта, затем повторите вход.');
  if (code.includes('invalid-credential') || code.includes('user-not-found') || code.includes('wrong-password')) return tr(locale, 'Неверный email или пароль.');
  if (code.includes('email-already-in-use')) return tr(locale, 'Аккаунт с таким email уже существует. Попробуйте войти.');
  if (code.includes('invalid-email')) return tr(locale, 'Проверьте правильность email.');
  if (code.includes('weak-password')) return tr(locale, 'Пароль слишком простой. Используйте не менее 8 символов.');
  if (code.includes('too-many-requests')) return tr(locale, 'Слишком много попыток. Подождите немного и повторите.');
  if (code.includes('operation-not-allowed')) return tr(locale, 'Этот способ входа пока не включён для сайта.');
  if (code.startsWith('auth/')) return tr(locale, 'Не удалось войти. Повторите попытку или используйте другой способ входа.');
  return tr(locale, reason instanceof Error ? reason.message : 'Не удалось выполнить действие');
}
