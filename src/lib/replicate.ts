export type SyncPage = { docs: unknown[]; cursor: number; more: boolean };

/**
 * Copies every change after `cursor` from one side to the other, page by page.
 * The cursor is reported after each page so an interrupted sync resumes there.
 */
export async function replicate(
  read: (since: number) => Promise<SyncPage>,
  write: (docs: unknown[]) => Promise<unknown>,
  cursor: number,
  onCursor: (cursor: number) => void = () => {},
) {
  for (;;) {
    const page = await read(cursor);
    for (const chunk of chunks(page.docs)) await write(chunk);
    cursor = page.cursor;
    onCursor(cursor);
    if (!page.more) return cursor;
  }
}

// Requests stay under the API limits: 100 documents and a 500 kB UTF-8 body.
const utf8 = new TextEncoder();
function* chunks(docs: unknown[]) {
  let chunk: unknown[] = [];
  let size = 0;
  for (const doc of docs) {
    const length = utf8.encode(JSON.stringify(doc)).byteLength;
    if (chunk.length && (chunk.length === 100 || size + length > 400000)) {
      yield chunk;
      chunk = [];
      size = 0;
    }
    chunk.push(doc);
    size += length;
  }
  if (chunk.length) yield chunk;
}
