import { BiomechanicalMuscleAgent } from "../src/domain/BiomechanicalMuscleAgent";
import { BiomechanicalVerifier } from "../src/domain/BiomechanicalVerifier";
import { KinematicMuscleSolver } from "../src/domain/KinematicMuscleSolver";
import {
  SOLVER_VERSION_V4,
  TYAGA_V4_JSON_SCHEMA,
  TYAGA_V4_SYSTEM_PROMPT,
  type AgentResolveRequest,
  type AgentResolveResponse,
  type ClarifyingParam,
  type JointActionKey,
  type KinematicDescriptor,
} from "../src/domain/KinematicTypesV4";

export interface AgentProviderEnv {
  AI?: {
    run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
  };
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
}

const WORKERS_AI_TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const WORKERS_AI_VISION_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

function extractJsonObject(raw: unknown): LlmExtractedPayload | null {
  if (!raw) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.actions) && obj.geometry && obj.profile) {
      return obj as unknown as LlmExtractedPayload;
    }
    if (obj.response !== undefined) return extractJsonObject(obj.response);
    if (Array.isArray(obj.choices)) {
      const first = obj.choices[0] as { message?: { content?: unknown } } | undefined;
      if (first?.message?.content !== undefined) return extractJsonObject(first.message.content);
    }
    return null;
  }
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as LlmExtractedPayload;
    if (!parsed || !Array.isArray(parsed.actions) || !parsed.geometry || !parsed.profile) return null;
    return parsed;
  } catch {
    return null;
  }
}

interface LlmExtractedPayload {
  canonicalSlug: string;
  displayNameRu: string;
  displayNameEn: string;
  confidence: number;
  missingParams: ClarifyingParam[];
  rationale: string;
  actions: Array<{ action: JointActionKey; weight: number }>;
  geometry: KinematicDescriptor["geometry"];
  profile: KinematicDescriptor["profile"];
}

function normalizeAlias(text: string, brandHint?: string): string {
  return `${text} ${brandHint ?? ""}`
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

/**
 * Серверный ООП-сервис ИИ-агента биомеханической разметки мышц «Тяга v4» (Cloudflare Worker + D1).
 * Реализует каскад: Tier 1 (D1-кэш) -> Tier 2 (LLM/VLM Structured Output + 1 ретрай при hard_reject_retry) ->
 * Tier 3 (KinematicMuscleSolver + BiomechanicalVerifier 15 INV) -> Tier 4 (Offline RU/EN NLP фолбэк).
 */
export class BiomechanicsAgentService {
  private readonly db: D1Database;
  private readonly userId: string;
  private readonly providerEnv: AgentProviderEnv;
  private readonly solver = new KinematicMuscleSolver();
  private readonly verifier = new BiomechanicalVerifier();
  private readonly agent = new BiomechanicalMuscleAgent(this.solver, this.verifier);

  constructor(db: D1Database, userId: string, providerEnv: AgentProviderEnv = {}) {
    this.db = db;
    this.userId = userId;
    this.providerEnv = providerEnv;
  }

  async resolve(req: AgentResolveRequest): Promise<AgentResolveResponse> {
    const t0 = Date.now();
    const queryText = String(req.queryText ?? "").trim().slice(0, 240);
    if (!queryText) {
      throw new Error("Опиши упражнение или тренажёр для анализа");
    }

    const alias = normalizeAlias(queryText, req.machineBrandHint);

    // 1. Tier 1: Проверка кэша D1 (если нет фото — текстовый поиск по алиасу/слагу)
    if (!req.imageBase64) {
      const cached = await this.lookupD1(alias);
      if (cached) {
        const desc = KinematicMuscleSolver.applyExecutionProfile(cached.descriptor, req.executionProfile);
        const raw = this.solver.solveKinematics(desc);
        const ver = this.verifier.verifyAndCorrect(desc, raw);
        return {
          canonicalSlug: cached.canonicalSlug,
          displayName: cached.displayName,
          rationale: "Загружено из верифицированного биомеханического кэша Тяга v4.",
          source: "d1_cache",
          confidence: cached.confidence,
          descriptor: desc,
          solved: ver.correctedResult,
          verification: { passed: ver.passed, status: ver.status, violations: ver.violations },
          clarifyingQuestions: [],
          latencyMs: Date.now() - t0,
          solverVersion: SOLVER_VERSION_V4,
        };
      }
    }

    // 2. Tier 2A: Онлайн LLM/VLM через OpenAI-совместимый Structured Output (если задан ключ)
    if (this.providerEnv.OPENAI_API_KEY) {
      const llmRes = await this.tryLlmExtraction(queryText, req, t0);
      if (llmRes) {
        await this.persistCache(alias, req.machineBrandHint, llmRes);
        return llmRes;
      }
    }

    // 2. Tier 2B: Встроенный Cloudflare Workers AI (env.AI — бесплатно, без сторонних ключей!)
    if (this.providerEnv.AI) {
      const cfRes = await this.tryWorkersAiExtraction(queryText, req, t0);
      if (cfRes) {
        await this.persistCache(alias, req.machineBrandHint, cfRes);
        return cfRes;
      }
    }

    // 3. Tier 0 / Tier 4: Детерминированный оффлайн RU/EN NLP + Solver + Verifier
    const offline = this.agent.resolveOffline({ ...req, queryText });
    return { ...offline, latencyMs: Date.now() - t0 };
  }

  async clarify(body: {
    canonicalSlug: string;
    updatedDescriptor: KinematicDescriptor;
    executionPatch?: Record<string, unknown>;
  }) {
    const raw = this.solver.solveKinematics(body.updatedDescriptor);
    const verified = this.verifier.verifyAndCorrect(body.updatedDescriptor, raw);
    if (!verified.passed) {
      return { ok: false, verification: verified };
    }
    const now = Date.now();
    try {
      await this.db
        .prepare(
          `INSERT INTO exercise_user_overrides (user_id, canonical_slug, execution_json, descriptor_patch, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(user_id, canonical_slug) DO UPDATE SET
             execution_json = excluded.execution_json,
             descriptor_patch = excluded.descriptor_patch,
             updated_at = excluded.updated_at`,
        )
        .bind(
          this.userId,
          body.canonicalSlug,
          body.executionPatch ? JSON.stringify(body.executionPatch) : null,
          JSON.stringify(body.updatedDescriptor),
          now,
        )
        .run();
    } catch {
      // Игнорируем FK-промах для временных оффлайн-слагов, ещё не попавших в canonical_cache
    }
    return {
      ok: true,
      solved: verified.correctedResult,
      verification: {
        passed: verified.passed,
        status: verified.status,
        violations: verified.violations,
      },
    };
  }

  async submitFeedback(body: {
    canonicalSlug: string;
    proposedDescriptor?: KinematicDescriptor;
    manualMuscleJson?: Record<string, unknown>;
  }) {
    const now = Date.now();
    try {
      const existing = await this.db
        .prepare(
          `SELECT id, consensus_count FROM exercise_hitl_queue
           WHERE canonical_slug = ?1 AND status IN ('open','ready_for_review')
           ORDER BY id DESC LIMIT 1`,
        )
        .bind(body.canonicalSlug)
        .first<{ id: number; consensus_count: number }>();

      if (existing) {
        const nextCount = existing.consensus_count + 1;
        const nextStatus = nextCount >= 3 ? "ready_for_review" : "open";
        await this.db
          .prepare(
            `UPDATE exercise_hitl_queue SET consensus_count = ?1, status = ?2, updated_at = ?3 WHERE id = ?4`,
          )
          .bind(nextCount, nextStatus, now, existing.id)
          .run();
        return { ok: true, consensusCount: nextCount, status: nextStatus };
      }

      if (body.proposedDescriptor) {
        await this.db
          .prepare(
            `INSERT INTO exercise_hitl_queue (canonical_slug, reason, proposed_desc_json, consensus_count, status, created_at, updated_at)
             VALUES (?1, 'user_consensus', ?2, 1, 'open', ?3, ?3)`,
          )
          .bind(body.canonicalSlug, JSON.stringify(body.proposedDescriptor), now)
          .run();
      }
    } catch {
      // Таблица может быть не инициализирована в изолированном тестовом D1
    }
    return { ok: true, consensusCount: 1, status: "open" as const };
  }

  async syncCatalog(sinceMs = 0) {
    try {
      const rows = await this.db
        .prepare(
          `SELECT canonical_slug, display_name_ru, descriptor_json, solver_version, updated_at
           FROM exercise_canonical_cache
           WHERE status IN ('active','canonical') AND updated_at >= ?1
           ORDER BY hit_count DESC LIMIT 200`,
        )
        .bind(sinceMs)
        .all<{
          canonical_slug: string;
          display_name_ru: string;
          descriptor_json: string;
          solver_version: string;
          updated_at: number;
        }>();
      return {
        solverVersion: SOLVER_VERSION_V4,
        items: (rows.results ?? []).map((r) => ({
          canonicalSlug: r.canonical_slug,
          displayName: r.display_name_ru,
          descriptor: JSON.parse(r.descriptor_json) as KinematicDescriptor,
          solverVersion: r.solver_version,
          updatedAt: r.updated_at,
        })),
      };
    } catch {
      return { solverVersion: SOLVER_VERSION_V4, items: [] };
    }
  }

  private async lookupD1(alias: string): Promise<{
    canonicalSlug: string;
    displayName: string;
    descriptor: KinematicDescriptor;
    confidence: number;
  } | null> {
    try {
      const row = await this.db
        .prepare(
          `SELECT c.canonical_slug, c.display_name_ru, c.descriptor_json, c.confidence
           FROM exercise_aliases a
           JOIN exercise_canonical_cache c ON c.canonical_slug = a.canonical_slug
           WHERE a.alias_normalized = ?1 AND c.status IN ('active','canonical')
           LIMIT 1`,
        )
        .bind(alias)
        .first<{
          canonical_slug: string;
          display_name_ru: string;
          descriptor_json: string;
          confidence: number;
        }>();
      if (!row) return null;
      await this.db
        .prepare(`UPDATE exercise_canonical_cache SET hit_count = hit_count + 1, updated_at = ?1 WHERE canonical_slug = ?2`)
        .bind(Date.now(), row.canonical_slug)
        .run();
      return {
        canonicalSlug: row.canonical_slug,
        displayName: row.display_name_ru,
        descriptor: JSON.parse(row.descriptor_json) as KinematicDescriptor,
        confidence: row.confidence,
      };
    } catch {
      return null;
    }
  }

  private async persistCache(alias: string, brandHint: string | undefined, res: AgentResolveResponse) {
    const now = Date.now();
    try {
      await this.db
        .prepare(
          `INSERT INTO exercise_canonical_cache
            (canonical_slug, display_name_ru, display_name_en, input_hash, descriptor_json, solved_json,
             solver_version, source, model_used, confidence, verification_state, status, hit_count, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'active', 1, ?12, ?12)
           ON CONFLICT(canonical_slug) DO UPDATE SET
             hit_count = hit_count + 1,
             updated_at = excluded.updated_at`,
        )
        .bind(
          res.canonicalSlug,
          res.displayName,
          res.displayName,
          alias,
          JSON.stringify(res.descriptor),
          JSON.stringify(res.solved),
          SOLVER_VERSION_V4,
          res.source === "vlm_v4" ? "vlm_v4" : "llm_v4",
          res.modelUsed ?? null,
          res.confidence,
          res.verification.status === "auto_corrected" ? "auto_corrected" : "valid",
          now,
        )
        .run();

      await this.db
        .prepare(
          `INSERT OR IGNORE INTO exercise_aliases (alias_normalized, canonical_slug, locale, brand_hint, created_at)
           VALUES (?1, ?2, 'mixed', ?3, ?4)`,
        )
        .bind(alias, res.canonicalSlug, brandHint ?? null, now)
        .run();
    } catch {
      // Не ломаем ответ клиенту при ошибке записи в кэш
    }
  }

  private async tryLlmExtraction(
    queryText: string,
    req: AgentResolveRequest,
    t0: number,
  ): Promise<AgentResolveResponse | null> {
    const apiKey = this.providerEnv.OPENAI_API_KEY;
    if (!apiKey) return null;

    const baseUrl = (this.providerEnv.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    const model = this.providerEnv.OPENAI_MODEL ?? "gpt-4o-mini";

    const runCall = async (retryHint?: string): Promise<LlmExtractedPayload | null> => {
      const userParts: Array<Record<string, unknown>> = [
        {
          type: "text",
          text: [
            `Exercise / Machine: ${queryText}`,
            req.machineBrandHint ? `Brand/Model: ${req.machineBrandHint}` : "",
            req.executionProfile ? `ExecutionProfile: ${JSON.stringify(req.executionProfile)}` : "",
            retryHint ? `PREVIOUS VERIFIER ERROR (FIX THIS): ${retryHint}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ];
      if (req.imageBase64 && req.imageBase64.startsWith("data:image/")) {
        userParts.push({ type: "image_url", image_url: { url: req.imageBase64, detail: "low" } });
      }

      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: {
            type: "json_schema",
            json_schema: TYAGA_V4_JSON_SCHEMA,
          },
          messages: [
            { role: "system", content: TYAGA_V4_SYSTEM_PROMPT },
            { role: "user", content: userParts },
          ],
        }),
      });
      if (!resp.ok) return null;
      const body = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = body.choices?.[0]?.message?.content;
      if (!content) return null;
      return JSON.parse(content) as LlmExtractedPayload;
    };

    try {
      let extracted = await runCall();
      if (!extracted) return null;

      for (let attempt = 0; attempt < 2; attempt++) {
        const actionsRecord: KinematicDescriptor["actions"] = {};
        for (const item of extracted.actions) {
          actionsRecord[item.action] = item.weight;
        }
        const baseDesc: KinematicDescriptor = {
          actions: actionsRecord,
          geometry: extracted.geometry,
          profile: extracted.profile,
        };
        const descriptor = KinematicMuscleSolver.applyExecutionProfile(baseDesc, req.executionProfile);
        const raw = this.solver.solveKinematics(descriptor);
        const verified = this.verifier.verifyAndCorrect(descriptor, raw);

        if (verified.passed) {
          return {
            canonicalSlug: extracted.canonicalSlug,
            displayName: req.locale === "en" ? extracted.displayNameEn : extracted.displayNameRu,
            rationale: extracted.rationale,
            source: req.imageBase64 ? "vlm_v4" : "llm_v4",
            modelUsed: model,
            confidence: extracted.confidence,
            descriptor,
            solved: verified.correctedResult,
            verification: {
              passed: verified.passed,
              status: verified.status,
              violations: verified.violations,
            },
            clarifyingQuestions:
              extracted.confidence < 0.8
                ? BiomechanicalMuscleAgent.buildClarifyingQuestions(extracted.missingParams)
                : [],
            latencyMs: Date.now() - t0,
            solverVersion: SOLVER_VERSION_V4,
          };
        }

        if (attempt === 0) {
          const hint = verified.violations.map((v) => `${v.code}: ${v.detail}`).join("; ");
          const retried = await runCall(hint);
          if (!retried) return null;
          extracted = retried;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private async tryWorkersAiExtraction(
    queryText: string,
    req: AgentResolveRequest,
    t0: number,
  ): Promise<AgentResolveResponse | null> {
    const ai = this.providerEnv.AI;
    if (!ai) return null;

    const hasPhoto = Boolean(req.imageBase64 && req.imageBase64.startsWith("data:image/"));
    const model = hasPhoto ? WORKERS_AI_VISION_MODEL : WORKERS_AI_TEXT_MODEL;

    const runCall = async (retryHint?: string): Promise<LlmExtractedPayload | null> => {
      const textPrompt = [
        `Exercise / Machine: ${queryText}`,
        req.machineBrandHint ? `Brand/Model: ${req.machineBrandHint}` : "",
        req.executionProfile ? `ExecutionProfile: ${JSON.stringify(req.executionProfile)}` : "",
        retryHint ? `PREVIOUS VERIFIER ERROR (FIX THIS): ${retryHint}` : "",
        hasPhoto
          ? `Return ONLY valid JSON matching schema: ${JSON.stringify(TYAGA_V4_JSON_SCHEMA.schema)}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      const userContent = hasPhoto
        ? [
            { type: "text", text: textPrompt },
            { type: "image_url", image_url: { url: req.imageBase64 } },
          ]
        : textPrompt;

      const inputs: Record<string, unknown> = {
        messages: [
          { role: "system", content: TYAGA_V4_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        temperature: 0,
        max_tokens: 700,
      };
      if (!hasPhoto) {
        inputs.response_format = {
          type: "json_schema",
          json_schema: TYAGA_V4_JSON_SCHEMA.schema,
        };
      }

      const raw = await ai.run(model, inputs);
      return extractJsonObject(raw);
    };

    try {
      let extracted = await runCall();
      if (!extracted) return null;

      for (let attempt = 0; attempt < 2; attempt++) {
        const actionsRecord: KinematicDescriptor["actions"] = {};
        for (const item of extracted.actions) {
          actionsRecord[item.action] = item.weight;
        }
        const baseDesc: KinematicDescriptor = {
          actions: actionsRecord,
          geometry: extracted.geometry,
          profile: extracted.profile,
        };
        const descriptor = KinematicMuscleSolver.applyExecutionProfile(baseDesc, req.executionProfile);
        const rawSolved = this.solver.solveKinematics(descriptor);
        const verified = this.verifier.verifyAndCorrect(descriptor, rawSolved);

        if (verified.passed) {
          return {
            canonicalSlug: extracted.canonicalSlug,
            displayName: req.locale === "en" ? extracted.displayNameEn : extracted.displayNameRu,
            rationale: extracted.rationale,
            source: hasPhoto ? "vlm_v4" : "llm_v4",
            modelUsed: model,
            confidence: extracted.confidence,
            descriptor,
            solved: verified.correctedResult,
            verification: {
              passed: verified.passed,
              status: verified.status,
              violations: verified.violations,
            },
            clarifyingQuestions:
              extracted.confidence < 0.8
                ? BiomechanicalMuscleAgent.buildClarifyingQuestions(extracted.missingParams)
                : [],
            latencyMs: Date.now() - t0,
            solverVersion: SOLVER_VERSION_V4,
          };
        }

        if (attempt === 0) {
          const hint = verified.violations.map((v) => `${v.code}: ${v.detail}`).join("; ");
          const retried = await runCall(hint);
          if (!retried) return null;
          extracted = retried;
        }
      }
      return null;
    } catch {
      return null;
    }
  }
}
