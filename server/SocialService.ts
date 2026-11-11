import type { Workout } from "../src/lib/model";
import { WorkoutPresenter } from "../src/domain/WorkoutPresenter";
import { StandingsBoard, WorkoutTally } from "../src/domain/LiveSession";
import {
  MAX_FOLLOWING,
  TAG_PATTERN,
  normalizeTag,
  type AthleteProfile,
  type FeedWorkout,
  type FollowedAthlete,
  type IncomingAthlete,
  type SocialOverview,
} from "../src/lib/social";
import { InputError, object, str } from "./validation";

const FEED_DAYS = 45;
const FEED_LIMIT = 40;
const INCOMING_LIMIT = 20;
/** Потолок на чтение тренировок недели: 51 человек × 11 тренировок. */
const WEEK_LIMIT = 600;
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const NOT_FOUND = "Атлет с таким тегом не найден или закрыл профиль";

/**
 * Напарники. Видно только то, что человек сам открыл: профиль закрыт, пока он не
 * включит «Показывать тренировки напарникам», а в ленту попадает итог тренировки
 * (название, подходы, тоннаж, время, мышцы) — без заметок, весов и упражнений.
 */
export class SocialService {
  constructor(
    private db: D1Database,
    private owner: string,
  ) {}

  async overview(): Promise<SocialOverview> {
    const [profile, followers, following, week, feedRows, incomingRows, me, weekRows] = await this.db.batch([
      this.db.prepare("SELECT tag,bio,is_public FROM athlete_profiles WHERE owner_id=?").bind(this.owner),
      this.db.prepare("SELECT COUNT(*) AS n FROM follows f JOIN athlete_profiles p ON p.owner_id=f.followee_id WHERE f.followee_id=? AND p.is_public=1").bind(this.owner),
      this.db
        .prepare(
          "SELECT p.owner_id,p.tag,p.bio,a.display_name,EXISTS(SELECT 1 FROM follows b WHERE b.follower_id=f.followee_id AND b.followee_id=?) AS mutual FROM follows f JOIN athlete_profiles p ON p.owner_id=f.followee_id AND p.is_public=1 JOIN accounts a ON a.platform_id=f.followee_id WHERE f.follower_id=? ORDER BY p.tag",
        )
        .bind(this.owner, this.owner),
      this.db
        .prepare(
          "SELECT w.owner_id,MAX(w.date) AS last,SUM(w.date>=?) AS week FROM workouts w JOIN follows f ON f.followee_id=w.owner_id AND f.follower_id=? JOIN athlete_profiles p ON p.owner_id=w.owner_id AND p.is_public=1 GROUP BY w.owner_id",
        )
        .bind(day(-6), this.owner),
      this.db
        .prepare(
          "SELECT w.id,w.owner_id,w.payload,p.tag,a.display_name FROM workouts w JOIN follows f ON f.followee_id=w.owner_id AND f.follower_id=? JOIN athlete_profiles p ON p.owner_id=w.owner_id AND p.is_public=1 JOIN accounts a ON a.platform_id=w.owner_id WHERE w.date>=? ORDER BY w.date DESC,w.updated_at DESC LIMIT ?",
        )
        .bind(this.owner, day(-FEED_DAYS), FEED_LIMIT),
      // Подписчики с открытым профилем, на которых я ещё не подписан. Пока мой профиль закрыт, подписчиков для меня нет.
      this.db
        .prepare(
          "SELECT p.tag,p.bio,a.display_name FROM follows f JOIN athlete_profiles me ON me.owner_id=f.followee_id AND me.is_public=1 JOIN athlete_profiles p ON p.owner_id=f.follower_id AND p.is_public=1 JOIN accounts a ON a.platform_id=f.follower_id WHERE f.followee_id=?1 AND NOT EXISTS (SELECT 1 FROM follows b WHERE b.follower_id=?1 AND b.followee_id=f.follower_id) ORDER BY f.created_at DESC LIMIT ?2",
        )
        .bind(this.owner, INCOMING_LIMIT),
      this.db.prepare("SELECT display_name FROM accounts WHERE platform_id=?").bind(this.owner),
      // Тренировки недели: мои и тех, за кем слежу при открытом профиле. Нужны только для итогов, наружу не уходят.
      this.db
        .prepare(
          "SELECT w.owner_id,w.payload FROM workouts w WHERE w.date>=?1 AND (w.owner_id=?2 OR w.owner_id IN (SELECT f.followee_id FROM follows f JOIN athlete_profiles p ON p.owner_id=f.followee_id AND p.is_public=1 WHERE f.follower_id=?2)) LIMIT ?3",
        )
        .bind(day(-6), this.owner, WEEK_LIMIT),
    ]);

    const activity = new Map(
      (week.results as { owner_id: string; last: string; week: number }[]).map((r) => [r.owner_id, r]),
    );
    const ownProfile = profile.results[0] as { tag: string; bio: string; is_public: number } | undefined;
    const rows = feedRows.results as { id: string; payload: string; tag: string; display_name: string }[];
    const followed = following.results as {
      owner_id: string;
      tag: string;
      bio: string;
      display_name: string;
      mutual: number;
    }[];

    const weekly = new Map<string, Workout[]>();
    for (const row of weekRows.results as { owner_id: string; payload: string }[])
      weekly.set(row.owner_id, [...(weekly.get(row.owner_id) ?? []), JSON.parse(row.payload) as Workout]);
    const standings = StandingsBoard.rank([
      {
        tag: ownProfile?.tag ?? "",
        displayName: (me.results[0] as { display_name: string } | undefined)?.display_name ?? "Ты",
        isMe: true,
        ...WorkoutTally.of(weekly.get(this.owner) ?? []),
      },
      ...followed.map((r) => ({
        tag: r.tag,
        displayName: r.display_name,
        isMe: false,
        ...WorkoutTally.of(weekly.get(r.owner_id) ?? []),
      })),
    ]);

    const kudos = new Map<string, { n: number; mine: number }>();
    if (rows.length) {
      const counted = await this.db
        .prepare(
          `SELECT workout_id,COUNT(*) AS n,MAX(giver_id=?) AS mine FROM kudos WHERE workout_id IN (${rows.map(() => "?").join(",")}) GROUP BY workout_id`,
        )
        .bind(this.owner, ...rows.map((r) => r.id))
        .all<{ workout_id: string; n: number; mine: number }>();
      for (const r of counted.results) kudos.set(r.workout_id, { n: r.n, mine: r.mine });
    }

    return {
      profile: ownProfile ? { tag: ownProfile.tag, bio: ownProfile.bio, isPublic: ownProfile.is_public === 1 } : null,
      followers: (followers.results[0] as { n: number }).n,
      following: followed.map(
        (r): FollowedAthlete => ({
          tag: r.tag,
          bio: r.bio,
          displayName: r.display_name,
          lastDate: activity.get(r.owner_id)?.last ?? null,
          workoutsLast7Days: activity.get(r.owner_id)?.week ?? 0,
          // Пока мой профиль закрыт, меня никто не видит, и «взаимно» ничего не значит.
          mutual: ownProfile?.is_public === 1 && r.mutual === 1,
        }),
      ),
      incoming: (incomingRows.results as { tag: string; bio: string; display_name: string }[]).map(
        (r): IncomingAthlete => ({ tag: r.tag, displayName: r.display_name, bio: r.bio }),
      ),
      standings,
      feed: rows.map((r): FeedWorkout => {
        const workout = JSON.parse(r.payload) as Workout;
        const count = kudos.get(r.id);
        const tally = WorkoutTally.of([workout]);
        return {
          id: r.id,
          date: workout.date,
          title: WorkoutPresenter.title(workout),
          sets: tally.sets,
          tonnageKg: tally.tonnageKg,
          duration: workout.duration,
          muscles: WorkoutPresenter.topMuscles(workout, 3),
          kudos: count?.n ?? 0,
          kudosByMe: count?.mine === 1,
          athlete: { tag: r.tag, displayName: r.display_name },
        };
      }),
    };
  }

  async saveProfile(input: unknown): Promise<AthleteProfile> {
    const v = object(input);
    const tag = normalizeTag(str(v.tag, 40, 1));
    if (!TAG_PATTERN.test(tag)) throw new InputError("Тег: 3–20 символов — латиница, цифры и «_»");
    const bio = str(v.bio ?? "", 140);
    if (typeof v.isPublic !== "boolean") throw new InputError("Проверь настройку видимости");
    try {
      await this.db
        .prepare(
          "INSERT INTO athlete_profiles (owner_id,tag,bio,is_public,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET tag=excluded.tag,bio=excluded.bio,is_public=excluded.is_public,updated_at=excluded.updated_at",
        )
        .bind(this.owner, tag, bio, v.isPublic ? 1 : 0, new Date().toISOString())
        .run();
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new InputError("Этот тег уже занят");
      throw error;
    }
    return { tag, bio, isPublic: v.isPublic };
  }

  async follow(input: unknown) {
    const tag = normalizeTag(str(object(input).tag, 40, 1));
    const target = await this.db
      .prepare("SELECT owner_id FROM athlete_profiles WHERE tag=? AND is_public=1")
      .bind(tag)
      .first<{ owner_id: string }>();
    if (!target) throw new InputError(NOT_FOUND);
    if (target.owner_id === this.owner) throw new InputError("Это твой собственный тег");
    const count = await this.db
      .prepare("SELECT COUNT(*) AS n FROM follows WHERE follower_id=?")
      .bind(this.owner)
      .first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_FOLLOWING) throw new InputError(`Можно следить не больше чем за ${MAX_FOLLOWING} напарниками`);
    await this.db
      .prepare("INSERT OR IGNORE INTO follows (follower_id,followee_id,created_at) VALUES (?,?,?)")
      .bind(this.owner, target.owner_id, new Date().toISOString())
      .run();
  }

  async unfollow(tag: string) {
    await this.db
      .prepare("DELETE FROM follows WHERE follower_id=? AND followee_id=(SELECT owner_id FROM athlete_profiles WHERE tag=?)")
      .bind(this.owner, normalizeTag(tag))
      .run();
  }

  /** Kudos можно поставить только тренировке напарника, за которым следишь и чей профиль открыт. */
  async kudos(input: unknown) {
    const v = object(input);
    const workoutId = str(v.workoutId, 80, 1);
    if (typeof v.give !== "boolean") throw new InputError("Проверь отметку");
    const visible = await this.db
      .prepare(
        "SELECT 1 AS ok FROM workouts w JOIN follows f ON f.followee_id=w.owner_id AND f.follower_id=? JOIN athlete_profiles p ON p.owner_id=w.owner_id AND p.is_public=1 WHERE w.id=?",
      )
      .bind(this.owner, workoutId)
      .first();
    if (!visible) throw new InputError("Тренировка недоступна");
    await (v.give
      ? this.db.prepare("INSERT OR IGNORE INTO kudos (workout_id,giver_id,created_at) VALUES (?,?,?)").bind(workoutId, this.owner, new Date().toISOString())
      : this.db.prepare("DELETE FROM kudos WHERE workout_id=? AND giver_id=?").bind(workoutId, this.owner)
    ).run();
    const n = await this.db.prepare("SELECT COUNT(*) AS n FROM kudos WHERE workout_id=?").bind(workoutId).first<{ n: number }>();
    return { kudos: n?.n ?? 0, kudosByMe: v.give };
  }
}
