import test from "node:test";
import assert from "node:assert/strict";
import { copyText, shareLink } from "../src/lib/shareLink";

test("shareLink uses navigator.share when available and falls back to clipboard on failure", async () => {
  const origNav = globalThis.navigator;
  const toasts: string[] = [];
  const pushToast = (t: string) => { toasts.push(t); };
  let shared: unknown = null;
  let copied = "";
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      share: async (opts: unknown) => {
        shared = opts;
      },
      clipboard: {
        writeText: async (text: string) => {
          copied = text;
        },
      },
    },
  });
  try {
    await shareLink({ title: "T", text: "Body", url: "https://tyaga.example/join" }, pushToast);
    assert.deepEqual(shared, { title: "T", text: "Body", url: "https://tyaga.example/join" });
    assert.equal(copied, "");
    assert.deepEqual(toasts, []);

    // User cancels share sheet (AbortError) → must NOT fall back to clipboard.
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        share: async () => {
          throw new DOMException("cancelled", "AbortError");
        },
        clipboard: {
          writeText: async (text: string) => {
            copied = text;
          },
        },
      },
    });
    await shareLink({ title: "T", text: "Body", url: "https://tyaga.example/join" }, pushToast);
    assert.equal(copied, "");

    // Non-abort error falls back to clipboard copy.
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        share: async () => {
          throw new Error("share unsupported");
        },
        clipboard: {
          writeText: async (text: string) => {
            copied = text;
          },
        },
      },
    });
    await shareLink({ title: "T", text: "Body", url: "https://tyaga.example/join" }, pushToast);
    assert.equal(copied, "https://tyaga.example/join");
    assert.deepEqual(toasts, ["Ссылка скопирована"]);

    // Clipboard failure shows manual fallback message.
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          writeText: async () => {
            throw new Error("denied");
          },
        },
      },
    });
    await copyText("abc", "OK", pushToast);
    assert.match(toasts.at(-1)!, /Не удалось скопировать/);
  } finally {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: origNav });
  }
});
