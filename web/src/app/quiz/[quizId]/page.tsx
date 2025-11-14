"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import { useRequireAuth } from "../../../hooks/useRequireAuth";
import { Card } from "../../../components/ui/Card";
import { Skeleton } from "../../../components/ui/Skeleton";
import { QuestionCard } from "../../../components/quiz/QuestionCard";
import { ResultPanel } from "../../../components/quiz/ResultPanel";
import { QuizSchema, Question } from "../../../schemas/quiz";

export default function QuizPage() {
  const { quizId } = useParams<{ quizId: string }>();
  const { jwt, ready } = useRequireAuth();

  const [questions, setQuestions] = useState<Question[]>([]);
  const [passScore, setPassScore] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // respostas selecionadas: questionId -> string[] (mesmo single mantém índice 0)
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [submitOut, setSubmitOut] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!jwt) {
      setQuestions([]);
      setPassScore(0);
      setErr(null);
      setAnswers({});
      setSubmitOut(null);
      return;
    }

    let alive = true;
    (async () => {
      setLoading(true);
      setErr(null);
      setSubmitOut(null);
      try {
        const { status, body } = await api(`/api/quizzes/${encodeURIComponent(quizId)}`, { jwt });
        if (!alive) return;

        if (status === 200 && typeof body === "object") {
          const parsed = QuizSchema.safeParse(body);
          if (parsed.success) {
            const quizData = parsed.data.quiz;
            const qs = quizData.questions || [];
            setQuestions(qs);
            setPassScore(quizData.passScore ?? 0);
            setErr(null);
            setAnswers({});
          } else {
            setQuestions([]);
            setPassScore(0);
            setErr(JSON.stringify({ status, validationError: parsed.error.flatten() }));
          }
        } else {
          setQuestions([]);
          setPassScore(0);
          setErr(JSON.stringify({ status, body }));
        }
      } catch (e: any) {
        if (!alive) return;
        setQuestions([]);
        setPassScore(0);
        setErr(JSON.stringify({ error: String(e) }));
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [quizId, jwt, ready]);

  const allRequiredAnswered = useMemo(() => {
    const required = questions.filter((q) => q.required);
    if (required.length === 0) return true;
    return required.every(
      (q) => Array.isArray(answers[q.id]) && answers[q.id].length > 0,
    );
  }, [questions, answers]);

  async function submit() {
    setSubmitting(true);
    setSubmitOut(null);
    try {
      const payload = questions.map((q) => ({
        questionId: q.id,
        choiceIds: Array.isArray(answers[q.id]) ? answers[q.id] : [],
      }));
      const { status, body } = await api(`/api/quizzes/${encodeURIComponent(quizId)}/submit`, {
        method: "POST",
        body: JSON.stringify({ answers: payload }),
        jwt,
      });
      setSubmitOut({ status, body });
    } catch (e: any) {
      setSubmitOut({ error: String(e) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fade-in"
      data-testid="quiz-page"
      style={{ display: "flex", flexDirection: "column", gap: 20 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Quiz</h1>
        <span style={{ fontSize: 12, color: "#777" }}>
          <code>{quizId}</code>
        </span>
      </div>

      {!ready && (
        <div data-testid="quiz-auth-loading" style={{ display: "grid", gap: 12 }}>
          <Card><Skeleton h={16} w="50%" /><Skeleton h={12} w="90%" /></Card>
          <Card><Skeleton h={16} w="40%" /><Skeleton h={12} w="85%" /></Card>
        </div>
      )}

      {ready && !jwt && (
        <Card data-testid="quiz-auth-warning">
          <strong>Não autenticado</strong>
          <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-soft)" }}>
            Clique em “Entrar” (topo) para responder o quiz.
          </p>
        </Card>
      )}

      {ready && jwt && loading && (
        <div data-testid="quiz-loading" style={{ display: "grid", gap: 12 }}>
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <Skeleton h={18} w="45%" />
              <Skeleton h={12} w="90%" />
              <Skeleton h={12} w="80%" />
            </Card>
          ))}
        </div>
      )}

      {ready && jwt && err && !loading && (
        <Card
          data-testid="quiz-error"
          style={{ borderColor: "#f2c2c2", background: "#fff6f6", color: "#842029" }}
        >
          <strong>Erro ao carregar quiz</strong>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>{err}</pre>
        </Card>
      )}

      {ready && jwt && !err && !loading && questions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div data-testid="quiz-pass-score" style={{ fontSize: 13, color: "#555" }}>
            passScore: {passScore}
          </div>
          {questions.map((q) => (
            <QuestionCard
              key={q.id}
              q={q}
              selectedChoiceIds={answers[q.id] || []}
              onToggle={(choiceId) =>
                setAnswers((prev) => {
                  const current = prev[q.id] || [];
                  const isMultiple = q.kind === "multiple";
                  if (isMultiple) {
                    const exists = current.includes(choiceId);
                    const next = exists
                      ? current.filter((value) => value !== choiceId)
                      : [...current, choiceId];
                    return { ...prev, [q.id]: next };
                  }
                  return { ...prev, [q.id]: [choiceId] };
                })
              }
            />
          ))}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={submit}
              disabled={!allRequiredAnswered || submitting}
              data-testid="quiz-submit"
              style={{
                padding: "8px 12px",
                background: allRequiredAnswered && !submitting ? "var(--color-primary)" : "#ddd",
                color: allRequiredAnswered && !submitting ? "#fff" : "#777",
                border: "1px solid",
                borderColor: allRequiredAnswered && !submitting ? "var(--color-primary)" : "#ccc",
                borderRadius: 8,
                cursor: allRequiredAnswered && !submitting ? "pointer" : "not-allowed",
                fontSize: 14,
              }}
            >
              {submitting ? "Enviando..." : "Enviar tentativa"}
            </button>
          </div>
        </div>
      )}

      {ready && jwt && submitOut && <ResultPanel result={submitOut} />}
    </div>
  );
}
