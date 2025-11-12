import { ReactNode } from "react";

export function Card({ children, as:Comp = "div", padding = 16, gap = 12, style, ...rest }:
  { children: ReactNode; as?: any; padding?: number; gap?: number; style?: React.CSSProperties } & React.HTMLAttributes<HTMLElement>) {
  return (
    <Comp
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius)",
        padding,
        display: "flex",
        flexDirection: "column",
        gap,
        boxShadow: "var(--shadow-sm)",
        ...style
      }}
      {...rest}
    >
      {children}
    </Comp>
  );
}
