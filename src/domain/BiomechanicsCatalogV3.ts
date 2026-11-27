// ============================================================================
// TYAGA v3 — BIOMECHANICAL CATALOG (ALL 74 EXERCISES, 18+3+1 REGIONS, PURE TS)
// ============================================================================

export type JointZone =
  | "lumbar"
  | "shoulder_anterior"
  | "elbow"
  | "knee_patellar"
  | "wrist";

export type PainSeverity = 0 | 1 | 2 | 3;
export type JointRiskLevel = 0 | 1 | 2 | 3;
export type LoadModeV3 = "total_external" | "per_implement" | "machine_stack";
export type ResistanceProfile = "lengthened" | "mid" | "shortened" | "flat";
export type StretchScore = 1 | 2 | 3;

export type AuditedHypertrophyRegion =
  | "chest_upper"
  | "chest_mid_lower"
  | "lats"
  | "upper_back"
  | "delt_mid"
  | "delt_rear"
  | "biceps_stretch"
  | "brachialis"
  | "triceps_long_head"
  | "triceps_lateral_medial"
  | "quads_vasti"
  | "quads_rectus_femoris"
  | "hams_hinge"
  | "hams_knee_flexion"
  | "glutes_stretched"
  | "glutes_shortened"
  | "calves_gastroc"
  | "calves_soleus";

export type AuxiliaryRegion = "delt_front" | "core_abs" | "spinal_erectors";
export type UntargetedRegion = "shin_dorsiflexors";
export type HypertrophyRegionId = AuditedHypertrophyRegion | AuxiliaryRegion;

export type AnatomicalCluster =
  | "push_chest"
  | "push_delt"
  | "push_tri"
  | "pull_back"
  | "pull_rear"
  | "pull_bi"
  | "legs_quad"
  | "legs_post"
  | "legs_calf"
  | "core";

export type ExerciseFamilyV3 =
  | "horiz_press"
  | "incline_press"
  | "dip_press"
  | "chest_fly"
  | "vert_pull"
  | "horiz_pull"
  | "lat_iso"
  | "shrug"
  | "hinge_iso"
  | "vert_press"
  | "lat_raise"
  | "rear_delt"
  | "biceps_curl"
  | "forearm_curl"
  | "triceps_pushdown"
  | "triceps_overhead"
  | "knee_dom_bilat"
  | "knee_dom_unilat"
  | "quad_iso"
  | "hinge_floor"
  | "hinge_rdl"
  | "ham_knee_flex"
  | "glute_short"
  | "calf_straight"
  | "calf_bent"
  | "core_flex"
  | "core_antiext"
  | "core_rot";

export interface RegionContribution {
  readonly region: HypertrophyRegionId;
  readonly weight: 1.0 | 0.5;
}

export interface ExerciseBiomechanicalProfile {
  readonly id: string;
  readonly family: ExerciseFamilyV3;
  readonly loadMode: LoadModeV3;
  readonly isBodyweight: boolean;
  readonly axialLoadMultiplier: number;
  readonly risk: Readonly<Record<JointZone, JointRiskLevel>>;
  readonly longLeverRiskDelta: Readonly<Record<JointZone, 0 | 1>>;
  readonly resistanceProfile: ResistanceProfile;
  readonly stretchScore: StretchScore;
  readonly sfrBase: number;
  readonly sfrLongLevers: number;
  readonly regions: readonly RegionContribution[];
}

export interface RegionMeta {
  readonly id: HypertrophyRegionId;
  readonly label: string;
  readonly audited: boolean;
  readonly minSets: number;
  readonly cluster: AnatomicalCluster;
}

export const JOINT_ZONES: readonly JointZone[] = [
  "lumbar",
  "shoulder_anterior",
  "elbow",
  "knee_patellar",
  "wrist",
];

export const JOINT_ZONE_LABELS: Readonly<Record<JointZone, string>> = {
  lumbar: "Поясница",
  shoulder_anterior: "Переднее плечо",
  elbow: "Локоть",
  knee_patellar: "Колено",
  wrist: "Запястье",
};

export const AUDITED_REGIONS: readonly AuditedHypertrophyRegion[] = [
  "chest_upper",
  "chest_mid_lower",
  "lats",
  "upper_back",
  "delt_mid",
  "delt_rear",
  "biceps_stretch",
  "brachialis",
  "triceps_long_head",
  "triceps_lateral_medial",
  "quads_vasti",
  "quads_rectus_femoris",
  "hams_hinge",
  "hams_knee_flexion",
  "glutes_stretched",
  "glutes_shortened",
  "calves_gastroc",
  "calves_soleus",
];

export const ALL_HYPERTROPHY_REGIONS: readonly HypertrophyRegionId[] = [
  ...AUDITED_REGIONS,
  "delt_front",
  "core_abs",
  "spinal_erectors",
];

export const REGION_META: Readonly<Record<HypertrophyRegionId, RegionMeta>> = {
  chest_upper: { id: "chest_upper", label: "Верх груди", audited: true, minSets: 4.0, cluster: "push_chest" },
  chest_mid_lower: { id: "chest_mid_lower", label: "Середина / низ груди", audited: true, minSets: 6.0, cluster: "push_chest" },
  lats: { id: "lats", label: "Широчайшие", audited: true, minSets: 6.0, cluster: "pull_back" },
  upper_back: { id: "upper_back", label: "Верх спины / трапеция", audited: true, minSets: 5.0, cluster: "pull_back" },
  delt_mid: { id: "delt_mid", label: "Средняя дельта", audited: true, minSets: 6.0, cluster: "push_delt" },
  delt_rear: { id: "delt_rear", label: "Задняя дельта", audited: true, minSets: 4.0, cluster: "pull_rear" },
  biceps_stretch: { id: "biceps_stretch", label: "Бицепс (растяжение)", audited: true, minSets: 4.0, cluster: "pull_bi" },
  brachialis: { id: "brachialis", label: "Брахиалис / предплечье", audited: true, minSets: 2.0, cluster: "pull_bi" },
  triceps_long_head: { id: "triceps_long_head", label: "Трицепс (длинная гол.)", audited: true, minSets: 4.0, cluster: "push_tri" },
  triceps_lateral_medial: { id: "triceps_lateral_medial", label: "Трицепс (лат./мед.)", audited: true, minSets: 4.0, cluster: "push_tri" },
  quads_vasti: { id: "quads_vasti", label: "Широкие бедра", audited: true, minSets: 6.0, cluster: "legs_quad" },
  quads_rectus_femoris: { id: "quads_rectus_femoris", label: "Прямая бедра", audited: true, minSets: 3.0, cluster: "legs_quad" },
  hams_hinge: { id: "hams_hinge", label: "Бицепс бедра (хиндж)", audited: true, minSets: 4.0, cluster: "legs_post" },
  hams_knee_flexion: { id: "hams_knee_flexion", label: "Бицепс бедра (сгибание)", audited: true, minSets: 4.0, cluster: "legs_post" },
  glutes_stretched: { id: "glutes_stretched", label: "Ягодицы (растяжение)", audited: true, minSets: 4.0, cluster: "legs_post" },
  glutes_shortened: { id: "glutes_shortened", label: "Ягодицы (сокращение)", audited: true, minSets: 2.0, cluster: "legs_post" },
  calves_gastroc: { id: "calves_gastroc", label: "Икроножная (стоя)", audited: true, minSets: 4.0, cluster: "legs_calf" },
  calves_soleus: { id: "calves_soleus", label: "Камбаловидная (сидя)", audited: true, minSets: 2.0, cluster: "legs_calf" },
  delt_front: { id: "delt_front", label: "Передняя дельта", audited: false, minSets: 2.0, cluster: "push_delt" },
  core_abs: { id: "core_abs", label: "Пресс / кор", audited: false, minSets: 4.0, cluster: "core" },
  spinal_erectors: { id: "spinal_erectors", label: "Разгибатели спины", audited: false, minSets: 2.0, cluster: "legs_post" },
};

export const BODYWEIGHT_IDS = new Set<string>([
  "pushup",
  "pullup",
  "body-squat",
  "crunch",
  "hanging-leg-raise",
  "ab-roller",
  "glute-bridge",
  "calf-standing",
  "back-extension",
]);

export const COMPATIBLE_FAMILIES: Readonly<Record<ExerciseFamilyV3, readonly ExerciseFamilyV3[]>> = {
  horiz_press: ["horiz_press", "incline_press", "dip_press", "chest_fly"],
  incline_press: ["incline_press", "horiz_press", "chest_fly"],
  dip_press: ["dip_press", "horiz_press", "incline_press", "chest_fly"],
  chest_fly: ["chest_fly", "horiz_press", "incline_press"],
  vert_pull: ["vert_pull", "horiz_pull", "lat_iso"],
  horiz_pull: ["horiz_pull", "vert_pull"],
  lat_iso: ["lat_iso", "vert_pull", "horiz_pull"],
  shrug: ["shrug", "horiz_pull"],
  hinge_iso: ["hinge_iso", "hinge_rdl", "glute_short"],
  vert_press: ["vert_press", "incline_press", "lat_raise"],
  lat_raise: ["lat_raise", "vert_press"],
  rear_delt: ["rear_delt", "horiz_pull"],
  biceps_curl: ["biceps_curl", "forearm_curl"],
  forearm_curl: ["forearm_curl", "biceps_curl"],
  triceps_pushdown: ["triceps_pushdown", "triceps_overhead"],
  triceps_overhead: ["triceps_overhead", "triceps_pushdown"],
  knee_dom_bilat: ["knee_dom_bilat", "knee_dom_unilat", "quad_iso"],
  knee_dom_unilat: ["knee_dom_unilat", "knee_dom_bilat", "quad_iso"],
  quad_iso: ["quad_iso", "knee_dom_bilat", "knee_dom_unilat"],
  hinge_floor: ["hinge_floor", "hinge_rdl", "glute_short", "ham_knee_flex"],
  hinge_rdl: ["hinge_rdl", "hinge_floor", "ham_knee_flex", "glute_short"],
  ham_knee_flex: ["ham_knee_flex", "hinge_rdl"],
  glute_short: ["glute_short", "hinge_rdl", "knee_dom_unilat"],
  calf_straight: ["calf_straight", "calf_bent"],
  calf_bent: ["calf_bent", "calf_straight"],
  core_flex: ["core_flex", "core_antiext", "core_rot"],
  core_antiext: ["core_antiext", "core_flex", "core_rot"],
  core_rot: ["core_rot", "core_flex", "core_antiext"],
};

export const TRANSFER_RATIOS: Readonly<Record<string, number>> = {
  "bench->flat-db-press": 0.4,
  "bench->incline-bar": 0.82,
  "bench->incline-db": 0.34,
  "bench->pec-deck-fly": 0.65,
  "bench->high-cable-fly": 0.5,
  "bench->fly": 0.5,
  "incline-bar->incline-db": 0.4,
  "incline-bar->flat-db-press": 0.45,
  "squat->hack-squat": 1.05,
  "squat->legpress": 1.75,
  "squat->bulgarian-split-squat": 0.22,
  "squat->lunge-reverse": 0.22,
  "squat->goblet": 0.28,
  "squat->leg-extension": 0.55,
  "deadlift-bar->trap-bar-deadlift": 1.08,
  "deadlift-bar->rdl": 0.7,
  "deadlift-bar->db-rdl": 0.28,
  "deadlift-bar->barbell-hip-thrust": 1.05,
  "deadlift-bar->legcurl-seated": 0.4,
  "rdl->db-rdl": 0.4,
  "rdl->barbell-hip-thrust": 1.35,
  "rdl->legcurl-seated": 0.55,
  "row-bent-bar->row-chest-supported": 0.78,
  "row-bent-bar->row-single-cable": 0.42,
  "row-bent-bar->row": 0.85,
  "row-bent-bar->row-v-grip": 0.85,
  "row-bent-bar->db-row": 0.42,
  "row-yates->row-chest-supported": 0.78,
  "row-yates->row-v-grip": 0.85,
  "ohp-bar->ohp": 0.42,
  "ohp-bar->shoulder-press-machine": 0.95,
  "push-press->shoulder-press-machine": 0.85,
  "push-press->ohp": 0.38,
  "skullcrusher-ez->extension-overhead-cable": 0.68,
  "skullcrusher-ez->extension-v-pushdown": 0.8,
  "skullcrusher-ez->triceps-push": 0.75,
  "skullcrusher-ez->triceps-db": 0.65,
  "curl-bar->curl-preacher-ez": 0.82,
  "curl-bar->hammer-seated": 0.42,
  "curl-bar->hammer": 0.42,
  "curl-bar->curl-incline-db": 0.36,
};

type RawTuple = [
  id: string,
  family: ExerciseFamilyV3,
  loadMode: LoadModeV3,
  axial: number,
  risk: [JointRiskLevel, JointRiskLevel, JointRiskLevel, JointRiskLevel, JointRiskLevel],
  llDelta: [0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1],
  profile: ResistanceProfile,
  stretch: StretchScore,
  sfrBase: number,
  sfrLongLevers: number,
  regions: Array<[HypertrophyRegionId, 1.0 | 0.5]>,
];

const RAW_PROFILES: readonly RawTuple[] = [
  ["bench", "horiz_press", "total_external", 0.5, [1, 2, 2, 0, 2], [0, 1, 0, 0, 0], "lengthened", 2, 7.0, 6.4, [["chest_mid_lower", 1.0], ["chest_upper", 0.5], ["triceps_lateral_medial", 0.5], ["delt_front", 0.5]]],
  ["incline-bar", "incline_press", "total_external", 0.5, [1, 2, 2, 0, 2], [0, 1, 0, 0, 0], "lengthened", 2, 7.0, 6.4, [["chest_upper", 1.0], ["chest_mid_lower", 0.5], ["triceps_lateral_medial", 0.5], ["delt_front", 0.5]]],
  ["flat-db-press", "horiz_press", "per_implement", 0.15, [0, 1, 1, 0, 1], [0, 0, 0, 0, 0], "lengthened", 3, 8.4, 8.4, [["chest_mid_lower", 1.0], ["chest_upper", 0.5], ["triceps_lateral_medial", 0.5], ["delt_front", 0.5]]],
  ["incline-db", "incline_press", "per_implement", 0.15, [0, 1, 1, 0, 1], [0, 0, 0, 0, 0], "lengthened", 3, 8.5, 8.5, [["chest_upper", 1.0], ["chest_mid_lower", 0.5], ["triceps_lateral_medial", 0.5], ["delt_front", 0.5]]],
  ["dip-weighted", "dip_press", "total_external", 0.5, [0, 3, 2, 0, 2], [0, 1, 1, 0, 0], "lengthened", 3, 6.8, 5.8, [["chest_mid_lower", 1.0], ["triceps_lateral_medial", 0.5], ["delt_front", 0.5]]],
  ["pushup", "horiz_press", "total_external", 0.15, [1, 1, 1, 0, 2], [0, 0, 0, 0, 0], "lengthened", 2, 7.8, 7.8, [["chest_mid_lower", 1.0], ["triceps_lateral_medial", 0.5], ["delt_front", 0.5]]],
  ["fly", "chest_fly", "machine_stack", 0.15, [0, 2, 1, 0, 1], [0, 0, 0, 0, 0], "lengthened", 3, 8.7, 8.7, [["chest_mid_lower", 1.0], ["chest_upper", 0.5]]],
  ["high-cable-fly", "chest_fly", "machine_stack", 0.15, [0, 1, 1, 0, 1], [0, 0, 0, 0, 0], "mid", 2, 8.8, 8.8, [["chest_mid_lower", 1.0]]],
  ["pec-deck-fly", "chest_fly", "machine_stack", 0.15, [0, 1, 1, 0, 0], [0, 0, 0, 0, 0], "flat", 2, 9.1, 9.1, [["chest_mid_lower", 1.0], ["chest_upper", 0.5]]],
  ["fly-db-flat", "chest_fly", "per_implement", 0.15, [0, 2, 2, 0, 1], [0, 1, 0, 0, 0], "lengthened", 3, 8.1, 7.3, [["chest_mid_lower", 1.0]]],
  ["lat-pulldown", "vert_pull", "machine_stack", 0.15, [0, 1, 1, 0, 1], [0, 0, 0, 0, 0], "lengthened", 2, 8.8, 8.8, [["lats", 1.0], ["upper_back", 0.5], ["biceps_stretch", 0.5]]],
  ["pulldown-reverse", "vert_pull", "machine_stack", 0.15, [0, 1, 2, 0, 1], [0, 0, 0, 0, 0], "lengthened", 2, 8.4, 8.4, [["lats", 1.0], ["biceps_stretch", 0.5]]],
  ["pullup", "vert_pull", "total_external", 0.5, [0, 2, 2, 0, 1], [0, 0, 1, 0, 0], "lengthened", 3, 7.2, 6.6, [["lats", 1.0], ["upper_back", 0.5], ["biceps_stretch", 0.5], ["brachialis", 0.5]]],
  ["pullup-weighted", "vert_pull", "total_external", 0.5, [0, 2, 2, 0, 1], [0, 1, 1, 0, 0], "lengthened", 3, 7.1, 6.0, [["lats", 1.0], ["upper_back", 0.5], ["biceps_stretch", 0.5], ["brachialis", 0.5]]],
  ["pullup-assisted", "vert_pull", "machine_stack", 0.15, [0, 1, 1, 0, 1], [0, 0, 0, 0, 0], "lengthened", 3, 8.9, 8.9, [["lats", 1.0], ["upper_back", 0.5], ["biceps_stretch", 0.5]]],
  ["row", "horiz_pull", "machine_stack", 0.15, [1, 1, 1, 0, 1], [0, 0, 0, 0, 0], "mid", 2, 8.7, 8.7, [["upper_back", 1.0], ["lats", 0.5], ["delt_rear", 0.5], ["biceps_stretch", 0.5]]],
  ["row-v-grip", "horiz_pull", "machine_stack", 0.15, [1, 0, 1, 0, 0], [0, 0, 0, 0, 0], "mid", 2, 8.8, 8.8, [["lats", 1.0], ["upper_back", 0.5], ["brachialis", 0.5]]],
  ["row-single-cable", "horiz_pull", "machine_stack", 0.15, [0, 0, 1, 0, 0], [0, 0, 0, 0, 0], "lengthened", 3, 9.0, 9.0, [["lats", 1.0], ["upper_back", 0.5]]],
  ["db-row", "horiz_pull", "per_implement", 0.5, [1, 1, 1, 0, 1], [0, 0, 0, 0, 0], "lengthened", 2, 7.7, 7.7, [["lats", 1.0], ["upper_back", 0.5], ["delt_rear", 0.5]]],
  ["row-bent-bar", "horiz_pull", "total_external", 1.5, [3, 1, 2, 1, 2], [1, 0, 0, 0, 0], "shortened", 1, 4.9, 4.2, [["upper_back", 1.0], ["lats", 0.5], ["delt_rear", 0.5], ["spinal_erectors", 0.5]]],
  ["row-yates", "horiz_pull", "total_external", 1.0, [2, 1, 2, 0, 2], [1, 0, 0, 0, 0], "shortened", 1, 5.8, 4.9, [["upper_back", 1.0], ["lats", 0.5], ["biceps_stretch", 0.5]]],
  ["row-chest-supported", "horiz_pull", "total_external", 0.15, [0, 0, 1, 0, 1], [0, 0, 0, 0, 0], "mid", 2, 9.1, 9.1, [["upper_back", 1.0], ["lats", 0.5], ["delt_rear", 0.5]]],
  ["pullover-cable", "lat_iso", "machine_stack", 0.15, [0, 1, 1, 0, 0], [0, 0, 0, 0, 0], "lengthened", 3, 9.0, 9.0, [["lats", 1.0], ["triceps_long_head", 0.5]]],
  ["shrug-bar", "shrug", "total_external", 1.0, [2, 0, 0, 0, 1], [0, 0, 0, 0, 0], "shortened", 1, 6.0, 5.5, [["upper_back", 1.0]]],
  ["shrug-db-incline", "shrug", "per_implement", 0.15, [0, 0, 0, 0, 1], [0, 0, 0, 0, 0], "mid", 2, 9.0, 9.0, [["upper_back", 1.0]]],
  ["back-extension", "hinge_iso", "total_external", 0.5, [2, 0, 0, 0, 0], [0, 0, 0, 0, 0], "lengthened", 2, 7.5, 7.5, [["spinal_erectors", 1.0], ["glutes_stretched", 0.5], ["hams_hinge", 0.5]]],
  ["ohp-bar", "vert_press", "total_external", 1.0, [2, 2, 1, 0, 2], [1, 1, 0, 0, 0], "lengthened", 2, 6.0, 4.7, [["delt_front", 1.0], ["delt_mid", 0.5], ["triceps_lateral_medial", 0.5], ["chest_upper", 0.5]]],
  ["ohp", "vert_press", "per_implement", 0.5, [1, 2, 1, 0, 1], [0, 0, 0, 0, 0], "lengthened", 2, 7.2, 7.2, [["delt_front", 1.0], ["delt_mid", 0.5], ["triceps_lateral_medial", 0.5]]],
  ["push-press", "vert_press", "total_external", 1.5, [3, 3, 2, 2, 2], [1, 1, 0, 0, 0], "mid", 1, 4.5, 3.6, [["delt_front", 1.0], ["delt_mid", 0.5], ["quads_vasti", 0.5]]],
  ["shoulder-press-machine", "vert_press", "machine_stack", 0.15, [0, 1, 1, 0, 1], [0, 0, 0, 0, 0], "lengthened", 2, 9.0, 9.0, [["delt_front", 1.0], ["delt_mid", 0.5], ["triceps_lateral_medial", 0.5]]],
  ["lateral", "lat_raise", "per_implement", 0.15, [0, 1, 0, 0, 0], [0, 0, 0, 0, 0], "shortened", 1, 8.7, 8.7, [["delt_mid", 1.0]]],
  ["lateral-cable-single", "lat_raise", "machine_stack", 0.15, [0, 1, 0, 0, 0], [0, 0, 0, 0, 0], "lengthened", 3, 9.1, 9.1, [["delt_mid", 1.0]]],
  ["facepull-er", "rear_delt", "machine_stack", 0.15, [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], "shortened", 1, 9.3, 9.3, [["delt_rear", 1.0], ["upper_back", 0.5]]],
  ["rear-delt-fly", "rear_delt", "machine_stack", 0.15, [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], "flat", 2, 9.5, 9.5, [["delt_rear", 1.0], ["upper_back", 0.5]]],
  ["curl", "biceps_curl", "per_implement", 0.15, [0, 1, 1, 0, 1], [0, 0, 0, 0, 0], "mid", 2, 8.7, 8.7, [["biceps_stretch", 1.0], ["brachialis", 0.5]]],
  ["curl-bar", "biceps_curl", "total_external", 0.5, [1, 1, 2, 0, 3], [0, 0, 1, 0, 1], "mid", 1, 6.8, 5.6, [["biceps_stretch", 1.0], ["brachialis", 0.5]]],
  ["curl-preacher-ez", "biceps_curl", "total_external", 0.15, [0, 0, 2, 0, 1], [0, 0, 1, 0, 0], "lengthened", 3, 8.8, 8.0, [["biceps_stretch", 1.0], ["brachialis", 0.5]]],
  ["curl-incline-db", "biceps_curl", "per_implement", 0.15, [0, 2, 1, 0, 1], [0, 1, 0, 0, 0], "lengthened", 3, 8.7, 7.9, [["biceps_stretch", 1.0]]],
  ["curl-reverse-ez", "forearm_curl", "total_external", 0.15, [0, 0, 2, 0, 2], [0, 0, 0, 0, 0], "mid", 1, 8.1, 8.1, [["brachialis", 1.0]]],
  ["hammer", "forearm_curl", "per_implement", 0.15, [0, 0, 1, 0, 0], [0, 0, 0, 0, 0], "mid", 1, 8.7, 8.7, [["brachialis", 1.0], ["biceps_stretch", 0.5]]],
  ["hammer-seated", "forearm_curl", "per_implement", 0.15, [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], "mid", 1, 9.3, 9.3, [["brachialis", 1.0], ["biceps_stretch", 0.5]]],
  ["triceps-push", "triceps_pushdown", "machine_stack", 0.15, [0, 0, 1, 0, 1], [0, 0, 0, 0, 0], "mid", 1, 8.8, 8.8, [["triceps_lateral_medial", 1.0], ["triceps_long_head", 0.5]]],
  ["extension-v-pushdown", "triceps_pushdown", "machine_stack", 0.15, [0, 0, 1, 0, 1], [0, 0, 0, 0, 0], "mid", 1, 8.9, 8.9, [["triceps_lateral_medial", 1.0], ["triceps_long_head", 0.5]]],
  ["triceps-db", "triceps_overhead", "per_implement", 0.15, [0, 1, 2, 0, 1], [0, 0, 1, 0, 0], "lengthened", 3, 8.5, 7.7, [["triceps_long_head", 1.0], ["triceps_lateral_medial", 0.5]]],
  ["extension-overhead-cable", "triceps_overhead", "machine_stack", 0.15, [0, 1, 1, 0, 0], [0, 0, 0, 0, 0], "lengthened", 3, 9.2, 9.2, [["triceps_long_head", 1.0], ["triceps_lateral_medial", 0.5]]],
  ["skullcrusher-ez", "triceps_overhead", "total_external", 0.15, [0, 1, 3, 0, 2], [0, 0, 1, 0, 0], "lengthened", 2, 7.7, 6.9, [["triceps_long_head", 1.0], ["triceps_lateral_medial", 0.5]]],
  ["squat", "knee_dom_bilat", "total_external", 1.5, [3, 1, 1, 3, 2], [1, 0, 0, 1, 0], "lengthened", 2, 5.4, 4.4, [["quads_vasti", 1.0], ["glutes_stretched", 1.0], ["spinal_erectors", 0.5]]],
  ["hack-squat", "knee_dom_bilat", "total_external", 0.5, [1, 0, 0, 2, 0], [0, 0, 0, 1, 0], "lengthened", 3, 8.0, 7.4, [["quads_vasti", 1.0], ["glutes_stretched", 1.0]]],
  ["legpress", "knee_dom_bilat", "total_external", 0.15, [1, 0, 0, 2, 0], [0, 0, 0, 0, 0], "lengthened", 2, 8.5, 8.5, [["quads_vasti", 1.0], ["glutes_stretched", 1.0]]],
  ["goblet", "knee_dom_bilat", "per_implement", 0.5, [1, 0, 0, 2, 1], [0, 0, 0, 0, 0], "lengthened", 2, 7.1, 7.1, [["quads_vasti", 1.0], ["glutes_stretched", 1.0]]],
  ["body-squat", "knee_dom_bilat", "total_external", 0.15, [0, 0, 0, 1, 0], [0, 0, 0, 0, 0], "mid", 1, 8.0, 8.0, [["quads_vasti", 1.0], ["glutes_stretched", 1.0]]],
  ["lunge-bar", "knee_dom_unilat", "total_external", 1.0, [2, 0, 0, 2, 1], [1, 0, 0, 1, 0], "lengthened", 2, 6.1, 4.8, [["quads_vasti", 1.0], ["glutes_stretched", 1.0]]],
  ["lunge-reverse", "knee_dom_unilat", "per_implement", 0.5, [1, 0, 0, 1, 0], [0, 0, 0, 0, 0], "lengthened", 2, 7.7, 7.7, [["quads_vasti", 1.0], ["glutes_stretched", 1.0]]],
  ["bulgarian-split-squat", "knee_dom_unilat", "per_implement", 0.5, [1, 0, 0, 2, 0], [0, 0, 0, 0, 0], "lengthened", 3, 7.4, 7.4, [["quads_vasti", 1.0], ["glutes_stretched", 1.0]]],
  ["leg-extension", "quad_iso", "machine_stack", 0.15, [0, 0, 0, 2, 0], [0, 0, 0, 0, 0], "shortened", 2, 8.8, 8.8, [["quads_rectus_femoris", 1.0], ["quads_vasti", 0.5]]],
  ["deadlift-bar", "hinge_floor", "total_external", 1.5, [3, 0, 1, 1, 1], [1, 0, 0, 0, 0], "mid", 1, 4.6, 3.9, [["hams_hinge", 1.0], ["glutes_stretched", 1.0], ["spinal_erectors", 1.0], ["upper_back", 0.5]]],
  ["trap-bar-deadlift", "hinge_floor", "total_external", 1.5, [2, 0, 0, 1, 0], [0, 0, 0, 0, 0], "mid", 1, 5.4, 5.0, [["glutes_stretched", 1.0], ["quads_vasti", 0.5], ["hams_hinge", 0.5], ["spinal_erectors", 0.5]]],
  ["deadlift-stiff", "hinge_rdl", "total_external", 1.5, [3, 0, 0, 1, 1], [1, 0, 0, 0, 0], "lengthened", 3, 5.6, 4.9, [["hams_hinge", 1.0], ["glutes_stretched", 0.5], ["spinal_erectors", 0.5]]],
  ["rdl", "hinge_rdl", "total_external", 1.0, [2, 0, 0, 0, 1], [1, 0, 0, 0, 0], "lengthened", 3, 6.8, 5.8, [["hams_hinge", 1.0], ["glutes_stretched", 1.0], ["spinal_erectors", 0.5]]],
  ["db-rdl", "hinge_rdl", "per_implement", 0.5, [2, 0, 0, 0, 1], [0, 0, 0, 0, 0], "lengthened", 3, 7.6, 7.6, [["hams_hinge", 1.0], ["glutes_stretched", 1.0]]],
  ["legcurl-seated", "ham_knee_flex", "machine_stack", 0.15, [0, 0, 0, 1, 0], [0, 0, 0, 0, 0], "lengthened", 3, 9.3, 9.3, [["hams_knee_flexion", 1.0], ["hams_hinge", 0.5]]],
  ["legcurl-prone", "ham_knee_flex", "machine_stack", 0.15, [1, 0, 0, 1, 0], [0, 0, 0, 0, 0], "shortened", 1, 8.6, 8.6, [["hams_knee_flexion", 1.0]]],
  ["barbell-hip-thrust", "glute_short", "total_external", 0.5, [1, 0, 0, 0, 0], [0, 0, 0, 0, 0], "shortened", 1, 7.8, 7.8, [["glutes_shortened", 1.0], ["glutes_stretched", 0.5]]],
  ["glute-bridge", "glute_short", "total_external", 0.15, [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], "shortened", 1, 9.1, 9.1, [["glutes_shortened", 1.0]]],
  ["calf-standing", "calf_straight", "total_external", 0.5, [1, 0, 0, 1, 0], [0, 0, 0, 0, 0], "lengthened", 3, 8.3, 8.3, [["calves_gastroc", 1.0], ["calves_soleus", 0.5]]],
  ["calf-standing-machine", "calf_straight", "machine_stack", 0.5, [1, 0, 0, 0, 0], [0, 0, 0, 0, 0], "lengthened", 3, 8.7, 8.7, [["calves_gastroc", 1.0], ["calves_soleus", 0.5]]],
  ["calf-legpress", "calf_straight", "total_external", 0.15, [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], "lengthened", 3, 9.7, 9.7, [["calves_gastroc", 1.0], ["calves_soleus", 0.5]]],
  ["calf-seated", "calf_bent", "total_external", 0.15, [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], "lengthened", 1, 9.1, 9.1, [["calves_soleus", 1.0]]],
  ["crunch", "core_flex", "total_external", 0.15, [1, 0, 0, 0, 0], [0, 0, 0, 0, 0], "shortened", 1, 8.5, 8.5, [["core_abs", 1.0]]],
  ["crunch-incline-plate", "core_flex", "total_external", 0.15, [1, 0, 0, 0, 0], [0, 0, 0, 0, 0], "lengthened", 2, 8.8, 8.8, [["core_abs", 1.0]]],
  ["cable-crunch", "core_flex", "machine_stack", 0.15, [1, 0, 0, 0, 0], [0, 0, 0, 0, 0], "lengthened", 2, 9.0, 9.0, [["core_abs", 1.0]]],
  ["hanging-leg-raise", "core_flex", "total_external", 0.15, [1, 1, 0, 0, 1], [0, 0, 0, 0, 0], "lengthened", 2, 8.3, 8.3, [["core_abs", 1.0], ["quads_rectus_femoris", 0.5]]],
  ["ab-roller", "core_antiext", "total_external", 0.15, [2, 1, 0, 1, 1], [1, 0, 0, 0, 0], "lengthened", 3, 8.1, 7.3, [["core_abs", 1.0], ["lats", 0.5]]],
  ["woodchopper-cable", "core_rot", "machine_stack", 0.15, [1, 0, 0, 0, 0], [0, 0, 0, 0, 0], "flat", 2, 8.8, 8.8, [["core_abs", 1.0]]],
];

const catalogEntries: Record<string, ExerciseBiomechanicalProfile> = {};
for (const [id, family, loadMode, axial, risk, llDelta, profile, stretch, sfrBase, sfrLongLevers, regions] of RAW_PROFILES) {
  catalogEntries[id] = {
    id,
    family,
    loadMode,
    isBodyweight: BODYWEIGHT_IDS.has(id),
    axialLoadMultiplier: axial,
    risk: {
      lumbar: risk[0],
      shoulder_anterior: risk[1],
      elbow: risk[2],
      knee_patellar: risk[3],
      wrist: risk[4],
    },
    longLeverRiskDelta: {
      lumbar: llDelta[0],
      shoulder_anterior: llDelta[1],
      elbow: llDelta[2],
      knee_patellar: llDelta[3],
      wrist: llDelta[4],
    },
    resistanceProfile: profile,
    stretchScore: stretch,
    sfrBase,
    sfrLongLevers,
    regions: regions.map(([region, weight]) => ({ region, weight })),
  };
}

export const EXERCISE_PROFILES_V3: Readonly<Record<string, ExerciseBiomechanicalProfile>> = catalogEntries;
export const ALL_BIOMECH_PROFILES_V3: readonly ExerciseBiomechanicalProfile[] = Object.values(catalogEntries);
