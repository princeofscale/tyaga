import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { WgerSnapshot, WgerRecord } from "../src/domain/WgerExercise";
import type { AnatomicalMuscle, RecordingSpec } from "../src/lib/types";

const base = JSON.parse(await readFile("data/wger/catalog-v2-ru.json", "utf8")) as WgerSnapshot;
const reviews = new Map<number, NonNullable<WgerRecord["review"]>>();
const machine: RecordingSpec = { type:"reps", loadMode:"machine_stack", implementCount:1, laterality:"bilateral", repsMode:"total", e1rmEligible:false };
const bar: RecordingSpec = { ...machine, loadMode:"total_external", e1rmEligible:true };
const pair: RecordingSpec = { ...bar, loadMode:"per_implement", implementCount:2 };
const elbow: AnatomicalMuscle[] = ["biceps-brachii","brachialis","brachioradialis"];
const retractors: AnatomicalMuscle[] = ["trapezius-middle","rhomboids"];
const hamstrings: AnatomicalMuscle[] = ["biceps-femoris-long","biceps-femoris-short","semitendinosus","semimembranosus"];
function review(ids:number[], primary:AnatomicalMuscle[], assistant:AnatomicalMuscle[], stabilizer:AnatomicalMuscle[], recording:RecordingSpec,
  variant:string, instructions:string, jointActions:string[], evidence:string[] = [], confidence:"high"|"moderate"="moderate") {
  const value = { version:"tyaga-wger-anatomy-2026-10-07-v1", primary, assistant, stabilizer, recording,
    variant, instructions, jointActions, evidence, confidence,
    limitations:"Редакционная проверка по функциональной анатомии и указанным исследованиям, составлена с помощью ИИ. Без независимой сертификации тренером или анатомом. Роли не являются процентами активации, роста или восстановления; техника и устройство тренажёра могут менять участие. Перечень мышц не исчерпывающий. Для машин сравнивай записанный вес только на том же оборудовании." };
  for (const id of ids) reviews.set(id,value);
}
const flat = "Горизонтальный жим от груди: горизонтальное приведение плеча и разгибание локтя. Ширина хвата и амплитуда индивидуальны.";
const flatTip = "Поставь стопы устойчиво, удерживай лопатки на опоре. Опускай вес подконтрольно и выжимай без рывка. Запиши общий вес грифа с блинами. Узкий/широкий хват не означает отдельные «внутреннюю» и «наружную» мышцы груди.";
review([73], ["pectoralis-major","triceps-brachii"], ["deltoid-anterior"], [], bar, flat, flatTip, ["Горизонтальное приведение плеча","Разгибание локтя"], ["bench-review"], "high");
review([75], ["pectoralis-major","triceps-brachii"], ["deltoid-anterior"], [], pair, "Жим двух гантелей на горизонтальной скамье, одновременно обеими руками.", "Удерживай стопы на полу и спину на опоре, опускай гантели подконтрольно. Записывай вес одной гантели и повторы обеих рук одновременно. Односторонний или попеременный вариант создай отдельно.", ["Горизонтальное приведение плеча","Разгибание локтя"]);
review([76], ["pectoralis-major","triceps-brachii"], ["deltoid-anterior"], [], bar, "Жим штанги на горизонтальной скамье, хват примерно на ширине плеч.", "Держи запястья устойчиво, локти ближе к туловищу, опускай штангу к нижней части груди подконтрольно. Вес включает гриф и блины.", ["Горизонтальное приведение плеча","Разгибание локтя"], ["bench-review"]);
review([91], ["biceps-brachii","brachialis"], ["brachioradialis"], [], bar, "Сгибание рук со штангой стоя, супинированный хват.", "Сгибай локти без раскачивания корпуса, сохраняй положение плеча. Записывай вес грифа и блинов вместе.", ["Сгибание локтя"], [], "high");
review([95], ["biceps-brachii","brachialis"], ["brachioradialis"], [], machine, "Двуручное сгибание локтей на нижнем блоке, супинированный хват.", "Удерживай плечи и корпус, сгибай локти подконтрольно. Записывай значение стека и название тренажёра.", ["Сгибание локтя"]);
review([129,379], ["pectoralis-major","triceps-brachii"], ["deltoid-anterior"], [], machine, "Жим от груди сидя в тренажёре: рукояти на уровне груди, спина на опоре.", "Настрой сиденье так, чтобы рукояти были на уровне груди. Выжимай и возвращай их подконтрольно. Записывай значение тренажёра, модель или номер и положение сиденья.", ["Горизонтальное приведение плеча","Разгибание локтя"]);
review([135], ["pectoralis-major"], ["deltoid-anterior"], [], machine, "Сведение рук сидя в пек-деке, локти почти не меняют угол.", "Настрой сиденье, удерживай плечи на уровне рукоятей. Своди руки перед грудью и возвращай без рывка. Не превращай движение в жим локтями.", ["Горизонтальное приведение плеча"]);
review([139,1775], ["deltoid-posterior"], retractors, [], machine, "Обратный пек-дек сидя лицом к опоре, руки примерно на высоте плеч. Ретракция лопаток зависит от техники.", "Настрой сиденье, сохраняй корпус на опоре. Разводи руки назад подконтрольно без запрокидывания головы. Отдельно запиши хват и амплитуду.", ["Горизонтальное отведение плеча","Ретракция лопаток"]);
review([172,173], ["rectus-abdominis"], ["obliques"], [], machine, "Скручивание позвоночника с сопротивлением: в тренажёре сидя либо на верхнем блоке с колен.", "Скручивай туловище подконтрольно, меняя угол позвоночника; не подменяй движение одним наклоном в тазобедренном суставе. На блоке держи рукоять у головы, не тяни руками.", ["Сгибание туловища"]);
review([272], elbow, [], [], pair, "Одновременные молотковые сгибания двух гантелей нейтральным хватом.", "Сохраняй нейтральный хват и неподвижное плечо, сгибай локти без раскачивания. Вес указывается для одной гантели. Попеременный вариант требует отдельного правила повторов.", ["Сгибание локтя"], [], "high");
review([275], elbow, [], [], machine, "Молотковое сгибание на нижнем блоке с канатом, нейтральный хват.", "Удерживай плечи рядом с корпусом, поднимай канат сгибанием локтей. Записывай значение стека, не складывай его с весом гантелей.", ["Сгибание локтя"]);
review([365], hamstrings, ["gastrocnemius"], [], machine, "Сгибание ног лёжа на животе в тренажёре; тазобедренный сустав около нейтрального положения.", "Совмести ось колена с осью тренажёра, настрой валик возле нижней части голени. Удерживай таз на опоре, сгибай колени подконтрольно.", ["Сгибание колена"], ["legcurl-length"], "high");
review([366], hamstrings, ["gastrocnemius"], [], machine, "Сгибание ног сидя в тренажёре; тазобедренный сустав согнут.", "Настрой сиденье и валики, удерживай таз и бедро на опоре. Сгибай колени без рывка, возвращай голень подконтрольно.", ["Сгибание колена"], ["legcurl-length"], "high");
review([369], ["quadriceps-vasti","rectus-femoris"], [], [], machine, "Разгибание коленей сидя в тренажёре; обе ноги одновременно.", "Настрой ось тренажёра по оси колена, валик возле нижней части голени. Разгибай колени подконтрольно, сохраняя таз на опоре.", ["Разгибание колена"], [], "high");
review([371], ["quadriceps-vasti","gluteus-maximus"], ["adductor-magnus"], [], machine, "Двусторонний жим ногами. Доля разгибания бедра зависит от глубины и устройства машины.", "Удерживай таз на спинке, сгибай колени в комфортной амплитуде без отрыва таза. Записывай значение оборудования и его модель; угол платформы и механика отличаются.", ["Разгибание колена","Разгибание бедра"]);
review([394], ["latissimus-dorsi",...retractors], ["deltoid-posterior","teres-major",...elbow], ["erector-spinae"], machine, "Горизонтальная тяга нижнего блока сидя, локти ближе к туловищу.", "Удерживай корпус, тяни рукоять к нижней части груди или животу. Контролируй возвращение без раскачивания. Запиши рукоять и тренажёр.", ["Разгибание плеча","Сгибание локтя","Ретракция лопаток"]);
review([1725], ["latissimus-dorsi",...retractors], ["deltoid-posterior","teres-major",...elbow], [], machine, "Двуручная горизонтальная тяга сидя в тренажёре; локти ближе к корпусу.", "Удерживай корпус на опоре, если она есть; тяни рукояти назад подконтрольно. Запиши наличие грудной опоры, хват и положение сиденья.", ["Разгибание плеча","Сгибание локтя","Ретракция лопаток"]);
review([543], ["deltoid-anterior","deltoid-middle","triceps-brachii"], ["serratus-anterior","trapezius-upper","trapezius-lower"], [], machine, "Вертикальный жим сидя в тренажёре, спинка почти вертикальна.", "Настрой сиденье, удерживай корпус на спинке. Выжимай рукояти над головой подконтрольно. Наклонный жим от груди — другой вариант.", ["Подъём плеча","Разгибание локтя","Вращение лопатки вверх"]);
review([549], ["triceps-brachii"], [], [], { ...bar, loadMode:"per_implement", implementCount:1 }, "Разгибание локтей с одной гантелью, удерживаемой двумя руками над головой, сидя.", "Удерживай плечи над головой и корпус устойчиво. Сгибай и разгибай локти подконтрольно. Записывай вес единственной гантели, не удваивай его.", ["Разгибание локтя"], ["overhead-triceps"]);
review([590], ["soleus"], ["gastrocnemius"], [], machine, "Подъём на носки сидя в тренажёре, колени согнуты примерно на 90°.", "Удерживай переднюю часть стоп на платформе, опускай и поднимай пятки подконтрольно без отбива. Запиши тренажёр и положение сиденья.", ["Подошвенное сгибание стопы"], ["calf-position"], "high");
review([622], ["gastrocnemius","soleus"], [], [], machine, "Подъём на носки стоя в тренажёре, колени близки к разогнутому положению.", "Удерживай корпус устойчиво и колени без резкого блокирования, поднимай и опускай пятки в комфортной амплитуде.", ["Подошвенное сгибание стопы"], ["calf-position"], "high");
review([1726], ["latissimus-dorsi","teres-major"], ["pectoralis-major"], ["triceps-brachii","rectus-abdominis","obliques"], machine, "Тяга верхнего блока прямыми руками стоя; локти удерживают небольшой постоянный угол.", "Удерживай локти почти неподвижно, тяни рукоять вниз разгибанием плеча. Не превращай движение в разгибание рук на трицепс или наклон корпусом.", ["Разгибание плеча"]);
review([2677], ["quadriceps-vasti","gluteus-maximus"], ["adductor-magnus"], [], { ...machine, laterality:"unilateral", repsMode:"per_side" }, "Жим ногами в тренажёре одной ногой; повторы записываются на сторону.", "Удерживай таз на опоре. Выполняй движение подконтрольно; запиши, сделаны обе ноги, левая или правая. Вес — значение оборудования.", ["Разгибание колена","Разгибание бедра"]);

const out = structuredClone(base);
for (const row of out.exercises) {
  const value = reviews.get(row.sourceId); if (!value) continue;
  row.review = value;
  const hash = createHash("sha256").update(JSON.stringify({ contentHash:row.contentHash, review:value })).digest("hex").slice(0,16);
  row.id = `wger:${row.sourceId}:${hash}`; row.contentHash = hash;
  row.adaptation += "; Added Tyaga editorial muscle/recording review; original text retained for attribution.";
}
out.release = "wger-ru-review-" + createHash("sha256").update(JSON.stringify(out.exercises.map(r=>r.id))).digest("hex").slice(0,16);
await writeFile("data/wger/catalog-v3-reviewed.json", JSON.stringify(out,null,2)+"\n");
console.log(JSON.stringify({ release:out.release, reviewed:reviews.size, records:out.count }));
