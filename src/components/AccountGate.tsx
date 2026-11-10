import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Dumbbell, LockKeyhole, LoaderCircle, ShieldCheck, Download, Smartphone, Eye, EyeOff, ArrowRight, ArrowUpRight, AlertCircle } from "lucide-react";
import { m, useReducedMotion } from "motion/react";
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
  if (!state) return <main className="account-loading auth-loading"><div className="auth-loading-mark"><Dumbbell size={32} aria-hidden="true" /></div><h1>Тяга</h1>{error ? <><p role="alert">{error}</p><button className="button primary" onClick={() => void refresh()}>Повторить</button></> : <p role="status">Открываем твой журнал…</p>}</main>;
  return <>
    {state.profile ? <App key={state.profile.id} account={state.profile}
      onAccountChange={profile => setState({ registered: true, profile })}
      onLogout={() => setState({ registered: true, profile: null })} />
      : <SignIn registered={state.registered} onSignedIn={(profile, recoveryCode) => { setState({ registered: true, profile }); if (recoveryCode) setRecovery(recoveryCode); history.replaceState(null, "", location.pathname + location.search); }} />}
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
      onSignedIn(result.profile, result.recoveryCode);
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось войти"); }
    finally { setBusy(false); }
  };
  return <main className="account-page auth-athletic">
    <m.header className="auth-masthead"
      initial={reduceMotion ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}>
      <div className="auth-brand">
        <span className="auth-brand-mark" aria-hidden="true"><Dumbbell size={23} /></span>
        <div className="auth-brand-type">
          <span className="auth-brand-name">ТЯГА</span>
          <span className="auth-brand-caption">Силовой дневник</span>
        </div>
      </div>
      <span className="auth-edition"><span aria-hidden="true" />Вес. Повторы. Прогресс.</span>
    </m.header>

    <div className="auth-layout">
      <m.aside className="auth-editorial" aria-label="О Тяге"
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.04 }}>
        <div className="auth-kicker"><span>01 / СИЛОВОЙ ДНЕВНИК</span><span className="auth-kicker-line" aria-hidden="true" /></div>
        <h2 className="auth-headline">СИЛА<br />В <span>ДЕТАЛЯХ.</span></h2>
        <p className="auth-editorial-copy">Подходы, тоннаж и личные рекорды.<br />Вся работа — в одном журнале.</p>
        <div className="auth-equipment" aria-hidden="true">
          <BarbellPlate />
          <div className="auth-equipment-caption"><span>РАБОЧИЙ ВЕС</span><span>20 КГ × 2</span></div>
        </div>
        <ul className="auth-benefits">
          <li><span>01</span>Записывай подходы</li>
          <li><span>02</span>Следи за 1ПМ</li>
          <li><span>03</span>Без рекламы</li>
        </ul>
      </m.aside>

      <m.section className="account-card panel auth-card" aria-labelledby="auth-title"
        initial={reduceMotion ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}>
        <div className="auth-card-eyebrow"><span>ТВОЙ АККАУНТ</span><LockKeyhole size={17} aria-hidden="true" /></div>
        <h1 id="auth-title">{mode === "register" ? "Твой журнал начинается здесь" : mode === "recover" ? "Вернуться к тренировкам" : "Снова в зале"}</h1>
        <p className="auth-card-intro">{mode === "register" ? "Создай профиль, записывай подходы и следи за своей работой." : mode === "recover" ? "Введи сохранённый код и придумай новый пароль." : "Войди, чтобы продолжить свою историю тренировок."}</p>
        {mode !== "recover" && (
          <div className="segmented account-tabs" role="group" aria-label="Режим входа">
            <button type="button" onClick={() => changeMode("login")} aria-pressed={mode === "login"} className={mode === "login" ? "active" : ""}>Вход</button>
            <button type="button" onClick={() => changeMode("register")} aria-pressed={mode === "register"} className={mode === "register" ? "active" : ""}>Регистрация</button>
          </div>
        )}
        <form onSubmit={submit} className="account-form" aria-busy={busy}>
          {mode === "register" && (
            <label htmlFor="auth-name">
              Как тебя зовут
              <input id="auth-name" name="displayName" autoComplete="given-name" placeholder="Твоё имя" maxLength={80} required />
            </label>
          )}
          <label htmlFor="auth-email">
            Почта
            <input id="auth-email" name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} placeholder="you@example.com" maxLength={254} required />
          </label>
          {mode === "recover" && (
            <label htmlFor="auth-recovery-code">
              Код восстановления
              <input id="auth-recovery-code" name="recoveryCode" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={64} required />
            </label>
          )}
          <div className="auth-password-field">
            <label htmlFor="auth-password">{mode === "recover" ? "Новый пароль" : "Пароль"}</label>
            <div className="password-input-row">
              <input
                id="auth-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={10}
                maxLength={128}
                placeholder={mode === "login" ? "Твой пароль" : "Не меньше 10 символов"}
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
            {mode !== "login" && <span className="auth-field-hint" id="auth-password-hint">Не меньше 10 символов</span>}
          </div>
          {error && <m.p className="form-error" role="alert"
            initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
            <AlertCircle size={17} aria-hidden="true" /><span>{error}</span>
          </m.p>}
          <button type="submit" className="button primary auth-submit" disabled={busy}>
            {busy ? <><LoaderCircle size={18} className="spin" aria-hidden="true" />Подождём немного…</> : <>
              {mode === "register" ? "Создать аккаунт" : mode === "recover" ? "Установить пароль" : "Войти в Тягу"}
              <ArrowRight size={19} aria-hidden="true" />
            </>}
          </button>
        </form>
        <button type="button" className="text-button account-recover" onClick={() => changeMode(mode === "recover" ? "login" : "recover")}>
          {mode === "recover" ? "Вернуться ко входу" : "Забыл пароль"}
        </button>
        <div className="account-assurance">
          <ShieldCheck size={17} aria-hidden="true" />
          <span>Тренировки сохраняются в аккаунте. Вход запоминается на 30 дней.</span>
        </div>
      </m.section>
    </div>

    <footer className="auth-bottom">
      <p className="account-footer"><span aria-hidden="true" />Разминка. Рабочие подходы. Твой прогресс.</p>
      {import.meta.env.MODE !== "device" && (
        <a className="button secondary android-download" href="/tyaga.apk" download>
          <Smartphone size={18} aria-hidden="true" />
          <span>Скачать приложение для Android</span>
          <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      )}
    </footer>
  </main>;
}

function BarbellPlate() {
  return <svg className="auth-barbell" viewBox="0 0 580 330" fill="none" focusable="false">
    <g className="auth-diagram-grid" strokeWidth="1">
      <path d="M20 80H560M20 160H560M20 240H560M100 28V294M220 28V294M340 28V294M460 28V294" />
      <path d="M20 28V40M14 34H26M554 286H566M560 280V292" />
    </g>
    <path className="auth-diagram-line" d="M34 286H540M34 281V291M540 281V291" strokeWidth="1" />
    <g transform="rotate(-14 288 162)">
      <rect className="auth-bar-shaft" x="30" y="151" width="520" height="23" rx="4" />
      <path className="auth-bar-detail" d="M36 156H544M36 169H544M228 153L218 172M240 153L230 172M252 153L242 172M264 153L254 172M276 153L266 172M288 153L278 172M300 153L290 172M312 153L302 172" />
      <rect className="auth-bar-collar" x="63" y="142" width="15" height="41" rx="3" />
      <ellipse className="auth-plate-edge" cx="135" cy="162" rx="41" ry="83" />
      <ellipse className="auth-plate-dark" cx="121" cy="162" rx="41" ry="83" />
      <ellipse className="auth-plate-ring" cx="121" cy="162" rx="31" ry="65" />
      <ellipse className="auth-plate-hub" cx="121" cy="162" rx="8" ry="15" />
      <rect className="auth-bar-collar" x="165" y="141" width="16" height="43" rx="3" />
      <ellipse className="auth-plate-edge" cx="432" cy="162" rx="65" ry="113" />
      <ellipse className="auth-plate-dark" cx="416" cy="162" rx="65" ry="113" />
      <ellipse className="auth-plate-lime" cx="399" cy="162" rx="65" ry="113" />
      <ellipse className="auth-plate-engraving" cx="399" cy="162" rx="54" ry="99" />
      <ellipse className="auth-plate-engraving" cx="399" cy="162" rx="26" ry="48" />
      <path className="auth-plate-engraving" d="M365 78L373 91M430 78L422 91M365 246L373 233M430 246L422 233" strokeWidth="3" />
      <ellipse className="auth-plate-hub" cx="399" cy="162" rx="12" ry="20" />
      <path className="auth-bar-detail" d="M388 159H410M388 166H410" />
      <text className="auth-plate-weight" x="399" y="116" textAnchor="middle">20</text>
      <text className="auth-plate-lettering" x="399" y="228" textAnchor="middle">ТЯГА / КГ</text>
      <rect className="auth-bar-collar" x="477" y="141" width="16" height="43" rx="3" />
      <path className="auth-bar-detail" d="M510 153V172M518 153V172M526 153V172M534 153V172" />
    </g>
    <path className="auth-diagram-line" d="M448 42H528V84M82 250H28V216" strokeWidth="1" />
    <circle className="auth-diagram-point" cx="448" cy="42" r="3" />
    <circle className="auth-diagram-point" cx="82" cy="250" r="3" />
  </svg>;
}
