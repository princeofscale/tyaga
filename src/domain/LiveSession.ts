import { fmt, volumeSummary, type Workout, type WorkoutExercise } from "../lib/model";
import { LIVE_EXERCISE_MAX, type LiveMember, type LivePhase, type LiveState } from "../lib/liveRoom";

/** Как часто повторять неизменившееся состояние, чтобы напарники видели: человек на связи. */
export const LIVE_HEARTBEAT_MS = 45_000;
/** Сколько тишины считается потерей связи: четыре пропущенных heartbeat. */
const LIVE_AWAY_MS = 3 * 60_000;

export type LiveBuildOptions = {
  /** Текущее время, мс. */
  now: number;
  nameOf: (entry: WorkoutExercise) => string;
  /** Когда закончится отдых, мс. Прошедший срок значит, что отдых уже окончен. */
  restEndsAt?: number | null;
  finished?: boolean;
};

/** Название, которое влезает в предел комнаты: длиннее обрезается с многоточием, пустое — это «нет названия». */
function roomName(name: string): string | null {
  const text = name.trim();
  if (text.length <= LIVE_EXERCISE_MAX) return text || null;
  let end = LIVE_EXERCISE_MAX - 1;
  if (/[\ud800-\udbff]/.test(text[end - 1])) end--; // не рвём суррогатную пару
  return `${text.slice(0, end).trimEnd()}…`;
}

/** Снимок тренировки для комнаты «Вместе»: где человек сейчас и сколько уже сделал. */
export class LiveStateBuilder {
  static fromWorkout(workout: Workout, options: LiveBuildOptions): LiveState {
    const { now, nameOf, finished = false } = options;
    const exercises = workout.exercises.map((entry) => ({ entry, sets: entry.sets.filter((s) => !s.warmup) }));
    const sets = exercises.flatMap((e) => e.sets);
    const done = sets.filter((s) => s.done);
    const last = done.at(-1);
    // Текущее — первое упражнение с несделанным рабочим подходом; когда всё сделано, остаётся последнее.
    const current = exercises.find((e) => e.sets.some((s) => !s.done)) ?? exercises.at(-1);
    const restEnd = options.restEndsAt ?? 0;
    const resting = !finished && restEnd > now;
    const phase: LivePhase = finished ? "done" : resting ? "resting" : done.length > 0 ? "lifting" : "idle";
    return {
      phase,
      exercise: current ? roomName(nameOf(current.entry)) : null,
      setsDone: done.length,
      setsTotal: sets.length,
      // Тот же рабочий тоннаж, что показан в шапке тренировки, но целыми килограммами.
      tonnageKg: Math.round(volumeSummary([workout], "working").total),
      lastSet: last ? { kg: last.weight, reps: last.reps } : null,
      restEndsAt: resting ? new Date(restEnd).toISOString() : null,
    };
  }
}

export type LivePush = { signature: string; at: number };

/** Когда состояние стоит отправлять комнате: при любом изменении и раз в LIVE_HEARTBEAT_MS без изменений. */
export class LivePushPolicy {
  static mark(state: LiveState, now: number): LivePush {
    return { signature: LivePushPolicy.signature(state), at: now };
  }

  static due(last: LivePush | null, state: LiveState, now: number): boolean {
    return !last || last.signature !== LivePushPolicy.signature(state) || now - last.at >= LIVE_HEARTBEAT_MS;
  }

  private static signature(s: LiveState): string {
    return JSON.stringify([s.phase, s.exercise, s.setsDone, s.setsTotal, s.tonnageKg, s.lastSet, s.restEndsAt]);
  }
}

/** Что показывать про напарника: одна строка, таймер отдыха и доля сделанных подходов. */
export class LivePresenter {
  /** Секунды до конца отдыха (с округлением вверх); 0, если отдыха нет или он уже закончился. */
  static restLeft(state: LiveState | null, now: number): number {
    if (!state?.restEndsAt) return 0;
    return Math.max(0, Math.ceil((Date.parse(state.restEndsAt) - now) / 1000));
  }

  /** 42 → «0:42», 600 → «10:00». */
  static clock(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  }

  /** Доля выполненных рабочих подходов, 0…1. */
  static progress(state: LiveState | null): number {
    return state && state.setsTotal > 0 ? state.setsDone / state.setsTotal : 0;
  }

  /** Тренировка идёт, а от человека давно ничего не приходило. Закончившие и ещё не начавшие не в счёт. */
  static isAway(seen: Pick<LiveMember, "state" | "updatedAt">, now: number): boolean {
    return !!seen.state && seen.state.phase !== "done" && now - Date.parse(seen.updatedAt) > LIVE_AWAY_MS;
  }

  static headline(seen: Pick<LiveMember, "state" | "updatedAt">, now: number): string {
    const state = seen.state;
    if (!state) return "Ждёт старта";
    if (state.phase === "done") return `Закончил · ${fmt(state.tonnageKg / 1000)} т`;
    if (LivePresenter.isAway(seen, now)) return "Нет связи";
    const count = `${state.setsDone}/${state.setsTotal}`;
    const rest = LivePresenter.restLeft(state, now);
    // Конец отдыха — не событие для сервера: по времени строка сама возвращается к подходам.
    if (state.phase === "resting" && rest > 0) return `Отдых ${LivePresenter.clock(rest)} · ${count}`;
    if (state.phase === "idle") return state.exercise ? `Готовится · ${state.exercise}` : "Готовится";
    return `${state.exercise ?? "Тренируется"} · ${count}`;
  }
}

const ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ROOM_LENGTH = 5;
const ROOM_PATTERN = new RegExp(`^[${ROOM_ALPHABET}]{${ROOM_LENGTH}}$`);
/** Байты от этого значения отбрасываются: иначе первые символы алфавита выпадали бы чаще остальных. */
const ROOM_BYTE_LIMIT = 256 - (256 % ROOM_ALPHABET.length);
const randomBytes = (count: number) => crypto.getRandomValues(new Uint8Array(count));

/** Код комнаты: пять символов без похожих 0/O и 1/I/L — его легко продиктовать в зале. */
export class RoomCode {
  /** «k7-m2q » → «K7M2Q»: регистр и разделители при вводе не важны. */
  static normalize(value: string): string {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  static isValid(code: string): boolean {
    return ROOM_PATTERN.test(code);
  }

  static generate(random: (count: number) => Uint8Array = randomBytes): string {
    let code = "";
    while (code.length < ROOM_LENGTH) {
      for (const byte of random(ROOM_LENGTH * 2)) {
        if (byte >= ROOM_BYTE_LIMIT) continue;
        code += ROOM_ALPHABET[byte % ROOM_ALPHABET.length];
        if (code.length === ROOM_LENGTH) break;
      }
    }
    return code;
  }
}

/** Ссылка в комнату: `?r=КОД`. Приглашение дружить (`?friend=`) живёт отдельно и здесь не трогается. */
export class RoomLink {
  static build(origin: string, code: string): string {
    return `${origin}/?r=${RoomCode.normalize(code)}`;
  }

  /** Код комнаты из адресной строки или null, если его нет или он не подходит. */
  static parse(search: string): string | null {
    const code = RoomCode.normalize(new URLSearchParams(search).get("r") ?? "");
    return RoomCode.isValid(code) ? code : null;
  }

  /** Адрес без кода комнаты: после обработки ссылки его убирают, чтобы перезагрузка не повторяла вход. */
  static strip(search: string): string {
    const params = new URLSearchParams(search);
    params.delete("r");
    const rest = params.toString();
    return rest ? `?${rest}` : "";
  }
}
