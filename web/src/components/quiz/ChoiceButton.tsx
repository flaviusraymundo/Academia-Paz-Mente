import type { CSSProperties } from "react";

export function ChoiceButton({
  label,
  selected,
  onClick,
  testId,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      style={{
        ...btn,
        background: selected ? "var(--color-primary)" : "#fff",
        color: selected ? "#fff" : "#222",
        borderColor: selected ? "var(--color-primary)" : "var(--color-border)",
      }}
    >
      {label}
    </button>
  );
}

const btn: CSSProperties = {
  padding: "8px 10px",
  fontSize: 13,
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  cursor: "pointer",
};
