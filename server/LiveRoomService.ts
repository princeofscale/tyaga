import { RoomCode } from "../src/domain/LiveSession";
import {
  LIVE_EXERCISE_MAX,
  MAX_ROOM_MEMBERS,
  ROOM_IDLE_HOURS,
  type LivePhase,
  type LiveRoom,
  type LiveState,
} from "../src/lib/liveRoom";
import { AuthError } from "./AccountService";
import { InputError, num, object, str } from "./validation";

const IDLE_MS = ROOM_IDLE_HOURS * 3_600_000;
/** Предел validWorkout: 30 упражнений по 30 подходов. Строже нельзя — легальная тренировка не должна ломать комнату. */
const MAX_SETS = 900;
const MAX_REST_AHEAD_MS = 3_600_000;
const JOIN_WINDOW_MS = 15 * 60_000;
const MAX_JOIN_FAILURES = 20;
const PHASES: readonly LivePhase[] = ["idle", "lifting", "resting", "done"];
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const NOT_FOUND = "Комната не найдена или уже закрыта";
const FULL = `Комната заполнена: в ней уже ${MAX_ROOM_MEMBERS} человек`;
const NO_ROOM = "Сначала войдите в комнату";

/** Войти в комнату: если человек уже сидит в другой, строка переезжает — прежняя комната освобождает место. */
const enterRoom = (guard: string) =>
  `INSERT INTO live_members (code,account_id,state,joined_at,updated_at) SELECT ?1,?2,NULL,?3,?3 WHERE ${guard} ON CONFLICT(account_id) DO UPDATE SET code=excluded.code,state=NULL,joined_at=excluded.joined_at,updated_at=excluded.updated_at`;

/** Принимает только известные поля и только разумные значения: остальное до участников не доходит. */
export function validLiveState(input: unknown, now = Date.now()): LiveState {
  const v = object(input);
  if (!PHASES.includes(v.phase as LivePhase)) throw new InputError("Проверь состояние тренировки");
  const setsDone = num(v.setsDone, 0, MAX_SETS, true);
  const setsTotal = num(v.setsTotal, 0, MAX_SETS, true);
  if (setsDone > setsTotal) throw new InputError("Выполненных подходов не может быть больше запланированных");
  let restEndsAt: string | null = null;
  if (v.restEndsAt !== null) {
    const text = str(v.restEndsAt, 30, 1);
    const at = Date.parse(text);
    if (!ISO_TIME.test(text) || !Number.isFinite(at) || at > now + MAX_REST_AHEAD_MS)
      throw new InputError("Проверь время отдыха");
    restEndsAt = new Date(at).toISOString();
  }
  const lastSet = v.lastSet === null ? null : object(v.lastSet);
  return {
    phase: v.phase as LivePhase,
    exercise: v.exercise === null ? null : str(v.exercise, LIVE_EXERCISE_MAX, 1),
    setsDone,
    setsTotal,
    tonnageKg: num(v.tonnageKg, 0, 1_000_000, true),
    lastSet: lastSet && { kg: num(lastSet.kg, 0, 2000), reps: num(lastSet.reps, 0, 1000, true) },
    restEndsAt,
  };
}

/**
 * Комнаты совместной тренировки. Входят по коду из пяти символов, видят друг у друга только
 * имя и состояние подходов (упражнение, подходы, тоннаж, отдых) — без почты, заметок и истории.
 * Одна строка на аккаунт: вход в новую комнату освобождает прежнюю, а комната без ответа
 * дольше ROOM_IDLE_HOURS исчезает сама. Дружба для входа не нужна: достаточно кода.
 */
export class LiveRoomService {
  constructor(
    private db: D1Database,
    private accountId: string,
    /** Источник случайных байтов для кода комнаты; в тестах подменяется, чтобы вызвать совпадение кодов. */
    private random?: (count: number) => Uint8Array,
  ) {}

  private cutoff() {
    return new Date(Date.now() - IDLE_MS).toISOString();
  }

  private sweep() {
    return this.db.prepare("DELETE FROM live_members WHERE updated_at<?").bind(this.cutoff()).run();
  }

  private joinLimitKey() {
    return `live_join:${this.accountId}`;
  }

  private async guardJoinAttempts() {
    const row = await this.db
      .prepare("SELECT attempts, window_start FROM auth_limits WHERE platform_id = ?")
      .bind(this.joinLimitKey())
      .first<{ attempts: number; window_start: number }>();
    if (row && row.window_start >= Date.now() - JOIN_WINDOW_MS && row.attempts >= MAX_JOIN_FAILURES) {
      throw new AuthError("Слишком много попыток входа в комнату. Попробуй через 15 минут.", 429);
    }
  }

  private async noteJoinFailure() {
    const now = Date.now();
    await this.db.batch([
      this.db.prepare("DELETE FROM auth_limits WHERE window_start < ?").bind(now - 86_400_000),
      this.db
        .prepare(
          "INSERT INTO auth_limits (platform_id,attempts,window_start) VALUES (?,1,?) ON CONFLICT(platform_id) DO UPDATE SET attempts = CASE WHEN auth_limits.window_start < ? THEN 1 ELSE auth_limits.attempts + 1 END, window_start = CASE WHEN auth_limits.window_start < ? THEN excluded.window_start ELSE auth_limits.window_start END",
        )
        .bind(this.joinLimitKey(), now, now - JOIN_WINDOW_MS, now - JOIN_WINDOW_MS),
    ]);
  }

  private async clearJoinFailures() {
    await this.db.prepare("DELETE FROM auth_limits WHERE platform_id = ?").bind(this.joinLimitKey()).run();
  }

  async current(): Promise<LiveRoom | null> {
    const mine = await this.db
      .prepare("SELECT code FROM live_members WHERE account_id=? AND updated_at>=?")
      .bind(this.accountId, this.cutoff())
      .first<{ code: string }>();
    return mine ? this.room(mine.code) : null;
  }

  async create(): Promise<LiveRoom> {
    await this.sweep();
    const now = new Date().toISOString();
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = RoomCode.generate(this.random);
      const entered = await this.db
        .prepare(enterRoom("NOT EXISTS (SELECT 1 FROM live_members WHERE code=?1)"))
        .bind(code, this.accountId, now)
        .run();
      if (entered.meta.changes === 1) return this.room(code);
    }
    throw new Error("No free room code");
  }

  async join(input: unknown): Promise<LiveRoom> {
    await this.guardJoinAttempts();
    const code = RoomCode.normalize(str(object(input).code, 40));
    if (!RoomCode.isValid(code)) throw new InputError("Код комнаты — пять символов, например H7KQ2");
    await this.sweep();
    const seats = await this.db
      .prepare("SELECT COUNT(*) AS n,MAX(account_id=?) AS mine FROM live_members WHERE code=?")
      .bind(this.accountId, code)
      .first<{ n: number; mine: number | null }>();
    if (!seats?.n) {
      await this.noteJoinFailure();
      throw new InputError(NOT_FOUND);
    }
    if (seats.mine === 1) {
      await this.clearJoinFailures();
      return this.room(code);
    }
    const entered = await this.db
      .prepare(enterRoom("(SELECT COUNT(*) FROM live_members WHERE code=?1)<?4"))
      .bind(code, this.accountId, new Date().toISOString(), MAX_ROOM_MEMBERS)
      .run();
    if (entered.meta.changes !== 1) throw new InputError(FULL);
    await this.clearJoinFailures();
    return this.room(code);
  }

  async push(input: unknown): Promise<LiveRoom> {
    const state = validLiveState(input);
    const updated = await this.db
      .prepare("UPDATE live_members SET state=?,updated_at=? WHERE account_id=? AND updated_at>=?")
      .bind(JSON.stringify(state), new Date().toISOString(), this.accountId, this.cutoff())
      .run();
    if (updated.meta.changes !== 1) throw new InputError(NO_ROOM);
    const room = await this.current();
    if (!room) throw new InputError(NO_ROOM);
    return room;
  }

  async leave(): Promise<void> {
    await this.db.prepare("DELETE FROM live_members WHERE account_id=?").bind(this.accountId).run();
  }

  private async room(code: string): Promise<LiveRoom> {
    const rows = await this.db
      .prepare(
        "SELECT m.id,m.account_id,m.state,m.updated_at,a.display_name FROM live_members m JOIN accounts a ON a.id=m.account_id WHERE m.code=? AND m.updated_at>=? ORDER BY m.joined_at,m.id",
      )
      .bind(code, this.cutoff())
      .all<{ id: number; account_id: string; state: string | null; updated_at: string; display_name: string }>();
    return {
      code,
      members: rows.results.map((r) => ({
        id: r.id,
        displayName: r.display_name,
        isMe: r.account_id === this.accountId,
        state: r.state ? (JSON.parse(r.state) as LiveState) : null,
        updatedAt: r.updated_at,
      })),
    };
  }
}
