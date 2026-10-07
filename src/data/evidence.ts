export type Evidence = {
  id: string;
  title: string;
  url: string;
  kind: "anatomy" | "emg" | "longitudinal" | "methodology";
  verification: "full-text" | "abstract" | "metadata";
  checkedAt: string;
  claim: string;
  limitation: string;
};
// Links and original summaries, not copied article text or third-party media.
export const EVIDENCE: Evidence[] = [
  {
    id: "anatomy-back",
    title: "OpenStax Anatomy and Physiology 2e, 11.3",
    url: "https://openstax.org/books/anatomy-and-physiology-2e/pages/11-3-axial-muscles-of-the-head-neck-and-back",
    kind: "anatomy",
    verification: "full-text",
    checkedAt: "2026-10-07",
    claim: "Разгибание и удержание позвоночника выпрямляющими мышцами.",
    limitation:
      "Стабилизация позвоночника не устанавливает эквивалент подхода на гипертрофию.",
  },
  {
    id: "anatomy-upper",
    title: "OpenStax Anatomy and Physiology 2e, 11.5",
    url: "https://openstax.org/books/anatomy-and-physiology-2e/pages/11-5-muscles-of-the-pectoral-girdle-and-upper-limbs",
    kind: "anatomy",
    verification: "full-text",
    checkedAt: "2026-10-07",
    claim: "Суставные функции мышц плечевого пояса и верхних конечностей.",
    limitation:
      "Связь с конкретным упражнением — редакционный вывод из анатомии, без измерения доли нагрузки.",
  },
  {
    id: "anatomy-lower",
    title: "OpenStax Anatomy and Physiology 2e, 11.6",
    url: "https://openstax.org/books/anatomy-and-physiology-2e/pages/11-6-appendicular-muscles-of-the-pelvic-girdle-and-lower-limbs",
    kind: "anatomy",
    verification: "full-text",
    checkedAt: "2026-10-07",
    claim: "Суставные функции мышц таза, бедра и голени.",
    limitation:
      "Анатомическая функция сама по себе не предсказывает величину гипертрофии.",
  },
  {
    id: "anatomy-trunk",
    title: "OpenStax Anatomy and Physiology 2e, 11.4",
    url: "https://openstax.org/books/anatomy-and-physiology-2e/pages/11-4-axial-muscles-of-the-abdominal-wall-and-thorax",
    kind: "anatomy",
    verification: "full-text",
    checkedAt: "2026-10-07",
    claim: "Функции мышц живота и поддержание положения корпуса.",
    limitation:
      "Удержание корпуса не приравнивается к прямому рабочему подходу на пресс.",
  },
  {
    id: "emg-limits",
    title:
      "Vigotsky et al. — Interpreting Signal Amplitudes in Surface Electromyography Studies",
    url: "https://doi.org/10.3389/fphys.2017.00985",
    kind: "methodology",
    verification: "full-text",
    checkedAt: "2026-10-07",
    claim:
      "Амплитуда поверхностной ЭМГ не устанавливает долю силы и не даёт надёжного прогноза роста мышцы.",
    limitation: "Методологическая работа; не каталог упражнений.",
  },
  {
    id: "bench-review",
    title:
      "Stastny et al. — A systematic review of surface electromyography analyses of the bench press movement task",
    url: "https://pubmed.ncbi.nlm.nih.gov/28170449/",
    kind: "emg",
    verification: "full-text",
    checkedAt: "2026-10-07",
    claim:
      "В обзоре жима штанги грудная и трицепс имели выраженный ЭМГ-сигнал; передняя дельта также участвует.",
    limitation: "ЭМГ не доказывает равенство тренировочного стимула этих мышц.",
  },
  {
    id: "incline-emg",
    title:
      "Rodríguez-Ridao et al. — Effect of Five Bench Inclinations on Electromyographic Activity",
    url: "https://pubmed.ncbi.nlm.nih.gov/33049982/",
    kind: "emg",
    verification: "metadata",
    checkedAt: "2026-10-07",
    claim: "Исследование рассматривает зависимость ЭМГ от угла скамьи.",
    limitation:
      "Проверены метаданные; работа со штангой не является прямым доказательством для гантелей под 30°.",
  },
  {
    id: "squat-depth",
    title:
      "Kubo et al. — Effects of squat training with different depths on lower limb muscle volumes",
    url: "https://pubmed.ncbi.nlm.nih.gov/31230110/",
    kind: "longitudinal",
    verification: "abstract",
    checkedAt: "2026-10-07",
    claim:
      "За 10 недель у 17 мужчин выросли разгибатели колена, ягодичная и приводящие; объём задней группы бедра не изменился.",
    limitation:
      "Небольшая выборка; не доказывает нулевое участие задней группы во всех вариантах приседа.",
  },
  {
    id: "deadlift-review",
    title:
      "Martín-Fuentes et al. — Electromyographic activity in deadlift exercise and its variants",
    url: "https://pubmed.ncbi.nlm.nih.gov/32107499/",
    kind: "emg",
    verification: "metadata",
    checkedAt: "2026-10-07",
    claim: "Обзор рассматривает мышечное возбуждение в вариантах тяги.",
    limitation:
      "Проверены метаданные; различие движителя и стабилизатора здесь основано на функции, а не на процентах ЭМГ.",
  },
  {
    id: "legcurl-length",
    title:
      "Maeo et al. — Greater Hamstrings Muscle Hypertrophy after Training at Long versus Short Muscle Lengths",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7969179/",
    kind: "longitudinal",
    verification: "full-text",
    checkedAt: "2026-10-07",
    claim:
      "Сидячее и лежачее сгибания ног исследовались как разные варианты с разным положением бедра.",
    limitation:
      "Результат конкретного протокола не устанавливает универсальные коэффициенты подходов.",
  },
  {
    id: "calf-position",
    title:
      "Kinoshita et al. — Triceps surae muscle hypertrophy after standing versus seated calf-raise training",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10753835/",
    kind: "longitudinal",
    verification: "full-text",
    checkedAt: "2026-10-07",
    claim:
      "У 14 нетренированных взрослых стоячий вариант дал больший рост икроножной, чем сидячий; рост камбаловидной был сходнее.",
    limitation:
      "В эксперименте использовалась внешняя нагрузка. Это не проверка нашего варианта без веса.",
  },
  {
    id: "overhead-triceps",
    title:
      "Maeo et al. — Triceps brachii hypertrophy in overhead versus neutral arm position",
    url: "https://pubmed.ncbi.nlm.nih.gov/35819335/",
    kind: "longitudinal",
    verification: "metadata",
    checkedAt: "2026-10-07",
    claim:
      "Исследование сравнивает разгибания локтя с разным положением плеча.",
    limitation:
      "Проверены метаданные; исследование с блоком не является прямым доказательством для гантели.",
  },
  {
    id: "hipthrust-study",
    title:
      "Plotkin et al. — Hip thrust and back squat training elicit similar gluteus muscle hypertrophy",
    url: "https://pubmed.ncbi.nlm.nih.gov/37877099/",
    kind: "longitudinal",
    verification: "metadata",
    checkedAt: "2026-10-07",
    claim:
      "Исследование рассматривает hip thrust с опорой плечами и присед, а не мост на полу.",
    limitation:
      "Проверены метаданные. Нельзя переносить результат на мост без веса как измеренный факт.",
  },
];
export const evidenceById = (id: string) => EVIDENCE.find((e) => e.id === id);
