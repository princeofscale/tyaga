import "./styles/layers.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { LazyMotion, MotionConfig } from "motion/react";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/auth.css";
import "./styles/workout.css";
import "./styles/screens.css";
import AccountGate from "./components/AccountGate";
const loadMotionFeatures = () =>
  import("./lib/motionFeatures").then((module) => module.default);
const backend =
  import.meta.env.MODE === "device"
    ? import("./device/localBackend")
        .then((m) => m.installLocalBackend())
        .then(() => import("./device/cloudSync"))
        .then((m) => m.startCloudSync())
    : Promise.resolve();
void backend.catch(console.error).finally(() =>
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <LazyMotion features={loadMotionFeatures}>
        <MotionConfig reducedMotion="user">
          <AccountGate />
        </MotionConfig>
      </LazyMotion>
    </React.StrictMode>,
  ),
);

// Оболочка и каталог открываются без сети после первого входа (R03-REQ04). Не для Android-сборки и не для dev.
if (import.meta.env.PROD && import.meta.env.MODE !== "device" && "serviceWorker" in navigator) {
  const RELOAD_KEY = "tyaga:sw-reload";

  /**
   * Плашка «Доступно обновление». Без неё уже открытая вкладка продолжает работать на старом
   * закэшированном бандле: install новой версии не активирует её, пока живы клиенты.
   */
  function promptUpdate(registration: ServiceWorkerRegistration) {
    if (document.getElementById("tyaga-sw-update")) return;
    const toast = document.createElement("div");
    toast.id = "tyaga-sw-update";
    toast.setAttribute("role", "status");
    toast.style.cssText = [
      "position:fixed",
      "inset-inline:12px",
      "bottom:calc(12px + env(safe-area-inset-bottom, 0px))",
      "z-index:2147483000",
      "display:flex",
      "align-items:center",
      "gap:12px",
      "padding:12px 14px",
      "border-radius:16px",
      "background:var(--surface, #1c241d)",
      "border:1px solid var(--border, #2c3a2e)",
      "color:var(--text, #e8f0e9)",
      "box-shadow:0 12px 32px rgb(0 0 0 / 45%)",
      "font:500 14px/1.35 system-ui, sans-serif",
    ].join(";");
    const label = document.createElement("span");
    label.textContent = "Доступно обновление";
    label.style.cssText = "flex:1 1 auto; min-inline-size:0;";
    const action = document.createElement("button");
    action.type = "button";
    action.textContent = "Обновить";
    action.style.cssText = [
      "flex:0 0 auto",
      "min-block-size:44px",
      "padding:0 18px",
      "border-radius:12px",
      "border:0",
      "cursor:pointer",
      "background:var(--accent, #cafa64)",
      "color:var(--accent-ink, #111512)",
      "font:700 14px system-ui, sans-serif",
    ].join(";");
    action.addEventListener("click", () => {
      try {
        sessionStorage.setItem(RELOAD_KEY, "1");
      } catch {
        /* приватный режим без storage — перезагрузимся по таймауту */
      }
      registration.waiting?.postMessage({ type: "SKIP_WAITING" });
      window.setTimeout(() => window.location.reload(), 1500);
    });
    toast.appendChild(label);
    toast.appendChild(action);
    document.body.appendChild(toast);
  }

  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => {
        // Новая версия уже установлена и ждёт активации с прошлого визита.
        if (registration.waiting && navigator.serviceWorker.controller) promptUpdate(registration);
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) promptUpdate(registration);
          });
        });
      })
      .catch(() => {});
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      let pending = false;
      try {
        pending = sessionStorage.getItem(RELOAD_KEY) === "1";
      } catch {
        /* нет доступа к storage — остаёмся на текущей странице */
      }
      if (!pending) return;
      try {
        sessionStorage.removeItem(RELOAD_KEY);
      } catch {
        /* нечего очищать */
      }
      window.location.reload();
    });
  });
}
