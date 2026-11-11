import type { AccountProfile } from "../src/lib/account";
import {
  FriendsService,
  type Athlete,
  type FriendWorkout,
  type FriendsData,
} from "../src/domain/FriendsService";
import type { Workout } from "../src/lib/types";
import { AuthError } from "./AccountService";
import { InputError, str, num } from "./validation";

type SocialRow = {
  invite_code: string;
  gym: string;
  focus: string;
  active_until: number;
  weekly_target: number;
};
type ConnectionRow = Omit<SocialRow, "invite_code"> & {
  id: string;
  display_name: string;
  sender_id: string;
  status: string;
  week_workouts: number;
};
const connected = `EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted'
  AND ((f.low_id = ? AND f.high_id = a.id) OR (f.high_id = ? AND f.low_id = a.id)))`;

export class FriendsRepository {
  constructor(
    private db: D1Database,
    private account: AccountProfile,
  ) {}

  private async profile() {
    const code = crypto
      .randomUUID()
      .replace(/-/g, "")
      .slice(0, 12)
      .toUpperCase();
    await this.db
      .prepare(
        "INSERT INTO social_profiles (account_id, invite_code) VALUES (?, ?) ON CONFLICT(account_id) DO NOTHING",
      )
      .bind(this.account.id, code)
      .run();
    return (await this.db
      .prepare("SELECT * FROM social_profiles WHERE account_id = ?")
      .bind(this.account.id)
      .first<SocialRow>())!;
  }

  /** Returns consented summaries only; selects team owners before indexed journal lookups. */
  async read(now = new Date()): Promise<FriendsData> {
    const id = this.account.id;
    const me = await this.profile();
    const { start, today, feedStart } = FriendsService.week(
      now,
      this.account.timeZone,
    );
    const connections = await this.db
      .prepare(
        `SELECT a.id, a.display_name, f.sender_id, f.status,
      COALESCE(p.weekly_target,3) AS weekly_target, COALESCE(p.gym, '') AS gym, COALESCE(p.focus, '') AS focus, COALESCE(p.active_until, 0) AS active_until,
      (SELECT COUNT(*) FROM workouts w WHERE w.owner_id = a.platform_id AND w.date >= ? AND w.date <= ?) AS week_workouts
      FROM friendships f JOIN accounts a ON a.id = CASE WHEN f.low_id = ? THEN f.high_id ELSE f.low_id END
      LEFT JOIN social_profiles p ON p.account_id = a.id
      WHERE f.low_id = ? OR f.high_id = ? ORDER BY f.created_at DESC`,
      )
      .bind(start, today, id, id, id)
      .all<ConnectionRow>();
    const myCount = await this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM workouts WHERE owner_id = ? AND date >= ? AND date <= ?",
      )
      .bind(
        (await this.db
          .prepare("SELECT platform_id FROM accounts WHERE id = ?")
          .bind(id)
          .first<{ platform_id: string }>())!.platform_id,
        start,
        today,
      )
      .first<{ n: number }>();
    const rows = await this.db
      .prepare(
        `SELECT w.id, w.payload, a.id AS athlete_id, a.display_name,
      (SELECT COUNT(*) FROM workout_kudos k WHERE k.workout_id = w.id) AS kudos_count,
      EXISTS(SELECT 1 FROM workout_kudos k WHERE k.workout_id = w.id AND k.account_id = ?) AS given
      FROM accounts a CROSS JOIN workouts w ON w.owner_id = a.platform_id
      WHERE a.id IN (SELECT ? UNION SELECT CASE WHEN f.low_id = ? THEN f.high_id ELSE f.low_id END
        FROM friendships f WHERE f.status = 'accepted' AND (f.low_id = ? OR f.high_id = ?))
        AND w.date >= ? AND w.date <= ?
      ORDER BY w.date DESC, w.updated_at DESC, w.id LIMIT 60`,
      )
      .bind(id, id, id, id, id, feedStart, today)
      .all<{
        id: string;
        payload: string;
        athlete_id: string;
        display_name: string;
        kudos_count: number;
        given: number;
      }>();
    const athlete = (row: ConnectionRow): Athlete => ({
      id: row.id,
      displayName: row.display_name,
      gym: row.gym,
      focus: row.focus,
      activeUntil: row.active_until,
      weekWorkouts: row.week_workouts,
      weeklyTarget: row.weekly_target,
    });
    return {
      me: {
        id,
        displayName: this.account.displayName,
        inviteCode: me.invite_code,
        gym: me.gym,
        focus: me.focus,
        activeUntil: me.active_until,
        weekWorkouts: myCount?.n ?? 0,
        weeklyTarget: me.weekly_target,
      },
      friends: connections.results
        .filter((row) => row.status === "accepted")
        .map(athlete),
      requests: connections.results
        .filter((row) => row.status === "pending")
        .map((row) => ({
          id: row.id,
          displayName: row.display_name,
          direction: row.sender_id === id ? "outgoing" : "incoming",
        })),
      feed: rows.results.map((row): FriendWorkout => {
        const workout = JSON.parse(row.payload) as Workout;
        return {
          id: row.id,
          athleteId: row.athlete_id,
          displayName: row.display_name,
          name: workout.name,
          date: workout.date,
          duration: workout.duration,
          ...FriendsService.workout(workout),
          kudosCount: row.kudos_count,
          hasGivenKudos: !!row.given,
        };
      }),
      weekStart: start,
      today,
      serverTime: now.getTime(),
    };
  }

  async goal(value: unknown) {
    await this.profile();
    await this.db
      .prepare("UPDATE social_profiles SET weekly_target=? WHERE account_id=?")
      .bind(num(value, 1, 14, true), this.account.id)
      .run();
  }

  /** Creates a pending invitation without auto-accepting reverse requests; limits guessing. */
  async request(value: unknown) {
    const code = FriendsService.inviteCode(str(value, 200, 1));
    if (!code)
      throw new InputError("Введи код из 12 символов или ссылку приглашения");
    const now = Date.now();
    const attempts = await this.db
      .prepare(
        `INSERT INTO auth_limits (platform_id, attempts, window_start) VALUES (?, 1, ?)
      ON CONFLICT(platform_id) DO UPDATE SET attempts = CASE WHEN window_start < ? THEN 1 ELSE attempts + 1 END,
      window_start = CASE WHEN window_start < ? THEN excluded.window_start ELSE window_start END RETURNING attempts`,
      )
      .bind(`social:${this.account.id}`, now, now - 900000, now - 900000)
      .first<{ attempts: number }>();
    if ((attempts?.attempts ?? 31) > 30)
      throw new AuthError(
        "Слишком много приглашений. Попробуй через 15 минут.",
        429,
      );
    const target = await this.db
      .prepare("SELECT account_id FROM social_profiles WHERE invite_code = ?")
      .bind(code)
      .first<{ account_id: string }>();
    if (!target)
      throw new AuthError(
        "Код не найден. Попроси друга прислать приглашение ещё раз.",
        404,
      );
    if (target.account_id === this.account.id)
      throw new InputError("Это твой код. Отправь его другу.");
    const [low, high] = [this.account.id, target.account_id].sort();
    const count = await this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM friendships WHERE low_id = ? OR high_id = ?",
      )
      .bind(this.account.id, this.account.id)
      .first<{ n: number }>();
    if ((count?.n ?? 0) >= 100)
      throw new InputError(
        "В списке уже 100 напарников и заявок. Удали ненужные заявки.",
      );
    // A reverse invitation stays pending: only the recipient explicitly accepts.
    await this.db
      .prepare(
        "INSERT INTO friendships (low_id, high_id, sender_id, status, created_at) VALUES (?, ?, ?, 'pending', ?) ON CONFLICT(low_id, high_id) DO NOTHING",
      )
      .bind(low, high, this.account.id, now)
      .run();
  }

  /** Accepts only invitations received by this account; safe to retry. */
  async accept(otherId: string) {
    const [low, high] = [this.account.id, otherId].sort();
    const row = await this.db
      .prepare(
        "UPDATE friendships SET status = 'accepted' WHERE low_id = ? AND high_id = ? AND sender_id != ? RETURNING status",
      )
      .bind(low, high, this.account.id)
      .first();
    if (!row)
      throw new AuthError("Входящая заявка не найдена. Обнови список.", 404);
  }

  /** Atomically revokes the pair and its mutual reactions. */
  async remove(otherId: string) {
    const [low, high] = [this.account.id, otherId].sort();
    await this.db.batch([
      this.db
        .prepare(
          `DELETE FROM workout_kudos WHERE
        (account_id = ? AND workout_id IN (SELECT w.id FROM workouts w JOIN accounts a ON a.platform_id = w.owner_id WHERE a.id = ?)) OR
        (account_id = ? AND workout_id IN (SELECT w.id FROM workouts w JOIN accounts a ON a.platform_id = w.owner_id WHERE a.id = ?))`,
        )
        .bind(this.account.id, otherId, otherId, this.account.id),
      this.db
        .prepare("DELETE FROM friendships WHERE low_id = ? AND high_id = ?")
        .bind(low, high),
    ]);
  }

  /** Persists an explicit check-in with a server-owned two-hour expiry. */
  async status(value: Record<string, unknown>) {
    if (typeof value.inGym !== "boolean")
      throw new InputError("Укажи статус тренировки");
    const gym = str(value.gym, 60),
      focus = str(value.focus, 80);
    await this.profile();
    await this.db
      .prepare(
        "UPDATE social_profiles SET gym = ?, focus = ?, active_until = ? WHERE account_id = ?",
      )
      .bind(
        gym,
        focus,
        value.inGym ? Date.now() + FriendsService.gymSessionMs : 0,
        this.account.id,
      )
      .run();
  }

  /** Sets a reaction idempotently, authorizing friendship inside the insert. */
  async kudos(workoutId: string, given: unknown) {
    if (typeof given !== "boolean")
      throw new InputError("Проверь отметку респекта");
    const id = this.account.id;
    // Authorization is part of the write, so a concurrent unfriend cannot leak a reaction.
    const permitted = `SELECT w.id, ? FROM workouts w JOIN accounts a ON a.platform_id = w.owner_id
      WHERE w.id = ? AND a.id != ? AND ${connected}`;
    const exists = await this.db
      .prepare(
        `SELECT w.id FROM workouts w JOIN accounts a ON a.platform_id = w.owner_id
      WHERE w.id = ? AND a.id != ? AND ${connected}`,
      )
      .bind(workoutId, id, id, id)
      .first();
    if (!exists)
      throw new AuthError(
        "Тренировка напарника недоступна. Обнови ленту.",
        404,
      );
    if (given)
      await this.db
        .prepare(
          `INSERT INTO workout_kudos (workout_id, account_id) ${permitted} ON CONFLICT(workout_id, account_id) DO NOTHING`,
        )
        .bind(id, workoutId, id, id, id)
        .run();
    else
      await this.db
        .prepare(
          "DELETE FROM workout_kudos WHERE workout_id = ? AND account_id = ?",
        )
        .bind(workoutId, id)
        .run();
  }
}
