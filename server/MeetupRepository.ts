import { localDate } from "../src/lib/calendar";
import { FriendsService } from "../src/domain/FriendsService";
import type {
  TrainingMeetup,
  MeetupParticipant,
} from "../src/domain/TrainingMeetups";
import type { AccountProfile } from "../src/lib/account";
import type { Workout } from "../src/lib/model";
import { AuthError } from "./AccountService";
import { InputError, object, str } from "./validation";
type MeetingRow = {
  id: string;
  host_id: string;
  host_name: string;
  name: string;
  starts_at: string;
  gym: string;
  participant_gym: string;
  cancelled: number;
  response: MeetupParticipant["response"];
};
/** Only invitees and the host can read a meetup; host friendship is rechecked on every action. */
export class MeetupRepository {
  constructor(
    private db: D1Database,
    private account: AccountProfile,
  ) {}
  private async access(id: string) {
    const row = await this.db
      .prepare(
        `SELECT m.*,a.display_name AS host_name,p.response,p.gym AS participant_gym FROM training_meetups m JOIN accounts a ON a.id=m.host_id JOIN meetup_participants p ON p.meetup_id=m.id AND p.account_id=?
   WHERE m.id=? AND (m.host_id=? OR EXISTS(SELECT 1 FROM friendships f WHERE f.status='accepted' AND ((f.low_id=? AND f.high_id=m.host_id) OR (f.high_id=? AND f.low_id=m.host_id))))`,
      )
      .bind(
        this.account.id,
        id,
        this.account.id,
        this.account.id,
        this.account.id,
      )
      .first<MeetingRow>();
    if (!row)
      throw new AuthError("Приглашение недоступно. Обнови команду.", 404);
    return row;
  }
  async read(): Promise<TrainingMeetup[]> {
    const ids = await this.db
      .prepare(
        `SELECT m.id FROM meetup_participants p JOIN training_meetups m ON m.id=p.meetup_id WHERE p.account_id=? AND m.starts_at>=? ORDER BY m.starts_at LIMIT 30`,
      )
      .bind(this.account.id, new Date(Date.now() - 7 * 86400000).toISOString())
      .all<{ id: string }>();
    const result: TrainingMeetup[] = [];
    for (const { id } of ids.results) {
      let m: MeetingRow;
      try {
        m = await this.access(id);
      } catch (e) {
        if (e instanceof AuthError && e.status === 404) continue;
        throw e;
      }
      const rows = await this.db
        .prepare(
          `SELECT p.*,a.display_name,w.payload FROM meetup_participants p JOIN accounts a ON a.id=p.account_id LEFT JOIN workouts w ON w.id=p.workout_id AND w.owner_id=a.platform_id
    WHERE p.meetup_id=? AND (p.account_id=? OR (p.account_id=? OR EXISTS(SELECT 1 FROM friendships f WHERE f.status='accepted' AND ((f.low_id=? AND f.high_id=p.account_id) OR(f.high_id=? AND f.low_id=p.account_id))))) ORDER BY p.account_id`,
        )
        .bind(id, this.account.id, m.host_id, m.host_id, m.host_id)
        .all<{
          account_id: string;
          response: MeetupParticipant["response"];
          gym: string;
          display_name: string;
          payload: string | null;
        }>();
      const canSee =
        m.host_id === this.account.id ||
        m.response === "accepted" ||
        m.response === "finished";
      const participants: MeetupParticipant[] = rows.results
        .filter(
          (p) =>
            p.account_id === this.account.id ||
            p.account_id === m.host_id ||
            (canSee &&
              (p.response === "accepted" ||
                p.response === "finished" ||
                m.host_id === this.account.id)),
        )
        .map((p) => {
          const w = p.payload ? (JSON.parse(p.payload) as Workout) : null;
          return {
            id: p.account_id,
            displayName: p.display_name,
            response: p.response,
            gym: p.gym,
            ...(w && p.response === "finished"
              ? {
                  summary: {
                    name: w.name,
                    duration: w.duration,
                    ...FriendsService.workout(w),
                  },
                }
              : {}),
          };
        });
      result.push({
        id,
        hostId: m.host_id,
        hostName: m.host_name,
        name: m.name,
        startsAt: m.starts_at,
        gym: m.gym,
        cancelled: !!m.cancelled,
        myResponse: m.response,
        participants,
      });
    }
    return result;
  }
  async create(input: unknown) {
    const v = object(input),
      id = str(v.id, 80, 1),
      name = str(v.name, 80, 1),
      gym = str(v.gym, 60),
      startsAt = str(v.startsAt, 40, 1);
    const time = Date.parse(startsAt);
    if (
      !Number.isFinite(time) ||
      time < Date.now() - 300000 ||
      time > Date.now() + 30 * 86400000
    )
      throw new InputError("Встречу можно запланировать на ближайшие 30 дней");
    if (
      !Array.isArray(v.friendIds) ||
      !v.friendIds.length ||
      v.friendIds.length > 20
    )
      throw new InputError("Выбери от 1 до 20 напарников");
    const ids = [...new Set(v.friendIds.map((id) => str(id, 80, 1)))];
    for (const other of ids) {
      const [low, high] = [other, this.account.id].sort();
      const f = await this.db
        .prepare(
          "SELECT 1 FROM friendships WHERE low_id=? AND high_id=? AND status='accepted'",
        )
        .bind(low, high)
        .first();
      if (!f)
        throw new AuthError("Приглашать можно только принятых напарников", 403);
    }
    const existing = await this.db
      .prepare("SELECT * FROM training_meetups WHERE id=?")
      .bind(id)
      .first<MeetingRow>();
    if (existing) {
      if (
        existing.host_id !== this.account.id ||
        existing.name !== name ||
        existing.starts_at !== new Date(time).toISOString() ||
        existing.gym !== gym
      )
        throw new AuthError("Встреча уже существует. Обнови список.", 409);
      return { id };
    }
    const recent = await this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM training_meetups WHERE host_id=? AND created_at>=?",
      )
      .bind(this.account.id, new Date(Date.now() - 86400000).toISOString())
      .first<{ n: number }>();
    if ((recent?.n ?? 0) >= 20)
      throw new AuthError(
        "На сегодня достаточно приглашений. Лимит — 20 встреч в день.",
        429,
      );
    await this.db.batch([
      this.db
        .prepare(
          "INSERT INTO training_meetups (id,host_id,name,starts_at,gym,cancelled,created_at) VALUES (?,?,?,?,?,0,?)",
        )
        .bind(
          id,
          this.account.id,
          name,
          new Date(time).toISOString(),
          gym,
          new Date().toISOString(),
        ),
      this.db
        .prepare(
          "INSERT INTO meetup_participants (meetup_id,account_id,response,gym) VALUES (?,?,'accepted',?)",
        )
        .bind(id, this.account.id, gym),
      ...ids.map((other) =>
        this.db
          .prepare(
            "INSERT INTO meetup_participants (meetup_id,account_id,response,gym) VALUES (?,?,'invited','')",
          )
          .bind(id, other),
      ),
    ]);
    return { id };
  }
  async act(id: string, input: unknown) {
    const m = await this.access(id),
      v = object(input);
    if (v.action === "cancel") {
      if (m.host_id !== this.account.id)
        throw new AuthError("Отменить встречу может организатор", 403);
      await this.db
        .prepare(
          "UPDATE training_meetups SET cancelled=1 WHERE id=? AND host_id=?",
        )
        .bind(id, this.account.id)
        .run();
      return;
    }
    if (m.cancelled) throw new InputError("Встреча отменена");
    if (v.action === "accept" || v.action === "decline") {
      if (m.response === "finished") throw new InputError("Итог уже добавлен");
      if (m.host_id === this.account.id && v.action === "decline")
        throw new InputError("Организатор может отменить встречу");
      await this.db
        .prepare(
          "UPDATE meetup_participants SET response=?,gym=? WHERE meetup_id=? AND account_id=?",
        )
        .bind(
          v.action === "accept" ? "accepted" : "declined",
          str(v.gym ?? "", 60),
          id,
          this.account.id,
        )
        .run();
      return;
    }
    if (v.action !== "finish") throw new InputError("Неизвестное действие");
    if (!["accepted", "finished"].includes(m.response))
      throw new AuthError("Сначала прими приглашение", 403);
    if (Date.parse(m.starts_at) > Date.now())
      throw new InputError("Встреча ещё не началась");
    const workoutId = str(v.workoutId, 80, 1);
    const w = await this.db
      .prepare(
        "SELECT payload FROM workouts WHERE id=? AND owner_id=(SELECT platform_id FROM accounts WHERE id=?)",
      )
      .bind(workoutId, this.account.id)
      .first<{ payload: string }>();
    if (!w) throw new AuthError("Сначала сохрани тренировку в аккаунте", 404);
    const workout = JSON.parse(w.payload) as Workout;
    if (
      workout.date !==
        localDate(
          new Date(m.starts_at),
          workout.timeZone ?? this.account.timeZone,
        ) ||
      FriendsService.workout(workout).setsCount === 0
    )
      throw new InputError("Выбери завершённую тренировку за день встречи");
    const attached = await this.db
      .prepare(
        `UPDATE meetup_participants SET response='finished',workout_id=?,gym=? WHERE meetup_id=? AND account_id=?
         AND NOT EXISTS(SELECT 1 FROM meetup_participants WHERE account_id=? AND workout_id=? AND meetup_id!=?) RETURNING workout_id`,
      )
      .bind(
        workoutId,
        str(v.gym ?? m.participant_gym, 60),
        id,
        this.account.id,
        this.account.id,
        workoutId,
        id,
      )
      .first();
    if (!attached)
      throw new InputError("Эта тренировка уже добавлена к другой встрече");
  }
}
