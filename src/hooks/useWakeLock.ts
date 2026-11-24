import { useEffect, useRef, useState } from "react";

type WakeLockSentinelLike = {
  released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: "release", listener: () => void) => void;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

/**
 * Опциональный Screen Wake Lock для активной тренировки в PWA:
 * не превращает страницу в фоновый сервис, но удерживает экран включённым,
 * пока тренировка открыта на переднем плане, и переподключается при возврате вкладки.
 */
export function useWakeLock(enabled: boolean) {
  const supported =
    typeof navigator !== "undefined" &&
    typeof (navigator as NavigatorWithWakeLock).wakeLock?.request === "function";
  const [active, setActive] = useState(false);
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    if (!supported || !enabled) {
      const current = sentinelRef.current;
      sentinelRef.current = null;
      setActive(false);
      if (current && !current.released) void current.release().catch(() => {});
      return;
    }

    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        const lock = await (navigator as NavigatorWithWakeLock).wakeLock!.request("screen");
        if (cancelled) {
          void lock.release().catch(() => {});
          return;
        }
        sentinelRef.current = lock;
        setActive(true);
        lock.addEventListener?.("release", () => {
          if (sentinelRef.current === lock) {
            sentinelRef.current = null;
            setActive(false);
          }
        });
      } catch {
        if (!cancelled) setActive(false);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      const current = sentinelRef.current;
      sentinelRef.current = null;
      setActive(false);
      if (current && !current.released) void current.release().catch(() => {});
    };
  }, [enabled, supported]);

  return { supported, active };
}
