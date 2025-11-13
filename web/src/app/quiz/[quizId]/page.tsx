"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import { useAuth } from "../../../contexts/AuthContext";

type Question = {
  id: string;
  kind: string;
  body: any;
  choices: any[];
};

export default function QuizPage() {
  const { quizId } = useParams<{ quizId: string }>();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [passScore, setPassScore] = useState<number>(0);
  const [out, setOut] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const { jwt, ready } = useAuth();

  useEffect(() => {
    if (!ready) return;
    if (!jwt) {
      setQuestions([]);
      setPassScore(0);
      setErr(null);
      return;
    }
    let alive = true;
    (async () => {
      const { status, body } = await api(`/api/quizzes/${encodeURIComponent(quizId)}`);
      if (!alive) return;
      if (status === 200) {
        setQuestions(body.quiz?.questions || []);
        setPassScore(body.quiz?.pass_score || 0);
        setErr(null);
      } else {
        setQuestions([]);
        setPassScore(0);
        setErr(JSON.stringify({ status, body }));
      }
    })();
    return () => { alive = false; };
  }, [quizId, jwt, ready]);

  async function submit() {
    // Como payload, enviamos cada questão com a primeira escolha (demo)
    const answers = questions.map(q => ({
      questionId: q.id,
      choiceIds: Array.isArray(q.choices) && q.choices.length > 0
        ? [q.choices[0]?.id ?? q.choices[0]?.value ?? q.choices[0]]
        : []
    }));
    const { status, body } = await api(`/api/quizzes/${encodeURIComponent(quizId)}/submit`, {
      method: "POST",
      body: JSON.stringify({ answers })
    });
    setOut({ status, body });
  }

  return (
    <div>
      <h1>Quiz</h1>
      {err && <pre style={{ color: "crimson" }}>{err}</pre>}
      <p>passScore: {passScore}</p>
      <ol>
        {questions.map((q, i) => (
          <li key={q.id} style={{ marginBottom: 8 }}>
            <div><strong>Q{i + 1}</strong>: {JSON.stringify(q.body)}</div>
            <div style={{ color: "#555" }}>choices: {JSON.stringify(q.choices)}</div>
          </li>
        ))}
      </ol>
      {questions.length > 0 && (
        <button onClick={submit} style={{ padding: "8px 12px" }}>Enviar tentativa</button>
      )}
      {out && (
        <div style={{ marginTop: 12 }}>
          <h3>Resultado</h3>
          <pre>{JSON.stringify(out, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
