import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { LazyMotion, MotionConfig } from "motion/react";
import "@fontsource-variable/manrope";
import "@fontsource-variable/unbounded";
import "./styles.css";
import "./design.css";
const loadMotionFeatures = () =>
  import("./lib/motionFeatures").then((module) => module.default);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LazyMotion features={loadMotionFeatures}>
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </LazyMotion>
  </React.StrictMode>,
);
