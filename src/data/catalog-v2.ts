import {
  ANATOMICAL_MUSCLES,
  type AnatomicalMuscle,
  type Muscle,
} from "./muscles";
import type {
  Equipment,
  Exercise,
  MuscleRole,
  RecordingSpec,
} from "../lib/types";

// Release 2 is immutable once published. Corrections belong in catalog-v3.
const bar: RecordingSpec = {
  loadMode: "total_external",
  implementCount: 1,
  laterality: "bilateral",
  repsMode: "total",
  e1rmEligible: true,
};
const pair: RecordingSpec = {
  ...bar,
  loadMode: "per_implement",
  implementCount: 2,
};
const single: RecordingSpec = { ...pair, implementCount: 1 };
const oneSide: RecordingSpec = {
  ...single,
  laterality: "unilateral",
  repsMode: "per_side",
};
const machine: RecordingSpec = {
  ...bar,
  loadMode: "machine_stack",
  e1rmEligible: false,
};
const body: RecordingSpec = {
  ...bar,
  loadMode: "bodyweight",
  e1rmEligible: false,
};
const added: RecordingSpec = { ...body, loadMode: "added_bodyweight" };
const assisted: RecordingSpec = { ...body, loadMode: "assisted_bodyweight" };
const hamstrings: AnatomicalMuscle[] = [
  "biceps-femoris-long",
  "semitendinosus",
  "semimembranosus",
];
const flexors: AnatomicalMuscle[] = [
  "biceps-brachii",
  "brachialis",
  "brachioradialis",
];
const retractors: AnatomicalMuscle[] = ["trapezius-middle", "rhomboids"];
const trunk: AnatomicalMuscle[] = [
  "rectus-abdominis",
  "obliques",
  "erector-spinae",
];
type Definition = {
  id: string;
  name: string;
  nameEn: string;
  familyId: string;
  equipment: Equipment;
  recording: RecordingSpec;
  variant: string;
  jointActions: string[];
  primary: AnatomicalMuscle[];
  assistant?: AnatomicalMuscle[];
  stabilizer?: AnatomicalMuscle[];
  moderate?: AnatomicalMuscle[];
  evidence?: string[];
  tip: string;
  limitations?: string;
};
function entry(d: Definition): Exercise {
  const roles = (
    ids: AnatomicalMuscle[],
    role: MuscleRole["role"],
  ): MuscleRole[] =>
    ids.map((muscleId) => {
      const zone = ANATOMICAL_MUSCLES.find((m) => m.id === muscleId)!.zone;
      const source =
        muscleId === "erector-spinae"
          ? "anatomy-back"
          : zone === "core"
            ? "anatomy-trunk"
            : ["quads", "hamstrings", "glutes", "calves"].includes(zone)
              ? "anatomy-lower"
              : "anatomy-upper";
      return {
        muscleId,
        role,
        confidence: d.moderate?.includes(muscleId) ? "moderate" : "high",
        basis: "anatomical-inference",
        sources: [source],
      };
    });
  const muscles = [
    ...roles(d.primary, "primary"),
    ...roles(d.assistant ?? [], "assistant"),
    ...roles(d.stabilizer ?? [], "stabilizer"),
  ];
  const zones = (role: MuscleRole["role"]) =>
    [
      ...new Set(
        muscles
          .filter((m) => m.role === role)
          .map(
            (m) => ANATOMICAL_MUSCLES.find((x) => x.id === m.muscleId)!.zone,
          ),
      ),
    ] as Muscle[];
  return {
    id: d.id,
    name: d.name,
    nameEn: d.nameEn,
    familyId: d.familyId,
    catalogRevision: 2,
    equipment: d.equipment,
    recording: d.recording,
    bodyweight: [
      "bodyweight",
      "added_bodyweight",
      "assisted_bodyweight",
    ].includes(d.recording.loadMode),
    primary: zones("primary"),
    secondary: zones("assistant").filter((z) => !zones("primary").includes(z)),
    muscles,
    variant: d.variant,
    jointActions: d.jointActions,
    tip: d.tip,
    evidence: d.evidence ?? [],
    limitations:
      d.limitations ??
      "Роли — редакционный вывод из суставных функций. Доля нагрузки, рост и восстановление не измеряются; техника и амплитуда меняют участие.",
    provenance: {
      curator: "Tyaga editorial / AI-assisted, not clinician-certified",
      reviewedAt: "2026-10-07",
      license:
        "MIT — original Tyaga metadata; referenced sources retain their own licenses",
      reviewStatus: "editorial",
    },
  };
}

export const CATALOG_V2: Exercise[] = [
  entry({
    id: "bench",
    name: "Жим штанги лёжа",
    nameEn: "Barbell flat bench press",
    familyId: "bench-press",
    equipment: "gym",
    recording: bar,
    variant:
      "Горизонтальная скамья, прямой хват средней ширины; общий вес грифа и блинов.",
    jointActions: ["Горизонтальное приведение плеча", "Разгибание локтя"],
    primary: ["pectoralis-major", "triceps-brachii"],
    assistant: ["deltoid-anterior"],
    stabilizer: ["rhomboids", "infraspinatus"],
    evidence: ["bench-review"],
    tip: "Стопы на полу, лопатки устойчивы. Опускай штангу в контролируемой, комфортной амплитуде.",
  }),
  entry({
    id: "incline-db",
    name: "Жим гантелей на наклонной 30°",
    nameEn: "30-degree incline dumbbell press",
    familyId: "bench-press",
    equipment: "dumbbells",
    recording: pair,
    variant:
      "Скамья 30°, две гантели одновременно; вес одной гантели, один повтор обеими руками.",
    jointActions: ["Приведение и сгибание плеча", "Разгибание локтя"],
    primary: ["pectoralis-major", "triceps-brachii"],
    assistant: ["deltoid-anterior"],
    stabilizer: ["infraspinatus"],
    evidence: ["incline-emg"],
    tip: "Установи наклон 30°. Сохраняй контроль гантелей в нижней точке.",
    limitations:
      "Угол зафиксирован для новых записей. Исследование ЭМГ со штангой служит контекстом; оно не доказывает точное распределение нагрузки этого варианта с гантелями.",
  }),
  entry({
    id: "fly",
    name: "Сведение рук в кроссовере",
    nameEn: "Standing mid-height cable fly",
    familyId: "chest-fly",
    equipment: "gym",
    recording: { ...machine, implementCount: 2 },
    variant:
      "Два блока на уровне груди, локти слегка согнуты и почти неподвижны. Ввод — значение одного стека.",
    jointActions: ["Горизонтальное приведение плеча"],
    primary: ["pectoralis-major"],
    assistant: ["deltoid-anterior"],
    stabilizer: ["infraspinatus", "rectus-abdominis"],
    moderate: ["deltoid-anterior"],
    tip: "Своди руки без рывка и изменения угла локтя. Для сравнения записей используй тот же тренажёр.",
  }),
  entry({
    id: "pushup",
    name: "Отжимания от пола",
    nameEn: "Floor push-up",
    familyId: "push-up",
    equipment: "bodyweight",
    recording: added,
    variant:
      "Ладони и стопы на полу, корпус прямой; один повтор всего тела. Вес — только добавленное отягощение.",
    jointActions: [
      "Горизонтальное приведение плеча",
      "Разгибание локтя",
      "Протракция лопатки",
    ],
    primary: ["pectoralis-major", "triceps-brachii"],
    assistant: ["deltoid-anterior", "serratus-anterior"],
    stabilizer: trunk,
    tip: "Сохраняй прямую линию корпуса. Высокая опора для рук — другой вариант, не эта запись.",
  }),
  entry({
    id: "lat-pulldown",
    name: "Тяга верхнего блока",
    nameEn: "Pronated lat pulldown",
    familyId: "vertical-pull",
    equipment: "gym",
    recording: machine,
    variant:
      "Прямой хват немного шире плеч, тяга перед собой к верху груди; значение стека конкретного блока.",
    jointActions: ["Приведение плеча", "Сгибание локтя"],
    primary: ["latissimus-dorsi", "teres-major"],
    assistant: [...flexors, "trapezius-lower"],
    stabilizer: ["infraspinatus"],
    moderate: ["trapezius-lower"],
    tip: "Тяни локти вниз без резкого отклонения корпуса. Укажи тренажёр для сравнения веса.",
  }),
  entry({
    id: "row",
    name: "Тяга горизонтального блока",
    nameEn: "Seated close-neutral cable row",
    familyId: "horizontal-row",
    equipment: "gym",
    recording: machine,
    variant:
      "Сидя, узкий нейтральный хват, локти близко к корпусу; значение одного стека.",
    jointActions: ["Разгибание плеча", "Ретракция лопатки", "Сгибание локтя"],
    primary: ["latissimus-dorsi", ...retractors],
    assistant: [...flexors, "teres-major", "deltoid-posterior"],
    stabilizer: ["erector-spinae"],
    tip: "Удерживай корпус устойчивым. Не превращай повтор в раскачивание.",
  }),
  entry({
    id: "db-row",
    name: "Тяга гантели одной рукой с опорой",
    nameEn: "Supported one-arm dumbbell row",
    familyId: "horizontal-row",
    equipment: "dumbbells",
    recording: oneSide,
    variant:
      "Опора свободной рукой, локоть близко к корпусу. Вес одной гантели, повторы на сторону; стороны записываются явно.",
    jointActions: ["Разгибание плеча", "Ретракция лопатки", "Сгибание локтя"],
    primary: ["latissimus-dorsi", ...retractors],
    assistant: [...flexors, "deltoid-posterior", "teres-major"],
    stabilizer: ["erector-spinae", "obliques"],
    tip: "Упрись свободной рукой. Сохраняй корпус без вращения; обе стороны — один парный подход.",
  }),
  entry({
    id: "pullup",
    name: "Подтягивания прямым хватом",
    nameEn: "Pronated bodyweight pull-up",
    familyId: "vertical-pull",
    equipment: "gym",
    recording: body,
    variant:
      "Прямой хват примерно на ширине плеч; без дополнительного веса и помощи.",
    jointActions: ["Приведение и разгибание плеча", "Сгибание локтя"],
    primary: ["latissimus-dorsi", "teres-major"],
    assistant: [...flexors, "trapezius-lower"],
    stabilizer: ["infraspinatus", "rectus-abdominis"],
    moderate: ["trapezius-lower"],
    tip: "Начинай без раскачки. Для дополнительного груза или помощи выбери отдельный вариант.",
  }),
  entry({
    id: "pullup-weighted",
    name: "Подтягивания с дополнительным весом",
    nameEn: "Weighted pronated pull-up",
    familyId: "vertical-pull",
    equipment: "gym",
    recording: added,
    variant:
      "Прямой хват; ввод — только дополнительный груз. Массу тела можно записать отдельно.",
    jointActions: ["Приведение и разгибание плеча", "Сгибание локтя"],
    primary: ["latissimus-dorsi", "teres-major"],
    assistant: flexors,
    stabilizer: ["rectus-abdominis"],
    tip: "Закрепи груз устойчиво. Дополнительный вес не является полной нагрузкой системы «тело + груз».",
  }),
  entry({
    id: "pullup-assisted",
    name: "Подтягивания с помощью тренажёра",
    nameEn: "Assisted machine pull-up",
    familyId: "vertical-pull",
    equipment: "gym",
    recording: assisted,
    variant:
      "Прямой хват, колени на опоре ассистирующего тренажёра. Ввод — положительное значение помощи на стеке.",
    jointActions: ["Приведение и разгибание плеча", "Сгибание локтя"],
    primary: ["latissimus-dorsi", "teres-major"],
    assistant: flexors,
    stabilizer: ["rectus-abdominis"],
    tip: "Больше помощи означает меньше сопротивления. Не записывай помощь как отрицательное отягощение.",
  }),
  entry({
    id: "ohp",
    name: "Жим гантелей сидя",
    nameEn: "Seated dumbbell overhead press",
    familyId: "overhead-press",
    equipment: "dumbbells",
    recording: pair,
    variant:
      "Спинка примерно 85°, две гантели одновременно. Вес одной гантели.",
    jointActions: [
      "Подъём плеча",
      "Разгибание локтя",
      "Вращение лопатки вверх",
    ],
    primary: ["deltoid-anterior", "deltoid-middle", "triceps-brachii"],
    assistant: ["serratus-anterior", "trapezius-upper", "trapezius-lower"],
    stabilizer: ["infraspinatus", "rectus-abdominis"],
    tip: "Не усиливай прогиб поясницы. Поднимай гантели по комфортной траектории.",
  }),
  entry({
    id: "lateral",
    name: "Махи гантелями в стороны",
    nameEn: "Bilateral dumbbell lateral raise",
    familyId: "shoulder-abduction",
    equipment: "dumbbells",
    recording: { ...pair, e1rmEligible: false },
    variant:
      "Обе руки одновременно, слегка согнутые локти, нейтральное положение плеча. Вес одной гантели.",
    jointActions: ["Отведение плеча", "Вращение лопатки вверх"],
    primary: ["deltoid-middle"],
    assistant: ["supraspinatus", "trapezius-upper", "serratus-anterior"],
    stabilizer: ["infraspinatus"],
    tip: "Поднимай руки без раскачки в комфортной амплитуде. Передняя и задняя дельты не получают прямой зачёт этого движения.",
  }),
  entry({
    id: "facepull-er",
    name: "Тяга каната к лицу с наружным вращением",
    nameEn: "Face pull with external rotation",
    familyId: "face-pull",
    equipment: "gym",
    recording: machine,
    variant:
      "Блок примерно на уровне лица; тяга каната с ретракцией лопаток и наружным вращением плеча.",
    jointActions: [
      "Горизонтальное отведение плеча",
      "Наружное вращение плеча",
      "Ретракция лопатки",
    ],
    primary: [
      "deltoid-posterior",
      ...retractors,
      "infraspinatus",
      "teres-minor",
    ],
    assistant: ["trapezius-lower", ...flexors],
    stabilizer: ["rectus-abdominis"],
    moderate: ["trapezius-lower", "infraspinatus", "teres-minor"],
    tip: "Умеренный вес, контролируемое наружное вращение. Не смешивай с тягой каната без вращения.",
    limitations:
      "Точная техника определяет роль наружных ротаторов. Разметка — анатомический вывод; прямое исследование этого канонического варианта не найдено.",
  }),
  entry({
    id: "curl",
    name: "Сгибание рук с гантелями",
    nameEn: "Simultaneous supinated dumbbell curl",
    familyId: "elbow-flexion",
    equipment: "dumbbells",
    recording: pair,
    variant:
      "Стоя, ладони вверх, две руки одновременно; один повтор обеими руками, вес одной гантели.",
    jointActions: ["Сгибание локтя"],
    primary: ["biceps-brachii", "brachialis"],
    assistant: ["brachioradialis"],
    stabilizer: ["rectus-abdominis"],
    tip: "Локти устойчивы. Не помогай корпусом; чередование рук требует другого правила повторов.",
  }),
  entry({
    id: "hammer",
    name: "Молотковые сгибания",
    nameEn: "Simultaneous neutral-grip dumbbell curl",
    familyId: "elbow-flexion",
    equipment: "dumbbells",
    recording: pair,
    variant: "Нейтральный хват, две руки одновременно; вес одной гантели.",
    jointActions: ["Сгибание локтя"],
    primary: flexors,
    stabilizer: ["rectus-abdominis"],
    tip: "Держи нейтральный хват и контролируй опускание. Доли работы трёх сгибателей не задаются процентами.",
  }),
  entry({
    id: "triceps-push",
    name: "Разгибание рук на блоке",
    nameEn: "Bilateral cable triceps pushdown",
    familyId: "elbow-extension",
    equipment: "gym",
    recording: machine,
    variant: "Стоя, локти у корпуса, прямая рукоять, обе руки; значение стека.",
    jointActions: ["Разгибание локтя"],
    primary: ["triceps-brachii"],
    stabilizer: ["rectus-abdominis"],
    tip: "Удерживай плечи и локти устойчивыми. Не меняй тренажёр внутри одной серии сравнения веса.",
  }),
  entry({
    id: "triceps-db",
    name: "Разгибание гантели из-за головы",
    nameEn: "Two-hand single-dumbbell overhead triceps extension",
    familyId: "elbow-extension",
    equipment: "dumbbells",
    recording: { ...single, e1rmEligible: false },
    variant:
      "Сидя, одна гантель в двух руках, плечи над головой; ввод — вес этой одной гантели.",
    jointActions: ["Разгибание локтя"],
    primary: ["triceps-brachii"],
    stabilizer: ["rectus-abdominis"],
    evidence: ["overhead-triceps"],
    tip: "Работай в комфортной амплитуде. Одна гантель в двух руках не считается парой гантелей.",
  }),
  entry({
    id: "squat",
    name: "Приседания со штангой",
    nameEn: "High-bar back squat",
    familyId: "squat",
    equipment: "gym",
    recording: bar,
    variant:
      "Штанга высоко на спине, стопы примерно на ширине плеч; комфортная глубина записывается в заметках.",
    jointActions: ["Разгибание колена", "Разгибание бедра"],
    primary: ["quadriceps-vasti", "gluteus-maximus"],
    assistant: ["adductor-magnus"],
    stabilizer: [...trunk, ...hamstrings],
    moderate: ["adductor-magnus", ...hamstrings],
    evidence: ["squat-depth"],
    tip: "Стой устойчиво; колени следуют за носками. Вес — гриф плюс все блины.",
    limitations:
      "Глубина меняет распределение работы. Прямая бедра не получает такой же прямой зачёт, как широкие мышцы; задняя группа и корпус отображаются как стабилизаторы, без автоматического объёма.",
  }),
  entry({
    id: "legpress",
    name: "Жим ногами",
    nameEn: "Bilateral seated leg press",
    familyId: "squat",
    equipment: "gym",
    recording: machine,
    variant:
      "Сидя в тренажёре, обе ноги; записывай отображаемое значение или вес блинов и идентификатор машины.",
    jointActions: ["Разгибание колена", "Разгибание бедра"],
    primary: ["quadriceps-vasti"],
    assistant: ["gluteus-maximus", "adductor-magnus"],
    moderate: ["gluteus-maximus", "adductor-magnus"],
    tip: "Не отрывай таз от спинки. Машина и амплитуда важнее условного сравнения килограммов между разными тренажёрами.",
  }),
  entry({
    id: "goblet",
    name: "Гоблет-присед",
    nameEn: "Single-dumbbell goblet squat",
    familyId: "squat",
    equipment: "dumbbells",
    recording: single,
    variant: "Одна гантель у груди, двусторонний присед в комфортной глубине.",
    jointActions: ["Разгибание колена", "Разгибание бедра"],
    primary: ["quadriceps-vasti", "gluteus-maximus"],
    assistant: ["adductor-magnus"],
    stabilizer: trunk,
    moderate: ["adductor-magnus"],
    tip: "Держи одну гантель у груди. Корпус удерживает положение, но это не прямой подход на пресс.",
  }),
  entry({
    id: "lunge-reverse",
    name: "Выпады назад с гантелями",
    nameEn: "Dumbbell reverse lunge",
    familyId: "lunge",
    equipment: "dumbbells",
    recording: { ...oneSide, implementCount: 2 },
    variant:
      "Шаг назад, корпус близок к вертикали, две гантели. Вес одной гантели, повторы на сторону.",
    jointActions: ["Разгибание колена", "Разгибание бедра"],
    primary: ["quadriceps-vasti", "gluteus-maximus"],
    assistant: ["adductor-magnus"],
    stabilizer: ["gluteus-medius", ...hamstrings, ...trunk],
    moderate: ["adductor-magnus", ...hamstrings],
    tip: "Записывай повторы на сторону и выбранные стороны. Сохраняй устойчивую опору.",
    limitations:
      "Длина шага и наклон корпуса меняют механику. Передний, статический и шагающий выпад не считаются этим вариантом.",
  }),
  entry({
    id: "body-squat",
    name: "Приседания без веса",
    nameEn: "Bilateral bodyweight squat",
    familyId: "squat",
    equipment: "bodyweight",
    recording: body,
    variant: "Обе ноги, без внешнего отягощения; комфортная глубина.",
    jointActions: ["Разгибание колена", "Разгибание бедра"],
    primary: ["quadriceps-vasti", "gluteus-maximus"],
    stabilizer: trunk,
    tip: "Контролируй темп и положение стоп. Сложность подхода записывается RIR, без коэффициента «стимула роста».",
  }),
  entry({
    id: "rdl",
    name: "Румынская тяга со штангой",
    nameEn: "Barbell Romanian deadlift",
    familyId: "hip-hinge",
    equipment: "gym",
    recording: bar,
    variant:
      "Штанга, обе ноги, небольшое почти постоянное сгибание коленей, движение в тазобедренных суставах.",
    jointActions: ["Разгибание бедра"],
    primary: [...hamstrings, "gluteus-maximus"],
    assistant: ["adductor-magnus"],
    stabilizer: ["erector-spinae", "rectus-abdominis", "obliques"],
    moderate: ["adductor-magnus"],
    evidence: ["deadlift-review"],
    tip: "Уводи таз назад, держи штангу близко. Выпрямители спины удерживают корпус и не добавляются в прямой объём спины.",
  }),
  entry({
    id: "db-rdl",
    name: "Румынская тяга с гантелями",
    nameEn: "Bilateral dumbbell Romanian deadlift",
    familyId: "hip-hinge",
    equipment: "dumbbells",
    recording: pair,
    variant:
      "Две гантели, обе ноги; вес одной гантели, один повтор всего движения.",
    jointActions: ["Разгибание бедра"],
    primary: [...hamstrings, "gluteus-maximus"],
    assistant: ["adductor-magnus"],
    stabilizer: trunk,
    moderate: ["adductor-magnus"],
    evidence: ["deadlift-review"],
    tip: "Гантели близко к ногам. Удержание спины отображается как стабилизация.",
  }),
  entry({
    id: "legcurl-seated",
    name: "Сгибание ног сидя",
    nameEn: "Seated bilateral leg curl",
    familyId: "knee-flexion",
    equipment: "gym",
    recording: machine,
    variant: "Сидячий тренажёр, бедро согнуто, обе ноги; значение стека.",
    jointActions: ["Сгибание колена"],
    primary: [...hamstrings, "biceps-femoris-short"],
    assistant: ["gastrocnemius"],
    moderate: ["gastrocnemius"],
    evidence: ["legcurl-length"],
    tip: "Настрой ось тренажёра под колени. Сидячий и лежачий варианты сохраняются раздельно.",
  }),
  entry({
    id: "legcurl-prone",
    name: "Сгибание ног лёжа",
    nameEn: "Prone bilateral leg curl",
    familyId: "knee-flexion",
    equipment: "gym",
    recording: machine,
    variant:
      "Лёжа на животе, бедро близко к разогнутому положению, обе ноги; значение стека.",
    jointActions: ["Сгибание колена"],
    primary: [...hamstrings, "biceps-femoris-short"],
    assistant: ["gastrocnemius"],
    moderate: ["gastrocnemius"],
    evidence: ["legcurl-length"],
    tip: "Таз остаётся на опоре. Сравнивай вес внутри того же тренажёра и варианта.",
  }),
  entry({
    id: "glute-bridge",
    name: "Ягодичный мост на полу",
    nameEn: "Bodyweight floor glute bridge",
    familyId: "hip-extension",
    equipment: "bodyweight",
    recording: body,
    variant:
      "Плечи на полу, обе ноги, без внешнего веса. Это не hip thrust со скамьёй.",
    jointActions: ["Разгибание бедра"],
    primary: ["gluteus-maximus"],
    assistant: hamstrings,
    stabilizer: ["rectus-abdominis", "obliques"],
    moderate: hamstrings,
    tip: "Поднимай таз без избыточного прогиба. Положение стоп меняет участие задней группы бедра.",
  }),
  entry({
    id: "barbell-hip-thrust",
    name: "Хип-траст со штангой",
    nameEn: "Barbell bench-supported hip thrust",
    familyId: "hip-extension",
    equipment: "gym",
    recording: bar,
    variant:
      "Плечи на скамье, обе ноги, штанга на тазу; полный вес грифа и блинов.",
    jointActions: ["Разгибание бедра"],
    primary: ["gluteus-maximus"],
    assistant: ["adductor-magnus", ...hamstrings],
    stabilizer: ["rectus-abdominis", "obliques"],
    moderate: ["adductor-magnus", ...hamstrings],
    evidence: ["hipthrust-study"],
    tip: "Устойчивая скамья и защита под штангой. Завершай разгибанием бедра, не поясницы.",
  }),
  entry({
    id: "calf-standing",
    name: "Подъём на носки стоя без веса",
    nameEn: "Bilateral standing bodyweight calf raise",
    familyId: "plantarflexion",
    equipment: "bodyweight",
    recording: body,
    variant: "Обе ноги, колени почти прямые, без внешнего веса.",
    jointActions: ["Подошвенное сгибание голеностопа"],
    primary: ["gastrocnemius", "soleus"],
    evidence: ["calf-position"],
    tip: "Полная комфортная амплитуда, без пружинящих рывков. Исследование с нагрузкой — контекст, не измерение этого подхода.",
  }),
  entry({
    id: "calf-seated",
    name: "Подъём на носки сидя в тренажёре",
    nameEn: "Seated machine calf raise",
    familyId: "plantarflexion",
    equipment: "gym",
    recording: machine,
    variant:
      "Колени примерно 90°, обе ноги; отображаемое значение или блины конкретного тренажёра.",
    jointActions: ["Подошвенное сгибание голеностопа"],
    primary: ["soleus"],
    assistant: ["gastrocnemius"],
    moderate: ["gastrocnemius"],
    evidence: ["calf-position"],
    tip: "Сохраняй согнутые колени и контролируемый темп. Этот вариант не заменяет запись подъёма стоя.",
  }),
  entry({
    id: "crunch",
    name: "Скручивания",
    nameEn: "Floor abdominal crunch",
    familyId: "trunk-flexion",
    equipment: "bodyweight",
    recording: body,
    variant:
      "На полу, колени согнуты, стопы не закреплены; поднимается верх спины, не полный подъём корпуса.",
    jointActions: ["Сгибание позвоночника"],
    primary: ["rectus-abdominis"],
    assistant: ["obliques"],
    moderate: ["obliques"],
    tip: "Не тяни голову руками. Все мышцы корпуса не получают одинакового прямого зачёта.",
  }),
];
