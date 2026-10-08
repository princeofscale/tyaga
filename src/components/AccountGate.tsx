import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Dumbbell, LockKeyhole, LoaderCircle, ShieldCheck, Download, Smartphone } from "lucide-react";
import App from "../App";
import Modal from "./Modal";
import { api } from "../services/ApiClient";
import { browserTimeZone } from "../lib/calendar";
import type { AccountProfile, AccountState } from "../lib/account";

export default function AccountGate() {
  const [state, setState] = useState<AccountState | null>(null);
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState("");
  const refresh = useCallback(async () => {
    try { setState(await api<AccountState>("/api/auth/session")); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось открыть аккаунт"); }
  }, []);
  useEffect(() => { void refresh(); window.addEventListener("tyaga:auth-expired", refresh); return () => window.removeEventListener("tyaga:auth-expired", refresh); }, [refresh]);
  if (!state) return <main className="account-loading"><Dumbbell size={32} /><h1>Тяга</h1>{error ? <><p role="alert">{error}</p><button className="button primary" onClick={() => void refresh()}>Повторить</button></> : <p role="status">Открываем твой журнал…</p>}</main>;
  return <>
    {state.profile ? <App key={state.profile.id} account={state.profile}
      onAccountChange={profile => setState({ registered: true, profile })}
      onLogout={() => setState({ registered: true, profile: null })} />
      : <SignIn registered={state.registered} onSignedIn={(profile, recoveryCode) => { setState({ registered: true, profile }); if (recoveryCode) setRecovery(recoveryCode); history.replaceState(null, "", location.pathname); }} />}
    {recovery && <Modal title="Код восстановления" onClose={() => setRecovery("")}>
      <p className="modal-intro">Сохрани этот код. Он позволит установить новый пароль, если забудешь старый. Почту мы используем для входа; письма восстановления пока не отправляем.</p>
      <code className="recovery-code">{recovery}</code>
      <div className="modal-actions"><button className="button secondary" onClick={() => {
        const url = URL.createObjectURL(new Blob([`Тяга — код восстановления\n${recovery}\nХрани отдельно от пароля.\n`], { type: "text/plain" }));
        const a = document.createElement("a"); a.href = url; a.download = "tyaga-recovery.txt"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}><Download size={16} />Скачать код</button><button className="button primary" onClick={() => setRecovery("")}>Код сохранён</button></div>
    </Modal>}
  </>;
}
function SignIn({ registered, onSignedIn }: { registered: boolean; onSignedIn: (profile: AccountProfile, code?: string) => void }) {
  const [mode, setMode] = useState(() => location.hash.includes("recover") ? "recover" : location.hash.includes("register") ? "register" : registered ? "login" : "register");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const changeMode = (value: string) => { setMode(value); setError(""); history.replaceState(null, "", `#/${value}`); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return; const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const result = await api<{ profile: AccountProfile; recoveryCode?: string }>(`/api/auth/${mode}`, "POST", {
        email: form.get("email"), password: form.get("password"), displayName: form.get("displayName"),
        timeZone: browserTimeZone(), recoveryCode: form.get("recoveryCode"),
      });
      onSignedIn(result.profile, result.recoveryCode);
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось войти"); }
    finally { setBusy(false); }
  };
  return <main className="account-page">
    <div className="account-brand"><span><Dumbbell size={26} /></span>ТЯГА</div>
    <section className="account-card panel">
      <div className="account-icon"><LockKeyhole size={25} /></div>
      <h1>{mode === "register" ? "Твой журнал начинается здесь" : mode === "recover" ? "Вернуться к тренировкам" : "Снова в зале"}</h1>
      <p>{mode === "register" ? "Создай профиль, записывай подходы и следи за своей работой." : mode === "recover" ? "Введи сохранённый код и придумай новый пароль." : "Войди, чтобы продолжить свою историю тренировок."}</p>
      {mode !== "recover" && <div className="segmented account-tabs"><button onClick={() => changeMode("login")} className={mode === "login" ? "active" : ""}>Вход</button><button onClick={() => changeMode("register")} className={mode === "register" ? "active" : ""}>Регистрация</button></div>}
      <form onSubmit={submit} className="account-form">
        {mode === "register" && <label>Как тебя зовут<input name="displayName" autoComplete="given-name" placeholder="Твоё имя" maxLength={80} required /></label>}
        <label>Почта<input name="email" type="email" autoComplete="username" placeholder="you@example.com" maxLength={254} required /></label>
        {mode === "recover" && <label>Код восстановления<input name="recoveryCode" autoComplete="off" maxLength={64} required /></label>}
        <label>{mode === "recover" ? "Новый пароль" : "Пароль"}<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={10} maxLength={128} placeholder={mode === "login" ? "Твой пароль" : "Не меньше 10 символов"} required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button primary" disabled={busy}>{busy ? <><LoaderCircle size={18} className="spin" />Подождём немного…</> : mode === "register" ? "Создать аккаунт" : mode === "recover" ? "Установить пароль" : "Войти в Тягу"}</button>
      </form>
      <button className="text-button account-recover" onClick={() => changeMode(mode === "recover" ? "login" : "recover")}>{mode === "recover" ? "Вернуться ко входу" : "Забыл пароль"}</button>
      <div className="account-assurance"><ShieldCheck size={16} /><span>Тренировки сохраняются в аккаунте. Вход запоминается на 30 дней.</span></div>
    </section>
    {import.meta.env.MODE !== "device" && <a className="button secondary android-download" href="/tyaga.apk" download><Smartphone size={18} />Скачать приложение для Android</a>}
    <p className="account-footer">Разминка. Рабочие подходы. Твой прогресс.</p>
  </main>;
}
