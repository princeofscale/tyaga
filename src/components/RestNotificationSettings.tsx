import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import {
  restTimerService,
  type RestTimerState,
} from "../services/RestTimerService";
export default function RestNotificationSettings() {
  const [state, setState] = useState<RestTimerState | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const read = () =>
      void restTimerService
        .read()
        .then(setState)
        .catch((e) => setError((e as Error).message));
    read();
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  }, []);
  const toggle = async () => {
    setBusy(true);
    setError("");
    try {
      setState(
        await (state?.enabled
          ? restTimerService.disable()
          : restTimerService.enable()),
      );
      window.dispatchEvent(new Event("tyaga:rest-settings"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rest-notification-settings">
      <Bell size={30} />
      {!state ? (
        <p role="status">Проверяем уведомления…</p>
      ) : !state.supported ? (
        <>
          <p>
            Фоновые уведомления отдыха доступны в приложении для Android. В
            браузере таймер работает, пока открыт экран тренировки.
          </p>
          <a className="button primary" href="/tyaga.apk" download>
            Скачать приложение для Android
          </a>
        </>
      ) : (
        <>
          <p>
            Телефон сообщит об окончании отдыха, даже когда экран заблокирован.
            В уведомлении можно добавить 30 секунд и вернуться к подходу.
          </p>
          <p role="status">
            {state.enabled && state.permission
              ? "Уведомления включены"
              : "Уведомления выключены"}
          </p>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void toggle()}
          >
            {state.enabled ? "Выключить уведомления" : "Включить уведомления"}
          </button>
          {!state.permission && (
            <button
              className="text-button"
              onClick={() =>
                void restTimerService
                  .openSettings("notifications")
                  .catch((e) => setError((e as Error).message))
              }
            >
              Настройки уведомлений телефона
            </button>
          )}
          {!state.exact && (
            <>
              <p className="tiny">
                Для своевременного сигнала разреши точный таймер. Без разрешения
                Android может задержать уведомление.
              </p>
              <button
                className="button secondary"
                onClick={() =>
                  void restTimerService
                    .openSettings("exact")
                    .catch((e) => setError((e as Error).message))
                }
              >
                Разрешить точный таймер
              </button>
            </>
          )}
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
