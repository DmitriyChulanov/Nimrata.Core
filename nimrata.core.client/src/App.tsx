import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    AuthProvider,
    Button,
    DataProvider,
    Dialog,
    ExtensionsProvider,
    LoginScreen,
    MainMenu,
    NoExtensionsNotice,
    PropertyGrid,
    RevealBinding,
    ResetPasswordScreen,
    SelectionProvider,
    SyncIndicator,
    SyncStatusProvider,
    TabContainer,
    TabsProvider,
    Tree,
    TypesProvider,
    UndoControls,
    Workspace,
    createDataController,
    createOfflineSync,
    deleteOfflineDb,
    isExtensionCatalog,
    forgetRememberedUser,
    rememberedUser,
    createSignalRChannel,
    createRevealBridge,
    extensionRegistry,
    menuRegistry,
    registerCommands,
    registerExtensionsEditor,
    registerJournal,
    registerTheme,
    registerUsersAdmin,
    tabRegistry,
    useAuth,
    useApi,
    useAuthContext,
    useCurrentUser,
    useDataController,
    useQuery,
    useTabs,
} from '@platform';
import type { CatalogCache, CurrentUser, DataController, OfflineSync } from '@platform';

import '@/extensions';

import './App.css';

registerCommands(tabRegistry, menuRegistry);
registerJournal(tabRegistry, menuRegistry);
registerExtensionsEditor(tabRegistry, menuRegistry);
registerUsersAdmin(tabRegistry, menuRegistry);
registerTheme(menuRegistry);

/**
 * Основной экран после входа: состояние загрузки данных или рабочая область из трёх панелей
 *
 * @returns индикатор загрузки, сообщение об ошибке с повтором или рабочая область
 */
function Main() {
    const data = useDataController();
    const { widths, setWidths } = useTabs();
    // Основной экран зависит только от состояния загрузки, а не от каждой правки модели
    const { status, error } = useQuery((d) => {
        const { status, error } = d.getSnapshot();
        return { status, error };
    }, []);
    const [everReady, setEverReady] = useState(false);

    if (status === 'error') {
        return (
            <div>
                <p role="alert">{error}</p>
                <Button onClick={() => void data.load()}>Повторить</Button>
            </div>
        );
    }
    // Повторная загрузка (смена подключения расширения) не заменяет рабочую область индикатором:
    // иначе вкладки пересоздаются, а состояние Редактора расширений (ошибка карточки) теряется
    if (status === 'ready' && !everReady) setEverReady(true);
    if (status !== 'ready' && !everReady) return <p>Загрузка…</p>;

    return (
        <Workspace
            left={
                <NoExtensionsNotice>
                    <Tree />
                </NoExtensionsNotice>
            }
            center={<TabContainer />}
            initialWidths={widths}
            onWidthsChange={setWidths}
            right={<PropertyGrid />}
        />
    );
}

/**
 * Мост между логикой расширений и выделением узла в дереве
 */
const revealBridge = createRevealBridge();

/**
 * Данные вошедшего пользователя: контроллер, его офлайн-часть (кэш в IndexedDB) и найден ли кэш
 */
interface UserData {
    /** Контроллер данных */
    controller: DataController;
    /** Снимок и очередь вкладки в IndexedDB */
    offline: OfflineSync;
    /** Модель уже показана из кэша: расширения догоняют данные, а не грузят заново */
    cached: boolean;
}

/**
 * Контроллер данных пользователя с офлайн-частью: создаётся при входе, стартует из кэша (если он
 * есть) и освобождается при выходе или смене пользователя. Создание в эффекте делает это
 * устойчивым к двойному запуску эффектов в StrictMode
 *
 * @param userId - вошедший пользователь
 * @returns данные пользователя; `null`, пока идёт старт
 */
function useUserData(userId: string): UserData | null {
    const api = useApi();
    const [userData, setUserData] = useState<UserData | null>(null);

    useEffect(() => {
        let cancelled = false;
        const controller = createDataController({ api });
        const offline = createOfflineSync({ controller, userId });
        // Без IndexedDB (или при её сбое) работаем как раньше: без кэша, с полной загрузкой
        void offline
            .start()
            .catch(() => false)
            .then((cached) => {
                if (!cancelled) setUserData({ controller, offline, cached });
            });
        // Сеть вернулась: отправить очередь сразу, не дожидаясь задержки повтора
        const onOnline = () => controller.kick();
        window.addEventListener('online', onOnline);
        return () => {
            cancelled = true;
            window.removeEventListener('online', onOnline);
            setUserData(null);
            controller.dispose();
            void offline.dispose();
        };
    }, [api, userId]);

    return userData;
}

/**
 * Свойства компонента `Application`
 */
interface ApplicationProps {
    /** Идентификатор вошедшего пользователя */
    userId: string;
    /** Данные пользователя */
    userData: UserData;
}

/**
 * Контекст данных пользователя: контроллер, подключённые расширения (их жизненным циклом и
 * загрузкой данных управляет `ExtensionsProvider`) и основной экран
 *
 * @param props - свойства компонента, описаны в `ApplicationProps`
 * @returns основной экран внутри провайдеров данных, выделения и расширений
 */
function Application({ userId, userData }: ApplicationProps) {
    const api = useApi();
    const { session } = useAuthContext();
    const { controller, offline, cached } = userData;

    // Push-синхронизация: соединение живёт, пока смонтирован экран пользователя
    useEffect(
        () =>
            controller.connectPush(
                createSignalRChannel({
                    getAccessToken: session.getAccessToken,
                    subscribeToken: session.subscribe,
                    refreshToken: session.refresh,
                }),
            ),
        [controller, session],
    );

    // Каталог расширений в той же базе: без сети расширения запускаются по сохранённому
    const catalogCache = useMemo<CatalogCache>(
        () => ({
            // Значение неверной формы (старая версия, порча базы) — как отсутствие кэша
            read: async () => {
                const value = await offline.readValue('catalog');
                return isExtensionCatalog(value) ? value : undefined;
            },
            write: (items) => offline.writeValue('catalog', items),
        }),
        [offline],
    );

    return (
        <DataProvider controller={controller}>
            <SelectionProvider>
                <RevealBinding bridge={revealBridge} />
                <UndoControls registry={menuRegistry} />
                <ExtensionsProvider
                    api={api}
                    controller={controller}
                    registry={extensionRegistry}
                    userId={userId}
                    reveal={revealBridge.reveal}
                    cached={cached}
                    catalogCache={catalogCache}
                >
                    <Main />
                </ExtensionsProvider>
            </SelectionProvider>
        </DataProvider>
    );
}

/**
 * Оболочка вошедшего пользователя: шапка с меню и выходом и область приложения
 *
 * @returns интерфейс сессии; ничего, пока неизвестен текущий пользователь
 */
function Session() {
    const user = useCurrentUser();

    if (!user) return null;

    return <UserSession key={user.id} user={user} />;
}

/**
 * Шапка и приложение вошедшего пользователя. Выход: при неотправленных изменениях (этой и других
 * вкладок) — предупреждение, затем база пользователя в IndexedDB удаляется
 *
 * @param props - текущий пользователь
 * @returns интерфейс сессии пользователя
 */
function UserSession({ user }: { user: CurrentUser }) {
    const { logout, status } = useAuth();
    const userData = useUserData(user.id);
    const unsentCount = useCallback(
        () => userData?.offline.unsentCount() ?? Promise.resolve(0),
        [userData],
    );
    // Число неотправленных наборов, о которых предупреждаем; `null` — предупреждения нет
    const [unsent, setUnsent] = useState<number | null>(null);
    // Возобновление отправки очереди: пока открыто предупреждение, наборы не уходят, иначе число
    // в предупреждении и то, что потеряется при выходе, разошлись бы
    const resumeSync = useRef<(() => void) | null>(null);

    const resume = () => {
        resumeSync.current?.();
        resumeSync.current = null;
    };

    const cancelLogout = () => {
        setUnsent(null);
        resume();
    };

    const finishLogout = async () => {
        setUnsent(null);
        resumeSync.current = null;
        if (userData) {
            userData.controller.dispose();
            await userData.offline.dispose();
        }
        await deleteOfflineDb(user.id).catch(() => undefined);
        forgetRememberedUser();
        await logout();
    };

    const requestLogout = async () => {
        if (resumeSync.current) return;
        // Заявка на выход уже идёт: повторное нажатие ничего не делает
        resumeSync.current = () => undefined;
        if (userData) resumeSync.current = await userData.controller.pauseSync();
        const count = userData ? await userData.offline.unsentCount() : 0;
        if (count > 0) setUnsent(count);
        else await finishLogout();
    };

    return (
        <TabsProvider registry={tabRegistry} userId={user.id}>
            <div className="app">
                <header className="app-header">
                    <h1>Nimrata</h1>
                    <MainMenu registry={menuRegistry} role={user.role} />
                    {userData && (
                        <SyncStatusProvider
                            controller={userData.controller}
                            unsentCount={unsentCount}
                            signedInOffline={status === 'offline'}
                        >
                            <SyncIndicator />
                        </SyncStatusProvider>
                    )}
                    <Button variant="ghost" icon="log-out" onClick={() => void requestLogout()}>
                        Выйти
                    </Button>
                </header>
                <main className="app-main">
                    {userData ? (
                        <Application userId={user.id} userData={userData} />
                    ) : (
                        <p>Загрузка…</p>
                    )}
                </main>
            </div>
            {unsent !== null && (
                <Dialog
                    title="Неотправленные изменения"
                    role="alertdialog"
                    onClose={cancelLogout}
                    actions={
                        <>
                            <Button onClick={cancelLogout}>Отмена</Button>
                            <Button variant="danger" onClick={() => void finishLogout()}>
                                Выйти
                            </Button>
                        </>
                    }
                >
                    <p>
                        Изменения ещё не отправлены на сервер ({unsent}). После выхода они будут
                        потеряны.
                    </p>
                </Dialog>
            )}
        </TabsProvider>
    );
}

/**
 * Токен из ссылки письма (`/reset-password?token=…`); null, если открыт обычный адрес
 */
function readResetToken(): string | null {
    if (window.location.pathname !== '/reset-password') return null;
    return new URLSearchParams(window.location.search).get('token') ?? '';
}

/**
 * Выбирает экран по состоянию входа: смена пароля, вход или сессия
 *
 * @returns экран, подходящий текущему состоянию
 */
function Shell() {
    const { status, login } = useAuth();
    const [resetToken, setResetToken] = useState(readResetToken);

    if (resetToken !== null) {
        return (
            <ResetPasswordScreen
                token={resetToken}
                onDone={() => {
                    window.history.replaceState({}, '', '/');
                    setResetToken(null);
                }}
            />
        );
    }
    if (status === 'loading') return null;
    if (status === 'anonymous') return <LoginScreen onLogin={login} />;
    // Без сети вход не проверить: работаем локально, если пользователь уже входил на этом устройстве
    if (status === 'offline' && !rememberedUser()) return <LoginScreen onLogin={login} />;

    return <Session />;
}

/**
 * Корень приложения: авторизация, типы и оболочка
 *
 * @returns приложение
 */
export function App() {
    return (
        <AuthProvider>
            <TypesProvider>
                <Shell />
            </TypesProvider>
        </AuthProvider>
    );
}
