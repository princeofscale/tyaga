import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertCircle, Dumbbell, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { m, useReducedMotion } from "motion/react";
import App from "../App";
import AppErrorBoundary from "./AppErrorBoundary";
import RecoveryCodeModal from "./RecoveryCodeModal";
import { LiveRoomProvider } from "./LiveRoomProvider";
import { api, ApiError } from "../services/ApiClient";
import { offlineSnapshot } from "../lib/offlineSnapshot";
import { deviceAccountData } from "../lib/deviceAccountData";
import { DEFAULT_SETTINGS } from "../lib/model";
import { browserTimeZone } from "../lib/calendar";
import type { AccountProfile, AccountState } from "../lib/account";

export default function AccountGate() {
  const [state, setState] = useState<AccountState | null>(null);
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState("");
  const refresh = useCallback(async () => {
    try {
      const session = await api<AccountState>("/api/auth/session");
      // Копия профиля нужна только для запуска без связи; без входа её не бывает.
      if (session.profile) { offlineSnapshot.saveSession(session.profile); deviceAccountData.purgeOthers(session.profile.id); } else { offlineSnapshot.clear(); deviceAccountData.wipeCaches(); }
      setState(session); setError("");
    }
    catch (e) {
      // Нет связи (а не отказ сервера): после первого входа приложение открывается с копией на устройстве.
      const cached = e instanceof ApiError ? null : offlineSnapshot.session();
      if (cached) { setState({ registered: true, profile: cached }); setError(""); }
      else setError(e instanceof Error ? e.message : "Не удалось открыть аккаунт");
    }
  }, []);
  // Выход: на устройстве не остаётся ничего личного (черновик, журнал веса, офлайн-копия). Повтор — после размонтирования приложения.
  const logout = useCallback(() => {
    deviceAccountData.wipe();
    setState({ registered: true, profile: null });
    setTimeout(() => deviceAccountData.wipe(), 0);
  }, []);
  useEffect(() => { void refresh(); window.addEventListener("tyaga:auth-expired", refresh); return () => window.removeEventListener("tyaga:auth-expired", refresh); }, [refresh]);
  if (!state) return (
    <main className="account-loading auth-loading steel-auth-loading">
      <span className="auth-loading-mark" aria-hidden="true"><Dumbbell size={28} /></span>
      <h1>Тяга</h1>
      {error ? <>
        <p role="alert">{error}</p>
        <button type="button" className="button primary" onClick={() => void refresh()}>Повторить</button>
      </> : <p role="status">Открываем твой журнал…</p>}
    </main>
  );
  return <>
    {state.profile ? <AppErrorBoundary key={state.profile.id} onLogout={logout}><LiveRoomProvider key={state.profile.id}><App account={state.profile}
      onAccountChange={profile => { offlineSnapshot.saveSession(profile); setState({ registered: true, profile }); }}
      onLogout={logout} /></LiveRoomProvider></AppErrorBoundary>
      : <SignIn registered={state.registered} onSignedIn={(profile, recoveryCode, fresh) => {
        // Офлайн-запуск должен работать сразу после первого входа, а не после второй онлайн-загрузки.
        deviceAccountData.purgeOthers(profile.id);
        offlineSnapshot.saveSession(profile);
        if (fresh) offlineSnapshot.saveData(profile.id, { workouts: [], settings: { ...DEFAULT_SETTINGS, timeZone: profile.timeZone || browserTimeZone() }, product: { routines: [], customExercises: [], favorites: [] } });
        setState({ registered: true, profile }); if (recoveryCode) setRecovery(recoveryCode); history.replaceState(null, "", location.pathname + location.search); }} />}
    {recovery && <RecoveryCodeModal code={recovery} onClose={() => setRecovery("")}
      intro="Сохрани этот код: он нигде больше не показывается. Он позволит установить новый пароль, если забудешь старый. Потерял — войди с паролем и выпусти новый в профиле. Почту мы используем для входа; письма восстановления пока не отправляем." />}
  </>;
}
function SignIn({ registered, onSignedIn }: { registered: boolean; onSignedIn: (profile: AccountProfile, code?: string, fresh?: boolean) => void }) {
  const [mode, setMode] = useState(() => location.hash.includes("recover") ? "recover" : location.hash.includes("register") ? "register" : registered ? "login" : "register");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const reduceMotion = useReducedMotion();
  const changeMode = (value: string) => { setMode(value); setError(""); history.replaceState(null, "", `#/${value}`); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return; const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const result = await api<{ profile: AccountProfile; recoveryCode?: string }>(`/api/auth/${mode}`, "POST", {
        email: form.get("email"), password: form.get("password"), displayName: form.get("displayName"),
        timeZone: browserTimeZone(), recoveryCode: form.get("recoveryCode"),
      });
      onSignedIn(result.profile, result.recoveryCode, mode === "register");
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось войти"); }
    finally { setBusy(false); }
  };
  return <main className="account-page steel-auth">
    <header className="auth-masthead">
      <span className="auth-brand-name">ТЯГА</span>
      <span className="auth-brand-caption">Силовой журнал</span>
    </header>

    <section className="auth-card" aria-labelledby="auth-title">
      <h1 id="auth-title">{mode === "register" ? "Новый аккаунт" : mode === "recover" ? "Вернуться к тренировкам" : "Снова в зале"}</h1>
      {mode !== "recover" ? (
        <div className="account-tabs" role="group" aria-label="Режим входа">
          <button type="button" onClick={() => changeMode("login")} aria-pressed={mode === "login"}>Вход</button>
          <button type="button" onClick={() => changeMode("register")} aria-pressed={mode === "register"}>Регистрация</button>
          <m.span className="auth-mode-indicator" aria-hidden="true" initial={false}
            animate={{ x: mode === "register" ? "100%" : "0%" }}
            transition={{ duration: reduceMotion ? 0 : 0.18, ease: "easeOut" }} />
        </div>
      ) : (
        <>
          <p className="auth-card-intro">Введи сохранённый код и придумай новый пароль.</p>
          <p className="auth-field-hint recover-no-code">
            Нет кода? Без него пароль не восстановить. Если ты ещё входишь с паролем на другом устройстве, войди там и выпусти новый код в профиле.
          </p>
        </>
      )}
      <form onSubmit={submit} className="account-form" aria-busy={busy}>
        {mode === "register" && (
          <label htmlFor="auth-name">
            Как тебя зовут
            <input id="auth-name" name="displayName" autoComplete="given-name" enterKeyHint="next" placeholder="Твоё имя" maxLength={80} required />
          </label>
        )}
        <label htmlFor="auth-email">
          Почта
          <input id="auth-email" name="email" type="email" autoComplete="username" inputMode="email" enterKeyHint="next" autoCapitalize="none" spellCheck={false} placeholder="you@example.com" maxLength={254} required />
        </label>
        {mode === "recover" && (
          <label htmlFor="auth-recovery-code">
            Код восстановления
            <input id="auth-recovery-code" name="recoveryCode" autoComplete="off" enterKeyHint="next" autoCapitalize="none" spellCheck={false} maxLength={64} required />
          </label>
        )}
        <div className="auth-password-field">
          <label htmlFor="auth-password">{mode === "recover" ? "Новый пароль" : "Пароль"}</label>
          {mode !== "login" && <span className="auth-field-hint" id="auth-password-hint">Не меньше 10 символов</span>}
          <div className="password-input-row">
            <input
              id="auth-password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              enterKeyHint="go"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              minLength={10}
              maxLength={128}
              aria-describedby={mode === "login" ? undefined : "auth-password-hint"}
              required
            />
            <button
              type="button"
              className="password-toggle-btn"
              aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
            </button>
          </div>
        </div>
        {error && <m.p className="form-error" role="alert"
          initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
          <AlertCircle size={17} aria-hidden="true" /><span>{error}</span>
        </m.p>}
        <button type="submit" className="button primary auth-submit" disabled={busy}>
          {busy ? <><LoaderCircle size={18} className="spin" aria-hidden="true" />Подождём немного…</> : <>
            {mode === "register" ? "Создать аккаунт" : mode === "recover" ? "Установить пароль" : "Войти в Тягу"}
          </>}
        </button>
      </form>
      <button type="button" className="text-button account-recover" onClick={() => changeMode(mode === "recover" ? "login" : "recover")}>
        {mode === "recover" ? "Вернуться ко входу" : "Забыл пароль"}
      </button>
      {mode === "login" && <p className="account-assurance">Вход запоминается на 30 дней.</p>}
    </section>

    {import.meta.env.MODE !== "device" && (
      <footer className="auth-bottom">
        <a className="button secondary android-download" href="/tyaga.apk" download>
          Скачать приложение для Android
        </a>
      </footer>
    )}
  </main>;
}
