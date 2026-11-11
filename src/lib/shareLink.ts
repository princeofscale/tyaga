/** Системное «Поделиться»; если его нет или оно сломалось — ссылка копируется в буфер. */
export async function shareLink(
  options: { title: string; text: string; url: string },
  onToast: (text: string) => void,
) {
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
