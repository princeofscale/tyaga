/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Cloudflare deployment the Android app syncs with. */
  readonly VITE_CLOUD_URL?: string;
}
