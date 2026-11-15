import type { Exercise, WorkoutExercise } from "../lib/types";
import { matchesSearch } from "../lib/search";
import { ExerciseSearchRank } from "./ExerciseSearchRank";

export class ExerciseCatalog {
  private entries = new Map<string, Exercise>();
  /** Актуальная версия каждого личного упражнения (по семье): правка разметки не должна оставлять старую историю «без мышц». */
  private families = new Map<string, Exercise>();
  constructor(
    private curated: Exercise[],
    private legacy: Exercise[],
  ) {
    this.register(curated);
    this.register(legacy);
  }
  private key(id: string, revision: number) {
    return `${revision}:${id}`;
  }
  register(exercises: Exercise[]) {
    for (const exercise of exercises)
      this.entries.set(
        this.key(exercise.id, exercise.catalogRevision),
        exercise,
      );
  }
  find(id: string, revision: 1 | 2 | 3 = 2): Exercise | undefined {
    if (id.startsWith("wger:") || id.startsWith("custom:"))
      return this.entries.get(this.key(id, 3));
    // Release 3 is additive: an id missing from the requested release is looked
    // up in the other curated releases instead of disappearing.
    return (
      this.entries.get(this.key(id, revision)) ??
      (this.entries.get(this.key(id, 3)) ||
        this.entries.get(this.key(id, 1)) ||
        undefined)
    );
  }
  /** Запоминает актуальные версии личных упражнений; возвращает число семей — удобно как ключ пересчёта. */
  adoptFamilies(exercises: Exercise[]) {
    this.families = new Map(
      exercises.filter((e) => e.custom?.familyId).map((e) => [e.custom!.familyId, e]),
    );
    return this.families.size;
  }
  private static bare(e: Exercise) {
    return !e.primary.length && !e.secondary.length && !(e.custom?.declaredZones?.length ?? 0);
  }
  forEntry(entry: WorkoutExercise): Exercise | undefined {
    if (
      entry.catalogRevision === 3 &&
      entry.externalDefinition?.id === entry.exerciseId &&
      (entry.externalDefinition.source?.provider === "wger" ||
        !!entry.externalDefinition.custom)
    ) {
      const snapshot = entry.externalDefinition;
      // Снимок без мышц заменяем актуальной версией той же семьи, если в ней мышцы уже есть: так разметка
      // «Моих» действует и на старые тренировки. Размеченные снимки не трогаем — история остаётся как записана.
      const latest = snapshot.custom ? this.families.get(snapshot.custom.familyId) : undefined;
      if (latest && latest.id !== snapshot.id && ExerciseCatalog.bare(snapshot) && !ExerciseCatalog.bare(latest))
        return latest;
      return snapshot;
    }
    return this.find(entry.exerciseId, entry.catalogRevision ?? 1);
  }
  curatedExercises() {
    return this.curated;
  }
  search({
    text = "",
    zone = "all",
    equipment = "all",
  }: {
    text?: string;
    zone?: string;
    equipment?: string;
  }) {
    const found = this.curated.filter(
      (e) =>
        matchesSearch(
          `${e.name} ${e.nameEn} ${(e.aliases ?? []).join(" ")}`,
          text,
        ) &&
        (zone === "all" ||
          [...e.primary, ...e.secondary].includes(
            zone as Exercise["primary"][number],
          )) &&
        (equipment === "all" ||
          equipment === "gym" ||
          e.equipment === equipment ||
          e.equipment === "bodyweight"),
    );
    // При запросе — ближайшие по названию первыми, при пустом остаётся порядок каталога.
    return ExerciseSearchRank.sort(found, text, (e) => e.name, () => true, (e) => e.recording.e1rmEligible === true, () => false, (e) => ExerciseSearchRank.isCore(e));
  }
}
