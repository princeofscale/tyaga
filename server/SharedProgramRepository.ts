import type { AccountProfile } from "../src/lib/account";
import { FriendsService } from "../src/domain/FriendsService";
import type {
  SharedProgram,
  SharedProgramKind,
  SharedProgramMember,
  SharedProgramPayload,
} from "../src/domain/SharedProgram";
import { InputError, str } from "./validation";

type ProgramRow = {
  id: string;
  owner_id: string;
  owner_name: string;
  title: string;
  kind: string;
  payload: string;
  created_at: string;
};

type MemberRow = {
  program_id: string;
  account_id: string;
  display_name: string;
  role: string;
  adopted_at: string | null;
  week_workouts: number;
};

const VALID_KINDS = new Set<SharedProgramKind>(["laid_dup", "template", "routine", "custom"]);

export class SharedProgramRepository {
  private initialized = false;

  constructor(
    private db: D1Database,
    private account: AccountProfile,
  ) {}

  private async ensure() {
    if (this.initialized) return;
    await this.db.batch([
      this.db.prepare(`CREATE TABLE IF NOT EXISTS shared_programs (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`),
      this.db.prepare(`CREATE TABLE IF NOT EXISTS shared_program_members (
        program_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        role TEXT NOT NULL,
        adopted_at TEXT,
        PRIMARY KEY (program_id, account_id)
      )`),
      this.db.prepare(`CREATE INDEX IF NOT EXISTS idx_shared_program_member ON shared_program_members(account_id, program_id)`),
    ]);
    this.initialized = true;
  }

  private async acceptedFriendIds(): Promise<Set<string>> {
    const id = this.account.id;
    const { results } = await this.db
      .prepare(
        `SELECT CASE WHEN low_id = ? THEN high_id ELSE low_id END AS friend_id
         FROM friendships
         WHERE status = 'accepted' AND (low_id = ? OR high_id = ?)`,
      )
      .bind(id, id, id)
      .all<{ friend_id: string }>();
    return new Set(results.map((r) => r.friend_id));
  }

  async read(now = new Date()): Promise<SharedProgram[]> {
    await this.ensure();
    const id = this.account.id;
    const { start, today } = FriendsService.week(now, this.account.timeZone);
    const { results: rows } = await this.db
      .prepare(
        `SELECT p.id, p.owner_id, COALESCE(a.display_name, 'Атлет') AS owner_name,
                p.title, p.kind, p.payload, p.created_at
         FROM shared_programs p
         JOIN shared_program_members m ON m.program_id = p.id
         LEFT JOIN accounts a ON a.id = p.owner_id
         WHERE m.account_id = ?
         ORDER BY p.updated_at DESC
         LIMIT 30`,
      )
      .bind(id)
      .all<ProgramRow>();

    if (!rows.length) return [];

    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(",");
    const { results: members } = await this.db
      .prepare(
        `SELECT m.program_id, m.account_id, COALESCE(a.display_name, 'Атлет') AS display_name,
                m.role, m.adopted_at,
                (SELECT COUNT(*) FROM workouts w
                 WHERE w.owner_id = COALESCE(a.user_id, '')
                   AND w.deleted = 0
                   AND w.date >= ? AND w.date <= ?) AS week_workouts
         FROM shared_program_members m
         LEFT JOIN accounts a ON a.id = m.account_id
         WHERE m.program_id IN (${placeholders})`,
      )
      .bind(start, today, ...ids)
      .all<MemberRow>();

    const byProgram = new Map<string, SharedProgramMember[]>();
    for (const row of members) {
      const list = byProgram.get(row.program_id) ?? [];
      list.push({
        accountId: row.account_id,
        displayName: row.display_name,
        role: row.role === "owner" ? "owner" : "member",
        adopted: !!row.adopted_at,
        weekWorkouts: Number(row.week_workouts ?? 0),
      });
      byProgram.set(row.program_id, list);
    }

    return rows.map((row) => {
      let payload: SharedProgramPayload;
      try {
        payload = JSON.parse(row.payload) as SharedProgramPayload;
      } catch {
        payload = {};
      }
      const list = byProgram.get(row.id) ?? [];
      const me = list.find((m) => m.accountId === id);
      return {
        id: row.id,
        ownerId: row.owner_id,
        ownerName: row.owner_name,
        title: row.title,
        kind: (VALID_KINDS.has(row.kind as SharedProgramKind) ? row.kind : "custom") as SharedProgramKind,
        payload,
        createdAt: row.created_at,
        members: list,
        isOwner: row.owner_id === id,
        adoptedByMe: !!me?.adopted,
      };
    });
  }

  async create(raw: Record<string, unknown>, now = new Date()): Promise<{ id: string }> {
    await this.ensure();
    const title = str(raw.title, 80, 1);
    const kind = str(raw.kind, 20, 1) as SharedProgramKind;
    if (!VALID_KINDS.has(kind)) throw new InputError("Неизвестный тип программы");

    const rawFriendIds = Array.isArray(raw.friendIds) ? raw.friendIds : [];
    const accepted = await this.acceptedFriendIds();
    const invitedIds: string[] = [];
    for (const fid of rawFriendIds) {
      if (typeof fid === "string" && accepted.has(fid) && !invitedIds.includes(fid)) {
        invitedIds.push(fid);
      }
    }

    const payloadJson = JSON.stringify(raw.payload ?? {});
    if (payloadJson.length > 32_000) throw new InputError("Программа слишком большая");

    const id = crypto.randomUUID();
    const ts = now.toISOString();
    const ownerAdopted = raw.ownerAdopted === false ? null : ts;

    const stmts: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO shared_programs (id, owner_id, title, kind, payload, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, this.account.id, title, kind, payloadJson, ts, ts),
      this.db
        .prepare(
          `INSERT INTO shared_program_members (program_id, account_id, role, adopted_at)
           VALUES (?, ?, 'owner', ?)`,
        )
        .bind(id, this.account.id, ownerAdopted),
    ];

    for (const friendId of invitedIds.slice(0, 12)) {
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO shared_program_members (program_id, account_id, role, adopted_at)
             VALUES (?, ?, 'member', NULL)`,
          )
          .bind(id, friendId),
      );
    }

    await this.db.batch(stmts);
    return { id };
  }

  async adopt(programId: string, now = new Date()): Promise<void> {
    await this.ensure();
    const id = str(programId, 80, 1);
    const ts = now.toISOString();
    const res = await this.db
      .prepare(
        `UPDATE shared_program_members
         SET adopted_at = ?
         WHERE program_id = ? AND account_id = ?`,
      )
      .bind(ts, id, this.account.id)
      .run();
    if (!res.meta.changes) throw new InputError("Программа не найдена");
  }

  async remove(programId: string): Promise<void> {
    await this.ensure();
    const id = str(programId, 80, 1);
    const row = await this.db
      .prepare(`SELECT owner_id FROM shared_programs WHERE id = ?`)
      .bind(id)
      .first<{ owner_id: string }>();
    if (!row) return;
    if (row.owner_id === this.account.id) {
      await this.db.batch([
        this.db.prepare(`DELETE FROM shared_program_members WHERE program_id = ?`).bind(id),
        this.db.prepare(`DELETE FROM shared_programs WHERE id = ?`).bind(id),
      ]);
    } else {
      await this.db
        .prepare(`DELETE FROM shared_program_members WHERE program_id = ? AND account_id = ?`)
        .bind(id, this.account.id)
        .run();
    }
  }
}
