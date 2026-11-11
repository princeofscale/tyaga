const PALETTE = ["#cafa64", "#ff9d42", "#b6a1e8", "#58c0ff", "#ff7676", "#5fd6a2"];

/** Цвет аватара зависит от тега (или имени), поэтому у одного человека он одинаков везде. */
const colorOf = (seed: string) => PALETTE[[...seed].reduce((n, c) => n + c.charCodeAt(0), 0) % PALETTE.length];
const initialOf = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

export function Avatar({ seed, name, size = "md" }: { seed: string; name: string; size?: "sm" | "md" }) {
  return (
    <span className={`friend-avatar ${size}`} style={{ background: colorOf(seed || name) }} aria-hidden="true">
      {initialOf(name)}
    </span>
  );
}

export const errorText = (error: unknown) => (error instanceof Error ? error.message : "Не удалось выполнить запрос");

/** Системное «Поделиться»; если его нет или человек отказался от копирования — ссылка копируется в буфер. */
export async function shareLink(options: { title: string; text: string; url: string }, onToast: (text: string) => void) {
  try {
    if (typeof navigator.share === "function") {
      await navigator.share(options);
      return;
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
  }
  await copyText(options.url, "Ссылка скопирована", onToast);
}

export async function copyText(text: string, done: string, onToast: (text: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
    onToast(done);
  } catch {
    onToast("Не удалось скопировать. Выдели текст и скопируй вручную.");
  }
}
