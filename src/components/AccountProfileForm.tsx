import { lazy, Suspense, useState, type FormEvent } from "react";
import { Smartphone, UserRound } from "lucide-react";
import { api } from "../services/ApiClient";
import { browserTimeZone } from "../lib/calendar";
import type { AccountProfile } from "../lib/account";
import { cloudState } from "../device/cloudSync";

// On Android the profile is created silently with a stored password, so
// signing out or changing the password would lock the owner out.
const onDevice = import.meta.env.MODE === "device";
const CloudSyncPanel = lazy(() => import("./CloudSyncPanel"));
export function AccountProfileForm({ account, onChange, onLogout, hasDraft }: {
  account: AccountProfile; onChange: (p: AccountProfile) => void; onLogout: () => void; hasDraft: boolean;
}) {
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [saved, setSaved] = useState("");
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setError(""); setSaved("");
    try { const r = await api<{profile: AccountProfile}>("/api/auth/profile", "PUT", {
      displayName: f.get("displayName"), timeZone: f.get("timeZone"), bodyMassKg: f.get("bodyMassKg") ? Number(f.get("bodyMassKg")) : null, revision: account.revision,
    }); onChange(r.profile); setSaved("Профиль сохранён"); }
    catch(e) { setError(e instanceof Error ? e.message : "Не удалось сохранить профиль"); }
    finally { setBusy(false); }
  };
  return <div className="profile-form">
    <div className="profile-identity"><span className="profile-avatar"><UserRound size={22} /></span><div><b>{account.displayName}</b><p>{!onDevice ? account.email : cloudState() ? `Синхронизируется с ${cloudState()!.email}` : "Данные хранятся только на этом телефоне"}</p></div></div>
    <form onSubmit={save} className="account-form">
      <label>Имя<input name="displayName" defaultValue={account.displayName} maxLength={80} required /></label>
      <label>Вес тела, кг <input name="bodyMassKg" type="number" step="0.1" min="20" max="500" placeholder="Необязательно" defaultValue={account.bodyMassKg ?? ""} /></label>
      <label>Часовой пояс<input name="timeZone" defaultValue={account.timeZone} list="time-zones" required /></label>
      <datalist id="time-zones">{[browserTimeZone(), "Europe/Moscow", "Europe/Amsterdam", "Asia/Yekaterinburg", "Asia/Novosibirsk", "America/Los_Angeles", "UTC"].map((z,i) => <option key={`${z}-${i}`} value={z} />)}</datalist>
      {error && <p className="form-error" role="alert">{error}</p>}{saved && <p role="status" className="success-message">{saved}</p>}
      <button className="button primary" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить профиль"}</button>
    </form>
    {onDevice ? <>
      <Suspense fallback={null}><CloudSyncPanel displayName={account.displayName} /></Suspense>
      <p className="tiny">Без облака резервная копия — История → Экспорт JSON: иначе данные пропадут при удалении приложения.</p>
    </> : <>
    <details className="password-details"><summary>Изменить пароль</summary><form className="account-form" onSubmit={async e => {
      e.preventDefault(); const f = new FormData(e.currentTarget), form = e.currentTarget; setBusy(true); setError("");
      try { const r = await api<{profile: AccountProfile}>("/api/auth/password", "POST", { currentPassword: f.get("currentPassword"), password: f.get("password") }); onChange(r.profile); form.reset(); setSaved("Пароль изменён. Остальные устройства вышли из аккаунта."); }
      catch(e) { setError(e instanceof Error ? e.message : "Не удалось изменить пароль"); } finally { setBusy(false); }
    }}><label>Текущий пароль<input name="currentPassword" type="password" minLength={10} autoComplete="current-password" required /></label><label>Новый пароль<input name="password" type="password" minLength={10} maxLength={128} autoComplete="new-password" required /></label><button className="button secondary" disabled={busy}>Изменить пароль</button></form></details>
    {hasDraft && <p className="tiny">Текущий черновик останется на этом устройстве и вернётся после входа в этот профиль.</p>}
    <a className="button secondary android-download" href="/tyaga.apk" download><Smartphone size={18} />Приложение для Android</a>
    <button className="button secondary account-logout" disabled={busy} onClick={async () => {
      setBusy(true); setError(""); try { await api("/api/auth/logout", "POST", {}); onLogout(); }
      catch(e) { setError(e instanceof Error ? e.message : "Не удалось выйти"); setBusy(false); }
    }}>Выйти из аккаунта</button>
    </>}
  </div>;
}
