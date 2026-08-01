/**
 * TrianglesCanvas.tsx
 * Fondo animado del login. El contorno del triángulo (silueta NovaMark) se
 * mantiene siempre visible — es el logo. Dentro del triángulo, un enjambre
 * de partículas se acomoda cíclicamente en distintas formas RELLENAS con
 * un entramado interno de líneas cortas (mesh):
 *   círculo → cuadrado → octágono → triángulo → círculo → …
 * Cada forma se mantiene ~3 segundos con transición suave.
 *
 * Interacción: al pasar el cursor cerca del centro, las partículas se
 * "desarman" en una red caótica y las líneas cerca del cursor se iluminan.
 *
 * Accesibilidad: prefers-reduced-motion → congela el ciclo y desactiva
 * la deformación caótica.
 */

import { useEffect, useRef } from "react";

// Silueta NovaMark normalizada a [-1..1]
const NOVA_SHAPE: [number, number][] = [
  [ 0,   -1.00],
  [ 1,    0.7419],
  [ 0,    0.3871],
  [-1,    0.7419],
];

const SHAPE_HOLD_MS = 3000;      // tiempo que se mantiene cada forma
const SHAPE_MORPH_MS = 900;      // transición suave entre formas
const NUM_PARTICLES = 160;       // partículas del enjambre (mesh interior)

// Espacio seguro dentro del triángulo: centro ligeramente arriba, radio
// máximo del interior. Deja aire para no invadir vértices ni notch.
const CENTER_Y = -0.05;
const SHAPE_RADIUS = 0.42;

type ShapeKind = "circle" | "square" | "octagon" | "triangle";
const SHAPE_CYCLE: ShapeKind[] = ["circle", "square", "octagon", "triangle"];

/** Radio del contorno de un polígono regular con N vértices (circunradio=1)
 *  en el ángulo θ. Fórmula estándar para regular N-gon centrado en origen. */
function polyRadiusAt(theta: number, sides: number, rotOffset = 0): number {
  const seg = (2 * Math.PI) / sides;
  const th = ((theta - rotOffset) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  const local = (th % seg) - seg / 2;
  return Math.cos(seg / 2) / Math.cos(local);
}

/** Radio del contorno según la figura (todas normalizadas al mismo circunradio=1). */
function shapeRadiusAt(theta: number, kind: ShapeKind): number {
  switch (kind) {
    case "circle":   return 1;
    // Cuadrado apuntando "hacia arriba" con vértices en 45° (más armónico con el logo)
    case "square":   return polyRadiusAt(theta, 4, Math.PI / 4);
    case "octagon":  return polyRadiusAt(theta, 8, 0);
    // Triángulo con vértice hacia arriba (igual orientación que el logo)
    case "triangle": return polyRadiusAt(theta, 3, -Math.PI / 2);
  }
}

/** Vértices (esquinas) de la figura para dibujar el contorno tenue del cycle.
 *  Devuelve los puntos en unidades [-1..1] antes de escalar. */
function shapeCorners(kind: ShapeKind): [number, number][] {
  switch (kind) {
    case "circle": {
      // No hay "esquinas"; se usa una serie de puntos para trazar el círculo
      const out: [number, number][] = [];
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        out.push([Math.cos(a), Math.sin(a)]);
      }
      return out;
    }
    case "square": {
      const out: [number, number][] = [];
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        out.push([Math.cos(a), Math.sin(a)]);
      }
      return out;
    }
    case "octagon": {
      const out: [number, number][] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        out.push([Math.cos(a), Math.sin(a)]);
      }
      return out;
    }
    case "triangle": {
      const out: [number, number][] = [];
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
        out.push([Math.cos(a), Math.sin(a)]);
      }
      return out;
    }
  }
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

interface Particle {
  // Coordenadas polares base (r ∈ [0..1], θ ∈ [0..2π]) que definen la
  // "identidad" del punto en el espacio circular unitario. Cuando la figura
  // cambia, la posición xy se obtiene multiplicando r por shapeRadiusAt(θ).
  r: number;
  theta: number;
  // Posición renderizada (px, relativos al centro del canvas)
  x: number;
  y: number;
  // Estado caótico durante hover (px acumulados desde centro)
  rx: number;
  ry: number;
  vx: number;
  vy: number;
}

export function TrianglesCanvas({ accent, hi }: {
  accent: string; dim: string; hi: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const parent = canvas.parentElement as HTMLElement;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = parent.clientWidth || window.innerWidth;
      const h = parent.clientHeight || window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const centroX = () => canvas.clientWidth / 2;
    const centroY = () => canvas.clientHeight / 2;
    const logoScale = () => Math.max(140, Math.min(canvas.clientWidth, canvas.clientHeight) * 0.48);

    const mouse = { x: -1000, y: -1000, sobreCentro: false };

    // Genera partículas con distribución uniforme en el disco unitario.
    // sqrt(rand) evita la concentración típica en el centro del muestreo naive.
    // Se agrega una pequeña fracción "cerca del borde" para reforzar el
    // contorno de cada figura y que los vértices se noten al morphear.
    const initParticles = (): Particle[] => {
      const S = logoScale();
      const out: Particle[] = [];
      for (let i = 0; i < NUM_PARTICLES; i++) {
        // 30% cerca del borde (r ∈ [0.85, 1.0]), 70% distribuidas uniformes
        const nearEdge = i < NUM_PARTICLES * 0.30;
        const r = nearEdge
          ? 0.85 + Math.random() * 0.15
          : Math.sqrt(Math.random()) * 0.98;
        const theta = Math.random() * Math.PI * 2;
        // Posición xy inicial en la primera figura del ciclo
        const rShape = shapeRadiusAt(theta, SHAPE_CYCLE[0]);
        const x = r * rShape * SHAPE_RADIUS * S * Math.cos(theta);
        const y = r * rShape * SHAPE_RADIUS * S * Math.sin(theta) + CENTER_Y * S;
        out.push({
          r, theta, x, y,
          rx: (Math.random() - 0.5) * S * 1.4,
          ry: (Math.random() - 0.5) * S * 1.4,
          vx: (Math.random() - 0.5) * 0.7,
          vy: (Math.random() - 0.5) * 0.7,
        });
      }
      return out;
    };

    let scale = logoScale();
    let particles = initParticles();

    const rebuildScale = () => {
      const s = logoScale();
      if (Math.abs(s - scale) > 40) {
        scale = s;
        particles = initParticles();
      }
    };
    window.addEventListener("resize", rebuildScale);

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      const dx = mouse.x - centroX();
      const dy = mouse.y - centroY();
      mouse.sobreCentro = Math.hypot(dx, dy) < logoScale() * 0.65;
    };
    const onLeave = () => { mouse.x = -1000; mouse.y = -1000; mouse.sobreCentro = false; };
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);

    const toRgba = (hex: string, a: number): string => {
      const h = hex.replace("#", "");
      const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
      const r = parseInt(full.slice(0, 2), 16) || 0;
      const g = parseInt(full.slice(2, 4), 16) || 0;
      const b = parseInt(full.slice(4, 6), 16) || 0;
      return `rgba(${r},${g},${b},${a})`;
    };

    let transicionRed = 0;
    let raf = 0;
    let stopped = false;
    const t0 = performance.now();
    const CYCLE_MS = SHAPE_HOLD_MS + SHAPE_MORPH_MS;

    const animar = () => {
      if (stopped) return;
      raf = requestAnimationFrame(animar);
      const now = performance.now();
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

      const cx = centroX();
      const cy = centroY();
      const S = scale;

      const objetivo = mouse.sobreCentro ? 1 : 0;
      transicionRed += (objetivo - transicionRed) * 0.06;

      // Índice de figura + fase de morph
      const elapsed = reduce ? 0 : (now - t0);
      const cycleIdx = Math.floor(elapsed / CYCLE_MS);
      const cyclePos = (elapsed % CYCLE_MS);
      const fromIdx = cycleIdx % SHAPE_CYCLE.length;
      const toIdx = (fromIdx + 1) % SHAPE_CYCLE.length;
      let morph = 0;
      if (cyclePos > SHAPE_HOLD_MS) {
        morph = Math.min(1, Math.max(0, (cyclePos - SHAPE_HOLD_MS) / SHAPE_MORPH_MS));
        morph = easeInOutCubic(morph);
      }
      const kindFrom = SHAPE_CYCLE[fromIdx];
      const kindTo = SHAPE_CYCLE[toIdx];

      // ── Halo central suave ──────────────────────────────────────────────
      const centerAlpha = 0.24 * (1 - transicionRed * 0.7);
      if (centerAlpha > 0.02) {
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.75);
        grad.addColorStop(0, toRgba(accent, centerAlpha));
        grad.addColorStop(0.45, toRgba(accent, centerAlpha * 0.35));
        grad.addColorStop(1, toRgba(accent, 0));
        ctx.fillStyle = grad;
        ctx.fillRect(cx - S * 1.3, cy - S * 1.3, S * 2.6, S * 2.6);
      }

      // ── Contorno del triángulo (logo NovaMark) — traslúcido y con pulso ─
      // Pulso lento: seno con período de ~4.5s modula la opacidad entre
      // 65%..115% del valor base (visualmente sutil, no distrae).
      const pulse = 0.9 + 0.25 * Math.sin(elapsed / 4500 * Math.PI * 2);
      const outlineBase = 0.28;
      const outlineAlpha = outlineBase * pulse * (1 - transicionRed * 0.4);
      if (outlineAlpha > 0.01) {
        ctx.beginPath();
        NOVA_SHAPE.forEach(([nx, ny], i) => {
          const px = cx + nx * S;
          const py = cy + ny * S;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.strokeStyle = toRgba(accent, outlineAlpha);
        ctx.lineWidth = 1.6;
        ctx.stroke();

        // Puntos en los vértices del logo (pulsan igual)
        ctx.fillStyle = toRgba(accent, outlineAlpha * 1.4);
        NOVA_SHAPE.forEach(([nx, ny]) => {
          ctx.beginPath();
          ctx.arc(cx + nx * S, cy + ny * S, 3.0, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // ── Contorno tenue de la figura actual del ciclo ─────────────────────
      // Ayuda al ojo a "leer" que las partículas rellenan una figura concreta.
      // Se atenúa con el hover.
      const shapeOutlineAlpha = 0.18 * (1 - transicionRed);
      if (shapeOutlineAlpha > 0.02) {
        const cornersFrom = shapeCorners(kindFrom);
        const cornersTo = shapeCorners(kindTo);
        // Solo dibuja el contorno de la figura DOMINANTE (from si morph<0.5, to si >=0.5).
        // Interpola opacidad para que en el punto medio se atenúe brevemente.
        const useCorners = morph < 0.5 ? cornersFrom : cornersTo;
        const outAlpha = shapeOutlineAlpha * (1 - Math.abs(morph - 0.5) * 2 * 0.6);
        ctx.beginPath();
        useCorners.forEach(([nx, ny], i) => {
          const px = cx + nx * SHAPE_RADIUS * S;
          const py = cy + ny * SHAPE_RADIUS * S + CENTER_Y * S;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.strokeStyle = toRgba(accent, Math.max(0, outAlpha));
        ctx.lineWidth = 1;
        ctx.stroke();

        // Puntos más marcados en los vértices reales (solo poligonales)
        if (kindFrom !== "circle" || kindTo !== "circle") {
          const drawVertexDots = (corners: [number, number][], alpha: number) => {
            ctx.fillStyle = toRgba(accent, alpha);
            corners.forEach(([nx, ny]) => {
              ctx.beginPath();
              ctx.arc(
                cx + nx * SHAPE_RADIUS * S,
                cy + ny * SHAPE_RADIUS * S + CENTER_Y * S,
                2.4, 0, Math.PI * 2,
              );
              ctx.fill();
            });
          };
          if (kindFrom !== "circle") drawVertexDots(cornersFrom, shapeOutlineAlpha * (1 - morph) * 1.6);
          if (kindTo !== "circle") drawVertexDots(cornersTo, shapeOutlineAlpha * morph * 1.6);
        }
      }

      // ── Posiciones de partículas (interpolando entre las 2 figuras) ────
      const positions: { x: number; y: number; distMouse: number; depth: number }[] = [];
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const rFrom = shapeRadiusAt(p.theta, kindFrom);
        const rTo = shapeRadiusAt(p.theta, kindTo);
        const rShape = rFrom + (rTo - rFrom) * morph;
        const magnitude = p.r * rShape * SHAPE_RADIUS * S;
        const shapeX = magnitude * Math.cos(p.theta);
        const shapeY = magnitude * Math.sin(p.theta) + CENTER_Y * S;

        // Movimiento caótico cuando hay hover
        if (transicionRed > 0.1 && !reduce) {
          p.rx += p.vx * 0.4;
          p.ry += p.vy * 0.4;
          if (Math.abs(p.rx) > S * 0.85) p.vx *= -1;
          if (Math.abs(p.ry - CENTER_Y * S) > S * 0.85) p.vy *= -1;
        }
        const chaosX = p.rx;
        const chaosY = p.ry + CENTER_Y * S;
        const targetX = shapeX * (1 - transicionRed) + chaosX * transicionRed;
        const targetY = shapeY * (1 - transicionRed) + chaosY * transicionRed;

        // Suavizado hacia el objetivo
        p.x += (targetX - p.x) * (reduce ? 1 : 0.18);
        p.y += (targetY - p.y) * (reduce ? 1 : 0.18);

        const xF = cx + p.x;
        const yF = cy + p.y;
        const dm = Math.hypot(xF - mouse.x, yF - mouse.y);
        // Depth: partículas cerca del centro brillan más
        const distC = Math.hypot(p.x, p.y - CENTER_Y * S);
        const depth = Math.max(0.35, 1 - (distC / (S * 0.55)) * 0.65);
        positions.push({ x: xF, y: yF, distMouse: dm, depth });
      }

      // ── Malla: líneas entre partículas cercanas (entramado interior) ────
      const distMaxLineas = transicionRed > 0.3 ? S * 0.22 : S * 0.14;
      const dCerca = S * 0.4;
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const n1 = positions[i], n2 = positions[j];
          const dx = n1.x - n2.x;
          const dy = n1.y - n2.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < distMaxLineas * distMaxLineas) {
            const d = Math.sqrt(d2);
            const md = Math.min(n1.distMouse, n2.distMouse);
            const cerca = md < dCerca;
            const depthAvg = (n1.depth + n2.depth) / 2;
            const fadeByDist = 1 - d / distMaxLineas;    // líneas cortas más nítidas
            ctx.beginPath();
            ctx.moveTo(n1.x, n1.y);
            ctx.lineTo(n2.x, n2.y);
            if (cerca) {
              const inten = 1 - md / dCerca;
              ctx.strokeStyle = toRgba(accent, 0.35 + inten * 0.55);
              ctx.lineWidth = 1.4;
            } else {
              const baseAlpha = transicionRed > 0.3 ? 0.20 : 0.30;
              ctx.strokeStyle = toRgba(accent, baseAlpha * depthAvg * fadeByDist);
              ctx.lineWidth = 1;
            }
            ctx.stroke();
          }
        }
      }

      // ── Partículas (nodos) — tenues, más brillantes en el centro ────────
      positions.forEach((n) => {
        const cerca = n.distMouse < dCerca;
        const size = cerca ? 3.2 : (1.4 + 0.9 * n.depth);
        ctx.beginPath();
        ctx.arc(n.x, n.y, size, 0, Math.PI * 2);
        if (cerca) {
          ctx.fillStyle = accent;
          ctx.shadowColor = accent;
          ctx.shadowBlur = 8;
        } else {
          ctx.fillStyle = toRgba(hi, 0.35 + 0.5 * n.depth);
          ctx.shadowBlur = 0;
        }
        ctx.fill();
      });
      ctx.shadowBlur = 0;
    };
    animar();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("resize", rebuildScale);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accent, hi]);

  return <canvas ref={ref} style={{ display: "block", width: "100%", height: "100%" }} aria-hidden />;
}
