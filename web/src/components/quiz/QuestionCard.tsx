import type { CSSProperties } from "react";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { ChoiceButton } from "./ChoiceButton";
import { normalizeChoice, renderBodyToString, Question } from "../../schemas/quiz";

export function QuestionCard({
  q,
  selectedChoiceId,
  onSelect,
}: {
  q: Question;
  selectedChoiceId?: string | null;
  onSelect: (choiceId: string) => void;
}) {
  const choices = (q.choices || []).map(normalizeChoice);
  const body = renderBodyToString(q.body);

  return (
    <Card data-testid={`quiz-question-${q.id}`} style={{ gap: 12 }}>
      <div style={header}>
        <strong>Pergunta</strong>
        <div style={{ display: "flex", gap: 6 }}>
          {q.required && <Badge tone="warn">obrigatória</Badge>}
          <Badge tone="info">{q.kind || "single"}</Badge>
        </div>
      </div>

      {body && <div style={{ fontSize: 14 }}>{body}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {choices.map((c) => (
          <ChoiceButton
            key={c.id}
            label={c.label}
            selected={selectedChoiceId === c.id}
            onClick={() => onSelect(c.id)}
            testId={`quiz-choice-${q.id}-${c.id}`}
          />
        ))}
      </div>
    </Card>
  );
}

const header: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};
