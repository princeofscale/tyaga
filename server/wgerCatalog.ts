import fallback from "../data/wger/fallback-snapshots.json";
import type { WgerSnapshot } from "../src/domain/WgerExercise";

type Snapshots = {
  v1: WgerSnapshot;
  v2: WgerSnapshot;
  v3: WgerSnapshot;
};

const snapshots = fallback as unknown as Snapshots;

export const WGER_PREVIOUS_V1: WgerSnapshot = snapshots.v1;
export const WGER_PREVIOUS_RU: WgerSnapshot = snapshots.v2;
export const WGER_CURRENT: WgerSnapshot = snapshots.v3;
