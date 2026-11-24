import type { SetEntry, WorkoutExercise } from "../lib/types";

export type WorkoutSetPosition = {
  entry: WorkoutExercise;
  set: SetEntry;
  exerciseIndex: number;
  setIndex: number;
  number: number;
  count: number;
};

export type WorkoutExerciseGroup = {
  entry: WorkoutExercise;
  positions: WorkoutSetPosition[];
  workingDone: number;
  workingTotal: number;
};

/** Navigation and progress use draft rows in stored order, not analytics. */
export class WorkoutFlow {
  readonly groups: WorkoutExerciseGroup[];
  readonly positions: WorkoutSetPosition[];
  readonly workingDone: number;
  readonly workingTotal: number;

  constructor(exercises: readonly WorkoutExercise[]) {
    this.groups = exercises.map((entry, exerciseIndex) => {
      const warmupTotal = entry.sets.filter((set) => set.warmup).length;
      const workingTotal = entry.sets.length - warmupTotal;
      let warmupNumber = 0;
      let workingNumber = 0;
      let workingDone = 0;
      const positions = entry.sets.map((set, setIndex) => {
        if (!set.warmup && set.done) workingDone++;
        return {
          entry,
          set,
          exerciseIndex,
          setIndex,
          number: set.warmup ? ++warmupNumber : ++workingNumber,
          count: set.warmup ? warmupTotal : workingTotal,
        };
      });
      return { entry, positions, workingDone, workingTotal };
    });
    this.positions = this.groups.flatMap((group) => group.positions);
    this.workingDone = this.groups.reduce((total, group) => total + group.workingDone, 0);
    this.workingTotal = this.groups.reduce((total, group) => total + group.workingTotal, 0);
  }

  current(selected: string | null): WorkoutSetPosition | undefined {
    const explicit = this.positions.find(({ set }) => set.id === selected);
    return explicit ?? this.positions.find(({ set }) => !set.done) ?? this.positions.at(-1);
  }

  after(setId: string): { position: WorkoutSetPosition; wrapped: boolean } | undefined {
    const start = this.positions.findIndex(({ set }) => set.id === setId);
    if (start < 0) return undefined;
    for (let offset = 1; offset < this.positions.length; offset++) {
      const index = (start + offset) % this.positions.length;
      const position = this.positions[index];
      if (!position.set.done) return { position, wrapped: index < start };
    }
    return undefined;
  }

  forExercise(exerciseIndex: number): WorkoutSetPosition | undefined {
    const group = this.groups[exerciseIndex];
    return group?.positions.find(({ set }) => !set.done) ?? group?.positions[0];
  }
}
