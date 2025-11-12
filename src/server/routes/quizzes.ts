// src/server/routes/quizzes.ts
import { Router, Request, Response } from "express";
import { pool } from "../lib/db.js";
import { ulid } from "ulid";
import { isUuid } from "../utils/ids.js";

const router = Router();

type NormalizedAnswer = { questionId: string; values: string[] };

const normalizeAnswers = (raw: unknown): NormalizedAnswer[] => {
  const answers = Array.isArray((raw as any)?.answers) ? (raw as any).answers : [];

  return answers.map((a: any) => {
    const questionId = a?.questionId ?? a?.question_id ?? a?.qid ?? a?.id ?? null;
    let v = a?.value ?? a?.values ?? a?.choices ?? a?.answer ?? a?.choiceIds;

    if (v && typeof v === "object" && !Array.isArray(v) && "id" in v) {
      v = (v as any).id;
    }

    if (!Array.isArray(v)) {
      v = v == null ? [] : [v];
    }

    const values = v.map((item: any) => {
      if (item && typeof item === "object" && "id" in item) {
        return String(item.id);
      }
      return String(item);
    });

    return {
      questionId: questionId != null ? String(questionId) : "",
      values,
    };
  });
};

const normalizeExpected = (value: any): string[] => {
  if (Array.isArray(value)) {
    return value.map((v) => String((v as any)?.id ?? v));
  }
  if (value && typeof value === "object" && "id" in value) {
    return [String((value as any).id)];
  }
  if (value == null) return [];
  return [String(value)];
};

const normBool = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    return ["true", "1", "yes", "y"].includes(v.toLowerCase());
  }
  return Boolean(v);
};

// ===== ADD: GET /api/quizzes/:quizId (aluno) =====
// Observações:
// - Requer JWT (o app já monta quizzesRouter sob requireAuth).
// - Valida quizId, carrega quiz + módulo + curso.
// - Se ENTITLEMENTS_ENFORCE=1, exige entitlement ativo para o curso.
// - Bloqueia acesso se módulo anterior não estiver "passed" (regra alinhada ao /api/me/items).
// - Retorna questões sem answerKey (não expor gabarito no fetch).
router.get("/:quizId", async (req: Request, res: Response) => {
  const quizId = String(req.params.quizId || "");
  if (!isUuid(quizId)) return res.status(400).json({ error: "invalid_quiz_id" });

  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const client = await pool.connect();
  try {
    // Carrega quiz + módulo + curso
    const quizQ = await client.query(
      `
      select q.id, q.module_id, q.pass_score, m.course_id, m."order"
        from quizzes q
        join modules m on m.id = q.module_id
       where q.id = $1
       limit 1
      `,
      [quizId]
    );
    if (!quizQ.rowCount) {
      client.release();
      return res.status(404).json({ error: "quiz_not_found" });
    }
    const quiz = quizQ.rows[0] as {
      id: string;
      module_id: string;
      pass_score: number;
      course_id: string;
      order: number;
    };

    // Entitlement (opcional por env)
    if (process.env.ENTITLEMENTS_ENFORCE === "1") {
      const ent = await client.query(
        `
        select 1
          from entitlements
         where user_id = $1
           and course_id = $2
           and status = 'active'
           and (expires_at is null or expires_at > now())
         limit 1
        `,
        [userId, quiz.course_id]
      );
      if (!ent.rowCount) {
        client.release();
        return res.status(403).json({ error: "no_entitlement" });
      }
    }

    // Desbloqueio por pré-requisito: módulo anterior precisa estar "passed"
    const prevOrderQ = await client.query(
      `select max("order") as prev_order from modules where course_id = $1 and "order" < $2`,
      [quiz.course_id, quiz.order]
    );
    const prevOrder = prevOrderQ.rows[0]?.prev_order;
    if (prevOrder !== null && prevOrder !== undefined) {
      const prevStatusQ = await client.query(
        `
        select p.status
          from progress p
         where p.user_id = $1
           and p.module_id in (
             select id from modules where course_id = $2 and "order" = $3
           )
         limit 1
        `,
        [userId, quiz.course_id, prevOrder]
      );
      const status = String(prevStatusQ.rows[0]?.status || "");
      if (status !== "passed") {
        client.release();
        return res.status(403).json({ error: "forbidden" });
      }
    }

    // Carrega questões (sem answer_key)
    const questionsQ = await client.query(
      `
      select id, kind, body, choices
        from questions
       where quiz_id = $1
       order by id
      `,
      [quizId]
    );

    client.release();
    return res.json({
      quiz: {
        id: quiz.id,
        moduleId: quiz.module_id,
        passScore: Number(quiz.pass_score),
        questions: questionsQ.rows.map((q: any) => ({
          id: q.id,
          kind: q.kind,
          body: q.body || {},
          choices: q.choices || [],
        })),
      },
    });
  } catch (e: any) {
    try {
      client.release();
    } catch {}
    return res.status(500).json({ error: "quiz_fetch_failed", detail: String(e?.message || e) });
  }
});

router.post("/:quizId/submit", async (req: Request, res: Response) => {
  const { quizId } = req.params;
  if (!isUuid(quizId)) {
    return res.status(400).json({ error: "invalid_id", param: "quizId" });
  }
  const answers = normalizeAnswers(req.body);
  if (answers.length === 0 || answers.some((a) => !a.questionId)) {
    return res.status(400).json({ error: { fieldErrors: { answers: ["Required"] } } });
  }

  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const client = await pool.connect();
  try {
    // carrega quiz, módulo e gabaritos
    const { rows: quizRows } = await client.query(
      `
      select q.id, q.module_id, q.pass_score
      from quizzes q
      where q.id = $1
      `,
      [quizId]
    );
    if (quizRows.length === 0) return res.status(404).json({ error: "quiz_not_found" });
    const quiz = quizRows[0];

    const { rows: qs } = await client.query(
      `select id, kind, answer_key from questions where quiz_id = $1`,
      [quizId]
    );
    if (qs.length === 0) return res.status(400).json({ error: "quiz_empty" });

    const provided = new Map<string, string[]>(answers.map((a) => [a.questionId, a.values]));
    const expectedById = new Map<string, { kind: string; expected: string[] }>();
    for (const q of qs) {
      expectedById.set(q.id, {
        kind: q.kind,
        expected: normalizeExpected(q.answer_key),
      });
    }

    const asSet = (xs: string[]) => new Set(xs.map(String));

    let correct = 0;
    for (const q of qs) {
      const meta = expectedById.get(q.id);
      if (!meta) continue;
      const givenValues = provided.get(q.id) ?? [];
      let ok = false;

      if (meta.kind === "multiple") {
        const exp = asSet(meta.expected);
        const got = asSet(givenValues);
        ok = exp.size === got.size && [...exp].every((x) => got.has(x));
      } else if (meta.kind === "single") {
        ok = givenValues.length > 0 && givenValues[0] === (meta.expected[0] ?? "");
      } else if (meta.kind === "truefalse") {
        ok = normBool(givenValues[0]) === normBool(meta.expected[0]);
      } else {
        ok = JSON.stringify(givenValues) === JSON.stringify(meta.expected);
      }

      if (ok) correct += 1;
    }

    const total = qs.length;
    const scorePct = total === 0 ? 0 : (correct / total) * 100;
    const score = Math.round(scorePct);
    const passScore = Number(quiz.pass_score ?? 70);
    const passed = score >= passScore;

    // grava evento e progresso
    const eventId = ulid();
    await client.query(
      `insert into event_log(event_id, topic, actor_user_id, entity_type, entity_id, occurred_at, source, payload)
       values ($1,'quiz.submitted',$2,'quiz',$3, now(),'app', $4)`,
      [eventId, userId, quizId, { score, passed, answers }]
    );

    await client.query(
      `
      insert into progress(user_id, module_id, status, score, time_spent_secs, updated_at)
      values ($1,$2,$3,$4, 0, now())
      on conflict (user_id, module_id)
      do update set status = excluded.status, score = excluded.score, updated_at = now()
      `,
      [userId, quiz.module_id, passed ? "passed" : "failed", score]
    );

    const debug = process.env.DEV_FAKE
      ? {
          total,
          correct,
          passScore,
        }
      : undefined;

    res.json({ passed, score, debug });
  } finally {
    client.release();
  }
});

export default router;
