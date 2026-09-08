import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { parseBackup, serializeBackup, type Backup } from './backup';
import {
  Bell,
  CalendarDays,
  Check,
  CirclePause,
  CirclePlay,
  Download,
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
  restoreBackup,
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
  money,
  monthlyAmount,
  nextOccurrence,
  upcomingOccurrences,
  type Category,
  type Currency,
  type Subscription,
  type SubscriptionInput,
  type UserSettings,
} from './domain';

type View = 'overview' | 'subscriptions' | 'calendar' | 'settings';
type Sort = 'date' | 'amount' | 'name';
type AuthState = 'loading' | 'signed-out' | 'verify-email' | 'denied' | 'ready';
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
  const legal = new URLSearchParams(window.location.search).get('legal');
  if (legal === 'privacy' || legal === 'terms') return <LegalScreen kind={legal} />;
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === '1') {
    return <Tracker user={previewUser} plan="paid" items={previewItems} settings={defaultSettings} loading={false} externalError={null} />;
  }
  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const [authState, setAuthState] = useState<AuthState>(firebaseConfigured ? 'loading' : 'signed-out');
  const [user, setUser] = useState<User | null>(null);
  const [items, setItems] = useState<Subscription[]>([]);
  const [settings, setSettings] = useState<UserSettings>(defaultSettings);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<UserPlan>(publicAccess ? 'free' : 'paid');
  const sessionRevision = useRef(0);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (nextUser) => {
      sessionRevision.current++;
      setItems([]);
      setSettings(defaultSettings);
      setError(null);
      setPlan(publicAccess ? 'free' : 'paid');
      setLoadingData(true);
      setUser(nextUser);
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
    });
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
    const current = () => !cancelled && revision === sessionRevision.current;
    setLoadingData(true);
    setError(null);
    void ensureOwnerDocuments(db, user).catch((reason: Error) => {
      if (current()) setError(friendlyError(reason));
    });
    const unsubscribeItems = watchSubscriptions(db, user.uid, (values) => {
      if (!current()) return;
      setItems(values);
      setLoadingData(false);
    }, (reason) => {
      if (!current()) return;
      setError(friendlyError(reason));
      setLoadingData(false);
    });
    const unsubscribeSettings = watchSettings(db, user.uid, (value) => {
      if (current()) setSettings(value);
    }, (reason) => { if (current()) setError(friendlyError(reason)); });
    return () => {
      cancelled = true;
      unsubscribeItems();
      unsubscribeSettings();
    };
  }, [authState, user]);

  if (!firebaseConfigured) return <SetupScreen />;
  if (authState === 'loading') return <LoadingScreen />;
  if (authState === 'signed-out') return <LoginScreen />;
  if (authState === 'verify-email') return <VerifyEmailScreen user={user!} onVerified={() => setAuthState('ready')} />;
  if (authState === 'denied') return <DeniedScreen email={user?.email ?? ''} />;

  return <Tracker key={user!.uid} user={user!} plan={plan} items={items} settings={settings} loading={loadingData} externalError={error} />;
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
  const [pendingDelete, setPendingDelete] = useState<Subscription | null>(null);
  const [localSettings, setLocalSettings] = useState(settings);
  const [toast, setToast] = useState<string | null>(null);
  const [backup, setBackup] = useState<Backup | null>(null);
  const [deleteDataOpen, setDeleteDataOpen] = useState(false);
  useEffect(() => {
    if (!dialogOpen && !pendingDelete && !backup && !deleteDataOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || saving) return;
      event.preventDefault();
      setDialogOpen(false);
      setPendingDelete(null);
      setBackup(null);
      setDeleteDataOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dialogOpen, pendingDelete, backup, deleteDataOpen, saving]);
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

  async function readBackup(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('Файл слишком большой (максимум 2 МБ)');
      setBackup(parseBackup(await file.text()));
    } catch (reason) { setToast(friendlyError(reason)); }
  }

  async function importBackup() {
    if (!db || !backup || saving) return;
    setSaving(true);
    try {
      const count = await restoreBackup(db, user.uid, backup, plan);
      setBackup(null);
      setToast(`Восстановлено подписок: ${count}. Существующие записи сохранены, настройки восстановлены.`);
    } catch (reason) { setToast(friendlyError(reason)); }
    finally { setSaving(false); }
  }

  useEffect(() => setLocalSettings(settings), [settings]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (externalError) setToast(externalError);
  }, [externalError]);

  const entitledItems = useMemo(() => items.filter((item) => canUseSubscription(item, plan)), [items, plan]);
  const lockedCount = items.length - entitledItems.length;
  const active = useMemo(() => entitledItems.filter((item) => item.status === 'active'), [entitledItems]);
  const monthlyTotals = totalsByCurrency(active);
  const projected = items.map((item) => ({ ...item, nextBillingDate: nextOccurrence(item, today) }));
  const upcoming = projected.filter((item) => canUseSubscription(item, plan) && item.status === 'active').sort((a, b) => a.nextBillingDate.localeCompare(b.nextBillingDate));
  const calendarItems = active.flatMap((item) => upcomingOccurrences(item, today))
    .sort((a, b) => a.nextBillingDate.localeCompare(b.nextBillingDate) || a.name.localeCompare(b.name, 'ru'));
  const reminders = upcoming.filter((item) => {
    const days = daysUntil(item.nextBillingDate);
    return settings.notificationsEnabled && days >= 0 && days <= settings.reminderDays;
  });
  const canAdd = plan === 'paid' || entitledItems.length < 3;
  const categoryTotals = categories.map((key) => {
    const categoryItems = active.filter((item) => item.category === key);
    return { key, count: categoryItems.length, totals: totalsByCurrency(categoryItems) };
  }).filter((entry) => entry.count > 0).sort((a, b) => b.count - a.count);
  const filtered = projected.filter((item) => {
    const matchesText = item.name.toLowerCase().includes(queryText.trim().toLowerCase());
    return matchesText && (category === 'all' || item.category === category) && (status === 'all' || item.status === status);
  }).sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, 'ru');
    if (sort === 'amount') return a.currency.localeCompare(b.currency) || monthlyAmount(b) - monthlyAmount(a);
    return a.nextBillingDate.localeCompare(b.nextBillingDate);
  });

  function navigate(next: View) {
    setView(next);
    window.history.replaceState(null, '', next === 'overview' ? '/' : `/?view=${next}`);
  }

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyForm(), currency: settings.baseCurrency });
    setDialogOpen(true);
  }

  function openEdit(item: Subscription) {
    item = items.find((original) => original.id === item.id) || item;
    if (!canUseSubscription(item, plan)) {
      setToast('Архивная подписка доступна только для просмотра, экспорта или удаления.');
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
      setToast(editing ? 'Изменения сохранены' : 'Подписка добавлена');
    } catch (reason) {
      setToast(friendlyError(reason));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(item: Subscription) {
    if (!db) return;
    if (!canUseSubscription(item, plan)) {
      setToast('Архивную подписку нельзя изменять на бесплатном тарифе.');
      return;
    }
    try {
      await toggleSubscription(db, user.uid, item);
      setToast(item.status === 'active' ? 'Подписка поставлена на паузу' : 'Подписка возобновлена');
    } catch (reason) {
      setToast(friendlyError(reason));
    }
  }

  async function confirmDelete() {
    if (!db || !pendingDelete) return;
    setSaving(true);
    try {
      await removeSubscription(db, user.uid, pendingDelete.id);
      setPendingDelete(null);
      setToast('Подписка удалена');
    } catch (reason) {
      setToast(friendlyError(reason));
    } finally {
      setSaving(false);
    }
  }

  async function savePreferences() {
    if (!db) return;
    try {
      await updateSettings(db, user.uid, localSettings);
      setToast('Настройки сохранены');
    } catch (reason) {
      setToast(friendlyError(reason));
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
        setToast('Данные удалены. Войдите заново и сразу повторите удаление, чтобы удалить сам аккаунт.');
        await leaveAccount();
      } else setToast(friendlyError(reason));
    } finally {
      setSaving(false);
    }
  }

  function exportData() {
    const payload = serializeBackup(items, settings);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tikhiy-schet-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast('Резервная копия сохранена');
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Logo />
        <nav className="nav" aria-label="Основная навигация">
          <NavButton active={view === 'overview'} icon={<LayoutDashboard />} onClick={() => navigate('overview')}>Обзор</NavButton>
          <NavButton active={view === 'subscriptions'} icon={<ReceiptText />} onClick={() => navigate('subscriptions')}>Подписки <span className="nav-count">{items.length}</span></NavButton>
          <NavButton active={view === 'calendar'} icon={<CalendarDays />} onClick={() => navigate('calendar')}>Календарь</NavButton>
          <NavButton active={view === 'settings'} icon={<Settings />} onClick={() => navigate('settings')}>Настройки</NavButton>
        </nav>
        {!publicAccess && <div className="ice-card">
          <ShieldCheck aria-hidden="true" />
          <div><strong>ЛЁД включён</strong><span>Закрыто для посторонних</span></div>
        </div>}
        <button className="account-row" onClick={() => void leaveAccount()}>
          <Avatar user={user} />
          <span><strong>{user.displayName || 'Владелец'}</strong><small>{user.email}</small></span>
          <LogOut aria-label="Выйти" />
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-logo"><Logo compact /></div>
          <p className="today">{new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</p>
          <div className="top-actions">
            <div className={`reminder-pill ${reminders.length ? 'attention' : ''}`}><Bell />{reminders.length ? `${reminders.length} напомин.` : 'Всё спокойно'}</div>
            <button className="top-account" onClick={() => void leaveAccount()} aria-label="Выйти из аккаунта"><Avatar user={user} /></button>
          </div>
        </header>

        <div className="content">
          <div className="page-heading">
            <div><p className="eyebrow">Ваш финансовый ритм</p><h1>{viewTitle(view, user)}</h1><p>{viewSubtitle(view, upcoming)}</p></div>
            {(view === 'overview' || view === 'subscriptions') && <button className="primary-button" onClick={openCreate} disabled={!canAdd} title={!canAdd ? 'Лимит бесплатного тарифа — три подписки' : undefined}><Plus />Добавить подписку</button>}
          </div>

          {publicAccess && plan === 'free' && <div className="plan-strip"><span>Бесплатный тариф</span><strong>{entitledItems.length} из 3 подписок</strong><small>{lockedCount ? `${lockedCount} в архиве · доступны просмотр, экспорт и удаление` : 'Увеличение лимита появится после подключения защищённой оплаты.'}</small></div>}

          {loading ? <div className="loading-panel"><LoaderCircle className="spin" /><span>Загружаем ваши данные…</span></div> : (
            <>
              {view === 'overview' && <Overview items={entitledItems} active={active} upcoming={upcoming} reminders={reminders} categoryTotals={categoryTotals} monthlyTotals={monthlyTotals} onEdit={openEdit} onNavigate={navigate} />}
              {view === 'subscriptions' && <SubscriptionsView items={filtered} plan={plan} query={queryText} category={category} status={status} sort={sort} onQuery={setQueryText} onCategory={setCategory} onStatus={setStatus} onSort={setSort} onEdit={openEdit} onToggle={(item) => void toggle(item)} onDelete={setPendingDelete} />}
              {view === 'calendar' && <CalendarView items={calendarItems} onEdit={openEdit} />}
              {view === 'settings' && <><SettingsView user={user} plan={plan} settings={localSettings} onChange={setLocalSettings} onSave={() => void savePreferences()} onExport={exportData} onDeleteData={() => setDeleteDataOpen(true)} /><section className="surface settings-card"><h2>Восстановить резервную копию</h2><p>Добавим отсутствующие подписки и восстановим настройки из файла. Существующие подписки не изменятся.{plan === 'free' ? ' На бесплатном тарифе действует общий лимит в три подписки.' : ''}</p><label className="field"><span>Выберите резервную копию JSON</span><input type="file" accept=".json,application/json" onChange={(event) => { void readBackup(event.target.files?.[0]); event.target.value = ''; }} /></label><LegalLinks /></section></>}
            </>
          )}
        </div>
      </section>

      <nav className="mobile-nav" aria-label="Мобильная навигация">
        <MobileButton active={view === 'overview'} icon={<LayoutDashboard />} onClick={() => navigate('overview')}>Обзор</MobileButton>
        <MobileButton active={view === 'subscriptions'} icon={<ReceiptText />} onClick={() => navigate('subscriptions')}>Подписки</MobileButton>
        <button className="mobile-add" onClick={openCreate} aria-label="Добавить подписку" disabled={!canAdd} title={!canAdd ? 'Лимит бесплатного тарифа — три подписки' : undefined}><Plus /></button>
        <MobileButton active={view === 'calendar'} icon={<CalendarDays />} onClick={() => navigate('calendar')}>Календарь</MobileButton>
        <MobileButton active={view === 'settings'} icon={<Settings />} onClick={() => navigate('settings')}>Настройки</MobileButton>
      </nav>

      {dialogOpen && <SubscriptionDialog form={form} editing={Boolean(editing)} saving={saving} onChange={setForm} onClose={() => setDialogOpen(false)} onSubmit={submit} />}
      {pendingDelete && <ConfirmDialog item={pendingDelete} saving={saving} onCancel={() => setPendingDelete(null)} onConfirm={() => void confirmDelete()} />}
      {backup && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Восстановление резервной копии"><h2>Восстановить резервную копию?</h2><p>В файле {backup.subscriptions.length} записей. Совпадающие подписки будут пропущены, а настройки заменятся значениями из копии.</p><div className="modal-actions"><button disabled={saving} onClick={() => setBackup(null)}>Отмена</button><button className="primary-button" disabled={saving} onClick={() => void importBackup()}>{saving ? 'Восстанавливаем…' : 'Восстановить'}</button></div></section></div>}
      {deleteDataOpen && <div className="modal-backdrop"><section className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-label="Удаление аккаунта и всех данных"><div className="danger-icon"><Trash2 /></div><h2>Удалить аккаунт и все данные?</h2><p>Аккаунт приложения, все подписки и настройки будут удалены без возможности восстановления. Для защиты от восстановления данных старой сессией останется только техническая отметка удалённого UID — без email, подписок и настроек. Сначала скачайте резервную копию, если она нужна.</p><div className="modal-actions"><button className="secondary-button" disabled={saving} onClick={() => setDeleteDataOpen(false)}>Отмена</button><button className="danger-button" disabled={saving} onClick={() => void confirmDeleteData()}>{saving && <LoaderCircle className="spin" />}Удалить аккаунт</button></div></section></div>}
      {toast && <div className="toast" role="status"><Check /><span>{toast}</span><button onClick={() => setToast(null)} aria-label="Закрыть"><X /></button></div>}
    </main>
  );
}

function Overview({ items, active, upcoming, reminders, categoryTotals, monthlyTotals, onEdit, onNavigate }: { items: Subscription[]; active: Subscription[]; upcoming: Subscription[]; reminders: Subscription[]; categoryTotals: { key: Category; count: number; totals: CurrencyTotals }[]; monthlyTotals: CurrencyTotals; onEdit: (item: Subscription) => void; onNavigate: (view: View) => void }) {
  const maxCategory = Math.max(...categoryTotals.map((entry) => entry.count), 1);
  return <>
    <div className="metrics">
      <Metric label="В месяц" value={formatTotals(monthlyTotals)} note={`${active.length} активных · валюты отдельно`} accent />
      <Metric label="В год" value={formatTotals(scaleTotals(monthlyTotals, 12))} note="прогноз без конвертации валют" />
      <Metric label="На паузе" value={String(items.length - active.length)} note="не входят в расчёт" />
      <Metric label="Ближайшее" value={upcoming[0] ? money(upcoming[0].amountCents / 100, upcoming[0].currency) : '—'} note={upcoming[0] ? `через ${Math.max(0, daysUntil(upcoming[0].nextBillingDate))} дн.` : 'списаний нет'} />
    </div>
    {reminders.length > 0 && <section className="notice-card"><Bell /><div><strong>Скоро спишутся средства</strong><span>{reminders.map((item) => item.name).join(', ')}</span></div><button onClick={() => onNavigate('calendar')}>Посмотреть</button></section>}
    <div className="overview-grid">
      <section className="surface upcoming-card">
        <div className="section-heading"><div><h2>Ближайшие списания</h2><p>Следующие регулярные платежи</p></div><button onClick={() => onNavigate('calendar')}>Все даты</button></div>
        {upcoming.length ? upcoming.slice(0, 5).map((item) => <SubscriptionRow key={item.id} item={item} onClick={() => onEdit(item)} />) : <EmptyState />}
      </section>
      <section className="surface category-card">
        <div className="section-heading"><div><h2>По категориям</h2><p>Среднее за месяц, без смешивания валют</p></div></div>
        {categoryTotals.length ? <div className="category-list">{categoryTotals.map((entry) => <div className="category-line" key={entry.key}><div className="category-meta"><span style={{ background: categoryColors[entry.key] }} /><strong>{categoryLabels[entry.key]}</strong><b>{formatTotals(entry.totals)}</b></div><div className="bar"><i style={{ width: `${Math.max(8, entry.count / maxCategory * 100)}%`, background: categoryColors[entry.key] }} /></div></div>)}</div> : <EmptyState />}
      </section>
    </div>
  </>;
}

function SubscriptionsView({ items, plan, query, category, status, sort, onQuery, onCategory, onStatus, onSort, onEdit, onToggle, onDelete }: { items: Subscription[]; plan: UserPlan; query: string; category: 'all' | Category; status: 'all' | 'active' | 'paused'; sort: Sort; onQuery: (value: string) => void; onCategory: (value: 'all' | Category) => void; onStatus: (value: 'all' | 'active' | 'paused') => void; onSort: (value: Sort) => void; onEdit: (item: Subscription) => void; onToggle: (item: Subscription) => void; onDelete: (item: Subscription) => void }) {
  return <section className="surface subscriptions-surface">
    <div className="filters">
      <label className="search-field"><Search /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Найти подписку" /></label>
      <select value={category} onChange={(event) => onCategory(event.target.value as 'all' | Category)} aria-label="Категория"><option value="all">Все категории</option>{categories.map((key) => <option key={key} value={key}>{categoryLabels[key]}</option>)}</select>
      <select value={status} onChange={(event) => onStatus(event.target.value as 'all' | 'active' | 'paused')} aria-label="Статус"><option value="all">Все статусы</option><option value="active">Активные</option><option value="paused">На паузе</option></select>
      <select value={sort} onChange={(event) => onSort(event.target.value as Sort)} aria-label="Сортировка"><option value="date">Сначала ближайшие</option><option value="amount">По сумме внутри валюты</option><option value="name">По названию</option></select>
    </div>
    <div className="table-head"><span>Сервис</span><span>Категория</span><span>Сумма</span><span>Статус</span><span>Действия</span></div>
    {items.length ? items.map((item) => {
      const editable = canUseSubscription(item, plan);
      return <div className={`manage-row ${editable ? '' : 'locked'}`} key={item.id}><SubscriptionIdentity item={item} /><span className="category-label"><i style={{ background: categoryColors[item.category] }} />{categoryLabels[item.category]}</span><div><strong>{money(item.amountCents / 100, item.currency)}</strong><small>/{item.billingPeriod === 'monthly' ? 'мес.' : 'год'}</small>{item.previousAmountCents && item.previousAmountCents < item.amountCents ? <em>Цена выросла</em> : null}</div>{editable ? <button className={`status-chip ${item.status}`} onClick={() => onToggle(item)}>{item.status === 'active' ? 'Активна' : 'На паузе'}</button> : <span className="status-chip locked">Архив</span>}<div className="row-actions">{editable && <><button onClick={() => onEdit(item)} aria-label={`Изменить ${item.name}`}><Pencil /></button><button onClick={() => onToggle(item)} aria-label={item.status === 'active' ? 'Поставить на паузу' : 'Возобновить'}>{item.status === 'active' ? <CirclePause /> : <CirclePlay />}</button></>}<button className="delete" onClick={() => onDelete(item)} aria-label={`Удалить ${item.name}`}><Trash2 /></button></div></div>;
    }) : <EmptyState />}
  </section>;
}

function CalendarView({ items, onEdit }: { items: Subscription[]; onEdit: (item: Subscription) => void }) {
  const groups = items.reduce<Record<string, Subscription[]>>((result, item) => {
    const key = item.nextBillingDate.slice(0, 7);
    (result[key] ||= []).push(item);
    return result;
  }, {});
  return <div className="calendar-layout">
    <section className="surface timeline-card"><div className="section-heading"><div><h2>Лента платежей</h2><p>Прогноз повторений на 12 месяцев</p></div></div>{Object.keys(groups).length ? Object.entries(groups).map(([month, monthItems]) => <div className="month-group" key={month}><h3>{new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`))}</h3>{monthItems.map((item) => <button key={`${item.id}-${item.nextBillingDate}`} className="timeline-row" onClick={() => onEdit(item)}><span className="date-box"><strong>{item.nextBillingDate.slice(8)}</strong><small>{new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${item.nextBillingDate}T12:00:00Z`))}</small></span><SubscriptionIdentity item={item} compact /><strong className="timeline-money">{money(item.amountCents / 100, item.currency)}</strong></button>)}</div>) : <EmptyState />}</section>
    <aside className="surface calendar-tip"><CalendarDays /><h2>Без сюрпризов</h2><p>Все даты хранятся в вашем закрытом пространстве. Напоминания появятся на главной за выбранное число дней.</p></aside>
  </div>;
}

function SettingsView({ user, plan, settings, onChange, onSave, onExport, onDeleteData }: { user: User; plan: UserPlan; settings: UserSettings; onChange: (value: UserSettings) => void; onSave: () => void; onExport: () => void; onDeleteData: () => void }) {
  return <div className="settings-grid">
    <section className="surface settings-card"><div className="section-heading"><div><h2>Расчёты и напоминания</h2><p>Настройте приложение под себя</p></div></div><div className="setting-row"><div><strong>Валюта новых подписок</strong><span>Итоги по разным валютам показываются отдельно без неточного курса</span></div><select aria-label="Валюта новых подписок" value={settings.baseCurrency} onChange={(event) => onChange({ ...settings, baseCurrency: event.target.value as Currency })}>{currencies.map((value) => <option key={value}>{value}</option>)}</select></div><div className="setting-row"><div><strong>Напоминать заранее</strong><span>От 0 до 30 дней перед списанием</span></div><div className="number-field"><input aria-label="Напоминать заранее" type="number" min="0" max="30" value={settings.reminderDays} onChange={(event) => onChange({ ...settings, reminderDays: Number(event.target.value) })} /><span>дн.</span></div></div><div className="setting-row"><div><strong>Напоминания внутри сайта</strong><span>Показывать ближайшие списания</span></div><button className={`switch ${settings.notificationsEnabled ? 'on' : ''}`} onClick={() => onChange({ ...settings, notificationsEnabled: !settings.notificationsEnabled })} role="switch" aria-label="Напоминания внутри сайта" aria-checked={settings.notificationsEnabled}><i /></button></div>{publicAccess && <div className="setting-row"><div><strong>Автообнаружение через Gmail</strong><span>Сейчас почта не подключается и её содержимое не читается. Функция появится только после отдельного согласия и проверки Google.</span></div><button className="future-button" type="button" disabled>Подключить позже</button></div>}<button className="primary-button save-settings" onClick={onSave}>Сохранить настройки</button></section>
    <section className="surface security-card">{!publicAccess && <><ShieldCheck /><span className="security-label">КОНТУР «ЛЁД»</span></>}<h2>{publicAccess ? 'Данные и резервная копия' : 'Данные под защитой'}</h2><p>{publicAccess ? 'Ваши подписки и настройки доступны только вашему аккаунту.' : 'Доступ разрешён только подтверждённому аккаунту владельца. База отклоняет запросы посторонних пользователей.'}</p><dl><div><dt>Аккаунт</dt><dd>{user.email}</dd></div><div><dt>{publicAccess ? 'Тариф' : 'Режим'}</dt><dd>{publicAccess ? plan === 'paid' ? 'Платный' : 'Бесплатный · до 3 подписок' : 'Личный доступ без лимита'}</dd></div><div><dt>Проверка почты</dt><dd className="safe">Подтверждена</dd></div><div><dt>Доступ к базе</dt><dd className="safe">{publicAccess ? 'Только ваши данные' : 'Только владелец'}</dd></div></dl><button className="secondary-button" onClick={onExport}><Download />Скачать резервную копию</button>{publicAccess && <button className="delete-data-button" onClick={onDeleteData}>Удалить аккаунт и данные</button>}</section>
  </div>;
}

function SubscriptionDialog({ form, editing, saving, onChange, onClose, onSubmit }: { form: SubscriptionInput; editing: boolean; saving: boolean; onChange: (value: SubscriptionInput) => void; onClose: () => void; onSubmit: (event: FormEvent) => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="subscription-dialog-title"><div className="modal-heading"><div><h2 id="subscription-dialog-title">{editing ? 'Изменить подписку' : 'Новая подписка'}</h2><p>Укажите данные о регулярном платеже.</p></div><button onClick={onClose} aria-label="Закрыть"><X /></button></div><form onSubmit={onSubmit} className="subscription-form"><Field label="Название сервиса"><input required minLength={2} maxLength={80} value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} placeholder="Например, Spotify" autoFocus /></Field><div className="form-grid amount-grid"><Field label="Сумма"><input required min="0.01" max="1000000" step="0.01" type="number" value={form.amount} onChange={(event) => onChange({ ...form, amount: event.target.value })} placeholder="499" /></Field><Field label="Валюта"><select value={form.currency} onChange={(event) => onChange({ ...form, currency: event.target.value as Currency })}>{currencies.map((value) => <option key={value}>{value}</option>)}</select></Field></div><div className="form-grid"><Field label="Период"><select value={form.billingPeriod} onChange={(event) => onChange({ ...form, billingPeriod: event.target.value as 'monthly' | 'yearly' })}><option value="monthly">Каждый месяц</option><option value="yearly">Каждый год</option></select></Field><Field label="Следующее списание"><input required type="date" value={form.nextBillingDate} onChange={(event) => onChange({ ...form, nextBillingDate: event.target.value })} /></Field></div><div className="form-grid"><Field label="Категория"><select value={form.category} onChange={(event) => onChange({ ...form, category: event.target.value as Category })}>{categories.map((key) => <option key={key} value={key}>{categoryLabels[key]}</option>)}</select></Field><Field label="Статус"><select value={form.status} onChange={(event) => onChange({ ...form, status: event.target.value as 'active' | 'paused' })}><option value="active">Активна</option><option value="paused">На паузе</option></select></Field></div><Field label="Заметка"><textarea maxLength={500} value={form.notes} onChange={(event) => onChange({ ...form, notes: event.target.value })} placeholder="Необязательно" /></Field><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button className="primary-button" type="submit" disabled={saving}>{saving && <LoaderCircle className="spin" />}{editing ? 'Сохранить' : 'Добавить'}</button></div></form></section></div>;
}

function ConfirmDialog({ item, saving, onCancel, onConfirm }: { item: Subscription; saving: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="modal-backdrop"><section className="modal confirm-modal" role="alertdialog" aria-modal="true"><div className="danger-icon"><Trash2 /></div><h2>Удалить «{item.name}»?</h2><p>Запись исчезнет из списка и расчётов. Это действие нельзя отменить.</p><div className="modal-actions"><button className="secondary-button" onClick={onCancel}>Оставить</button><button className="danger-button" onClick={onConfirm} disabled={saving}>{saving && <LoaderCircle className="spin" />}Удалить</button></div></section></div>;
}

function LoginScreen() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [sampleCount, setSampleCount] = useState(5);
  const [sampleMonthly, setSampleMonthly] = useState(599);
  async function login() {
    setBusy(true);
    setMessage(null);
    try { await signInWithGoogle(); } catch (reason) { setMessage(friendlyError(reason)); setBusy(false); }
  }
  async function emailAuth() {
    if (mode === 'register' && !acceptedTerms) return;
    setBusy(true);
    setMessage(null);
    try {
      if (mode === 'register') await registerWithEmail(email, password);
      else if (mode === 'reset') {
        await requestPasswordReset(email);
        setMessage('Ссылка для восстановления отправлена. Проверьте также папку «Спам».');
        setBusy(false);
      } else await signInWithEmail(email, password);
    } catch (reason) { setMessage(friendlyError(reason)); setBusy(false); }
  }
  const switchMode = (next: 'login' | 'register' | 'reset') => {
    setMode(next);
    setPassword('');
    setAcceptedTerms(false);
    setMessage(null);
  };
  const loginCard = <section className="login-card" id="login">
    <Logo />
    <div className="gate-illustration"><span><LockKeyhole /></span><i /><i /><i /></div>
    <p className="eyebrow">{publicAccess ? 'Личное пространство' : 'Закрытое пространство'}</p>
    <h1>{mode === 'register' ? 'Создайте личный аккаунт' : mode === 'reset' ? 'Восстановите пароль' : 'Ваши подписки — только для вас'}</h1>
    <p className="login-copy">{publicAccess ? mode === 'reset' ? 'Укажите email — Firebase отправит защищённую ссылку для выбора нового пароля.' : 'Войдите, чтобы управлять своими подписками. Обычный вход не даёт приложению доступ к содержимому почтового ящика.' : 'Войдите через разрешённый Google-аккаунт. Посторонним доступ к сайту и данным закрыт.'}</p>
    {publicAccess && <form className="email-auth" onSubmit={(event) => { event.preventDefault(); void emailAuth(); }}>
      <Field label="Email"><input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
      {mode !== 'reset' && <Field label="Пароль"><input required minLength={8} type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} /></Field>}
      {mode === 'register' && <label className="terms-consent"><input required type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} /><span>Я принимаю <a href="/?legal=terms">условия использования</a> и <a href="/?legal=privacy">политику конфиденциальности</a>.</span></label>}
      <button className="primary-button wide" type="submit" disabled={busy || (mode === 'register' && !acceptedTerms)}>{busy ? <LoaderCircle className="spin" /> : null}{mode === 'register' ? 'Создать аккаунт' : mode === 'reset' ? 'Отправить ссылку' : 'Войти по email'}</button>
      {mode === 'login' ? <><button className="secondary-button wide" type="button" disabled={busy} onClick={() => switchMode('register')}>Создать аккаунт</button><button className="text-button compact" type="button" disabled={busy} onClick={() => switchMode('reset')}>Забыли пароль?</button></> : <button className="text-button compact" type="button" disabled={busy} onClick={() => switchMode('login')}>Вернуться ко входу</button>}
      {mode !== 'reset' && <div className="auth-divider"><span>или</span></div>}
    </form>}
    {mode !== 'reset' && <><button className="google-button" onClick={() => void login()} disabled={busy}><span>G</span>{busy ? 'Подождите…' : 'Продолжить с Google'}</button>{publicAccess && <p className="google-consent">Продолжая с Google, вы принимаете <a href="/?legal=terms">условия использования</a> и <a href="/?legal=privacy">политику конфиденциальности</a>.</p>}</>}
    {message && <p className="login-error" role="alert">{message}</p>}
    {!publicAccess && <div className="ice-note"><ShieldCheck /><span><strong>Защита «ЛЁД»</strong>Проверяем аккаунт, приложение и каждый запрос к базе.</span></div>}
    {publicAccess && <LegalLinks />}
    {!publicAccess && <small>Разрешённый аккаунт: {maskEmail(ownerEmail)}</small>}
  </section>;

  if (!publicAccess) return <main className="gate">{loginCard}</main>;
  const yearlySample = Math.max(0, sampleCount) * Math.max(0, sampleMonthly) * 12;
  return <main className="public-gate">
    <section className="public-intro">
      <Logo />
      <p className="eyebrow">Спокойный контроль регулярных расходов</p>
      <h1>Подписки не должны становиться неожиданностью</h1>
      <p className="public-copy">Соберите даты и суммы в одном личном пространстве. «Тихий счёт» покажет ближайшие списания, годовой ритм и рост цены.</p>
      <div className="sample-calculator" aria-labelledby="sample-title">
        <div><span>Быстрый расчёт</span><strong id="sample-title">Сколько уходит за год?</strong></div>
        <label><span>Количество подписок</span><input type="number" min="0" max="100" value={sampleCount} onChange={(event) => setSampleCount(Math.min(100, Math.max(0, Number(event.target.value) || 0)))} /></label>
        <label><span>Средняя цена в месяц, ₽</span><input type="number" min="0" max="1000000" value={sampleMonthly} onChange={(event) => setSampleMonthly(Math.min(1_000_000, Math.max(0, Number(event.target.value) || 0)))} /></label>
        <output>{new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(yearlySample)} в год</output>
        <small>Расчёт выполняется только в браузере и никуда не отправляется.</small>
      </div>
      <div className="public-points"><span><Check />До 3 подписок бесплатно</span><span><Check />Данные каждого аккаунта изолированы</span><span><Check />Резервная копия и удаление аккаунта</span></div>
      <a className="primary-button public-cta" href="#login">Начать бесплатно</a>
    </section>
    {loginCard}
  </main>;
}

function LegalLinks() {
  return <nav className="legal-links" aria-label="Правовая информация"><a href="/?legal=privacy">Конфиденциальность</a><a href="/?legal=terms">Условия использования</a></nav>;
}

function LegalScreen({ kind }: { kind: 'privacy' | 'terms' }) {
  const privacy = kind === 'privacy';
  return <main className="legal-page"><article className="surface legal-document"><Logo /><a className="legal-back" href="/">← Вернуться в приложение</a><p className="eyebrow">Редакция от 7 сентября 2026 года</p><h1>{privacy ? 'Политика конфиденциальности' : 'Условия использования'}</h1>{privacy ? <>
    <h2>Какие данные обрабатываются</h2><p>Для работы сервиса используются email, имя профиля, технический идентификатор аккаунта, версия и серверное время принятия условий, введённые вами подписки и настройки. Пароли обрабатывает Firebase Authentication; приложение их не хранит.</p>
    <h2>Зачем нужны данные</h2><p>Они нужны только для входа, показа ваших записей, расчёта прогноза и защиты доступа. Обычный вход через Google или email не даёт сервису доступа к содержимому вашей почты.</p>
    <h2>Где хранятся данные</h2><p>Авторизация, база и защита приложения работают на сервисах Google Firebase. Каждая ветка базы доступна только подтверждённому владельцу соответствующего аккаунта.</p>
    <h2>Ваш контроль</h2><p>В настройках можно скачать резервную копию или безвозвратно удалить подписки, настройки, профиль приложения и учётную запись Firebase Authentication. После начала удаления сохраняется только техническая отметка UID без email и пользовательского содержимого: она нужна, чтобы ранее открытая сессия не смогла создать данные заново. Для давно открытой сессии Firebase может потребовать сначала войти заново и завершить удаление.</p>
  </> : <>
    <h2>Назначение сервиса</h2><p>«Тихий счёт» помогает вручную учитывать регулярные платежи. Он не является банком, платёжной системой или финансовым консультантом и сам не списывает деньги.</p>
    <h2>Точность прогноза</h2><p>Даты и суммы зависят от данных, которые вводит пользователь. Сервис не смешивает разные валюты по неточному курсу: итоги для каждой валюты показываются отдельно.</p>
    <h2>Безопасное использование</h2><p>Нельзя пытаться получить доступ к чужим данным, нарушать работу сервиса или использовать его в незаконных целях. Не вводите в заметки пароли, полные реквизиты карт и другие секреты.</p>
    <h2>Изменения и доступность</h2><p>Функции могут обновляться, а работа иногда прерываться для обслуживания. Перед важными изменениями рекомендуется скачать резервную копию.</p>
  </>}<h2>Связь</h2><p>{supportEmail ? <>По вопросам данных и сервиса: <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</> : 'Публичный контактный адрес ещё не указан. Это обязательный пункт перед открытым запуском.'}</p><LegalLinks /></article></main>;
}

function VerifyEmailScreen({ user, onVerified }: { user: User; onVerified: () => void }) {
  const [busy, setBusy] = useState<'check' | 'send' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function check() {
    setBusy('check'); setMessage(null);
    try {
      if (await refreshVerifiedUser()) onVerified();
      else setMessage('Адрес ещё не подтверждён. Откройте ссылку из письма и повторите проверку.');
    } catch (reason) { setMessage(friendlyError(reason)); }
    finally { setBusy(null); }
  }
  async function resend() {
    setBusy('send'); setMessage(null);
    try { await sendVerificationEmail(); setMessage('Новое письмо отправлено. Проверьте также папку «Спам».'); }
    catch (reason) { setMessage(friendlyError(reason)); }
    finally { setBusy(null); }
  }
  return <main className="gate"><section className="login-card"><Logo /><div className="denied-icon muted"><Bell /></div><p className="eyebrow">Защита аккаунта</p><h1>Подтвердите email</h1><p className="login-copy">Мы отправили ссылку на {maskEmail(user.email || '')}. Пока адрес не подтверждён, данные не загружаются.</p><button className="primary-button wide" disabled={Boolean(busy)} onClick={() => void check()}>{busy === 'check' && <LoaderCircle className="spin" />}Я подтвердил email</button><button className="secondary-button wide" disabled={Boolean(busy)} onClick={() => void resend()}>{busy === 'send' && <LoaderCircle className="spin" />}Отправить письмо повторно</button>{message && <p className="login-error" role="status">{message}</p>}<button className="text-button" disabled={Boolean(busy)} onClick={() => void leaveAccount()}>Выйти и указать другой email</button></section></main>;
}

function DeniedScreen({ email }: { email: string }) {
  return <main className="gate"><section className="login-card"><div className="denied-icon"><LockKeyhole /></div><p className="eyebrow">Доступ закрыт</p><h1>Этот аккаунт не разрешён</h1><p className="login-copy">Вы вошли как {email || 'неизвестный пользователь'}. Данные не загружались.</p><button className="secondary-button wide" onClick={() => void leaveAccount()}><LogOut />Выйти и выбрать другой аккаунт</button></section></main>;
}

function SetupScreen() {
  return <main className="gate"><section className="login-card"><Logo /><div className="denied-icon muted"><Settings /></div><p className="eyebrow">Подготовка Google-версии</p><h1>Приложение собрано</h1><p className="login-copy">Осталось связать его с вашим проектом Firebase. До подключения конфигурации никакие данные не отправляются.</p><div className="ice-note"><ShieldCheck /><span><strong>Безопасный режим</strong>Доступ к базе по умолчанию закрыт.</span></div></section></main>;
}

function LoadingScreen() { return <main className="gate"><div className="loading-gate"><LoaderCircle className="spin" /><span>Проверяем защищённый вход…</span></div></main>; }
function Metric({ label, value, note, accent = false }: { label: string; value: string; note: string; accent?: boolean }) { return <article className={`metric ${accent ? 'accent' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }
function EmptyState() { return <div className="empty"><ReceiptText /><strong>Пока здесь тихо</strong><span>Добавьте первую подписку, чтобы увидеть расчёты.</span></div>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
function Logo({ compact = false }: { compact?: boolean }) { return <div className="logo"><span><WalletCards /></span>{!compact && <strong>Тихий счёт</strong>}</div>; }
function Avatar({ user }: { user: User }) { return user.photoURL ? <img className="avatar" src={user.photoURL} referrerPolicy="no-referrer" alt="" /> : <span className="avatar fallback">{initials(user.displayName || user.email || 'ТС')}</span>; }
function SubscriptionIdentity({ item, compact = false }: { item: Subscription; compact?: boolean }) { return <div className={`identity ${compact ? 'compact' : ''}`}><span style={{ background: `${categoryColors[item.category]}22`, color: categoryColors[item.category] }}>{item.name.slice(0, 2).toUpperCase()}</span><div><strong>{item.name}</strong><small>{formatDate(item.nextBillingDate)}</small></div></div>; }
function SubscriptionRow({ item, onClick }: { item: Subscription; onClick: () => void }) { return <button className="subscription-row" onClick={onClick}><SubscriptionIdentity item={item} /><div><strong>{money(item.amountCents / 100, item.currency)}</strong>{item.previousAmountCents && item.previousAmountCents < item.amountCents ? <em>Цена выросла</em> : <small>{item.billingPeriod === 'monthly' ? 'ежемесячно' : 'ежегодно'}</small>}</div></button>; }
function NavButton({ active, icon, onClick, children }: { active: boolean; icon: ReactNode; onClick: () => void; children: ReactNode }) { return <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}>{icon}{children}</button>; }
function MobileButton({ active, icon, onClick, children }: { active: boolean; icon: ReactNode; onClick: () => void; children: ReactNode }) { return <button className={active ? 'active' : ''} onClick={onClick}>{icon}<span>{children}</span></button>; }
function initials(value: string) { return value.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'ТС'; }
function firstName(user: User) { return (user.displayName || user.email || 'владелец').split(/[\s@]/)[0]; }
function maskEmail(email: string) { const [name, domain] = email.split('@'); return `${name.slice(0, 3)}•••@${domain}`; }
function viewTitle(view: View, user: User) { if (view === 'overview') return `Добрый день, ${firstName(user)}`; if (view === 'subscriptions') return 'Все подписки'; if (view === 'calendar') return 'Календарь списаний'; return 'Настройки'; }
function viewSubtitle(view: View, upcoming: Subscription[]) { if (view === 'overview') return upcoming[0] ? `Всё под контролем. Ближайшее списание через ${Math.max(0, daysUntil(upcoming[0].nextBillingDate))} дн.` : 'Добавьте первую подписку — расчёты появятся автоматически.'; if (view === 'subscriptions') return 'Редактируйте суммы, даты и статусы в одном месте.'; if (view === 'calendar') return 'Спокойный взгляд на будущие регулярные расходы.'; return 'Управляйте расчётами, напоминаниями и резервной копией.'; }
function totalsByCurrency(items: Subscription[]): CurrencyTotals {
  return items.reduce<CurrencyTotals>((totals, item) => {
    totals[item.currency] = (totals[item.currency] || 0) + monthlyAmount(item);
    return totals;
  }, {});
}
function scaleTotals(totals: CurrencyTotals, factor: number): CurrencyTotals {
  return Object.fromEntries(Object.entries(totals).map(([currency, value]) => [currency, value! * factor])) as CurrencyTotals;
}
function formatTotals(totals: CurrencyTotals) {
  const values = currencies.filter((currency) => totals[currency] !== undefined)
    .map((currency) => money(totals[currency]!, currency));
  return values.length ? values.join(' · ') : '—';
}
function friendlyError(reason: unknown) {
  const code = (reason as { code?: string }).code || '';
  if (code.includes('permission-denied')) return 'Защита «ЛЁД» отклонила запрос. Проверьте разрешённый аккаунт.';
  if (code.includes('network-request-failed') || code.includes('unavailable')) return 'Нет связи с Google. Проверьте интернет и попробуйте ещё раз.';
  if (code.includes('popup-closed')) return 'Окно входа было закрыто.';
  if (code.includes('invalid-credential') || code.includes('user-not-found') || code.includes('wrong-password')) return 'Неверный email или пароль.';
  if (code.includes('email-already-in-use')) return 'Аккаунт с таким email уже существует. Попробуйте войти.';
  if (code.includes('invalid-email')) return 'Проверьте правильность email.';
  if (code.includes('weak-password')) return 'Пароль слишком простой. Используйте не менее 8 символов.';
  if (code.includes('too-many-requests')) return 'Слишком много попыток. Подождите немного и повторите.';
  if (code.includes('operation-not-allowed')) return 'Вход по email пока не включён для этого сайта.';
  return reason instanceof Error ? reason.message : 'Не удалось выполнить действие';
}
