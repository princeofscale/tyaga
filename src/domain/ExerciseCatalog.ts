import type { Exercise, WorkoutExercise } from "../lib/types";

export class ExerciseCatalog {
  private entries = new Map<string, Exercise>();
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
    if (id.startsWith("wger:")) return this.entries.get(this.key(id, 3));
    return (
      this.entries.get(this.key(id, revision)) ??
      (revision === 2 ? this.entries.get(this.key(id, 1)) : undefined)
    );
  }
  forEntry(entry: WorkoutExercise): Exercise | undefined {
    if (
      entry.catalogRevision === 3 &&
      entry.externalDefinition?.id === entry.exerciseId &&
      entry.externalDefinition.source?.provider === "wger"
    )
      return entry.externalDefinition;
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
    const query = text.toLocaleLowerCase().trim();
    return this.curated.filter(
      (e) =>
        `${e.name} ${e.nameEn}`.toLocaleLowerCase().includes(query) &&
        (zone === "all" ||
          [...e.primary, ...e.secondary].includes(
            zone as Exercise["primary"][number],
          )) &&
        (equipment === "all" ||
          equipment === "gym" ||
          e.equipment === equipment ||
          e.equipment === "bodyweight"),
    );
  }
}
