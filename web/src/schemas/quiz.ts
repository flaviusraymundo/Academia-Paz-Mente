import { z } from "zod";

// Choice pode vir como string ou objeto { id|value, label? }
export const RawChoiceSchema = z.union([
  z.string(),
  z.object({
    id: z.string(),
    label: z.string().optional(),
  }),
  z.object({
    value: z.string(),
    label: z.string().optional(),
  }),
]);

export const QuestionSchema = z.object({
  id: z.string(),
  kind: z.string().default("single"),
  body: z.unknown().optional(),
  required: z.boolean().optional(),
  choices: z.array(RawChoiceSchema).default([]),
});

const QuizInnerRaw = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    questions: z.array(QuestionSchema).default([]),
    passScore: z.number().optional(),
    pass_score: z.number().optional(),
  })
  .passthrough()
  .transform((quiz) => ({
    ...quiz,
    passScore: quiz.passScore ?? quiz.pass_score ?? 0,
  }));

export const QuizSchema = z.object({
  quiz: QuizInnerRaw,
});

export type RawChoice = z.infer<typeof RawChoiceSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type QuizData = z.infer<typeof QuizSchema>;

// Normaliza para { id, label }
export function normalizeChoice(c: RawChoice): { id: string; label: string } {
  if (typeof c === "string") return { id: c, label: c };
  if ("id" in c) return { id: c.id, label: c.label ?? c.id };
  if ("value" in c) return { id: c.value, label: c.label ?? c.value };
  return { id: JSON.stringify(c), label: JSON.stringify(c) };
}

export function renderBodyToString(body: unknown): string {
  if (body == null) return "";
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}
