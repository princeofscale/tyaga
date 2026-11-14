import { useBodyweight } from "../state/BodyweightContext";
import { BodyMass } from "../domain/BodyMass";
import { BodyweightTracker } from "../domain/BodyweightTracker";
import { localDate } from "../lib/calendar";
import { Suspense, useState, useEffect, type FormEvent } from "react";
import { CloudSyncPanel } from "./chunks";
import { Smartphone, UserRound, Sparkles } from "lucide-react";
import { api } from "../services/ApiClient";
import { browserTimeZone } from "../lib/calendar";
import type { AccountProfile } from "../lib/account";
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
  const [confirmLogout, setConfirmLogout] = useState(false);
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
      await api("/api/auth/logout", "POST", {});
      onLogout();
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
        <label>
          Часовой пояс
          <input
            name="timeZone"
            defaultValue={account.timeZone}
            list="time-zones"
            required
          />
        </label>
        <datalist id="time-zones">
          {[
            browserTimeZone(),
            "Europe/Moscow",
            "Europe/Amsterdam",
            "Asia/Yekaterinburg",
            "Asia/Novosibirsk",
            "America/Los_Angeles",
            "UTC",
          ].map((z, i) => (
            <option key={`${z}-${i}`} value={z} />
          ))}
        </datalist>
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
          <a
            className="button secondary android-download"
            href="/tyaga.apk"
            download
          >
            <Smartphone size={18} />
            Приложение для Android
          </a>
          <button
            className="button secondary account-logout"
            disabled={busy}
            onClick={() => (hasDraft || queued ? setConfirmLogout(true) : void signOut())}
          >
            Выйти из аккаунта
          </button>
          {confirmLogout && (hasDraft || queued) ? (
            <div className="account-logout-confirm" role="alertdialog" aria-label="Выйти из аккаунта?">
              <p>
                Выйти? Несохранённая тренировка на этом устройстве пропадёт
                {queued ? ` (ждёт отправки: ${queued})` : ""}.
              </p>
              <div className="actions">
                <button className="button danger" disabled={busy} onClick={() => void signOut()}>
                  Выйти
                </button>
                <button className="button secondary" disabled={busy} autoFocus onClick={() => setConfirmLogout(false)}>
                  Остаться
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
