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

// ── Silueta NovaMark tipo "punta de flecha" ────────────────────────────
// Basado en el logo Sthenova, con proporciones acentuadas para que el
// silhouette lea claramente como flecha: viewBox más alto que ancho,
// pico superior sostenido y muesca inferior profunda ("fletching").
// Ancho: 100 unidades. Alto: 120 unidades. Origen en centro (50, 60).
function trianglePath(size: number = 100, margin: number = 4): string {
  const cx = 50;
  const cy = 60;                 // centro vertical del viewBox 100x120
  const halfW = 50 - margin;
  const halfH = 60 - margin;
  // Coordenadas normalizadas (-1 a 1) del NovaMark, con muesca más profunda
  // para reforzar la sensación de flecha:
  const pts: [number, number][] = [
    [0, -1.00],     // pico superior (agudo)
    [1, 0.85],      // esquina inferior derecha (más ancha)
    [0, 0.15],      // muesca central (más profunda → arrow feathers marcadas)
    [-1, 0.85],     // esquina inferior izquierda
  ];
  return pts.map(([x, y], i) => {
    const px = cx + x * halfW;
    const py = cy + y * halfH;
    return `${i === 0 ? "M" : "L"} ${px.toFixed(2)} ${py.toFixed(2)}`;
  }).join(" ") + " Z";
}

// ── Triángulo holográfico ──────────────────────────────────────────────
// Look inspirado en holograma cian-blanco tipo Sthenova brand: acabado
// glassy translúcido, luz interna sutil, wireframe interior apenas visible.
// Sin brillo agresivo — solo un halo bajísimo. Respira en vez de girar.
let _gid = 0;
function MetallicTriangle({ size = 32, glow = true, breathe = false }: {
  size?: number; glow?: boolean; breathe?: boolean;
}) {
  const gid = useMemo(() => `mt${++_gid}`, []);
  // Halo bajísimo — 8% de tamaño en blur, opacidad ~0.28
  const filter = glow ? `drop-shadow(0 0 ${size * 0.09}px rgba(140,200,255,0.28))` : undefined;
  return (
    <svg
      width={size}
      height={size * 1.2}
      viewBox="0 0 100 120"
      style={{
        filter,
        transformOrigin: "center",
        animation: breathe ? "assistant-breathe 4.2s ease-in-out infinite" : undefined,
      }}
      aria-hidden="true"
    >
      <defs>
        {/* Cuerpo glassy azul-cian, translúcido */}
        <linearGradient id={`${gid}-body`} x1="30%" y1="0%" x2="70%" y2="100%">
          <stop offset="0%"  stopColor="rgba(210,235,255,0.85)" />
          <stop offset="35%" stopColor="rgba(130,180,235,0.55)" />
          <stop offset="70%" stopColor="rgba(70,120,190,0.45)" />
          <stop offset="100%" stopColor="rgba(100,150,215,0.6)" />
        </linearGradient>
        {/* Núcleo interno con luz — como la del holograma */}
        <radialGradient id={`${gid}-core`} cx="50%" cy="42%" r="45%">
          <stop offset="0%"  stopColor="rgba(240,250,255,0.85)" />
          <stop offset="45%" stopColor="rgba(140,200,255,0.28)" />
          <stop offset="100%" stopColor="rgba(80,140,220,0)" />
        </radialGradient>
        {/* Highlight superior — reflejo suave sobre la cara delantera */}
        <linearGradient id={`${gid}-shine`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"  stopColor="rgba(255,255,255,0.55)" />
          <stop offset="50%" stopColor="rgba(255,255,255,0.05)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>

      {/* Silueta principal glassy */}
      <path
        d={trianglePath(100, 3)}
        fill={`url(#${gid}-body)`}
        stroke="rgba(180,220,255,0.55)"
        strokeWidth="0.7"
        strokeLinejoin="round"
      />
      {/* Núcleo luminoso interior */}
      <path d={trianglePath(100, 3)} fill={`url(#${gid}-core)`} strokeLinejoin="round" />
      {/* Highlight superior */}
      <path
        d={trianglePath(100, 6)}
        fill={`url(#${gid}-shine)`}
        opacity="0.75"
        strokeLinejoin="round"
      />
      {/* Wireframe interior — líneas del pico hacia esquinas y muesca.
          Muy tenues, dan la sensación de estructura holográfica sin invadir. */}
      <line x1="50" y1="0"   x2="50" y2="69" stroke="rgba(200,230,255,0.18)" strokeWidth="0.5" />
      <line x1="50" y1="0"   x2="97" y2="111" stroke="rgba(200,230,255,0.12)" strokeWidth="0.4" />
      <line x1="50" y1="0"   x2="3"  y2="111" stroke="rgba(200,230,255,0.12)" strokeWidth="0.4" />
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
  // Bienvenida de primera vez — se muestra una sola vez y se recuerda en
  // localStorage. Se cierra sola a los 8 s o al primer click en el FAB.
  const [showWelcome, setShowWelcome] = useState<boolean>(() => {
    try { return localStorage.getItem("assistant:welcomed") !== "1"; }
    catch { return false; }
  });
  useEffect(() => {
    if (!showWelcome) return;
    const t = setTimeout(() => dismissWelcome(), 8000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWelcome]);
  const dismissWelcome = () => {
    setShowWelcome(false);
    try { localStorage.setItem("assistant:welcomed", "1"); } catch { /* noop */ }
  };

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
        @keyframes assistant-breathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.035); } }
        @keyframes assistant-label-pulse { 0%,100% { opacity: 0.42; } 50% { opacity: 0.82; } }
        @keyframes assistant-pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.05); opacity: 0.85; } }
        @keyframes assistant-slide-in { from { transform: translateX(24px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes assistant-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes assistant-welcome-in { from { transform: translateX(12px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .assistant-fab:hover .assistant-fab-inner { transform: scale(1.06); }
        .assistant-chip:hover { background: rgba(120,170,255,0.18) !important; border-color: rgba(160,200,255,0.35) !important; }
        .assistant-action-btn:hover { background: rgba(255,255,255,0.08) !important; color: rgba(220,235,255,0.95) !important; }
        .assistant-scroll::-webkit-scrollbar { width: 6px; }
        .assistant-scroll::-webkit-scrollbar-thumb { background: rgba(148,178,245,0.12); border-radius: 3px; }
      `}</style>

      {/* Burbuja de bienvenida — solo primera vez, discreta, auto-cierra */}
      {showWelcome && !open && (
        <div
          style={{
            position: "fixed", right: 88, bottom: 34, zIndex: 9998,
            maxWidth: 240, padding: "10px 14px",
            background: "rgba(15,22,41,0.55)",
            backdropFilter: "blur(24px) saturate(150%)",
            WebkitBackdropFilter: "blur(24px) saturate(150%)",
            border: "1px solid rgba(148,178,245,0.22)",
            borderRadius: 12,
            boxShadow: "0 8px 24px rgba(0,0,0,0.32)",
            color: "#E4ECFB", fontSize: 12.5, lineHeight: 1.45,
            animation: "assistant-welcome-in .3s ease-out",
            display: "flex", alignItems: "flex-start", gap: 10,
          }}
        >
          <div style={{ flex: 1 }}>
            Hola. Soy tu <b style={{ color: "#B5CDF3" }}>asistente</b>.<br/>
            <span style={{ color: "rgba(200,215,240,0.62)", fontSize: 11.5 }}>
              Tócame o presiona Ctrl+K.
            </span>
          </div>
          <button
            onClick={dismissWelcome}
            aria-label="Cerrar bienvenida"
            style={{
              background: "transparent", border: "none", color: "rgba(200,215,240,0.55)",
              cursor: "pointer", fontSize: 13, padding: 0, lineHeight: 1,
            }}
          >✕</button>
        </div>
      )}

      {/* FAB flotante — triángulo cristalino sin fondo, con label debajo */}
      <div style={{
        position: "fixed", right: 24, bottom: 22, zIndex: 9998,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
      }}>
        <button
          onClick={() => { setOpen(o => !o); if (showWelcome) dismissWelcome(); }}
          title="Asistente (Ctrl+K)"
          aria-label="Abrir asistente"
          className="assistant-fab"
          style={{
            width: 52, height: 60, borderRadius: 14,
            background: "transparent",
            border: "none", padding: 0,
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "opacity .2s, transform .2s",
            opacity: open ? 1 : 0.85,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = open ? "1" : "0.85"; }}
        >
          <span className="assistant-fab-inner" style={{ display: "flex", transition: "transform .2s" }}>
            <MetallicTriangle size={40} glow={true} breathe={!open && !streaming} />
          </span>
        </button>
        {/* Label "Asistente" — pulsa muy suave y discreto */}
        <div style={{
          fontSize: 9.5, letterSpacing: 1.2, textTransform: "uppercase",
          color: "rgba(200,215,240,0.72)", fontWeight: 500,
          animation: "assistant-label-pulse 3.4s ease-in-out infinite",
          userSelect: "none", marginTop: 1,
          textShadow: "0 0 6px rgba(120,170,255,0.35)",
        }}>Asistente</div>
      </div>

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
            position: "fixed", right: 20, bottom: 96, zIndex: 9999,
            width: 440, maxWidth: "calc(100vw - 40px)",
            height: "min(720px, calc(100vh - 130px))",
            // Cristal muy translúcido (~30% opaco) + blur fuerte para
            // legibilidad. El fondo del ERP se ve a través pero el texto
            // permanece nítido gracias al backdrop-filter saturado.
            background: "rgba(12, 20, 38, 0.32)",
            backdropFilter: "blur(40px) saturate(180%)",
            WebkitBackdropFilter: "blur(40px) saturate(180%)",
            border: "1px solid rgba(180,215,255,0.18)",
            borderRadius: 22,
            boxShadow: "0 28px 70px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)",
            display: "flex", flexDirection: "column", overflow: "hidden",
            animation: "assistant-slide-in .24s ease-out",
            color: "#E4ECFB",
          }}
        >
          {/* Header */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "16px 18px", borderBottom: "1px solid rgba(148,178,245,0.10)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <MetallicTriangle size={30} glow={true} breathe={streaming} />
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
