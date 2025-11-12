import { ReactNode } from "react";

const palettes: Record<string,{bg:string;color:string;border?:string}> = {
  neutral: { bg:"#f1f1f5", color:"#444" },
  success: { bg:"#e5f8ed", color:"#1f7a43" },
  info: { bg:"#e5f1ff", color:"#1d4f91" },
  warn: { bg:"#fff6d9", color:"#8a6d00" },
  level: { bg:"#efe9ff", color:"#5326d9" }
};

export function Badge({ children, tone="neutral" }:{ children: ReactNode; tone?: keyof typeof palettes }) {
  const p = palettes[tone] || palettes.neutral;
  return (
    <span style={{
      display:"inline-block",
      fontSize:11,
      lineHeight:"14px",
      padding:"3px 6px",
      borderRadius:999,
      fontWeight:500,
      background:p.bg,
      color:p.color,
      border: p.border ? `1px solid ${p.border}` : "1px solid transparent",
      whiteSpace:"nowrap"
    }}>{children}</span>
  );
}
