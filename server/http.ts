export class BodyTooLargeError extends Error {
  readonly status = 413;
  constructor(message = "Слишком большой запрос") {
    super(message);
  }
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

/**
 * Читает тело запроса с жёстким лимитом байт до полной буферизации в память.
 * Сначала проверяет Content-Length, затем потоково считает байты (chunked-передача без Content-Length).
 */
export async function readTextLimited(request: Request, maxBytes: number): Promise<string> {
  const lengthHeader = request.headers.get("Content-Length");
  if (lengthHeader !== null) {
    const declared = Number(lengthHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new BodyTooLargeError();
    }
  }
  const stream = request.body;
  if (!stream || typeof stream.getReader !== "function") {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new BodyTooLargeError();
    }
    return text;
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new BodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}
