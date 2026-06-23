import { useEffect, useState } from "react";
import { onServerWaking } from "../services/api";

export default function ServerWakingBanner() {
  const [waking, setWaking] = useState(false);

  useEffect(() => onServerWaking(setWaking), []);

  if (!waking) return null;

  return (
    <div
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
        padding: "10px 16px", textAlign: "center",
        background: "linear-gradient(90deg, #1e293b, #334155)",
        color: "#f1f5f9", fontSize: 13, fontFamily: "inherit",
        boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      }}
    >
      <span
        style={{
          width: 14, height: 14, borderRadius: "50%",
          border: "2px solid rgba(255,255,255,0.35)",
          borderTopColor: "#fff", display: "inline-block",
          animation: "swb-spin 0.8s linear infinite",
        }}
      />
      Despertando el servidor (puede tardar 30-60s)… por favor espera, no cierres la pestaña.
      <style>{`@keyframes swb-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
