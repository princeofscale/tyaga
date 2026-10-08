import { useEffect, useState, type FormEvent } from "react";
import { Cloud, CloudOff, RefreshCw } from "lucide-react";
import {
  CLOUD_URL,
  cloudState,
  connectCloud,
  disconnectCloud,
  syncCloud,
} from "../device/cloudSync";

/** Android only: links the offline journal to a Cloudflare account. */
export default function CloudSyncPanel({ displayName }: { displayName: string }) {
  const [state, setState] = useState(cloudState);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  useEffect(() => {
    const refresh = () => setState(cloudState());
    window.addEventListener("tyaga:cloud", refresh);
    return () => window.removeEventListener("tyaga:cloud", refresh);
  }, []);
  if (!CLOUD_URL) return null;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const code = await connectCloud(mode, String(form.get("email")), String(form.get("password")), displayName);
      setRecoveryCode(code ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось подключить облако");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="cloud-panel" aria-labelledby="cloud-title">
      <h3 id="cloud-title">
        <Cloud size={18} />
        Облако
      </h3>
      {state ? (
        <>
          <p>
            Синхронизация с <b>{state.email}</b>. Тренировки есть и на сайте{" "}
            {new URL(CLOUD_URL).host}, и на других телефонах с этим аккаунтом.
          </p>
          <p className={state.error ? "inline-error" : "tiny"} role={state.error ? "alert" : "status"}>
            {state.error ??
              (state.lastSyncAt
                ? `Синхронизировано ${new Date(state.lastSyncAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                : "Синхронизируем…")}
          </p>
          {recoveryCode ? (
            <>
              <p className="tiny">Код восстановления пароля — сохрани его отдельно:</p>
              <code className="recovery-code">{recoveryCode}</code>
            </>
          ) : null}
          <div className="cloud-actions">
            <button className="button secondary" onClick={() => void syncCloud()}>
              <RefreshCw size={16} />
              Синхронизировать
            </button>
            <button className="text-button" onClick={disconnectCloud}>
              <CloudOff size={16} />
              Отключить
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="tiny">
            Войди в облачный аккаунт, и тренировки будут на этом телефоне, на
            других устройствах и на сайте. Без интернета всё работает как
            раньше и догоняется при подключении.
          </p>
          <div className="segmented account-tabs">
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
              Вход
            </button>
            <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
              Новый аккаунт
            </button>
          </div>
          <form className="account-form" onSubmit={submit}>
            <label>
              Почта
              <input name="email" type="email" autoComplete="username" maxLength={254} required />
            </label>
            <label>
              Пароль
              <input
                name="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={10}
                maxLength={128}
                required
              />
            </label>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <button className="button primary" disabled={busy}>
              {busy ? "Подключаем…" : mode === "login" ? "Войти в облако" : "Создать аккаунт"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
