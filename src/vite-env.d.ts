/// <reference types="vite/client" />
/** Android versionCode/versionName this bundle was built with (vite.config.ts). */
declare const __APP_VERSION__: { code: number; name: string };
interface ImportMetaEnv {
  /** Cloudflare deployment the Android app syncs with. */
  readonly VITE_CLOUD_URL?: string;
}
