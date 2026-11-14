import type { ExecutionProfile, SetEntry, WorkoutExercise } from "../lib/types";

/** Stable comparison identity; a machine ID never changes anatomical roles. */
export class ExecutionIdentity {
  static profile(
    entry: WorkoutExercise,
    set?: SetEntry,
  ): ExecutionProfile | undefined {
    const merged = { ...entry.execution, ...set?.execution };
    return Object.keys(merged).length ? merged : undefined;
  }
  static key(entry: WorkoutExercise, set?: SetEntry) {
    const profile = this.profile(entry, set);
    const context = profile
      ? Object.entries(profile)
          .filter(([, value]) => value !== undefined && value !== "")
          .sort(([a], [b]) => a.localeCompare(b))
      : [];
    return JSON.stringify([
      entry.exerciseId,
      entry.catalogRevision ?? 1,
      entry.machineInstanceId
        ? `machine:${entry.machineInstanceId}`
        : (entry.equipmentNote ?? ""),
      set?.performedSides ?? entry.performedSides ?? "both",
      ...(context.length ? [context] : []),
    ]);
  }
  static describe(entry: WorkoutExercise, set?: SetEntry) {
    const p = this.profile(entry, set);
    const rom = {
      full: "полная амплитуда",
      lengthened_partial: "частичная в растянутой позиции",
      shortened_partial: "частичная в сокращённой позиции",
      custom: "своя амплитуда",
    };
    return [
      entry.machineSnapshot?.nickname,
      (set?.performedSides ?? entry.performedSides) === "left"
        ? "левая сторона"
        : (set?.performedSides ?? entry.performedSides) === "right"
          ? "правая сторона"
          : undefined,
      p?.rom ? rom[p.rom] : undefined,
      p?.grip,
      p?.attachment,
      p?.stance,
      p?.benchAngle === undefined ? undefined : `скамья ${p.benchAngle}°`,
      p?.torsoAngle === undefined ? undefined : `корпус ${p.torsoAngle}°`,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  static setIndex(entry: WorkoutExercise, set: SetEntry) {
    const position = entry.sets.findIndex(
      (candidate) => candidate.id === set.id,
    );
    const key = this.key(entry, set);
    return entry.sets
      .slice(0, Math.max(0, position))
      .filter(
        (candidate) =>
          candidate.warmup === set.warmup && this.key(entry, candidate) === key,
      ).length;
  }
  static forSet(entry: WorkoutExercise, set: SetEntry): WorkoutExercise {
    return {
      ...entry,
      performedSides: set.performedSides ?? entry.performedSides,
      execution: this.profile(entry, set),
      sets: [set],
    };
  }
  static split(entry: WorkoutExercise): WorkoutExercise[] {
    const groups = new Map<string, WorkoutExercise>();
    for (const set of entry.sets) {
      const key = this.key(entry, set);
      let group = groups.get(key);
      if (!group) {
        group = { ...this.forSet(entry, set), sets: [] };
        groups.set(key, group);
      }
      group.sets.push(set);
    }
    return [...groups.values()];
  }
}
