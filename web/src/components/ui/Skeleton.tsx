export function Skeleton({ h=14, w="100%", radius=6, style }:{h?:number; w?:number|string; radius?:number; style?:React.CSSProperties}) {
  return (
    <div style={{
      height: h,
      width: w,
      borderRadius: radius,
      background: "linear-gradient(90deg,#eee,#f5f5f5 45%,#eee 80%)",
      backgroundSize: "200% 100%",
      animation: "skel 1.2s ease-in-out infinite",
      ...style
    }} />
  );
}

// global keyframes guard (in case not defined)
if (typeof document !== "undefined" && !document.getElementById("__skel_style")) {
  const el = document.createElement("style");
  el.id="__skel_style";
  el.innerHTML="@keyframes skel{0%{background-position:0 0;}100%{background-position:-200% 0;}}";
  document.head.appendChild(el);
}
