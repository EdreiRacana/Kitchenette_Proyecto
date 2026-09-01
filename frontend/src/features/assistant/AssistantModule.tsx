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
import api from "../../services/api";

// ── Silueta NovaMark — logo oficial Sthenova ───────────────────────────
// Coordenadas exactas del NovaMark tal como viven en TrianglesCanvas.tsx
// (usado en el login y en toda la marca). NO se altera — es la identidad.
function trianglePath(size: number = 100, margin: number = 4): string {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - margin;
  const pts: [number, number][] = [
    [0, -1.00],     // pico superior
    [1, 0.7419],    // esquina inferior derecha
    [0, 0.3871],    // muesca central inferior (profundidad oficial)
    [-1, 0.7419],   // esquina inferior izquierda
  ];
  return pts.map(([x, y], i) => {
    const px = cx + x * r;
    const py = cy + y * r;
    return `${i === 0 ? "M" : "L"} ${px.toFixed(2)} ${py.toFixed(2)}`;
  }).join(" ") + " Z";
}

// Path para el core pulsante — más pequeño y centrado hacia arriba, donde
// se ve la mayor "carne" del triángulo (encima de la muesca).
function coreCirclePath(size: number = 100): { cx: number; cy: number; r: number } {
  return { cx: size / 2, cy: size * 0.42, r: size * 0.20 };
}

// ── Triángulo holográfico Sthenova ─────────────────────────────────────
// Cuerpo glassy translúcido azul-cian sobre la silueta OFICIAL del logo,
// con un núcleo luminoso central que PULSA — brilla y se apaga cíclica-
// mente cada 2.4s. Ese pulso es lo que le da la sensación de "presencia
// viva" tipo holograma, sin ser invasivo.
let _gid = 0;
function MetallicTriangle({ size = 32, glow = true, pulse = false, outlined = false }: {
  size?: number; glow?: boolean; pulse?: boolean; outlined?: boolean;
}) {
  const gid = useMemo(() => `mt${++_gid}`, []);
  const glowShadow = glow ? `drop-shadow(0 0 ${size * 0.09}px rgba(140,200,255,0.28))` : "";
  // Cuando outlined=true, refuerza el halo azul cyan para hacer notable el borde.
  const outlineShadow = outlined
    ? " drop-shadow(0 0 1px rgba(120,200,255,0.9)) drop-shadow(0 0 6px rgba(90,180,255,0.55))"
    : "";
  const filter = (glowShadow + outlineShadow).trim() || undefined;
  const core = coreCirclePath(100);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ filter, transformOrigin: "center" }}
      aria-hidden="true"
    >
      <defs>
        {/* Cuerpo glassy azul-cian translúcido */}
        <linearGradient id={`${gid}-body`} x1="30%" y1="0%" x2="70%" y2="100%">
          <stop offset="0%"   stopColor="rgba(210,235,255,0.75)" />
          <stop offset="40%"  stopColor="rgba(130,180,235,0.42)" />
          <stop offset="100%" stopColor="rgba(70,120,190,0.55)" />
        </linearGradient>
        {/* Núcleo interno luminoso — pulsa */}
        <radialGradient id={`${gid}-core`} cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="rgba(240,250,255,0.95)" />
          <stop offset="35%"  stopColor="rgba(160,215,255,0.55)" />
          <stop offset="70%"  stopColor="rgba(100,170,240,0.15)" />
          <stop offset="100%" stopColor="rgba(60,120,200,0)" />
        </radialGradient>
        {/* Reflejo superior */}
        <linearGradient id={`${gid}-shine`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.55)" />
          <stop offset="50%"  stopColor="rgba(255,255,255,0.04)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
        {/* Máscara con la forma del triángulo — para que el núcleo pulsante
            NO se salga por los bordes al brillar. */}
        <clipPath id={`${gid}-clip`}>
          <path d={trianglePath(100, 3)} />
        </clipPath>
      </defs>

      {/* Silueta principal glassy — stroke reforzado cuando outlined=true */}
      <path
        d={trianglePath(100, 3)}
        fill={`url(#${gid}-body)`}
        stroke={outlined ? "rgba(120,200,255,0.95)" : "rgba(180,220,255,0.55)"}
        strokeWidth={outlined ? "2.2" : "0.7"}
        strokeLinejoin="round"
      />

      {/* Núcleo pulsante — clippeado al triángulo, opacidad animada */}
      <g style={{
        transformOrigin: `${core.cx}px ${core.cy}px`,
        animation: pulse ? "assistant-core-pulse 2.4s ease-in-out infinite" : undefined,
      }} clipPath={`url(#${gid}-clip)`}>
        <circle cx={core.cx} cy={core.cy} r={core.r * 1.8} fill={`url(#${gid}-core)`} />
      </g>

      {/* Reflejo superior encima */}
      <path
        d={trianglePath(100, 6)}
        fill={`url(#${gid}-shine)`}
        opacity="0.75"
        strokeLinejoin="round"
      />

      {/* Wireframe interior — líneas de pico a esquinas y muesca */}
      <line x1="50" y1="4"  x2="50" y2="69" stroke="rgba(200,230,255,0.18)" strokeWidth="0.5" />
      <line x1="50" y1="4"  x2="93" y2="87" stroke="rgba(200,230,255,0.12)" strokeWidth="0.4" />
      <line x1="50" y1="4"  x2="7"  y2="87" stroke="rgba(200,230,255,0.12)" strokeWidth="0.4" />
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
type Msg = {
  role: "user" | "assistant";
  text: string;
  source?: string;
  ms?: number;
  // Payload crudo devuelto por la tool — usado para exportar a Excel.
  tool?: string;
  data?: any;
  // Pregunta original que originó esta respuesta (se copia en el XLSX).
  question?: string;
};

// Chips sugeridos según el módulo actual — se calculan al abrir el panel.
// Como en fase A no consumimos el path del router, van 4 preguntas de las
// más frecuentes en cualquier ERP.
const DEFAULT_CHIPS = [
  "¿Cuánto vendí este mes?",
  "Top 5 productos",
  "Cartera vencida",
  "¿Cómo va Walmart?",
];

// Llama al endpoint real /assistant/ask. Sprint 1: cero LLM, todo Python.
async function fetchAnswer(question: string): Promise<{
  text: string; source: string; ms: number; tool?: string; data?: any;
}> {
  try {
    const { data } = await api.post("/assistant/ask", { question });
    return {
      text: data?.text || "Sin respuesta.",
      source: data?.source || "Sistema",
      ms: data?.ms ?? 0,
      tool: data?.tool,
      data: data?.data,
    };
  } catch (e: any) {
    const msg = e?.response?.data?.detail || e?.message || "Error de conexión";
    return { text: `No pude consultar el asistente: ${msg}`, source: "Error", ms: 0 };
  }
}

// Heurística: la respuesta es descargable a Excel si trae un array con
// datos (items, top_debtors, horas, etc.) o al menos 2 escalares.
// Refleja assistant/export.py::is_exportable() del backend para no
// mostrar el botón cuando el backend igual va a rechazar.
const TABLE_KEYS = [
  "items", "top_debtors", "top_creditors", "accounts", "horas",
  "top", "sesiones", "recientes", "rapidos", "mas_lentos", "bottom",
  // ventas_persona devuelve estas tres — el botón debe aparecer si al
  // menos una tiene filas.
  "vendedores", "clientes", "empleados",
];
function isExportable(data: any): boolean {
  if (!data || typeof data !== "object") return false;
  for (const k of TABLE_KEYS) {
    const v = (data as any)[k];
    if (Array.isArray(v) && v.length > 0) return true;
  }
  // Escalares suficientes: ≥3 claves no vacías (evita exportar respuestas
  // triviales de una sola cifra).
  const filled = Object.entries(data).filter(
    ([_k, v]) => v !== null && v !== undefined && v !== "" && !Array.isArray(v)
  ).length;
  return filled >= 3;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 100);
}

type SuggestionType = "tool" | "store" | "customer" | "employee" | "module";
type Suggestion = {
  tool: string; prompt: string; score: number;
  type?: SuggestionType; sublabel?: string;
};

async function fetchSuggestions(q: string): Promise<Suggestion[]> {
  try {
    const { data } = await api.get("/assistant/suggest", { params: { q } });
    return Array.isArray(data?.items) ? data.items : [];
  } catch {
    return [];
  }
}

async function downloadExcel(tool: string, data: any, question?: string) {
  try {
    const res = await api.post(
      "/assistant/export-xlsx",
      { tool_name: tool, data, question },
      { responseType: "blob" }
    );
    const blob = res.data as Blob;
    // Extraer filename del Content-Disposition si viene.
    let filename = `asistente_${tool}.xlsx`;
    const cd = res.headers?.["content-disposition"];
    if (cd) {
      const m = /filename="?([^"]+)"?/i.exec(cd);
      if (m) filename = m[1];
    }
    triggerDownload(blob, filename);
  } catch (e: any) {
    alert("No pude generar el Excel: " + (e?.response?.data?.detail || e?.message || "error desconocido"));
  }
}

// ── Assistant (componente principal, se monta en App root) ─────────────
export default function Assistant({ lang = "es" }: { lang?: "es" | "en" } = {}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  // Presupuesto real leído del backend: /assistant/budget devuelve
  // { pct, level, over_budget }. Se refresca al abrir y tras cada mensaje.
  const [budget, setBudget] = useState<{ pct: number; level: "green" | "amber" | "red"; over: boolean }>(
    { pct: 0, level: "green", over: false }
  );
  const refreshBudget = async () => {
    try {
      const { data } = await api.get("/assistant/budget");
      setBudget({
        pct: data?.pct ?? 0,
        level: (data?.level as "green" | "amber" | "red") || "green",
        over: !!data?.over_budget,
      });
    } catch { /* silencio — la barra queda como esté */ }
  };
  useEffect(() => { if (open) refreshBudget(); }, [open]);
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

  // ── Typeahead de sugerencias (debounced) ─────────────────────────
  // Al escribir en el input, con 180ms de debounce llamamos a
  // /assistant/suggest y mostramos las top 5 en un popover flotante.
  // Cero AI: matching por substring + prefix en el backend.
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [activeSuggest, setActiveSuggest] = useState<number>(-1);
  const suggestDebounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!open) return;
    if (suggestDebounceRef.current) window.clearTimeout(suggestDebounceRef.current);
    const q = input.trim();
    // Solo consulta si el usuario está escribiendo activamente.
    suggestDebounceRef.current = window.setTimeout(async () => {
      if (q.length === 0) {
        setSuggestions([]);
        setShowSuggest(false);
        return;
      }
      const items = await fetchSuggestions(q);
      setSuggestions(items);
      setShowSuggest(items.length > 0);
      setActiveSuggest(-1);
    }, 180);
    return () => {
      if (suggestDebounceRef.current) window.clearTimeout(suggestDebounceRef.current);
    };
  }, [input, open]);

  const applySuggestion = (s: Suggestion) => {
    setInput("");
    setShowSuggest(false);
    setSuggestions([]);
    send(s.prompt);
  };

  const send = async (text?: string) => {
    const question = (text ?? input).trim();
    if (!question || streaming) return;
    setInput("");
    setMsgs(prev => [...prev, { role: "user", text: question }]);
    setStreaming(true);
    // Placeholder mientras espera respuesta real del backend
    setMsgs(prev => [...prev, { role: "assistant", text: "", source: "", ms: 0 }]);
    const answer = await fetchAnswer(question);
    // Streaming visual — letra por letra a ~14ms. Aunque el backend
    // devolvió toda la respuesta de una, mostrarla progresivamente da la
    // sensación de "escribiendo" que ya se espera de un asistente moderno.
    let acc = "";
    for (const ch of answer.text) {
      await new Promise(r => setTimeout(r, 14));
      acc += ch;
      setMsgs(prev => {
        const copy = [...prev];
        copy[copy.length - 1] = {
          role: "assistant", text: acc, source: answer.source, ms: answer.ms,
          tool: answer.tool, data: answer.data, question,
        };
        return copy;
      });
    }
    setStreaming(false);
    // Refresca la barra por si la respuesta consumió LLM (Sprint 2+)
    refreshBudget();
  };

  // ── Voces del sistema (Web Speech API) ─────────────────────────────
  // Los navegadores exponen las voces del OS + voces cloud del propio
  // navegador (Chrome/Edge). Todas gratuitas. Filtramos a español y
  // dejamos al usuario elegir. La lista suele venir vacía en el primer
  // llamado; hay que escuchar 'voiceschanged' para completarla.
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string>(() => {
    try { return localStorage.getItem("assistant:voice") || ""; } catch { return ""; }
  });
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const load = () => {
      const all = window.speechSynthesis.getVoices();
      const es = all.filter(v => v.lang.toLowerCase().startsWith("es"));
      setVoices(es);
    };
    load();
    window.speechSynthesis.addEventListener?.("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", load);
  }, []);

  // Etiqueta corta y legible por voz — quita el "Microsoft"/"Google"
  // repetitivo y muestra el nombre + acento entre paréntesis.
  const formatVoiceLabel = (v: SpeechSynthesisVoice): string => {
    const name = v.name
      .replace(/^Microsoft\s+/i, "")
      .replace(/^Google\s+/i, "")
      .replace(/\s+Online.*$/i, "")
      .replace(/\s+\(Natural\)/i, " · natural")
      .trim();
    const region = v.lang.split("-")[1]?.toUpperCase() || "";
    return region ? `${name} (${region})` : name;
  };

  // Elimina marcadores de markdown que ensucian la lectura y el render en
  // texto plano: **bold**, *italic*, __bold__, _italic_, `code`, # heading,
  // enlaces [txt](url) → txt. Se aplica antes de mostrar y antes de TTS.
  const stripMarkdown = (text: string): string => {
    if (!text) return "";
    return text
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1$2")
      .replace(/(^|[^_])_([^_\n]+?)_(?!_)/g, "$1$2")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^\s*#{1,6}\s+/gm, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  };

  // Prepara el texto para lectura de voz. El TTS pronuncia "$" como
  // "dolares", pero todos los importes del sistema son MXN, asi que
  // reescribimos "$1,234.56" → "1234 pesos con 56 centavos" (y "$1M" →
  // "1 millon de pesos"). Se aplica SOLO al TTS, no al texto visible.
  const speakFriendly = (text: string): string => {
    let s = stripMarkdown(text);
    // Millones: $4.5M / $4M → "4.5 millones de pesos" / "4 millones de pesos"
    s = s.replace(/\$\s*([\d,]+(?:\.\d+)?)\s*M\b/g, (_m, n) => {
      const val = n.replace(/,/g, "");
      return `${val} ${val === "1" ? "millón" : "millones"} de pesos`;
    });
    // Miles: $4.5K / $4K → "4500 pesos" / "4000 pesos"
    s = s.replace(/\$\s*([\d,]+(?:\.\d+)?)\s*K\b/g, (_m, n) => {
      const raw = parseFloat(n.replace(/,/g, ""));
      if (isNaN(raw)) return `${n} pesos`;
      return `${Math.round(raw * 1000)} pesos`;
    });
    // Importes normales: $1,234.56 / $1,234 → "1234 pesos con 56 centavos"
    s = s.replace(/\$\s*([\d,]+)(?:\.(\d{1,2}))?/g, (_m, entero, cents) => {
      const int = entero.replace(/,/g, "");
      if (cents && cents !== "00") return `${int} pesos con ${cents.padEnd(2, "0")} centavos`;
      return `${int} pesos`;
    });
    return s;
  };

  // Texto a voz nativo (SpeechSynthesis). Sin costo, calidad del sistema.
  const speak = (text: string, voiceOverride?: SpeechSynthesisVoice) => {
    try {
      const u = new SpeechSynthesisUtterance(speakFriendly(text));
      const chosen = voiceOverride
        || voices.find(v => v.name === selectedVoiceName)
        || voices.find(v => v.lang.toLowerCase().startsWith("es-mx"))
        || voices[0];
      if (chosen) { u.voice = chosen; u.lang = chosen.lang; }
      else { u.lang = "es-MX"; }
      u.rate = 1.02;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { /* navegador sin TTS */ }
  };

  const previewVoice = (v: SpeechSynthesisVoice) => {
    speak("Hola, soy tu asistente. Puedo ayudarte a analizar tu negocio.", v);
  };

  const selectVoice = (v: SpeechSynthesisVoice) => {
    setSelectedVoiceName(v.name);
    try { localStorage.setItem("assistant:voice", v.name); } catch { /* noop */ }
  };

  // Color de la barra según nivel del backend (green/amber/red)
  const budgetColor =
    budget.level === "red"   ? "#EF4444" :
    budget.level === "amber" ? "#F0B740" :
                                "#4ADE80";
  // Ancho mínimo 4% para que la barra sea visible aún si el gasto es 0
  const budgetWidthPct = Math.max(4, Math.round(budget.pct * 100));

  return createPortal(
    <>
      <style>{`
        @keyframes assistant-core-pulse {
          0%,100% { opacity: 0.35; transform: scale(0.85); }
          50%     { opacity: 1.00; transform: scale(1.15); }
        }
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
        display: "flex", flexDirection: "column", alignItems: "center", gap: 0,
      }}>
        <button
          onClick={() => { setOpen(o => !o); if (showWelcome) dismissWelcome(); }}
          title={lang === "en" ? "Assistant (Ctrl+K)" : "Asistente (Ctrl+K)"}
          aria-label="Abrir asistente"
          className="assistant-fab"
          style={{
            width: 52, height: 52, borderRadius: 14,
            background: "transparent",
            border: "none", padding: 0,
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "opacity .2s, transform .2s",
            opacity: open ? 1 : 0.9,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = open ? "1" : "0.9"; }}
        >
          <span className="assistant-fab-inner" style={{ display: "flex", transition: "transform .2s" }}>
            <MetallicTriangle size={40} glow={true} pulse={!open} outlined />
          </span>
        </button>
        {/* Label "Asistente" — pegado al triangulo, notable pero discreto */}
        <div style={{
          fontSize: 9.5, letterSpacing: 1.4, textTransform: "uppercase",
          color: "rgba(200,220,250,0.9)", fontWeight: 600,
          animation: "assistant-label-pulse 3.4s ease-in-out infinite",
          userSelect: "none", marginTop: -2,
          textShadow: "0 0 8px rgba(120,170,255,0.5)",
        }}>{lang === "en" ? "Assistant" : "Asistente"}</div>
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
            // Cristal frosted: fondo con gradient translucido + blur intenso
            // + doble sombra interna para simular grosor de vidrio.
            background: "linear-gradient(160deg, rgba(30,45,80,0.28) 0%, rgba(10,18,36,0.22) 60%, rgba(15,25,48,0.30) 100%)",
            backdropFilter: "blur(48px) saturate(200%)",
            WebkitBackdropFilter: "blur(48px) saturate(200%)",
            border: "1px solid rgba(180,215,255,0.28)",
            borderRadius: 22,
            boxShadow: "0 28px 70px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -1px 0 rgba(0,0,0,0.25)",
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
              <MetallicTriangle size={30} glow={true} pulse={streaming} />
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 500, letterSpacing: 0.1 }}>{lang === "en" ? "Assistant" : "Asistente"}</div>
                <div style={{ fontSize: 11, color: "rgba(180,200,235,0.55)", marginTop: 1 }}>
                  {streaming ? "Analizando…" : "Análisis inteligente del negocio"}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 4, position: "relative" }}>
              <button title="Cambiar voz del asistente"
                onClick={() => setVoicePickerOpen(o => !o)}
                style={{ ...iconBtn,
                  background: voicePickerOpen ? "rgba(120,170,255,0.16)" : iconBtn.background,
                  color: voicePickerOpen ? "#B5CDF3" : iconBtn.color,
                }}>⚙</button>
              <button title="Nueva conversación"
                onClick={() => setMsgs([])}
                style={iconBtn}>↻</button>
              <button title="Cerrar" onClick={() => setOpen(false)} style={iconBtn}>✕</button>

              {/* Popover de voces — cristal, ancla al engranaje */}
              {voicePickerOpen && (
                <div
                  onClick={e => e.stopPropagation()}
                  style={{
                    position: "absolute", top: 40, right: 0, zIndex: 10,
                    width: 296, maxHeight: 360, overflowY: "auto",
                    padding: 12,
                    background: "rgba(12, 20, 38, 0.55)",
                    backdropFilter: "blur(32px) saturate(180%)",
                    WebkitBackdropFilter: "blur(32px) saturate(180%)",
                    border: "1px solid rgba(180,215,255,0.20)",
                    borderRadius: 14,
                    boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
                  }}
                  className="assistant-scroll"
                >
                  <div style={{
                    fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase",
                    color: "rgba(180,200,235,0.7)", fontWeight: 500, marginBottom: 8,
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}>
                    <span>Voz del asistente</span>
                    <span style={{ opacity: 0.5, fontSize: 10, textTransform: "none", letterSpacing: 0 }}>
                      {voices.length} {voices.length === 1 ? "disponible" : "disponibles"}
                    </span>
                  </div>
                  {voices.length === 0 ? (
                    <div style={{ padding: 10, fontSize: 12, color: "rgba(200,215,240,0.6)", textAlign: "center", lineHeight: 1.5 }}>
                      No se detectaron voces en español en este navegador.<br/>
                      <span style={{ fontSize: 11, color: "rgba(180,200,235,0.45)" }}>
                        Prueba con Chrome, Edge o Safari.
                      </span>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {voices.map(v => {
                        const isSelected = v.name === selectedVoiceName
                          || (!selectedVoiceName && v.lang.toLowerCase().startsWith("es-mx") && v === voices.find(x => x.lang.toLowerCase().startsWith("es-mx")));
                        return (
                          <div key={v.name}
                            onClick={() => selectVoice(v)}
                            style={{
                              display: "flex", alignItems: "center", gap: 8,
                              padding: "8px 10px", borderRadius: 8, cursor: "pointer",
                              background: isSelected ? "rgba(120,170,255,0.14)" : "transparent",
                              border: `1px solid ${isSelected ? "rgba(160,200,255,0.25)" : "transparent"}`,
                              transition: "background .12s",
                            }}
                            onMouseEnter={e => {
                              if (!isSelected) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
                            }}
                            onMouseLeave={e => {
                              if (!isSelected) (e.currentTarget as HTMLElement).style.background = "transparent";
                            }}
                          >
                            <div style={{
                              width: 14, height: 14, borderRadius: "50%",
                              border: `1px solid ${isSelected ? "#B5CDF3" : "rgba(148,178,245,0.25)"}`,
                              background: isSelected ? "radial-gradient(circle, #B5CDF3 0%, #B5CDF3 40%, transparent 55%)" : "transparent",
                              flexShrink: 0,
                            }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, color: "#E4ECFB", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {formatVoiceLabel(v)}
                              </div>
                              <div style={{ fontSize: 10, color: "rgba(180,200,235,0.5)" }}>
                                {v.localService ? "Sistema" : "Cloud del navegador"}
                              </div>
                            </div>
                            <button
                              onClick={e => { e.stopPropagation(); previewVoice(v); }}
                              title="Escuchar muestra"
                              style={{
                                width: 26, height: 26, borderRadius: 6,
                                background: "rgba(255,255,255,0.06)",
                                border: "1px solid rgba(148,178,245,0.20)",
                                color: "rgba(200,215,240,0.85)",
                                cursor: "pointer", flexShrink: 0,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 11,
                              }}
                            >▶</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ marginTop: 10, fontSize: 10.5, color: "rgba(160,180,220,0.5)", textAlign: "center", lineHeight: 1.5 }}>
                    Todas las voces son gratuitas y viven en tu navegador. Cero consumo del presupuesto.
                  </div>
                </div>
              )}
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
                    {stripMarkdown(m.text)}
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
                          onClick={() => navigator.clipboard?.writeText(stripMarkdown(m.text)).catch(() => {})}
                          style={actionBtn}>📋 Copiar</button>
                        {m.tool && isExportable(m.data) && (
                          <button className="assistant-action-btn"
                            onClick={() => downloadExcel(m.tool!, m.data, m.question)}
                            style={actionBtn}>📊 Descargar Excel</button>
                        )}
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
          <div style={{ padding: "12px 14px 14px", borderTop: "1px solid rgba(148,178,245,0.10)",
                         position: "relative" }}>
            {/* Popover de sugerencias — arriba del input, cierra en Escape
                o click fuera. Al click en una sugerencia, se envía como
                pregunta directa. */}
            {showSuggest && suggestions.length > 0 && (
              <div style={{
                position: "absolute", left: 14, right: 14, bottom: "100%",
                marginBottom: 6,
                background: "rgba(12,22,44,0.98)",
                border: "1px solid rgba(148,178,245,0.25)",
                borderRadius: 12, padding: 6,
                boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
                zIndex: 20, maxHeight: 260, overflowY: "auto",
              }}>
                <div style={{ fontSize: 10, color: "rgba(160,180,220,0.55)",
                               padding: "4px 8px" }}>
                  Sugerencias · ↑↓ para elegir, Enter para enviar
                </div>
                {suggestions.map((s, i) => {
                  const icon = s.type === "store" ? "🏬"
                    : s.type === "customer" ? "👤"
                    : s.type === "employee" ? "💼"
                    : s.type === "module" ? "📊"
                    : "→";
                  return (
                    <div
                      key={`${s.tool}-${s.prompt}-${i}`}
                      onMouseEnter={() => setActiveSuggest(i)}
                      onMouseDown={(e) => { e.preventDefault(); applySuggestion(s); }}
                      style={{
                        padding: "8px 10px", borderRadius: 8,
                        background: activeSuggest === i
                          ? "rgba(70,120,200,0.28)" : "transparent",
                        color: "#DEE9FB", fontSize: 13, cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 10,
                      }}
                    >
                      <span style={{ color: "rgba(140,200,255,0.85)", width: 16, textAlign: "center" }}>{icon}</span>
                      <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.prompt}</span>
                      {s.sublabel && (
                        <span style={{
                          fontSize: 10, color: "rgba(160,180,220,0.55)",
                          textTransform: "uppercase", letterSpacing: 0.5,
                          flexShrink: 0,
                        }}>{s.sublabel}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
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
                onBlur={() => setTimeout(() => setShowSuggest(false), 120)}
                onKeyDown={e => {
                  // Navegación del popover de sugerencias
                  if (showSuggest && suggestions.length > 0) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setActiveSuggest(i => Math.min(i + 1, suggestions.length - 1));
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setActiveSuggest(i => Math.max(i - 1, -1));
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setShowSuggest(false);
                      return;
                    }
                    if (e.key === "Tab" && activeSuggest >= 0) {
                      e.preventDefault();
                      applySuggestion(suggestions[activeSuggest]);
                      return;
                    }
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    // Enter con sugerencia activa → envía esa sugerencia.
                    // Sin sugerencia activa → envía lo que el usuario escribió.
                    if (showSuggest && activeSuggest >= 0) {
                      applySuggestion(suggestions[activeSuggest]);
                    } else {
                      send();
                    }
                  }
                }}
                placeholder={
                  speech.listening
                    ? (lang === "en" ? "Listening…" : "Escuchando…")
                    : (lang === "en" ? "Ask me something about the business…" : "Pregúntame algo del negocio…")
                }
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
                width: `${budgetWidthPct}%`, height: "100%",
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
