import { BodyMass } from "../domain/BodyMass";
import { JournalBackup, type WeightBackup } from "../domain/JournalBackup";
import {
  BodyweightTracker,
  type BodyweightEntry,
  type BodyweightGoal,
} from "../domain/BodyweightTracker";
import {
  BodyweightDocument,
  type WeightDocument,
  type WeightValue,
} from "../domain/BodyweightDocument";
import { apiClient, ApiError, type ApiClient } from "./ApiClient";

type Pending = { value: WeightValue; revision: number; mutationId: string };
type State = {
  entries: BodyweightEntry[];
  goal: BodyweightGoal;
  revisions: Record<string, number>;
  pending: Record<string, Pending>;
  conflicts: Record<string, WeightDocument | null>;
  lastSyncedAt?: string;
};
const emptyGoal: BodyweightGoal = { targetWeightKg: null, startWeightKg: null };

/** Durable local outbox; per-document revisions prevent one device overwriting another silently. */
export class BodyweightJournal {
  readonly tracker: BodyweightTracker;
  private state: State;
  private cacheKey: string;
  private blocked = "";
  private binding?: string;
  private running: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  error = "";
  constructor(
    private accountId: string,
    timeZone: string,
    private client: Pick<ApiClient, "request"> = apiClient,
    binding?: string,
  ) {
    this.binding = binding;
    this.cacheKey = `tyaga-bodyweight-sync:${accountId}${binding === undefined ? "" : `:cloud:${binding || "offline"}`}`;
    const legacy = new BodyweightTracker(accountId, timeZone);
    this.state = {
      entries: legacy.getEntries(),
      goal: legacy.getGoal(),
      revisions: {},
      pending: {},
      conflicts: {},
    };
    this.blocked = legacy.storageIssue();
    try {
      const bound = localStorage.getItem(`tyaga-bodyweight-bound:${accountId}`);
      if (binding && bound && bound !== binding)
        this.state = {
          entries: [],
          goal: emptyGoal,
          revisions: {},
          pending: {},
          conflicts: {},
        };
      const raw =
        localStorage.getItem(this.cacheKey) ??
        (binding && (!bound || bound === binding)
          ? localStorage.getItem(
              `tyaga-bodyweight-sync:${accountId}:cloud:offline`,
            )
          : null);
      if (raw) {
        this.state = this.parse(raw);
        this.blocked = "";
      } else {
        for (const entry of this.state.entries)
          this.state.pending[`weight:${entry.date}`] = {
            value: entry,
            revision: 0,
            mutationId: crypto.randomUUID(),
          };
        if (this.state.goal.targetWeightKg !== null)
          this.state.pending.goal = {
            value: this.state.goal,
            revision: 0,
            mutationId: crypto.randomUUID(),
          };
      }
    } catch (e) {
      this.blocked =
        e instanceof Error ? e.message : "Не удалось прочитать сохранённый вес";
    }
    this.tracker = new BodyweightTracker(accountId, timeZone, {
      getItem: (key) => {
        if (this.blocked) throw new Error(this.blocked);
        this.refreshCache();
        return JSON.stringify(
          key.includes("-goal:") ? this.state.goal : this.state.entries,
        );
      },
      setItem: (key, value) => this.write(key, JSON.parse(value)),
    });
  }
  private static queues = new Map<string, Promise<unknown>>();
  /** Lock only short cache transactions; a network request never delays local input. */
  async change<T>(action: () => T): Promise<T> {
    const apply = () => {
      if (this.blocked) throw new Error(this.blocked);
      this.reload(true);
      return action();
    };
    if (typeof navigator !== "undefined" && navigator.locks)
      return navigator.locks.request(this.cacheKey, apply);
    const prior =
      BodyweightJournal.queues.get(this.cacheKey) ?? Promise.resolve();
    const result = prior.then(apply, apply);
    BodyweightJournal.queues.set(this.cacheKey, result);
    try {
      return await result;
    } finally {
      if (BodyweightJournal.queues.get(this.cacheKey) === result)
        BodyweightJournal.queues.delete(this.cacheKey);
    }
  }
  private parse(raw: string): State {
    const state = JSON.parse(raw) as State;
    if (
      !state ||
      !Array.isArray(state.entries) ||
      !state.pending ||
      !state.revisions ||
      !state.conflicts
    )
      throw new Error(
        "Кэш синхронизации повреждён. Исходные данные сохранены.",
      );
    for (const e of state.entries)
      BodyweightDocument.value(`weight:${e.date}`, e);
    BodyweightDocument.value("goal", state.goal);
    for (const [key, p] of Object.entries(state.pending)) {
      BodyweightDocument.value(key, p.value);
      if (
        !Number.isInteger(p.revision) ||
        p.revision < 0 ||
        typeof p.mutationId !== "string"
      )
        throw new Error("Повреждена очередь синхронизации");
    }
    return state;
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit() {
    this.listeners.forEach((fn) => fn());
  }
  massAt(date: string, legacy: number | null) {
    try {
      this.refreshCache();
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Не удалось прочитать вес";
    }
    const hasHistory =
      this.state.entries.length > 0 ||
      [
        ...Object.keys(this.state.revisions),
        ...Object.keys(this.state.pending),
      ].some((k) => k.startsWith("weight:"));
    let legacyAllowed = this.binding === undefined;
    try {
      if (this.binding === "")
        legacyAllowed = !localStorage.getItem(
          `tyaga-bodyweight-bound:${this.accountId}`,
        );
    } catch {
      legacyAllowed = false;
    }
    return BodyMass.at(
      this.state.entries,
      date,
      hasHistory || !legacyAllowed ? null : legacy,
    );
  }
  get pendingCount() {
    return Object.keys(this.state.pending).length;
  }
  get conflicts() {
    return Object.keys(this.state.conflicts);
  }
  get lastSyncedAt() {
    return this.state.lastSyncedAt;
  }
  private persist(next: State) {
    if (this.binding)
      localStorage.setItem(
        `tyaga-bodyweight-bound:${this.accountId}`,
        this.binding,
      );
    localStorage.setItem(this.cacheKey, JSON.stringify(next));
    this.state = next;
    this.emit();
  }
  private refreshCache() {
    const raw = localStorage.getItem(this.cacheKey);
    if (raw) this.state = this.parse(raw);
  }
  reload(throwOnError = false) {
    try {
      const raw = localStorage.getItem(this.cacheKey);
      if (raw) {
        this.state = this.parse(raw);
        this.blocked = "";
      }
      this.emit();
    } catch (e) {
      this.blocked = this.error = (e as Error).message;
      this.emit();
      if (throwOnError) throw e;
    }
  }
  private write(key: string, value: BodyweightEntry[] | BodyweightGoal) {
    if (this.blocked) throw new Error(this.blocked);
    this.reload(true);
    const next = structuredClone(this.state);
    const queue = (docKey: string, v: WeightValue) => {
      next.pending[docKey] = {
        value: BodyweightDocument.value(docKey, v),
        revision: next.pending[docKey]?.revision ?? next.revisions[docKey] ?? 0,
        mutationId: crypto.randomUUID(),
      };
    };
    if (key.includes("-goal:")) {
      next.goal = value as BodyweightGoal;
      queue("goal", next.goal);
    } else {
      const entries = value as BodyweightEntry[];
      const before = new Map(next.entries.map((e) => [e.date, e]));
      const after = new Map(entries.map((e) => [e.date, e]));
      for (const date of new Set([...before.keys(), ...after.keys()]))
        if (
          JSON.stringify(before.get(date)) !== JSON.stringify(after.get(date))
        )
          queue(`weight:${date}`, after.get(date) ?? null);
      next.entries = entries;
    }
    try {
      this.persist(next);
    } catch {
      throw new Error(
        "Не удалось сохранить вес на устройстве. Ввод остаётся в форме.",
      );
    }
  }
  private putValue(next: State, key: string, value: WeightValue) {
    if (key === "goal") {
      next.goal = (value as BodyweightGoal) ?? emptyGoal;
      return;
    }
    next.entries = next.entries.filter((e) => e.date !== key.slice(7));
    if (value) next.entries.push(value as BodyweightEntry);
    next.entries.sort((a, b) => a.date.localeCompare(b.date));
  }
  private receive(doc: WeightDocument) {
    this.refreshCache();
    BodyweightDocument.value(doc.key, doc.value);
    const next = structuredClone(this.state),
      p = next.pending[doc.key];
    if (p && p.mutationId !== doc.mutationId) {
      if (p.revision !== doc.revision) next.conflicts[doc.key] = doc;
    } else {
      if (p) delete next.pending[doc.key];
      delete next.conflicts[doc.key];
      this.putValue(next, doc.key, doc.value);
    }
    next.revisions[doc.key] = doc.revision;
    this.persist(next);
  }
  /** Both conflict options are explicit; taking the server version never deletes the local backup keys. */
  resolve(key: string, keepLocal: boolean) {
    const next = structuredClone(this.state),
      current = next.conflicts[key];
    if (!(key in next.conflicts)) return;
    if (keepLocal) {
      next.pending[key] = {
        ...next.pending[key],
        revision: current?.revision ?? 0,
        mutationId: crypto.randomUUID(),
      };
    } else {
      delete next.pending[key];
      this.putValue(next, key, current?.value ?? null);
    }
    delete next.conflicts[key];
    this.persist(next);
  }
  sync() {
    return (this.running ??= this.run().finally(() => {
      this.running = null;
      this.emit();
    }));
  }
  get syncing() {
    return this.running !== null;
  }
  private async run() {
    this.error = "";
    this.emit();
    try {
      if (this.blocked) throw new Error(this.blocked);
      await this.change(() => this.persist(structuredClone(this.state)));
      const data = await this.client.request<{
        documents: WeightDocument[];
        accountId: string;
      }>("/api/bodyweight");
      if (this.binding === undefined && data.accountId !== this.accountId)
        throw new Error("Аккаунт изменился. Открой журнал веса заново.");
      for (const doc of data.documents)
        await this.change(() => this.receive(doc));
      for (const key of Object.keys(this.state.pending)) {
        if (key in this.state.conflicts) continue;
        const pending = this.state.pending[key];
        try {
          const result = await this.client.request<{
            document: WeightDocument;
          }>(`/api/bodyweight/${encodeURIComponent(key)}`, "PUT", {
            ...pending,
            accountId: data.accountId,
          });
          await this.change(() => {
            // Edits made while awaiting this own write inherit its acknowledged revision.
            this.refreshCache();
            const next = structuredClone(this.state);
            if (next.pending[key]?.mutationId === pending.mutationId)
              delete next.pending[key];
            else if (next.pending[key])
              next.pending[key].revision = result.document.revision;
            next.revisions[key] = result.document.revision;
            this.persist(next);
          });
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            await this.change(() => {
              const next = structuredClone(this.state);
              next.conflicts[key] = (
                e.data as { document: WeightDocument | null }
              ).document;
              this.persist(next);
            });
          } else throw e;
        }
      }
      await this.change(() => {
        const next = structuredClone(this.state);
        next.lastSyncedAt = new Date().toISOString();
        this.persist(next);
      });
    } catch (e) {
      this.error =
        e instanceof Error ? e.message : "Нет связи. Изменения ждут отправки.";
      this.emit();
    }
  }
  restore(snapshot: WeightBackup, replace = false) {
    if (this.blocked) throw new Error(this.blocked);
    const valid = JournalBackup.weights(snapshot);
    this.reload(true);
    const plan = JournalBackup.merge(
      this.state.entries,
      valid.entries,
      replace,
    );
    const next = structuredClone(this.state);
    const values: Record<string, WeightValue> = {};
    const before = new Map(this.state.entries.map((e) => [e.date, e]));
    for (const e of plan.entries)
      if (JSON.stringify(before.get(e.date)) !== JSON.stringify(e))
        values[`weight:${e.date}`] = e;
    next.entries = plan.entries;
    if (
      (replace || next.goal.targetWeightKg === null) &&
      JSON.stringify(valid.goal) !== JSON.stringify(next.goal)
    ) {
      next.goal = valid.goal;
      values.goal = valid.goal;
    }
    for (const [key, value] of Object.entries(values))
      next.pending[key] = {
        value,
        revision: next.pending[key]?.revision ?? next.revisions[key] ?? 0,
        mutationId: crypto.randomUUID(),
      };
    this.persist(next);
    return plan;
  }
  export() {
    return {
      format: "tyaga-bodyweight",
      version: 1,
      exportedAt: new Date().toISOString(),
      entries: this.tracker.getEntries(),
      goal: this.tracker.getGoal(),
    };
  }
}
