/**
 * Audio and Haptic feedback engine for Tyaga workout sessions.
 * Pure Web Audio API synth tones (no external audio files required).
 */

const STORAGE_KEY_MUTED = "tyaga_sound_muted";

export class AudioHapticsEngine {
  private muted = false;

  constructor() {
    try {
      this.muted = typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY_MUTED) === "1";
    } catch {
      // Storage can be blocked; keep the in-memory default.
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY_MUTED, muted ? "1" : "0");
      }
    } catch {
      // A failed write must not prevent changing the in-memory preference.
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  private getAudioContext(): AudioContext | null {
    if (this.muted || typeof window === "undefined") return null;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof window.AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      return new AudioCtx();
    } catch {
      return null;
    }
  }

  /**
   * Subtle tick tone during rest timer countdown (e.g. at 3, 2, 1 seconds)
   */
  public playCountdownTick(): void {
    const ctx = this.getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(660, now);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.06);
    } catch {
      // Audio error ignored
    }
    this.vibrateLight();
  }

  /**
   * Pleasant rising chime when a set is marked completed
   */
  public playSetDone(): void {
    const ctx = this.getAudioContext();
    if (!ctx) {
      this.vibrateLight();
      return;
    }
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.09); // A5
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.22);
    } catch {
      // Audio error ignored
    }
    this.vibrateSuccess();
  }

  /**
   * Two-tone gym chime when rest timer finishes
   */
  public playTimerAlert(): void {
    const ctx = this.getAudioContext();
    if (!ctx) {
      this.vibrateAlert();
      return;
    }
    try {
      const now = ctx.currentTime;

      // Note 1: A5 (880Hz -> 1320Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(880, now);
      osc1.frequency.exponentialRampToValueAtTime(1320, now + 0.14);
      gain1.gain.setValueAtTime(0.22, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.3);

      // Note 2: A6 (1760Hz)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(1760, now + 0.16);
      gain2.gain.setValueAtTime(0.18, now + 0.16);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.16);
      osc2.stop(now + 0.45);
    } catch {
      // Audio error ignored
    }
    this.vibrateAlert();
  }

  /**
   * Rewarding fanfare when personal record is beaten
   */
  public playPRFanfare(): void {
    const ctx = this.getAudioContext();
    if (!ctx) {
      this.vibrateSuccess();
      return;
    }
    try {
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      const now = ctx.currentTime;
      notes.forEach((freq, idx) => {
        const start = now + idx * 0.08;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.2, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.25);
      });
    } catch {
      // Audio error ignored
    }
    this.vibrateSuccess();
  }

  // --- Haptics ---

  public vibrateLight(): void {
    try {
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(35);
      }
    } catch {
      // ignored
    }
  }

  public vibrateSuccess(): void {
    try {
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate([40, 30, 60]);
      }
    } catch {
      // ignored
    }
  }

  public vibrateAlert(): void {
    try {
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate([120, 80, 180]);
      }
    } catch {
      // ignored
    }
  }
}

export const audioHaptics = new AudioHapticsEngine();
