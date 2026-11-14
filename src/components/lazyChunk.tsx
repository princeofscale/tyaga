import { createElement, lazy, useEffect, useState, type ComponentType } from "react";

/** Место окна, когда файл экрана не загрузился (нет связи): остальное приложение остаётся на месте. */
function ChunkFailed({
  title,
  onRetry,
  offline,
}: {
  title: string;
  onRetry: () => void;
  offline: boolean;
}) {
  return (
    <div className="chunk-failed" role="alert">
      <b>{title}</b>
      <p>
        Нет связи. Введённые данные остаются на месте
        {offline ? ": подключись к сети и нажми «Повторить»." : "."}
      </p>
      <button type="button" className="button primary" onClick={onRetry}>
        Повторить
      </button>
    </div>
  );
}

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/**
 * `React.lazy` запоминает отказ и падает всем деревом, если файл экрана не пришёл (подвал, слабая сеть).
 * Здесь отказ не бросается, а превращается в обычный компонент с кнопкой «Повторить».
 *
 * Браузер запоминает и сам неудачный `import()` до конца жизни страницы, поэтому второй `import()` того же файла
 * не пойдёт в сеть. Поэтому «Повторить» так: пробуем загрузить снова; если связь есть, а файл всё равно «не
 * загрузился» (запомненный отказ) — перезагружаем страницу: черновик тренировки хранится на устройстве и вернётся.
 * Без связи перезагрузка убила бы и само приложение, поэтому там остаётся то же сообщение.
 * `preload` докачивает файл заранее, пока связь есть, и молча игнорирует отказ.
 */
export function lazyChunk<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  title: string,
) {
  const listeners = new Set<() => void>();
  let offline = false;
  const failed = ((_props: P) =>
    createElement(ChunkFailed, { title, onRetry: retry, offline })) as ComponentType<P>;
  const build = (loader: () => Promise<{ default: ComponentType<P> }>) =>
    lazy<ComponentType<P>>(() => loader().catch(() => ({ default: failed })));
  let Inner = build(load);
  async function retry() {
    try {
      const loaded = await load();
      Inner = build(() => Promise.resolve(loaded));
    } catch {
      if (!isOffline()) {
        location.reload();
        return;
      }
      offline = true;
      Inner = build(() => Promise.reject(new Error("offline")));
    }
    listeners.forEach((notify) => notify());
  }
  function Chunk(props: P) {
    const [, bump] = useState(0);
    useEffect(() => {
      const notify = () => bump((n) => n + 1);
      listeners.add(notify);
      return () => void listeners.delete(notify);
    }, []);
    return createElement(Inner, props as P & React.JSX.IntrinsicAttributes);
  }
  return Object.assign(Chunk, {
    preload: () => void load().catch(() => undefined),
  });
}
