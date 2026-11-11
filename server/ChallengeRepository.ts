import { AuthError } from "./AccountService";
import { InputError, object, str, num } from "./validation";
import type { AccountProfile } from "../src/lib/account";
import { localDate, addCalendarDays, weekStart } from "../src/lib/calendar";
import {
  TeamChallengeProgress,
  type TeamChallenge,
  type ChallengeParticipant,
} from "../src/domain/TeamChallenge";
type Row = {
  id: string;
  host_id: string;
  name: string;
  start_date: string;
  cancelled: number;
  response: ChallengeParticipant["response"];
};
/** Challenge membership is explicit, and host friendship is checked for reads and writes. */
export class ChallengeRepository {
  constructor(
    private db: D1Database,
    private account: AccountProfile,
  ) {}
  private async access(id: string) {
    const row = await this.db
      .prepare(
        `SELECT c.*,p.response FROM team_challenges c JOIN challenge_participants p ON p.challenge_id=c.id AND p.account_id=? WHERE c.id=? AND (c.host_id=? OR EXISTS(SELECT 1 FROM friendships f WHERE f.status='accepted' AND ((f.low_id=? AND f.high_id=c.host_id)OR(f.high_id=? AND f.low_id=c.host_id))))`,
      )
      .bind(
        this.account.id,
        id,
        this.account.id,
        this.account.id,
        this.account.id,
      )
      .first<Row>();
    if (!row) throw new AuthError("Челлендж недоступен. Обнови команду.", 404);
    return row;
  }
  async read(): Promise<{ challenges: TeamChallenge[]; accountId: string }> {
    const today = localDate(new Date(), this.account.timeZone);
    const ids = await this.db
      .prepare(
        "SELECT c.id FROM team_challenges c JOIN challenge_participants p ON p.challenge_id=c.id WHERE p.account_id=? AND c.start_date>=? ORDER BY c.start_date DESC,c.id LIMIT 20",
      )
      .bind(this.account.id, addCalendarDays(today, -90))
      .all<{ id: string }>();
    const challenges: TeamChallenge[] = [];
    for (const { id } of ids.results) {
      let c: Row;
      try {
        c = await this.access(id);
      } catch (e) {
        if (e instanceof AuthError && e.status === 404) continue;
        throw e;
      }
      const visible =
        c.host_id === this.account.id || c.response === "accepted";
      const people = await this.db
        .prepare(
          `SELECT p.account_id,p.response,p.target,a.display_name,a.time_zone FROM challenge_participants p JOIN accounts a ON a.id=p.account_id WHERE p.challenge_id=? AND (p.account_id=? OR p.account_id=? OR EXISTS(SELECT 1 FROM friendships f WHERE f.status='accepted' AND ((f.low_id=? AND f.high_id=p.account_id)OR(f.high_id=? AND f.low_id=p.account_id)))) ORDER BY p.account_id`,
        )
        .bind(id, this.account.id, c.host_id, c.host_id, c.host_id)
        .all<{
          account_id: string;
          response: ChallengeParticipant["response"];
          target: number;
          display_name: string;
          time_zone: string;
        }>();
      // Select team owners first; workout payloads never leave this repository.
      const counts = visible
        ? await this.db
            .prepare(
              `SELECT p.account_id,w.date,COUNT(*) AS n FROM challenge_participants p JOIN accounts a ON a.id=p.account_id JOIN workouts w ON w.owner_id=a.platform_id AND w.date>=? AND w.date<=? WHERE p.challenge_id=? AND p.response='accepted' AND EXISTS(SELECT 1 FROM json_each(w.payload,'$.exercises') e,json_each(e.value,'$.sets') s WHERE json_extract(s.value,'$.done')=1 AND COALESCE(json_extract(s.value,'$.warmup'),0)=0) GROUP BY p.account_id,w.date`,
            )
            .bind(c.start_date, addCalendarDays(c.start_date, 27), id)
            .all<{ account_id: string; date: string; n: number }>()
        : { results: [] };
      const participants = people.results
        .filter(
          (p) =>
            p.account_id === this.account.id ||
            p.account_id === c.host_id ||
            (visible &&
              (p.response === "accepted" || c.host_id === this.account.id)),
        )
        .map((p) => ({
          id: p.account_id,
          displayName: p.display_name,
          response: p.response,
          target: p.target,
          ...(visible && p.response === "accepted"
            ? {
                weeks: TeamChallengeProgress.weeks(
                  c.start_date,
                  localDate(new Date(), p.time_zone),
                  p.target,
                  counts.results.filter((w) => w.account_id === p.account_id),
                ),
              }
            : {}),
        }));
      challenges.push({
        id,
        hostId: c.host_id,
        name: c.name,
        startDate: c.start_date,
        endDate: addCalendarDays(c.start_date, 27),
        today,
        cancelled: !!c.cancelled,
        myResponse: c.response,
        participants,
      });
    }
    return { challenges, accountId: this.account.id };
  }
  async create(input: unknown) {
    const v = object(input);
    if (v.accountId !== this.account.id)
      throw new AuthError("Аккаунт изменился. Обнови команду.", 401);
    const id = str(v.id, 80, 1),
      name = str(v.name, 80, 1),
      start = str(v.startDate, 10, 10),
      target = num(v.target, 1, 14, true);
    const today = localDate(new Date(), this.account.timeZone);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
      Number.isNaN(Date.parse(start)) ||
      new Date(start + "T12:00:00Z").toISOString().slice(0, 10) !== start ||
      new Date(start + "T12:00:00Z").getUTCDay() !== 1 ||
      start < weekStart(new Date(), this.account.timeZone) ||
      start > addCalendarDays(today, 30)
    )
      throw new InputError(
        "Выбери понедельник текущей или ближайших четырёх недель",
      );
    if (
      !Array.isArray(v.friendIds) ||
      !v.friendIds.length ||
      v.friendIds.length > 20
    )
      throw new InputError("Выбери от 1 до 20 напарников");
    const friendIds = [...new Set(v.friendIds.map((x) => str(x, 80, 1)))];
    for (const other of friendIds) {
      const [low, high] = [this.account.id, other].sort();
      if (
        !(await this.db
          .prepare(
            "SELECT 1 FROM friendships WHERE low_id=? AND high_id=? AND status='accepted'",
          )
          .bind(low, high)
          .first())
      )
        throw new AuthError("Приглашать можно только принятых напарников", 403);
    }
    const exists = await this.db
      .prepare("SELECT * FROM team_challenges WHERE id=?")
      .bind(id)
      .first<Row>();
    if (exists) {
      if (
        exists.host_id !== this.account.id ||
        exists.name !== name ||
        exists.start_date !== start
      )
        throw new AuthError(
          "Челлендж с таким идентификатором уже существует",
          409,
        );
      const participants = await this.db
        .prepare(
          "SELECT account_id,target FROM challenge_participants WHERE challenge_id=?",
        )
        .bind(id)
        .all<{ account_id: string; target: number }>();
      if (
        participants.results.find((p) => p.account_id === this.account.id)
          ?.target !== target ||
        JSON.stringify(participants.results.map((p) => p.account_id).sort()) !==
          JSON.stringify([this.account.id, ...friendIds].sort())
      )
        throw new AuthError(
          "Условия приглашения изменились. Создай новый челлендж.",
          409,
        );
      return { id };
    }
    const active = await this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM team_challenges WHERE host_id=? AND start_date>=? AND cancelled=0",
      )
      .bind(this.account.id, addCalendarDays(today, -27))
      .first<{ n: number }>();
    if ((active?.n ?? 0) >= 5)
      throw new InputError("Можно вести до пяти активных челленджей");
    await this.db.batch([
      this.db
        .prepare(
          "INSERT INTO team_challenges(id,host_id,name,start_date,cancelled,created_at) VALUES(?,?,?,?,0,?)",
        )
        .bind(id, this.account.id, name, start, new Date().toISOString()),
      this.db
        .prepare(
          "INSERT INTO challenge_participants(challenge_id,account_id,response,target,joined_at) VALUES(?,?,'accepted',?,?)",
        )
        .bind(id, this.account.id, target, new Date().toISOString()),
      ...friendIds.map((other) =>
        this.db
          .prepare(
            "INSERT INTO challenge_participants(challenge_id,account_id,response,target) VALUES(?,?,'invited',3)",
          )
          .bind(id, other),
      ),
    ]);
    return { id };
  }
  async act(id: string, input: unknown) {
    const c = await this.access(id),
      v = object(input);
    if (v.accountId !== this.account.id)
      throw new AuthError("Аккаунт изменился. Обнови команду.", 401);
    if (v.action === "cancel") {
      if (c.host_id !== this.account.id)
        throw new AuthError("Отменить челлендж может организатор", 403);
      await this.db
        .prepare("UPDATE team_challenges SET cancelled=1 WHERE id=?")
        .bind(id)
        .run();
      return;
    }
    if (c.cancelled) throw new InputError("Челлендж отменён");
    if (
      addCalendarDays(c.start_date, 27) <
      localDate(new Date(), this.account.timeZone)
    )
      throw new InputError("Четыре недели уже завершились");
    if (v.action === "accept") {
      if (c.response === "accepted") return; // Retries cannot change a target midway through a challenge.
      await this.db
        .prepare(
          "UPDATE challenge_participants SET response='accepted',target=CASE WHEN joined_at IS NULL THEN ? ELSE target END,joined_at=COALESCE(joined_at,?) WHERE challenge_id=? AND account_id=?",
        )
        .bind(
          num(v.target, 1, 14, true),
          new Date().toISOString(),
          id,
          this.account.id,
        )
        .run();
      return;
    }
    if (v.action === "decline") {
      if (c.host_id === this.account.id)
        throw new InputError("Организатор может отменить челлендж");
      await this.db
        .prepare(
          "UPDATE challenge_participants SET response='declined' WHERE challenge_id=? AND account_id=?",
        )
        .bind(id, this.account.id)
        .run();
      return;
    }
    throw new InputError("Неизвестное действие");
  }
}
