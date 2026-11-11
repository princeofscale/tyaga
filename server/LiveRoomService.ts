import { RoomCode } from "../src/domain/LiveSession";
import {
  MAX_ROOM_MEMBERS,
  ROOM_IDLE_HOURS,
  type LivePhase,
  type LiveRoom,
  type LiveState,
} from "../src/lib/social";
import { InputError, num, object, str } from "./validation";

const IDLE_MS = ROOM_IDLE_HOURS * 3_600_000;
/** Предел validWorkout: 30 упражнений по 30 подходов. Строже нельзя — легальная тренировка не должна ломать комнату. */
const MAX_SETS = 900;
const MAX_REST_AHEAD_MS = 3_600_000;
const PHASES: readonly LivePhase[] = ["idle", "lifting", "resting", "done"];
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const NOT_FOUND = "Комната не найдена или уже закрыта";
const FULL = `Комната заполнена: в ней уже ${MAX_ROOM_MEMBERS} человек`;
const NO_ROOM = "Сначала войдите в комнату";

/** Войти в комнату: если человек уже сидит в другой, строка переезжает — прежняя комната освобождает место. */
const enterRoom = (guard: string) =>
  `INSERT INTO live_members (code,owner_id,state,joined_at,updated_at) SELECT ?1,?2,NULL,?3,?3 WHERE ${guard} ON CONFLICT(owner_id) DO UPDATE SET code=excluded.code,state=NULL,joined_at=excluded.joined_at,updated_at=excluded.updated_at`;

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
    exercise: v.exercise === null ? null : str(v.exercise, 80, 1),
    setsDone,
    setsTotal,
    tonnageKg: num(v.tonnageKg, 0, 1_000_000, true),
    lastSet: lastSet && { kg: num(lastSet.kg, 0, 2000), reps: num(lastSet.reps, 0, 1000, true) },
    restEndsAt,
  };
}

/**
 * Комнаты совместной тренировки. Входят по коду из пяти символов, видят друг у друга только
 * состояние подходов (упражнение, подходы, тоннаж, отдых) — без заметок, истории и профилей.
 * Одна строка на человека: вход в новую комнату освобождает прежнюю, а комната без ответа
 * дольше ROOM_IDLE_HOURS исчезает сама.
 */
export class LiveRoomService {
  constructor(
    private db: D1Database,
    private owner: string,
    /** Источник случайных байтов для кода комнаты; в тестах подменяется, чтобы вызвать совпадение кодов. */
    private random?: (count: number) => Uint8Array,
  ) {}

  private cutoff() {
    return new Date(Date.now() - IDLE_MS).toISOString();
  }

  private sweep() {
    return this.db.prepare("DELETE FROM live_members WHERE updated_at<?").bind(this.cutoff()).run();
  }

  async current(): Promise<LiveRoom | null> {
    const mine = await this.db
      .prepare("SELECT code FROM live_members WHERE owner_id=? AND updated_at>=?")
      .bind(this.owner, this.cutoff())
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
        .bind(code, this.owner, now)
        .run();
      if (entered.meta.changes === 1) return this.room(code);
    }
    throw new Error("No free room code");
  }

  async join(input: unknown): Promise<LiveRoom> {
    const code = RoomCode.normalize(str(object(input).code, 40));
    if (!RoomCode.isValid(code)) throw new InputError("Код комнаты — пять символов, например H7KQ2");
    await this.sweep();
    const seats = await this.db
      .prepare("SELECT COUNT(*) AS n,MAX(owner_id=?) AS mine FROM live_members WHERE code=?")
      .bind(this.owner, code)
      .first<{ n: number; mine: number | null }>();
    if (!seats?.n) throw new InputError(NOT_FOUND);
    if (seats.mine === 1) return this.room(code);
    const entered = await this.db
      .prepare(enterRoom("(SELECT COUNT(*) FROM live_members WHERE code=?1)<?4"))
      .bind(code, this.owner, new Date().toISOString(), MAX_ROOM_MEMBERS)
      .run();
    if (entered.meta.changes !== 1) throw new InputError(FULL);
    return this.room(code);
  }

  async push(input: unknown): Promise<LiveRoom> {
    const state = validLiveState(input);
    const updated = await this.db
      .prepare("UPDATE live_members SET state=?,updated_at=? WHERE owner_id=? AND updated_at>=?")
      .bind(JSON.stringify(state), new Date().toISOString(), this.owner, this.cutoff())
      .run();
    if (updated.meta.changes !== 1) throw new InputError(NO_ROOM);
    const room = await this.current();
    if (!room) throw new InputError(NO_ROOM);
    return room;
  }

  async leave(): Promise<void> {
    await this.db.prepare("DELETE FROM live_members WHERE owner_id=?").bind(this.owner).run();
  }

  private async room(code: string): Promise<LiveRoom> {
    const rows = await this.db
      .prepare(
        "SELECT m.id,m.owner_id,m.state,m.updated_at,a.display_name,p.tag FROM live_members m JOIN accounts a ON a.platform_id=m.owner_id LEFT JOIN athlete_profiles p ON p.owner_id=m.owner_id AND p.is_public=1 WHERE m.code=? AND m.updated_at>=? ORDER BY m.joined_at,m.id",
      )
      .bind(code, this.cutoff())
      .all<{ id: number; owner_id: string; state: string | null; updated_at: string; display_name: string; tag: string | null }>();
    return {
      code,
      members: rows.results.map((r) => ({
        id: r.id,
        displayName: r.display_name,
        tag: r.tag,
        isMe: r.owner_id === this.owner,
        state: r.state ? (JSON.parse(r.state) as LiveState) : null,
        updatedAt: r.updated_at,
      })),
    };
  }
}
