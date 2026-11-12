// Display zones aggregate anatomical entries; a zone is not one anatomical muscle.
export const MUSCLES = [
  { id: "chest", name: "Грудь", short: "Грудь", goal: 10 },
  { id: "back", name: "Спина", short: "Спина", goal: 12 },
  { id: "shoulders", name: "Плечи", short: "Плечи", goal: 8 },
  { id: "biceps", name: "Сгибатели локтя", short: "Сгибатели рук", goal: 6 },
  { id: "triceps", name: "Трицепс", short: "Трицепс", goal: 6 },
  { id: "quads", name: "Квадрицепс", short: "Квадрицепс", goal: 10 },
  {
    id: "hamstrings",
    name: "Задняя поверхность бедра",
    short: "Задняя часть бедра",
    goal: 8,
  },
  { id: "glutes", name: "Ягодицы и приводящие", short: "Ягодицы", goal: 8 },
  { id: "calves", name: "Мышцы голени", short: "Икры", goal: 6 },
  { id: "core", name: "Мышцы живота", short: "Пресс", goal: 6 },
] as const;
export type Muscle = (typeof MUSCLES)[number]["id"];
export const ANATOMICAL_MUSCLES = [
  {
    id: "pectoralis-major",
    name: "Большая грудная",
    latin: "m. pectoralis major",
    zone: "chest",
  },
  {
    id: "pectoralis-clavicular",
    name: "Верхняя часть груди (ключичная)",
    latin: "m. pectoralis major, pars clavicularis",
    zone: "chest",
  },
  {
    id: "pectoralis-sternal",
    name: "Средняя часть груди (грудинная)",
    latin: "m. pectoralis major, pars sternocostalis",
    zone: "chest",
  },
  {
    id: "pectoralis-abdominal",
    name: "Нижняя часть груди (брюшная)",
    latin: "m. pectoralis major, pars abdominalis",
    zone: "chest",
  },
  {
    id: "deltoid-anterior",
    name: "Передняя дельтовидная",
    latin: "m. deltoideus, pars clavicularis",
    zone: "shoulders",
  },
  {
    id: "deltoid-middle",
    name: "Средняя дельтовидная",
    latin: "m. deltoideus, pars acromialis",
    zone: "shoulders",
  },
  {
    id: "deltoid-posterior",
    name: "Задняя дельтовидная",
    latin: "m. deltoideus, pars spinalis",
    zone: "shoulders",
  },
  {
    id: "latissimus-dorsi",
    name: "Широчайшая спины",
    latin: "m. latissimus dorsi",
    zone: "back",
  },
  {
    id: "teres-major",
    name: "Большая круглая",
    latin: "m. teres major",
    zone: "back",
  },
  {
    id: "trapezius-upper",
    name: "Верхняя трапециевидная",
    latin: "m. trapezius, pars descendens",
    zone: "back",
  },
  {
    id: "trapezius-middle",
    name: "Средняя трапециевидная",
    latin: "m. trapezius, pars transversa",
    zone: "back",
  },
  {
    id: "trapezius-lower",
    name: "Нижняя трапециевидная",
    latin: "m. trapezius, pars ascendens",
    zone: "back",
  },
  {
    id: "rhomboids",
    name: "Ромбовидные",
    latin: "mm. rhomboidei",
    zone: "back",
  },
  {
    id: "serratus-anterior",
    name: "Передняя зубчатая",
    latin: "m. serratus anterior",
    zone: "chest",
  },
  {
    id: "infraspinatus",
    name: "Подостная",
    latin: "m. infraspinatus",
    zone: "shoulders",
  },
  {
    id: "teres-minor",
    name: "Малая круглая",
    latin: "m. teres minor",
    zone: "shoulders",
  },
  {
    id: "supraspinatus",
    name: "Надостная",
    latin: "m. supraspinatus",
    zone: "shoulders",
  },
  {
    id: "biceps-brachii",
    name: "Двуглавая плеча",
    latin: "m. biceps brachii",
    zone: "biceps",
  },
  {
    id: "brachialis",
    name: "Плечевая",
    latin: "m. brachialis",
    zone: "biceps",
  },
  {
    id: "brachioradialis",
    name: "Плечелучевая",
    latin: "m. brachioradialis",
    zone: "biceps",
  },
  {
    id: "triceps-brachii",
    name: "Трёхглавая плеча",
    latin: "m. triceps brachii",
    zone: "triceps",
  },
  {
    id: "quadriceps-vasti",
    name: "Широкие мышцы бедра",
    latin: "mm. vasti (lateralis, medialis, intermedius)",
    zone: "quads",
  },
  {
    id: "rectus-femoris",
    name: "Прямая бедра",
    latin: "m. rectus femoris",
    zone: "quads",
  },
  {
    id: "gluteus-maximus",
    name: "Большая ягодичная",
    latin: "m. gluteus maximus",
    zone: "glutes",
  },
  {
    id: "gluteus-medius",
    name: "Средняя ягодичная",
    latin: "m. gluteus medius",
    zone: "glutes",
  },
  {
    id: "adductor-magnus",
    name: "Большая приводящая",
    latin: "m. adductor magnus",
    zone: "glutes",
  },
  {
    id: "biceps-femoris-long",
    name: "Двуглавая бедра, длинная головка",
    latin: "m. biceps femoris, caput longum",
    zone: "hamstrings",
  },
  {
    id: "biceps-femoris-short",
    name: "Двуглавая бедра, короткая головка",
    latin: "m. biceps femoris, caput breve",
    zone: "hamstrings",
  },
  {
    id: "semitendinosus",
    name: "Полусухожильная",
    latin: "m. semitendinosus",
    zone: "hamstrings",
  },
  {
    id: "semimembranosus",
    name: "Полуперепончатая",
    latin: "m. semimembranosus",
    zone: "hamstrings",
  },
  {
    id: "gastrocnemius",
    name: "Икроножная",
    latin: "m. gastrocnemius",
    zone: "calves",
  },
  { id: "soleus", name: "Камбаловидная", latin: "m. soleus", zone: "calves" },
  {
    id: "tibialis-anterior",
    name: "Передняя большеберцовая",
    latin: "m. tibialis anterior",
    zone: "calves",
  },
  {
    id: "neck-muscles",
    name: "Мышцы шеи",
    latin: "mm. colli",
    zone: "back",
  },
  {
    id: "rectus-abdominis",
    name: "Прямая живота",
    latin: "m. rectus abdominis",
    zone: "core",
  },
  {
    id: "obliques",
    name: "Косые мышцы живота",
    latin: "mm. obliquus externus et internus abdominis",
    zone: "core",
  },
  {
    id: "erector-spinae",
    name: "Выпрямляющая позвоночник",
    latin: "m. erector spinae",
    zone: "back",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  name: string;
  latin: string;
  zone: Muscle;
}>;
export type AnatomicalMuscle = (typeof ANATOMICAL_MUSCLES)[number]["id"];

export const CHEST_HEADS = [
  {
    id: "pectoralis-clavicular" as const,
    slug: "chest-upper",
    name: "Верх груди",
    latin: "m. pectoralis major, pars clavicularis",
    desc: "Ключичный пучок: акцент в жиме на скамье 30°. Отделы груди работают совместно.",
  },
  {
    id: "pectoralis-sternal" as const,
    slug: "chest-mid",
    name: "Середина груди",
    latin: "m. pectoralis major, pars sternocostalis",
    desc: "Грудинный пучок: горизонтальный жим штанги/гантелей, разводки",
  },
  {
    id: "pectoralis-abdominal" as const,
    slug: "chest-lower",
    name: "Низ груди",
    latin: "m. pectoralis major, pars abdominalis",
    desc: "Брюшной пучок: отжимания на брусьях, кроссовер сверху вниз",
  },
] as const;

export const DELTOID_HEADS = [
  {
    id: "deltoid-anterior" as const,
    slug: "deltoid-anterior",
    name: "Передняя дельта",
    latin: "m. deltoideus, pars clavicularis",
    desc: "Передний пучок: армейский жим, жим сидя, подъёмы перед собой",
  },
  {
    id: "deltoid-middle" as const,
    slug: "deltoid-middle",
    name: "Средняя дельта",
    latin: "m. deltoideus, pars acromialis",
    desc: "Средний пучок: махи гантелями в стороны, махи на блоке",
  },
  {
    id: "deltoid-posterior" as const,
    slug: "deltoid-posterior",
    name: "Задняя дельта",
    latin: "m. deltoideus, pars spinalis",
    desc: "Задний пучок: махи в наклоне, фейспул, обратная бабочка",
  },
] as const;

