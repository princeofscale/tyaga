import React from "react";
import { createRoot } from "react-dom/client";
import AccountGate from "./components/AccountGate";
import { LazyMotion, MotionConfig } from "motion/react";
import "@fontsource-variable/manrope";
import "@fontsource-variable/unbounded";
import "./styles.css";
const loadMotionFeatures = () =>
  import("./lib/motionFeatures").then((module) => module.default);
const backend =
  import.meta.env.MODE === "device"
    ? import("./device/localBackend").then((m) => m.installLocalBackend())
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
