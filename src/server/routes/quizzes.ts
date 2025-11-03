// src/server/routes/quizzes.ts
import { Router, Request, Response } from "express";
import { pool } from "../lib/db.js";
import { z } from "zod";
import { ulid } from "ulid";

const router = Router();

const Submission = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        choiceIds: z.array(z.string()).optional().default([]),
      })
    )
    .min(1),
});

router.post("/:quizId/submit", async (req: Request, res: Response) => {
  const { quizId } = req.params;
  const parsed = Submission.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
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

    const answers = new Map(parsed.data.answers.map((a) => [a.questionId, new Set(a.choiceIds)]));

    // avaliação simples: acerto total por questão
    let correct = 0;
    for (const q of qs) {
      const given = answers.get(q.id) || new Set<string>();
      const key = new Set<string>((q.answer_key || []).map((x: any) => String(x)));
      const ok = key.size === given.size && [...key].every((k) => given.has(k));
      if (ok) correct += 1;
    }
    const scorePct = (correct / qs.length) * 100;
    const passed = scorePct >= Number(quiz.pass_score);

    // grava evento e progresso
    const eventId = ulid();
    await client.query(
      `insert into event_log(event_id, topic, actor_user_id, entity_type, entity_id, occurred_at, source, payload)
       values ($1,'quiz.submitted',$2,'quiz',$3, now(),'app', $4)`,
      [eventId, userId, quizId, { score: scorePct, passed, answers: parsed.data.answers }]
    );

    await client.query(
      `
      insert into progress(user_id, module_id, status, score, time_spent_secs, updated_at)
      values ($1,$2,$3,$4, 0, now())
      on conflict (user_id, module_id)
      do update set status = excluded.status, score = excluded.score, updated_at = now()
      `,
      [userId, quiz.module_id, passed ? "passed" : "failed", scorePct]
    );

    res.json({ passed, score: Number(scorePct.toFixed(2)) });
  } finally {
    client.release();
  }
});

export default router;
