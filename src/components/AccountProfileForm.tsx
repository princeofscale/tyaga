import { useBodyweight } from "../state/bodyweightStore";
import { BodyMass } from "../domain/BodyMass";
import { BodyweightTracker } from "../domain/BodyweightTracker";
import { localDate } from "../lib/calendar";
import { Suspense, useState, useEffect, useCallback, type FormEvent } from "react";
import { CloudSyncPanel } from "./chunks";
import Modal from "./Modal";
import RecoveryCodeModal from "./RecoveryCodeModal";
import { TimeZoneField } from "./TimeZoneField";
import { Laptop, LogOut, Smartphone, Trash2, UserRound, Sparkles } from "lucide-react";
import { api } from "../services/ApiClient";
import { signOutAccount } from "../services/signOut";
import { useAndroidApkAvailable } from "../lib/androidApk";
import type { AccountProfile, SessionDevice } from "../lib/account";
import { cloudState } from "../device/cloudSync";
import {
  THEMES,
  applyTheme,
  getCurrentTheme,
  type ThemeId,
} from "../lib/theme";

// On Android the profile is created silently with a stored password, so
// signing out or changing the password would lock the owner out.
const onDevice = import.meta.env.MODE === "device";

export function AccountProfileForm({
  account,
  onChange,
  onLogout,
  hasDraft,
  queued = 0,
}: {
  account: AccountProfile;
  onChange: (p: AccountProfile) => void;
  onLogout: () => void;
  /** Начатая тренировка на этом устройстве: при выходе она пропадёт. */
  hasDraft: boolean;
  /** Завершённые без связи тренировки, которые ещё не ушли на сервер: при выходе тоже пропадут. */
  queued?: number;
}) {
  const journal = useBodyweight();
  const apkAvailable = useAndroidApkAvailable();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [confirmLogoutAll, setConfirmLogoutAll] = useState(false);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [sessions, setSessions] = useState<SessionDevice[] | null>(null);
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const loadSessions = useCallback(async () => {
    if (onDevice) return;
    setSessionsBusy(true);
    try {
      const r = await api<{ sessions: SessionDevice[] }>("/api/auth/sessions");
      setSessions(r.sessions);
    } catch {
      // Нет связи — список сессий не показываем, форма профиля остаётся рабочей.
    } finally {
      setSessionsBusy(false);
    }
  }, []);
  const revokeSession = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ revoked: boolean; current: boolean }>(
        `/api/auth/sessions/${encodeURIComponent(id)}`,
        "DELETE",
        {},
      );
      if (r.current) {
        onLogout();
        return;
      }
      setSessions((list) => (list ? list.filter((s) => s.id !== id) : list));
      setSaved("Сессия завершена");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось завершить сессию");
    } finally {
      setBusy(false);
    }
  };
  const revokeOthers = async () => {
    setBusy(true);
    setError("");
    try {
      await api<{ revoked: number }>("/api/auth/sessions/revoke-others", "POST", {});
      setSessions((list) => (list ? list.filter((s) => s.current) : list));
      setSaved("Остальные устройства вышли из аккаунта");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось завершить остальные сессии");
    } finally {
      setBusy(false);
    }
  };
  const revokeAll = async () => {
    setBusy(true);
    setError("");
    try {
      await api<{ loggedOut: boolean }>("/api/auth/sessions/revoke-all", "POST", {});
      onLogout();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выйти со всех устройств");
      setBusy(false);
      setConfirmLogoutAll(false);
    }
  };
  const [zone, setZone] = useState(account.timeZone);
  const [newCode, setNewCode] = useState("");
  const latestMass = journal.massAt(
    localDate(new Date(), account.timeZone),
    account.bodyMassKg,
  );
  const [mass, setMass] = useState(latestMass?.toString() ?? ""),
    [massDirty, setMassDirty] = useState(false);
  // Журнал веса догружается уже после открытия окна. Подставляем его значение,
  // пока поле не тронуто, и никогда не затираем то, что человек уже начал вводить.
  useEffect(() => {
    if (!massDirty) setMass(latestMass?.toString() ?? "");
  }, [latestMass, massDirty]);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState("");
  const [currentTheme, setCurrentTheme] = useState<ThemeId>(() =>
    getCurrentTheme(),
  );
  const signOut = async () => {
    setBusy(true);
    setError("");
    try {
      await signOutAccount(onLogout);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выйти");
      setBusy(false);
      setConfirmLogout(false);
    }
  };
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    setSaved("");
    try {
      // Берём то, что сейчас в поле, а не копию в состоянии: именно это значение человек видит и отправляет.
      const typedMass = String(f.get("bodyMassKg") ?? "").trim();
      const parsedMass = typedMass ? BodyweightTracker.parseWeight(typedMass) : null;
      const r = await api<{ profile: AccountProfile }>(
        "/api/auth/profile",
        "PUT",
        {
          displayName: f.get("displayName"),
          timeZone: f.get("timeZone"),
          bodyMassKg: parsedMass,
          revision: account.revision,
        },
      );
      // Профиль не должен «сохраняться» без введённого веса: сверяем с ответом сервера.
      if (parsedMass !== null && r.profile.bodyMassKg !== parsedMass)
        throw new Error("Вес не сохранился. Проверь значение и попробуй ещё раз.");
      onChange(r.profile);
      if (
        parsedMass !== null &&
        parsedMass !==
          BodyMass.at(
            journal.tracker.getEntries(),
            localDate(new Date(), r.profile.timeZone),
            null,
          )
      ) {
        const date = localDate(new Date(), r.profile.timeZone),
          previous = journal.tracker.getEntries().find((e) => e.date === date);
        await journal.change(() =>
          journal.tracker.addEntry(parsedMass, date, previous?.note ?? ""),
        );
        if (!onDevice || cloudState()) void journal.sync();
      }
      setMassDirty(false);
      setSaved("Профиль сохранён");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить профиль");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="profile-form">
      <div className="profile-identity">
        <span className="profile-avatar">
          <UserRound size={22} />
        </span>
        <div>
          <b>{account.displayName}</b>
          <p>
            {!onDevice
              ? account.email
              : cloudState()
                ? `Синхронизируется с ${cloudState()!.email}`
                : "Данные хранятся только на этом телефоне"}
          </p>
        </div>
      </div>
      <form onSubmit={save} className="account-form">
        <label>
          Имя
          <input
            name="displayName"
            defaultValue={account.displayName}
            maxLength={80}
            required
          />
        </label>
        <label>
          Вес тела, кг{" "}
          <input
            name="bodyMassKg"
            type="number"
            step="0.1"
            min="20"
            max="500"
            placeholder="Необязательно"
            value={mass}
            onChange={(e) => {
              setMass(e.target.value);
              setMassDirty(true);
            }}
            required={journal.tracker.getEntries().length > 0}
          />
        </label>
        <p className="tiny">
          Вес берётся из журнала взвешиваний. Изменённое значение сохранится как
          замер за сегодня.
        </p>
        <TimeZoneField label="Часовой пояс" name="timeZone" value={zone} onChange={setZone} />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="success-message">
            {saved}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? "Сохраняем…" : "Сохранить профиль"}
        </button>
      </form>
      <div className="theme-accent-selector-card">
        <div className="theme-selector-header">
          <Sparkles size={16} className="text-accent" />
          <b>Цветовой акцент интерфейса</b>
        </div>
        <div className="theme-swatches-row">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`theme-swatch-btn ${currentTheme === t.id ? "active" : ""}`}
              onClick={() => {
                applyTheme(t.id);
                setCurrentTheme(t.id);
              }}
              title={t.name}
            >
              <span
                className="swatch-circle"
                style={{ backgroundColor: t.accent }}
              />
              <span className="swatch-label">{t.name.split(" ")[0]}</span>
            </button>
          ))}
        </div>
      </div>
      {onDevice ? (
        <>
          <Suspense fallback={null}>
            <CloudSyncPanel displayName={account.displayName} />
          </Suspense>
          <p className="tiny">
            Без облака резервная копия — Инструменты → Резервная копия: иначе
            данные пропадут при удалении приложения.
          </p>
        </>
      ) : (
        <>
          <details className="password-details">
            <summary>Изменить пароль</summary>
            <form
              className="account-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget),
                  form = e.currentTarget;
                setBusy(true);
                setError("");
                try {
                  const r = await api<{ profile: AccountProfile }>(
                    "/api/auth/password",
                    "POST",
                    {
                      currentPassword: f.get("currentPassword"),
                      password: f.get("password"),
                    },
                  );
                  onChange(r.profile);
                  form.reset();
                  setSaved(
                    "Пароль изменён. Остальные устройства вышли из аккаунта.",
                  );
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Не удалось изменить пароль",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Текущий пароль
                <input
                  name="currentPassword"
                  type="password"
                  minLength={10}
                  autoComplete="current-password"
                  required
                />
              </label>
              <label>
                Новый пароль
                <input
                  name="password"
                  type="password"
                  minLength={10}
                  maxLength={128}
                  autoComplete="new-password"
                  required
                />
              </label>
              <button className="button secondary" disabled={busy}>
                Изменить пароль
              </button>
            </form>
          </details>
          <details className="password-details recovery-details">
            <summary>Код восстановления</summary>
            <p className="tiny">
              Код нигде не хранится в открытом виде, поэтому старый показать нельзя. Введи пароль — выпустим новый код,
              а прежний перестанет подходить.
            </p>
            <form
              className="account-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const f = new FormData(form);
                setBusy(true);
                setError("");
                try {
                  const r = await api<{ recoveryCode: string }>("/api/auth/recovery-code", "POST", {
                    currentPassword: f.get("currentPassword"),
                  });
                  form.reset();
                  setNewCode(r.recoveryCode);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Не удалось выпустить код");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Текущий пароль для нового кода
                <input name="currentPassword" type="password" minLength={10} autoComplete="current-password" required />
              </label>
              <button className="button secondary" disabled={busy}>
                Выпустить новый код
              </button>
            </form>
          </details>
          {newCode ? (
            <RecoveryCodeModal
              code={newCode}
              onClose={() => setNewCode("")}
              intro="Новый код восстановления. Прежний больше не подходит. Сохрани этот: он показывается один раз."
            />
          ) : null}
          <details
            className="password-details sessions-details"
            onToggle={(e) => {
              if (e.currentTarget.open && sessions === null && !sessionsBusy) void loadSessions();
            }}
          >
            <summary>Активные устройства и сессии</summary>
            <p className="tiny">
              Управляй входами на других устройствах без смены пароля.
            </p>
            {sessionsBusy && !sessions ? (
              <p className="tiny" role="status">Загружаем список устройств…</p>
            ) : sessions && sessions.length ? (
              <ul className="sessions-list">
                {sessions.map((s) => {
                  const isMobile = /iPhone|iPad|Android/i.test(s.deviceLabel);
                  const lastSeen = new Date(s.lastSeenAt).toLocaleString("ru-RU", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  return (
                    <li key={s.id} className={`session-device-row${s.current ? " is-current" : ""}`}>
                      <span className="session-device-icon" aria-hidden="true">
                        {isMobile ? <Smartphone size={16} /> : <Laptop size={16} />}
                      </span>
                      <div className="session-device-info">
                        <b>
                          {s.deviceLabel}
                          {s.current ? <span className="session-current-badge">Текущее</span> : null}
                        </b>
                        <small>Активность: {lastSeen}</small>
                      </div>
                      {!s.current ? (
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy}
                          onClick={() => void revokeSession(s.id)}
                        >
                          Завершить
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="tiny">Не удалось получить список устройств.</p>
            )}
            <div className="session-actions">
              {sessions && sessions.length > 1 ? (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void revokeOthers()}
                >
                  Завершить остальные ({sessions.length - 1})
                </button>
              ) : null}
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setConfirmLogoutAll(true)}
              >
                <LogOut size={16} aria-hidden="true" />
                Выйти со всех устройств
              </button>
            </div>
            {confirmLogoutAll ? (
              <Modal
                title="Выйти со всех устройств?"
                onClose={() => {
                  if (busy) return false;
                  setConfirmLogoutAll(false);
                }}
              >
                <p>
                  Завершить все активные сессии, включая это устройство?
                  {hasDraft || queued ? " Несохранённая тренировка на этом устройстве пропадёт." : ""}
                </p>
                <div className="actions">
                  <button type="button" className="button danger" disabled={busy} onClick={() => void revokeAll()}>
                    Выйти везде
                  </button>
                  <button type="button" className="button secondary" disabled={busy} data-autofocus onClick={() => setConfirmLogoutAll(false)}>
                    Отмена
                  </button>
                </div>
              </Modal>
            ) : null}
          </details>
          {apkAvailable ? (
            <a
              className="button secondary android-download"
              href="/tyaga.apk"
              download
            >
              <Smartphone size={18} />
              Приложение для Android
            </a>
          ) : null}
          <button
            className="button secondary account-logout"
            disabled={busy}
            onClick={() => (hasDraft || queued ? setConfirmLogout(true) : void signOut())}
          >
            Выйти из аккаунта
          </button>
          <button
            type="button"
            className="text-button danger"
            disabled={busy}
            onClick={() => {
              setDeletePassword("");
              setDeleteError("");
              setConfirmDeleteAccount(true);
            }}
          >
            <Trash2 size={15} aria-hidden="true" />
            Удалить аккаунт и данные
          </button>
          {confirmLogout && (hasDraft || queued) ? (
            <Modal
              title="Выйти из аккаунта?"
              onClose={() => {
                if (busy) return false;
                setConfirmLogout(false);
              }}
            >
              <p>
                Выйти? Несохранённая тренировка на этом устройстве пропадёт
                {queued ? ` (ждёт отправки: ${queued})` : ""}.
              </p>
              <div className="actions">
                <button type="button" className="button danger" disabled={busy} onClick={() => void signOut()}>
                  Выйти
                </button>
                <button type="button" className="button secondary" disabled={busy} data-autofocus onClick={() => setConfirmLogout(false)}>
                  Остаться
                </button>
              </div>
            </Modal>
          ) : null}
          {confirmDeleteAccount ? (
            <Modal
              title="Удалить аккаунт навсегда?"
              onClose={() => {
                if (busy) return false;
                setConfirmDeleteAccount(false);
              }}
            >
              <p>
                Будут безвозвратно удалены твой профиль, все тренировки, программы, личные упражнения, замеры веса и сессии.
                Перед удалением можно скачать полную резервную копию в разделе «История».
              </p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (busy) return;
                  setBusy(true);
                  setDeleteError("");
                  try {
                    await api("/api/auth/account", "DELETE", { currentPassword: deletePassword });
                    onLogout();
                  } catch (err) {
                    setDeleteError(err instanceof Error ? err.message : "Не удалось удалить аккаунт");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  Текущий пароль для подтверждения
                  <input
                    type="password"
                    autoComplete="current-password"
                    minLength={10}
                    maxLength={128}
                    required
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                  />
                </label>
                {deleteError ? <p className="form-error" role="alert">{deleteError}</p> : null}
                <div className="actions">
                  <button type="submit" className="button danger" disabled={busy}>
                    Удалить навсегда
                  </button>
                  <button type="button" className="button secondary" disabled={busy} data-autofocus onClick={() => setConfirmDeleteAccount(false)}>
                    Отмена
                  </button>
                </div>
              </form>
            </Modal>
          ) : null}
        </>
      )}
    </div>
  );
}
