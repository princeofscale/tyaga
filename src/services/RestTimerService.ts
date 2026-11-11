import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from "@capacitor/core";
export type RestAction = {
  id: string;
  type: "open" | "extend";
  accountId: string;
  workoutId: string;
  until: number;
  exerciseId?: string;
  setId?: string;
};
export type RestTimerState = {
  supported: boolean;
  enabled: boolean;
  permission: boolean;
  exact: boolean;
  action: RestAction | null;
};
export type RestTimerCommand = {
  inWorkout?: boolean;
  accountId: string;
  workoutId: string;
  until: number | null;
  exerciseId?: string;
  setId?: string;
};
export interface RestTimerBridge {
  getState(): Promise<RestTimerState>;
  enable(): Promise<RestTimerState>;
  disable(): Promise<RestTimerState>;
  sync(command: RestTimerCommand): Promise<void>;
  acknowledge(input: { id: string }): Promise<void>;
  openSettings(input: { kind: "notifications" | "exact" }): Promise<void>;
  addListener(
    event: "action",
    listener: () => void,
  ): Promise<PluginListenerHandle>;
}
const bridge = registerPlugin<RestTimerBridge>("RestTimer");
const unavailable: RestTimerState = {
  supported: false,
  enabled: false,
  permission: false,
  exact: false,
  action: null,
};
/** Serialized bridge writes prevent a slow old schedule from replacing a newer pause/cancellation. */
export class RestTimerService {
  private queue: Promise<unknown> = Promise.resolve();
  private sequence = 0;
  constructor(
    private native: RestTimerBridge = bridge,
    private available = () =>
      Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android",
  ) {}
  supported() {
    return this.available();
  }
  private run<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action, action);
    this.queue = result.catch(() => undefined);
    return result;
  }
  read() {
    return this.available()
      ? this.run(() => this.native.getState())
      : Promise.resolve(unavailable);
  }
  enable() {
    return this.run(() => this.native.enable());
  }
  disable() {
    ++this.sequence;
    return this.run(() => this.native.disable());
  }
  sync(command: RestTimerCommand) {
    const sequence = ++this.sequence;
    if (!this.available()) return Promise.resolve();
    return this.run(async () => {
      if (sequence === this.sequence) await this.native.sync(command);
    });
  }
  acknowledge(id: string) {
    return this.run(() => this.native.acknowledge({ id }));
  }
  openSettings(kind: "notifications" | "exact") {
    return this.native.openSettings({ kind });
  }
  listen(action: () => void) {
    return this.available()
      ? this.native.addListener("action", action)
      : Promise.resolve({ remove: async () => {} });
  }
}
export const restTimerService = new RestTimerService();
