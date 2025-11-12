import type {
  ReactNode,
  CSSProperties,
  HTMLAttributes,
  ElementType
} from "react";

/**
 * Componente básico de cartão.
 * - `as`: permite trocar a tag (div, section, article...)
 * - `padding` e `gap`: espaçamentos internos.
 */
export function Card({
  children,
  as: Comp = "div",
  padding = 16,
  gap = 12,
  style,
  ...rest
}: {
  children: ReactNode;
  as?: ElementType;
  padding?: number;
  gap?: number;
  style?: CSSProperties;
} & HTMLAttributes<HTMLElement>) {
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
