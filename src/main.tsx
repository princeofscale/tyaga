import React from "react";
import { createRoot } from "react-dom/client";
import AccountGate from "./components/AccountGate";
import { LazyMotion, MotionConfig } from "motion/react";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./styles/layers.css";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/auth.css";
import "./styles/workout.css";
import "./styles/screens.css";
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
if (import.meta.env.PROD && import.meta.env.MODE !== "device" && "serviceWorker" in navigator)
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {});
  });
