import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";

export function ResultPanel({ result }: { result: any }) {
  if (!result) return null;

  const payload = result?.body ?? result;

  // tenta inferir aprovado com base em campos comuns
  const approved =
    payload?.approved ??
    payload?.passed ??
    (typeof payload?.pass === "boolean" ? payload.pass : undefined);

  const score =
    payload?.score ??
    payload?.result?.score ??
    payload?.details?.score ??
    undefined;

  return (
    <Card data-testid="quiz-result" style={{ gap: 10, borderColor: "#dfe8df" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong>Resultado</strong>
        {typeof approved === "boolean" && (
          <Badge tone={approved ? "success" : "warn"}>
            {approved ? "aprovado" : "reprovado"}
          </Badge>
        )}
        {typeof score === "number" && <Badge tone="info">score: {score}</Badge>}
      </div>
      <pre style={{ margin: 0, fontSize: 12, background: "#f8f8fa", padding: 8, borderRadius: 8, border: "1px solid #eee" }}>
{JSON.stringify(result, null, 2)}
      </pre>
    </Card>
  );
}
