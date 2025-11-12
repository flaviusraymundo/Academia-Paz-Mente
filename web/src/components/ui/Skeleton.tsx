import type { CSSProperties } from "react";

interface SkeletonProps {
  h?: number;
  w?: number | string;
  radius?: number;
  style?: CSSProperties;
  className?: string;
}

/**
 * Skeleton simples para estados de carregamento.
 */
export function Skeleton({
  h = 14,
  w = "100%",
  radius = 6,
  style,
  className
}: SkeletonProps) {
  return (
    <div
      className={className}
      style={{
        height: h,
        width: w,
        borderRadius: radius,
        background: "linear-gradient(90deg,#eee,#f5f5f5 45%,#eee 80%)",
        backgroundSize: "200% 100%",
        animation: "skel 1.2s ease-in-out infinite",
        ...style
      }}
    />
  );
}

// Garante keyframes apenas uma vez no client
if (typeof document !== "undefined" && !document.getElementById("__skel_style")) {
  const el = document.createElement("style");
  el.id = "__skel_style";
  el.innerHTML = "@keyframes skel{0%{background-position:0 0;}100%{background-position:-200% 0;}}";
  document.head.appendChild(el);
}
