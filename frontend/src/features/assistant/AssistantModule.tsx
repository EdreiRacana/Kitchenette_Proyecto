// AssistantModule.tsx — Asistente conversacional flotante del ERP.
//
// Fase A: UI completa funcionando (panel, streaming falso, micrófono, barra
// de presupuesto). El backend con LLM real y tools deterministas llega en
// la siguiente fase. Este archivo es puramente frontend, sin dependencias
// nuevas y sin cambios en otros módulos.
//
// Filosofía visual:
//  - No invasivo: FAB pequeño (52px) en esquina inferior derecha, opacidad
//    reducida en idle, se ilumina al hover. Nunca tapa contenido.
//  - Panel lateral (440px) desliza desde la derecha, glassmorphism con
//    backdrop-filter para que "flote" sobre el ERP sin obstruirlo.
//  - Triángulo metálico como avatar — replica la NovaMark del logo con
//    gradientes de acero, resplandor tenue y sutil rotación en el FAB.
//  - Barra de presupuesto: solo color, sin cifras. Verde → amarillo → rojo
//    conforme se agota. Refuerza consumo consciente sin ansiedad numérica.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

// ── Silueta NovaMark normalizada (idéntica a TrianglesCanvas) ──────────
// Triángulo con muesca inferior — logo de la marca. Se dibuja centrado en
// un viewBox 100×100 con margen para respirar.
function trianglePath(size: number = 100, margin: number = 6): string {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - margin;
  const pts: [number, number][] = [
    [0, -1.00],
    [1, 0.7419],
    [0, 0.3871],
    [-1, 0.7419],
  ];
  return pts.map(([x, y], i) => {
    const px = cx + x * r;
    const py = cy + y * r;
    return `${i === 0 ? "M" : "L"} ${px.toFixed(2)} ${py.toFixed(2)}`;
  }).join(" ") + " Z";
}

// ── Triángulo metálico ─────────────────────────────────────────────────
// Gradientes múltiples simulan superficie metálica pulida:
//   1. Base linearGradient de acero (plata + azul acero)
//   2. Highlight superior (luz de estudio)
//   3. Rim glow para dar volumen y separación del fondo
// Cada instancia genera IDs únicos para evitar colisión de <defs>.
let _gid = 0;
function MetallicTriangle({ size = 32, glow = true, spin = false }: {
  size?: number; glow?: boolean; spin?: boolean;
}) {
  const gid = useMemo(() => `mt${++_gid}`, []);
  const filter = glow ? `drop-shadow(0 0 ${size * 0.28}px rgba(120,170,255,0.35))` : undefined;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ filter, transformOrigin: "center", animation: spin ? "assistant-slow-spin 24s linear infinite" : undefined }} aria-hidden="true">
      <defs>
        {/* Base metálica — pasa por tonos plateados/azulados con highlight */}
        <linearGradient id={`${gid}-metal`} x1="20%" y1="0%" x2="80%" y2="100%">
          <stop offset="0%" stopColor="#F0F5FF" />
          <stop offset="18%" stopColor="#C7D5EE" />
          <stop offset="42%" stopColor="#8A9DC0" />
          <stop offset="62%" stopColor="#546A93" />
          <stop offset="82%" stopColor="#7A93BE" />
          <stop offset="100%" stopColor="#B3C4E2" />
        </linearGradient>
        {/* Highlight superior — barrido de luz sobre la cara */}
        <linearGradient id={`${gid}-shine`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.75)" />
          <stop offset="40%" stopColor="rgba(255,255,255,0.10)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
        {/* Halo interno translúcido */}
        <radialGradient id={`${gid}-halo`} cx="50%" cy="35%" r="60%">
          <stop offset="0%" stopColor="rgba(180,215,255,0.55)" />
          <stop offset="60%" stopColor="rgba(120,155,220,0.10)" />
          <stop offset="100%" stopColor="rgba(60,90,140,0)" />
        </radialGradient>
      </defs>
      {/* Sombra sutil hacia abajo para dar peso */}
      <path d={trianglePath(100, 4)} fill={`url(#${gid}-metal)`}
        stroke="rgba(255,255,255,0.35)" strokeWidth="0.6"
        strokeLinejoin="round" />
      <path d={trianglePath(100, 4)} fill={`url(#${gid}-halo)`}
        strokeLinejoin="round" />
      <path d={trianglePath(100, 8)} fill={`url(#${gid}-shine)`}
        opacity="0.85" strokeLinejoin="round" />
    </svg>
  );
}

// ── Web Speech API bridge (opcional, sin dependencias) ─────────────────
// Si el navegador lo soporta, escuchamos y transcribimos en vivo al
// textarea. Chrome/Edge/Safari lo tienen. Firefox no — mostramos aviso.
function useSpeechRecognition(onResult: (text: string, isFinal: boolean) => void) {
  const recRef = useRef<any>(null);
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState<boolean>(true);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
    const rec = new SR();
    rec.lang = "es-MX";
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (e: any) => {
      let interim = "", final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      if (final) onResult(final, true);
      else if (interim) onResult(interim, false);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
  }, [onResult]);

  const start = () => {
    if (!supported || !recRef.current) return;
    try { recRef.current.start(); setListening(true); } catch { /* ya escuchando */ }
  };
  const stop = () => {
    if (!recRef.current) return;
    try { recRef.current.stop(); } catch { /* nada */ }
    setListening(false);
  };
  return { listening, supported, start, stop };
}

// ── Estado global de la conversación ───────────────────────────────────
type Msg = { role: "user" | "assistant"; text: string; source?: string; ms?: number };

// Chips sugeridos según el módulo actual — se calculan al abrir el panel.
// Como en fase A no consumimos el path del router, van 4 preguntas de las
// más frecuentes en cualquier ERP.
const DEFAULT_CHIPS = [
  "¿Cuánto vendí este mes?",
  "Top 5 productos",
  "Cartera vencida",
  "¿Cómo va Walmart?",
];

// Respuestas simuladas — solo demo mientras aún no está el backend LLM.
// Se muestran letra por letra para replicar la sensación de streaming.
function fakeAnswerFor(question: string): { text: string; source: string; ms: number } {
  const q = question.toLowerCase();
  if (q.includes("cxc") || q.includes("cobrar") || q.includes("cartera")) {
    return {
      text: "Tienes $1,240,530 por cobrar (28 clientes).\nAl día $840K · 1-30d $260K · 31-60d $95K · +60d $45K (3 clientes).",
      source: "Finanzas", ms: 340,
    };
  }
  if (q.includes("vend") || q.includes("ventas")) {
    return {
      text: "Este mes has facturado $487,320 con 143 pedidos (ticket promedio $3,408).\nLlevas +12% vs mes pasado. Cadena con mayor crecimiento: Walmart (+18%).",
      source: "Ventas", ms: 420,
    };
  }
  if (q.includes("walmart") || q.includes("cadena") || q.includes("tienda")) {
    return {
      text: "Walmart este mes: $180,000 (37% del total).\nMejores tiendas: Satélite $65K · Gustavo Baz $52K · Arboledas $38K.\nAlerta: WoS crítico en tienda Toltecas (1.4 semanas).",
      source: "Retail", ms: 510,
    };
  }
  if (q.includes("producto") || q.includes("top") || q.includes("mejor")) {
    return {
      text: "Top 5 productos por revenue este mes:\n1. Apple iPhone 15 Pro Max — $145,200 (17 uds.)\n2. Apple Watch Series 9 — $98,400\n3. AirPods Pro 2 — $67,120\n4. MacBook Air M3 — $52,800\n5. iPad Air — $41,300",
      source: "Ventas", ms: 380,
    };
  }
  return {
    text: "Modo demo: en la próxima fase conecto el motor de análisis para responder esta pregunta con datos reales de tu ERP. Prueba con: ventas, cartera, Walmart, top productos.",
    source: "Demo", ms: 90,
  };
}

// ── Assistant (componente principal, se monta en App root) ─────────────
export default function Assistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  // Presupuesto simulado (0 a 1). En fase B esto lee del backend real.
  // 0.24 = verde relajado; cambia a amarillo >0.60; a rojo >0.85.
  const [budget] = useState(0.24);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Atajo global ⌘K / Ctrl+K para abrir y cerrar
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  // Autofocus + scroll al abrir / mensaje nuevo
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 240);
  }, [open]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs, streaming]);

  // Auto-crecimiento del textarea (hasta ~4 líneas)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 110) + "px";
  }, [input]);

  const speech = useSpeechRecognition((text, isFinal) => {
    setInput(prev => isFinal ? (prev + " " + text).trim() : text);
  });

  const send = async (text?: string) => {
    const question = (text ?? input).trim();
    if (!question || streaming) return;
    setInput("");
    setMsgs(prev => [...prev, { role: "user", text: question }]);
    setStreaming(true);
    // Streaming falso — letra por letra a ~18ms
    const answer = fakeAnswerFor(question);
    let acc = "";
    const chars = answer.text.split("");
    setMsgs(prev => [...prev, { role: "assistant", text: "", source: answer.source, ms: answer.ms }]);
    for (const ch of chars) {
      await new Promise(r => setTimeout(r, 18));
      acc += ch;
      setMsgs(prev => {
        const copy = [...prev];
        copy[copy.length - 1] = { ...copy[copy.length - 1], text: acc };
        return copy;
      });
    }
    setStreaming(false);
  };

  // Texto a voz nativo (SpeechSynthesis). Sin costo, calidad del sistema.
  const speak = (text: string) => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "es-MX";
      u.rate = 1.02;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { /* navegador sin TTS */ }
  };

  // Color de la barra según nivel de consumo del presupuesto
  const budgetColor =
    budget >= 0.85 ? "#EF4444" :
    budget >= 0.60 ? "#F0B740" :
                     "#4ADE80";

  return createPortal(
    <>
      <style>{`
        @keyframes assistant-slow-spin { to { transform: rotate(360deg); } }
        @keyframes assistant-pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.05); opacity: 0.85; } }
        @keyframes assistant-slide-in { from { transform: translateX(24px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes assistant-fade-in { from { opacity: 0; } to { opacity: 1; } }
        .assistant-fab:hover .assistant-fab-inner { transform: scale(1.06); }
        .assistant-chip:hover { background: rgba(120,170,255,0.18) !important; border-color: rgba(160,200,255,0.35) !important; }
        .assistant-action-btn:hover { background: rgba(255,255,255,0.08) !important; color: rgba(220,235,255,0.95) !important; }
        .assistant-scroll::-webkit-scrollbar { width: 6px; }
        .assistant-scroll::-webkit-scrollbar-thumb { background: rgba(148,178,245,0.12); border-radius: 3px; }
      `}</style>

      {/* FAB flotante — bottom right, no invasivo */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Asistente (Ctrl+K)"
        aria-label="Abrir asistente"
        className="assistant-fab"
        style={{
          position: "fixed", right: 24, bottom: 24, zIndex: 9998,
          width: 56, height: 56, borderRadius: 16,
          background: open
            ? "linear-gradient(135deg, rgba(30,45,80,0.95) 0%, rgba(15,25,50,0.95) 100%)"
            : "linear-gradient(135deg, rgba(30,45,80,0.72) 0%, rgba(15,25,50,0.72) 100%)",
          border: "1px solid rgba(148,178,245,0.28)",
          backdropFilter: "blur(20px) saturate(150%)",
          WebkitBackdropFilter: "blur(20px) saturate(150%)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)",
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "background .2s, transform .2s",
          opacity: open ? 1 : 0.78,
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = open ? "1" : "0.78"; }}
      >
        <span className="assistant-fab-inner" style={{ display: "flex", transition: "transform .2s" }}>
          <MetallicTriangle size={30} glow={true} spin={!open && !streaming} />
        </span>
      </button>

      {/* Backdrop translúcido — cierra al tocar fuera */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 9997,
            background: "rgba(3,8,22,0.32)", backdropFilter: "blur(2px)",
            WebkitBackdropFilter: "blur(2px)",
            animation: "assistant-fade-in .18s ease-out",
          }}
        />
      )}

      {/* Panel principal del asistente */}
      {open && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: "fixed", right: 20, bottom: 92, zIndex: 9999,
            width: 440, maxWidth: "calc(100vw - 40px)",
            height: "min(720px, calc(100vh - 120px))",
            background: "rgba(15, 22, 41, 0.72)",
            backdropFilter: "blur(28px) saturate(150%)",
            WebkitBackdropFilter: "blur(28px) saturate(150%)",
            border: "1px solid rgba(148,178,245,0.16)",
            borderRadius: 20,
            boxShadow: "0 24px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)",
            display: "flex", flexDirection: "column", overflow: "hidden",
            animation: "assistant-slide-in .22s ease-out",
            color: "#E4ECFB",
          }}
        >
          {/* Header */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "16px 18px", borderBottom: "1px solid rgba(148,178,245,0.10)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <MetallicTriangle size={30} glow={true} spin={streaming} />
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 500, letterSpacing: 0.1 }}>Asistente</div>
                <div style={{ fontSize: 11, color: "rgba(180,200,235,0.55)", marginTop: 1 }}>
                  {streaming ? "Analizando…" : "Análisis inteligente del negocio"}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button title="Nueva conversación"
                onClick={() => setMsgs([])}
                style={iconBtn}>↻</button>
              <button title="Cerrar" onClick={() => setOpen(false)} style={iconBtn}>✕</button>
            </div>
          </div>

          {/* Chat / bienvenida */}
          <div ref={scrollRef} className="assistant-scroll" style={{
            flex: 1, padding: "20px 18px 12px", overflowY: "auto",
            display: "flex", flexDirection: "column", gap: 14,
          }}>
            {msgs.length === 0 && (
              <>
                <div style={{ fontSize: 15, lineHeight: 1.55, color: "#D8E3F8" }}>
                  Hola. ¿Sobre qué te ayudo hoy?
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                  {DEFAULT_CHIPS.map(c => (
                    <button key={c} className="assistant-chip"
                      onClick={() => send(c)}
                      style={{
                        padding: "7px 12px", borderRadius: 999,
                        background: "rgba(100,165,255,0.10)",
                        border: "1px solid rgba(140,190,255,0.20)",
                        color: "#B5CDF3", fontSize: 12, cursor: "pointer",
                        transition: "background .15s, border-color .15s",
                      }}>
                      {c}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10,
                              background: "rgba(255,255,255,0.03)",
                              border: "1px dashed rgba(148,178,245,0.15)",
                              fontSize: 11.5, color: "rgba(180,200,235,0.6)", lineHeight: 1.5 }}>
                  Modo demo — respuestas ilustrativas. El motor conectado a tus datos reales
                  y al análisis con IA llega en la siguiente actualización.
                </div>
              </>
            )}

            {msgs.map((m, i) => (
              m.role === "user" ? (
                <div key={i} style={{ display: "flex", justifyContent: "flex-end" }}>
                  <div style={{
                    maxWidth: "78%",
                    background: "rgba(70,120,200,0.24)",
                    border: "1px solid rgba(120,170,240,0.20)",
                    borderRadius: "14px 14px 4px 14px",
                    padding: "10px 14px", fontSize: 13.5, lineHeight: 1.5,
                  }}>{m.text}</div>
                </div>
              ) : (
                <div key={i} style={{ display: "flex", gap: 10 }}>
                  <div style={{ flexShrink: 0, width: 22, height: 22, marginTop: 3 }}>
                    <MetallicTriangle size={22} glow={false} />
                  </div>
                  <div style={{ flex: 1, color: "#E0E9F9", fontSize: 13.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    {m.text}
                    {streaming && i === msgs.length - 1 && (
                      <span style={{ display: "inline-block", width: 8, height: 14,
                                      background: "rgba(200,215,240,0.7)",
                                      marginLeft: 2, verticalAlign: "middle",
                                      animation: "assistant-pulse 1s ease-in-out infinite" }} />
                    )}
                    {m.text && !streaming && (
                      <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button className="assistant-action-btn" onClick={() => speak(m.text)}
                          style={actionBtn}>🔊 Escuchar</button>
                        <button className="assistant-action-btn"
                          onClick={() => navigator.clipboard?.writeText(m.text).catch(() => {})}
                          style={actionBtn}>📋 Copiar</button>
                        {m.source && (
                          <div style={{ marginLeft: "auto", fontSize: 10.5,
                                        color: "rgba(160,180,220,0.5)",
                                        alignSelf: "center" }}>
                            {m.source}{m.ms ? ` · ${m.ms}ms` : ""}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            ))}
          </div>

          {/* Input + micrófono + enviar */}
          <div style={{ padding: "12px 14px 14px", borderTop: "1px solid rgba(148,178,245,0.10)" }}>
            <div style={{
              display: "flex", alignItems: "flex-end", gap: 8,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(148,178,245,0.18)",
              borderRadius: 14, padding: "10px 12px",
            }}>
              <div style={{ flexShrink: 0, width: 26, height: 26, marginBottom: 2 }}>
                <MetallicTriangle size={26} glow={true} />
              </div>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={speech.listening ? "Escuchando…" : "Pregúntame algo del negocio…"}
                rows={1}
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  resize: "none", color: "#E4ECFB", fontSize: 14, fontFamily: "inherit",
                  padding: "4px 0", lineHeight: 1.4, minHeight: 20, maxHeight: 110,
                }}
              />
              <button
                onClick={() => speech.listening ? speech.stop() : speech.start()}
                disabled={!speech.supported}
                title={speech.supported
                  ? (speech.listening ? "Detener" : "Hablar")
                  : "Tu navegador no soporta voz — usa Chrome, Edge o Safari"}
                style={{
                  width: 32, height: 32, borderRadius: 10,
                  background: speech.listening ? "#EF4444" : "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(148,178,245,0.20)",
                  color: speech.listening ? "#fff" : "rgba(200,215,240,0.85)",
                  cursor: speech.supported ? "pointer" : "not-allowed",
                  opacity: speech.supported ? 1 : 0.4,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                  animation: speech.listening ? "assistant-pulse 1.2s ease-in-out infinite" : undefined,
                }}
              >🎤</button>
              <button
                onClick={() => send()}
                disabled={!input.trim() || streaming}
                title="Enviar (Enter)"
                style={{
                  width: 32, height: 32, borderRadius: 10,
                  background: input.trim() && !streaming
                    ? "linear-gradient(135deg, #4A90E2 0%, #2C5FBA 100%)"
                    : "rgba(255,255,255,0.06)",
                  border: input.trim() && !streaming ? "none" : "1px solid rgba(148,178,245,0.15)",
                  color: input.trim() && !streaming ? "#fff" : "rgba(200,215,240,0.4)",
                  cursor: input.trim() && !streaming ? "pointer" : "not-allowed",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                  boxShadow: input.trim() && !streaming ? "0 4px 12px rgba(74,144,226,0.35)" : "none",
                }}
              >→</button>
            </div>

            {/* Barra de presupuesto — solo color, sin cifras */}
            <div style={{
              marginTop: 10, height: 3,
              background: "rgba(255,255,255,0.04)",
              borderRadius: 999, overflow: "hidden",
            }}
              title="Consumo del presupuesto mensual del asistente"
            >
              <div style={{
                width: `${Math.max(4, budget * 100)}%`, height: "100%",
                background: budgetColor, borderRadius: 999,
                transition: "width .6s, background .6s",
              }} />
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}

const iconBtn: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 8,
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(148,178,245,0.12)",
  color: "rgba(200,215,240,0.7)", cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: 13,
};

const actionBtn: React.CSSProperties = {
  padding: "4px 10px", borderRadius: 6,
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(148,178,245,0.15)",
  color: "rgba(200,215,240,0.7)", fontSize: 11, cursor: "pointer",
  transition: "background .15s, color .15s",
};
