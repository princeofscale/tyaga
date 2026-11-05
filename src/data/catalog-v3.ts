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

// Release 3 is ADDITIVE. It only adds movements that the five-day upper/lower
// programme needs and that the 31 entries of release 2 do not cover. Release 2
// (catalog-v2.ts) stays frozen: "Release 2 is immutable once published.
// Corrections belong in catalog-v3." — which means v3 is the right place for
// NEW curated ids, not for rewriting v2 records. No v2 id is redefined here.
//
// Everything below is editorial: muscle roles are an anatomical inference from
// joint function, not measured shares, EMG percentages or 1RM values, and no
// entry claims review by a clinician or coach. Every limitation states what this
// record cannot tell you.
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
// One recording for ONE-ARM cable/machine work: the single implement and per-side
// reps of `oneSide`, but with the stack load mode of `machine`. A cable handle is
// a machine stack, not a dumbbell, so it must not be labelled "кг одной гантели"
// or produce a 1RM estimate — same rule every cable entry of release 2 follows.
const oneSideStack: RecordingSpec = {
  ...machine,
  implementCount: 1,
  laterality: "unilateral",
  repsMode: "per_side",
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
    catalogRevision: 3,
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
      curator: "Tyaga v3",
      reviewedAt: null,
      license: "MIT",
      reviewStatus: "editorial",
    },
  };
}

export const CATALOG_V3: Exercise[] = [
  entry({
    id: "incline-bar",
    name: "Жим штанги на наклонной скамье 30°",
    nameEn: "30-degree incline barbell bench press",
    familyId: "bench-press",
    equipment: "gym",
    recording: bar,
    variant:
      "Скамья 30°, штанга, общий вес грифа и блинов; отдельная запись от жима гантелей на наклонной.",
    jointActions: [
      "Сгибание и горизонтальное приведение плеча",
      "Разгибание локтя",
      "Вращение лопатки вверх",
    ],
    primary: ["pectoralis-major", "triceps-brachii"],
    assistant: ["deltoid-anterior"],
    stabilizer: ["rhomboids", "infraspinatus"],
    evidence: ["incline-emg"],
    tip: "Фиксируй наклон 30°. В нижней точке не позволяй плечам уходить вперёд.",
    limitations:
      "Наклон зафиксирован: 30° — это один вариант, жим под другим углом сюда не записывается. Исследование зависимости ЭМГ от угла скамьи проверено только по метаданным и не устанавливает распределение нагрузки этого варианта.",
  }),
  entry({
    id: "flat-db-press",
    name: "Жим гантелей лёжа на горизонтальной скамье",
    nameEn: "Flat dumbbell bench press",
    familyId: "bench-press",
    equipment: "dumbbells",
    recording: pair,
    variant:
      "Горизонтальная скамья, две гантели одновременно; вес одной гантели, один повтор обеими руками.",
    jointActions: ["Горизонтальное приведение плеча", "Разгибание локтя"],
    primary: ["pectoralis-major", "triceps-brachii"],
    assistant: ["deltoid-anterior"],
    stabilizer: ["infraspinatus"],
    evidence: ["bench-review"],
    tip: "Лопатки сведены, гантели опускаются в комфортную глубину. Вес — одной гантели, не суммы.",
    limitations:
      "Обзор ЭМГ относится к жиму штанги; для гантелей это контекст, а не измерение этого варианта. Свободные гантели требуют большего контроля траектории, чем гриф, но из этого не следует другой коэффициент нагрузки.",
  }),
  entry({
    id: "high-cable-fly",
    name: "Сведение в кроссовере с верхних блоков",
    nameEn: "High-to-low standing cable fly",
    familyId: "chest-fly",
    equipment: "gym",
    recording: { ...machine, implementCount: 2 },
    variant:
      "Оба блока выше плеч, руки сводятся сверху вниз; ввод — значение одного стека, как у кроссовера из выпуска 2.",
    jointActions: ["Горизонтальное приведение плеча"],
    primary: ["pectoralis-major"],
    assistant: ["deltoid-anterior"],
    stabilizer: ["infraspinatus", "rectus-abdominis"],
    moderate: ["deltoid-anterior"],
    tip: "Держи угол локтя постоянным и не меняй высоту блоков внутри сравнения весов.",
    limitations:
      "Высота блоков и наклон корпуса меняют момент по амплитуде, поэтому сравнимы только записи с одинаковой настройкой. Доля волокон грудной не измерялась; верхний и средний блоки — разные записи, а не прогрессия одной.",
  }),
  entry({
    id: "pulldown-reverse",
    name: "Тяга верхнего блока обратным хватом",
    nameEn: "Supinated-grip lat pulldown",
    familyId: "vertical-pull",
    equipment: "gym",
    recording: machine,
    variant:
      "Обратный (супинированный) хват примерно на ширине плеч, тяга перед собой; отдельная запись от прямого хвата.",
    jointActions: ["Приведение плеча", "Сгибание локтя"],
    primary: ["latissimus-dorsi", "teres-major"],
    assistant: [...flexors, "trapezius-lower"],
    stabilizer: ["infraspinatus"],
    moderate: ["trapezius-lower"],
    tip: "Начинай повтор с опускания лопаток, а не с рывка руками. Кисть не заваливай.",
    limitations:
      "Супинированный хват повышает требования к сгибателям локтя и к подвижности плеча и предплечья, поэтому при дискомфорте это не «та же тяга». Веса прямого и обратного хвата не сравниваются между собой.",
  }),
  entry({
    id: "row-v-grip",
    name: "Тяга горизонтального блока с узкой V-рукоятью",
    nameEn: "Close neutral-grip seated cable row",
    familyId: "horizontal-row",
    equipment: "gym",
    recording: machine,
    variant:
      "Сидя, тяга к поясу за узкую V-рукоять (нейтральный хват), локти близко к корпусу; значение одного стека.",
    jointActions: ["Разгибание плеча", "Ретракция лопатки", "Сгибание локтя"],
    primary: ["latissimus-dorsi", ...retractors],
    assistant: [...flexors, "teres-major", "deltoid-posterior"],
    stabilizer: ["erector-spinae"],
    tip: "Тяни рукоять к поясу, корпус держи неподвижным. Рывок делает повтор другим.",
    limitations:
      "Механика совпадает с записью «row» выпуска 2: различие только в конкретной V-рукояти. Это не два разных движения — не сравнивай их веса как разные упражнения и не суммируй объём дважды.",
  }),
  entry({
    id: "row-single-cable",
    name: "Тяга блока одной рукой сидя",
    nameEn: "Single-arm seated cable row",
    familyId: "horizontal-row",
    equipment: "gym",
    recording: oneSideStack,
    variant:
      "Одна рука, один блок, тяга к поясу сидя; вес одного стека, повторы на сторону, стороны записываются явно.",
    jointActions: ["Разгибание плеча", "Ретракция лопатки", "Сгибание локтя"],
    primary: ["latissimus-dorsi", ...retractors],
    assistant: [...flexors, "teres-major", "deltoid-posterior"],
    stabilizer: ["erector-spinae", "obliques"],
    tip: "Не разворачивай корпус: разворот плеча превращает повтор в тягу другого вида.",
    limitations:
      "Односторонняя запись: вес — значение одного стека, повторы на сторону. Удержание корпуса от разворота реально, но прямого подхода на косые не заменяет.",
  }),
  entry({
    id: "pullover-cable",
    name: "Пуловер на верхнем блоке",
    nameEn: "Standing cable straight-arm pullover",
    familyId: "pullover",
    equipment: "gym",
    recording: machine,
    variant:
      "Стоя, рукоять на верхнем блоке, руки почти прямые, движение только в плечевом суставе; значение стека.",
    jointActions: ["Разгибание плеча", "Приведение плеча"],
    primary: ["latissimus-dorsi", "teres-major"],
    assistant: ["deltoid-posterior"],
    stabilizer: ["rectus-abdominis", "obliques"],
    moderate: ["deltoid-posterior"],
    tip: "Держи локти почти прямыми. Сгибание рук превращает повтор в тягу.",
    limitations:
      "Длинная головка трёхглавой тоже разгибает плечо, но каталог не делит её на головки, поэтому её помощь здесь не отмечена. Раскачка корпусом переносит работу с плеча на спину и делает вес несравнимым.",
  }),
  entry({
    id: "shrug-bar",
    name: "Шраги со штангой",
    nameEn: "Barbell shrug",
    familyId: "shrug",
    equipment: "gym",
    recording: bar,
    variant:
      "Стоя, штанга в опущенных руках, подъём плеч вверх без вращения; общий вес грифа и блинов.",
    jointActions: ["Подъём лопатки"],
    primary: ["trapezius-upper"],
    assistant: [...retractors],
    stabilizer: ["erector-spinae"],
    moderate: ["trapezius-middle", "rhomboids"],
    tip: "Поднимай плечи вверх, а не назад. Локти не сгибай — иначе часть нагрузки уходит с трапеции.",
    limitations:
      "Ремень или очень большой вес сокращают амплитуду, а рывок корпусом делает вес несравнимым между сериями. Доля верхней и средней трапеции не измерялась; средняя и ромбовидные отмечены с умеренной уверенностью.",
  }),
  entry({
    id: "shrug-db-incline",
    name: "Шраги с гантелями с наклоном 10°",
    nameEn: "Slight-incline dumbbell shrug",
    familyId: "shrug",
    equipment: "dumbbells",
    recording: pair,
    variant:
      "Корпус опирается на скамью с наклоном около 10°, две гантели; вес одной гантели.",
    jointActions: ["Подъём лопатки"],
    primary: ["trapezius-upper"],
    assistant: [...retractors],
    stabilizer: ["erector-spinae"],
    moderate: ["trapezius-middle", "rhomboids"],
    tip: "Опора корпусом убирает раскачку. Не подтягивай гантели к ушам.",
    limitations:
      "Опора снимает помощь ног и спины, поэтому веса не сравниваются со стоячим вариантом. Наклон 10° зафиксирован для новых записей: другая скамья — другой вариант.",
  }),
  entry({
    id: "rear-delt-fly",
    name: "Обратные разведения на заднюю дельту",
    nameEn: "Rear-delt fly on pec-deck or incline bench",
    familyId: "reverse-fly",
    equipment: "gym",
    recording: machine,
    variant:
      "Обратные разведения на тренажёре-пек-деке; здесь записывается вариант на тренажёре — значение стека.",
    jointActions: ["Горизонтальное отведение плеча", "Ретракция лопатки"],
    primary: ["deltoid-posterior"],
    assistant: [...retractors, "infraspinatus", "teres-minor"],
    moderate: ["trapezius-middle", "rhomboids", "infraspinatus", "teres-minor"],
    tip: "Веди движение локтями, а не кистями. Не своди лопатки раньше дельты.",
    limitations:
      "Запись соответствует тренажёру: вариант с гантелями на наклонной скамье имеет другое правило веса (вес одной гантели) и под этим id не записывается. Роль наружных ротаторов — анатомический вывод, а не измерение.",
  }),
  entry({
    id: "curl-preacher-ez",
    name: "Сгибания с EZ-штангой на скамье Скотта",
    nameEn: "EZ-bar preacher curl",
    familyId: "elbow-flexion",
    equipment: "gym",
    recording: bar,
    variant:
      "Скамья Скотта, EZ-гриф, плечо лежит на подушке; общий вес грифа и блинов.",
    jointActions: ["Сгибание локтя"],
    primary: ["biceps-brachii", "brachialis"],
    assistant: ["brachioradialis"],
    tip: "Не разгибай локоть до дискомфорта в нижней точке. Плечо остаётся на подушке.",
    limitations:
      "Подушка фиксирует плечо в согнутом положении, поэтому длинная головка двуглавой работает в укороченном положении — из этого не следует, что вариант «хуже». Хват EZ-грифа не равен прямому грифу, и веса между ними не сравниваются.",
  }),
  entry({
    id: "curl-incline-db",
    name: "Сгибания с гантелями сидя на наклонной",
    nameEn: "Incline-bench dumbbell curl",
    familyId: "elbow-flexion",
    equipment: "dumbbells",
    recording: pair,
    variant:
      "Сидя на наклонной скамье, руки свисают позади корпуса, две гантели; вес одной гантели.",
    jointActions: ["Сгибание локтя"],
    primary: ["biceps-brachii", "brachialis"],
    assistant: ["brachioradialis"],
    tip: "Не выводи локти вперёд, чтобы дожать повтор. Начинай из комфортного полного разгибания.",
    limitations:
      "Угол скамьи задаёт длину двуглавой в нижней точке, но конкретный наклон в записи не фиксируется и не измерялся. Записывается один повтор обеими руками; чередование рук потребовало бы другого правила.",
  }),
  entry({
    id: "curl-bar",
    name: "Подъём штанги на бицепс стоя",
    nameEn: "Standing barbell curl",
    familyId: "elbow-flexion",
    equipment: "gym",
    recording: bar,
    variant:
      "Стоя, прямой гриф, ладони вверх, ширина хвата задана грифом; общий вес грифа и блинов.",
    jointActions: ["Сгибание локтя"],
    primary: ["biceps-brachii", "brachialis"],
    assistant: ["brachioradialis"],
    stabilizer: ["rectus-abdominis"],
    tip: "Локти почти неподвижны. Отклон корпуса назад превращает повтор в другое движение.",
    limitations:
      "Прямой гриф задаёт фиксированную ширину хвата, поэтому при дискомфорте в запястьях это не тот же вариант, что EZ. Помощь корпусом и рывок делают вес несравнимым между сериями.",
  }),
  entry({
    id: "curl-reverse-ez",
    name: "Обратные сгибания с EZ-штангой",
    nameEn: "Prone-grip EZ-bar reverse curl",
    familyId: "elbow-flexion",
    equipment: "gym",
    recording: bar,
    variant:
      "EZ-гриф, ладони вниз (пронированный хват), стоя; общий вес грифа и блинов.",
    jointActions: ["Сгибание локтя"],
    primary: ["brachioradialis", "brachialis"],
    assistant: ["biceps-brachii"],
    stabilizer: ["rectus-abdominis"],
    tip: "Хват чуть уже обычного, кисть не заваливай. Меньший вес, чем в прямом подъёме, — ожидаем.",
    limitations:
      "Разгибателей запястья и пальцев в модели каталога нет, поэтому их участие здесь не учитывается: плечелучевая — единственный доступный идентификатор этой работы. Доли трёх сгибателей не задаются процентами.",
  }),
  entry({
    id: "skullcrusher-ez",
    name: "Французский жим с EZ-штангой лёжа на наклонной",
    nameEn: "Incline EZ-bar skull crusher",
    familyId: "elbow-extension",
    equipment: "gym",
    recording: bar,
    variant:
      "Лёжа на наклонной скамье, EZ-гриф над головой, движение только в локтях; общий вес грифа и блинов.",
    jointActions: ["Разгибание локтя"],
    primary: ["triceps-brachii"],
    evidence: ["overhead-triceps"],
    tip: "Плечи неподвижны, работает только локоть. Опускай гриф в комфортной амплитуде.",
    limitations:
      "Сравнение положений плеча проверено только по метаданным и выполнено на блоке, а не с EZ-грифом на наклонной скамье; переносить его результат на этот вариант нельзя. Наклон скамьи меняет длину трёхглавой — фиксируй угол.",
  }),
  entry({
    id: "extension-overhead-cable",
    name: "Разгибания с канатом из-за головы на блоке",
    nameEn: "Overhead rope triceps extension",
    familyId: "elbow-extension",
    equipment: "gym",
    recording: machine,
    variant:
      "Стоя спиной к верхнему блоку, канат, плечи подняты над головой; значение стека.",
    jointActions: ["Разгибание локтя"],
    primary: ["triceps-brachii"],
    stabilizer: ["rectus-abdominis", "erector-spinae"],
    evidence: ["overhead-triceps"],
    tip: "Держи локти рядом с головой и не разводи их в стороны. Корпус не прогибай.",
    limitations:
      "Исследование положения плеча проверено по метаданным; его протокол и настройки блока не переносятся на этот вариант. Доля головок трёхглавой записью не измеряется.",
  }),
  entry({
    id: "extension-v-pushdown",
    name: "Разгибания на верхнем блоке с V-рукоятью",
    nameEn: "V-bar triceps pushdown",
    familyId: "elbow-extension",
    equipment: "gym",
    recording: machine,
    variant:
      "Стоя, V-рукоять на верхнем блоке, локти у корпуса, обе руки; значение стека.",
    jointActions: ["Разгибание локтя"],
    primary: ["triceps-brachii"],
    stabilizer: ["rectus-abdominis"],
    tip: "Не наклоняйся вперёд, чтобы дожать. Локти остаются на одном месте.",
    limitations:
      "Механика та же, что у записи «triceps-push» выпуска 2; различие — V-рукоять против прямой. Веса двух записей не сравнивай как разные движения, а объём не суммируй дважды.",
  }),
  entry({
    id: "shoulder-press-machine",
    name: "Жим в тренажёре сидя на дельты",
    nameEn: "Seated machine shoulder press",
    familyId: "overhead-press",
    equipment: "gym",
    recording: machine,
    variant:
      "Сидя в тренажёре со спинкой, обе руки движутся по заданной траектории; отображаемое значение стека.",
    jointActions: [
      "Подъём плеча",
      "Разгибание локтя",
      "Вращение лопатки вверх",
    ],
    primary: ["deltoid-anterior", "deltoid-middle", "triceps-brachii"],
    assistant: ["serratus-anterior", "trapezius-upper", "trapezius-lower"],
    stabilizer: ["infraspinatus"],
    moderate: ["trapezius-lower"],
    tip: "Настрой сиденье под уровень плеч. Не выжимай через дискомфорт в плече.",
    limitations:
      "Тренажёр задаёт траекторию, поэтому килограммы стека не сравниваются с гантелями или штангой: другая машина — другие цифры. Запись не различает настройку сиденья и хвата.",
  }),
  entry({
    id: "lateral-cable-single",
    name: "Махи в сторону в кроссовере одной рукой",
    nameEn: "Single-arm low-pulley lateral raise",
    familyId: "shoulder-abduction",
    equipment: "gym",
    recording: oneSideStack,
    variant:
      "Одна рука, блок ниже плеча, отведение руки в сторону; вес одного стека, повторы на сторону.",
    jointActions: ["Отведение плеча", "Вращение лопатки вверх"],
    primary: ["deltoid-middle"],
    assistant: ["supraspinatus", "trapezius-upper", "serratus-anterior"],
    stabilizer: ["infraspinatus", "obliques"],
    moderate: ["trapezius-upper"],
    tip: "Не наклоняй корпус, чтобы поднять вес выше. Высоту блока фиксируй.",
    limitations:
      "Высота блока и точка хвата меняют сопротивление по амплитуде, поэтому сравнимы только одинаковые настройки. Передняя и задняя дельты прямого зачёта не получают. Односторонняя запись не равна сумме двух рук в одном подходе.",
  }),
  entry({
    id: "woodchopper-cable",
    name: "Дровосек на верхнем блоке",
    nameEn: "Cable woodchopper",
    familyId: "rotation",
    equipment: "gym",
    recording: oneSideStack,
    variant:
      "Стоя, блок выше плеча, тяга по диагонали вниз через корпус; вес одного стека, повторы на сторону.",
    jointActions: ["Вращение позвоночника", "Боковое сгибание позвоночника"],
    primary: ["obliques"],
    assistant: ["rectus-abdominis"],
    stabilizer: ["erector-spinae"],
    moderate: ["rectus-abdominis"],
    tip: "Поворачивай корпус, а не тяни одной рукой. Стопы и колени держи устойчивыми.",
    limitations:
      "Запись не различает, где именно идёт вращение — в грудном отделе или тазом с опорой на ноги, а от этого сильно зависит вклад. Это односторонняя запись: вес одного стека, повторы на сторону.",
  }),
  entry({
    id: "ab-roller",
    name: "Ролик на пресс",
    nameEn: "Ab-wheel rollout",
    familyId: "anti-extension",
    equipment: "bodyweight",
    recording: body,
    variant:
      "Ролик на полу, колени или носки; полный цикл выката и возврата, вес тела без внешнего отягощения.",
    jointActions: [
      "Удержание нейтрального положения позвоночника",
      "Сгибание и разгибание плеча",
    ],
    primary: ["rectus-abdominis"],
    assistant: ["obliques"],
    stabilizer: ["latissimus-dorsi", "serratus-anterior"],
    moderate: ["obliques"],
    tip: "Держи рёбра вниз и не прогибай поясницу. Амплитуду ограничивай до комфортной.",
    limitations:
      "Ролика нет в перечне оборудования каталога, поэтому запись идёт как упражнение с весом тела: прогресс выражается повторами и амплитудой. Участие мышц, сгибающих бедро, в модели отсутствует, а прогиб в пояснице записью не фиксируется.",
  }),
  entry({
    id: "crunch-incline-plate",
    name: "Скручивания на наклонной скамье с блином",
    nameEn: "Weighted incline crunch",
    familyId: "trunk-flexion",
    equipment: "gym",
    recording: { ...bar, e1rmEligible: false },
    variant:
      "Наклонная скамья, стопы закреплены, блин у груди; ввод — вес блина, не масса тела.",
    jointActions: ["Сгибание позвоночника"],
    primary: ["rectus-abdominis"],
    assistant: ["obliques"],
    moderate: ["obliques"],
    tip: "Короткая амплитуда: поднимается верх спины, а не весь корпус.",
    limitations:
      "Вес — только блин; масса корпуса в запись не входит. Наклон скамьи и способ крепления стоп меняют механику, а вариант без веса — отдельная запись «crunch» выпуска 2. Оценка 1ПМ для этого движения не рассчитывается.",
  }),
  entry({
    id: "hanging-leg-raise",
    name: "Подъём ног в висе",
    nameEn: "Hanging leg raise",
    familyId: "leg-raise",
    equipment: "gym",
    recording: body,
    variant:
      "Вис на перекладине, подъём прямых или согнутых ног; вес тела без внешнего отягощения.",
    jointActions: ["Сгибание бедра", "Сгибание позвоночника"],
    primary: ["rectus-abdominis"],
    assistant: ["obliques", "rectus-femoris"],
    moderate: ["obliques", "rectus-femoris"],
    tip: "Начинай с подъёма коленей и наклона таза назад. Раскачка делает повтор другим.",
    limitations:
      "Подвздошно-поясничной мышцы в модели каталога нет, поэтому вклад сгибателей бедра здесь представлен только прямой бедра и систематически недооценён. Сила хвата и раскачка корпуса записью не фиксируются.",
  }),
  entry({
    id: "leg-extension",
    name: "Разгибания ног в тренажёре",
    nameEn: "Seated leg extension",
    familyId: "knee-extension",
    equipment: "gym",
    recording: machine,
    variant:
      "Сидя в тренажёре, колено разгибается, обе ноги; отображаемое значение или блины конкретной машины.",
    jointActions: ["Разгибание колена"],
    primary: ["quadriceps-vasti"],
    assistant: ["rectus-femoris"],
    moderate: ["rectus-femoris"],
    tip: "Настрой ось под колено и валик над стопой. Не бросай вес в нижней точке.",
    limitations:
      "В сидячем положении бедро согнуто, поэтому прямая бедра работает в укороченном положении — это другой вариант, чем присед или жим ногами, и вес не переносится между ними. Ось тренажёра и амплитуда меняют механику.",
  }),
  entry({
    id: "bulgarian-split-squat",
    name: "Болгарский сплит-присед с гантелями",
    nameEn: "Dumbbell Bulgarian split squat",
    familyId: "lunge",
    equipment: "dumbbells",
    recording: { ...oneSide, implementCount: 2 },
    variant:
      "Задняя стопа на скамье, опора на одну ногу, две гантели; вес одной гантели, повторы на сторону.",
    jointActions: ["Разгибание колена", "Разгибание бедра"],
    primary: ["quadriceps-vasti", "gluteus-maximus"],
    assistant: ["adductor-magnus"],
    stabilizer: ["gluteus-medius", ...hamstrings, ...trunk],
    moderate: ["adductor-magnus", ...hamstrings],
    tip: "Не заваливай колено внутрь, корпус держи устойчиво. Записывай повторы на сторону.",
    limitations:
      "Высота скамьи и длина шага меняют наклон корпуса и вклад ягодичной и квадрицепса. Задняя нога помогает, но в объём не попадает, а стороны записываются явно.",
  }),
  entry({
    id: "back-extension",
    name: "Гиперэкстензия",
    nameEn: "45-degree back extension",
    familyId: "spinal-extension",
    equipment: "gym",
    recording: body,
    variant:
      "Скамья под 45°, таз на подушке, корпус опускается и поднимается до прямой линии; вес тела без внешнего отягощения.",
    jointActions: ["Разгибание позвоночника", "Разгибание бедра"],
    primary: ["erector-spinae"],
    assistant: ["gluteus-maximus", ...hamstrings],
    stabilizer: ["obliques"],
    moderate: ["gluteus-maximus", ...hamstrings],
    evidence: ["anatomy-back"],
    tip: "Поднимайся до прямой линии, без прогиба. Если поясница «клюёт», сократи амплитуду.",
    limitations:
      "Запись идёт как упражнение с весом тела: добавленный блин в вес не попадает и требует отдельной заметки. Сколько работы даёт разгибание в тазобедренном суставе против разгибания позвоночника, записью не различается.",
  }),
  entry({
    id: "calf-standing-machine",
    name: "Подъём на носки стоя в тренажёре",
    nameEn: "Standing machine calf raise",
    familyId: "plantarflexion",
    equipment: "gym",
    recording: machine,
    variant:
      "Стоя в тренажёре, плечи под упором, колени почти прямые, обе ноги; значение стека.",
    jointActions: ["Подошвенное сгибание голеностопа"],
    primary: ["gastrocnemius", "soleus"],
    evidence: ["calf-position"],
    tip: "Полная комфортная амплитуда с паузой в верхней точке. Колени не сгибай — иначе это другой вариант.",
    limitations:
      "Это не подъём на носки без веса из выпуска 2 и не сидячий вариант: колени почти прямые. Сравнение стоячего и сидячего вариантов выполнено на внешней нагрузке в небольшой выборке и к конкретной машине напрямую не переносится.",
  }),
];