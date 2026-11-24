export function ChunkFailed({
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
