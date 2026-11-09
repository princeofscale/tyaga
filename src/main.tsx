import React from "react";
import { createRoot } from "react-dom/client";
import AccountGate from "./components/AccountGate";
import { LazyMotion, MotionConfig } from "motion/react";
import "@fontsource-variable/manrope";
import "@fontsource-variable/unbounded";
import "@fontsource-variable/oswald";
import "./styles.css";
import "./styles/athletic.css";
import "./styles/auth-athletic.css";
import "./styles/workout-athletic.css";
import "./styles/friends.css";
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
