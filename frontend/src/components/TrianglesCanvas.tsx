/**
 * TrianglesCanvas.tsx
 * Fondo animado del login. El contorno del triángulo (silueta NovaMark) se
 * mantiene siempre visible — es el logo. Dentro del triángulo, un enjambre
 * de partículas se acomoda cíclicamente en distintas formas:
 *   círculo → cuadrado → octágono → triángulo → círculo → …
 * Cada forma se mantiene ~3 segundos con una transición suave.
 *
 * Interacción: al pasar el cursor cerca del centro, las partículas se
 * "desarman" en una red caótica y las líneas cerca del cursor se iluminan
 * (mismo comportamiento que ya existía).
 *
 * Accesibilidad: prefers-reduced-motion → congela el ciclo en una figura
 * y desactiva la deformación.
 */

import { useEffect, useRef } from "react";

// Silueta NovaMark normalizada a [-1..1] (mismo polígono que el SVG del logo,
// polygon points="0,-62 62,46 0,24 -62,46" → dividido entre 62).
const NOVA_SHAPE: [number, number][] = [
  [ 0,   -1.00],
  [ 1,    0.7419],
  [ 0,    0.3871],
  [-1,    0.7419],
];

const SHAPE_HOLD_MS = 3000;     // tiempo que se mantiene cada forma
const SHAPE_MORPH_MS = 900;     // transición suave entre formas
const NUM_PARTICLES = 72;       // partículas del enjambre (mismo count en cada forma)

// Radio máximo interior seguro dentro del triángulo (evita tocar los bordes).
// El triángulo apunta hacia arriba; el centro geométrico está ligeramente
// abajo del (0,0) del logo. Con centerY = -0.05 y radius = 0.45 las figuras
// caben cómodas sin invadir los vértices ni el notch inferior.
const CENTER_Y = -0.05;
const SHAPE_RADIUS = 0.45;

function circlePoints(n: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    pts.push([Math.cos(a), Math.sin(a)]);
  }
  return pts;
}

// Perímetro parametrizado de un polígono regular con N vértices, muestreado
// uniformemente. Devuelve `count` puntos distribuidos a lo largo del contorno.
function polygonPoints(vertices: number, count: number, rotationOffset = 0): [number, number][] {
  const verts: [number, number][] = [];
  for (let i = 0; i < vertices; i++) {
    const a = (i / vertices) * Math.PI * 2 - Math.PI / 2 + rotationOffset;
    verts.push([Math.cos(a), Math.sin(a)]);
  }
  // Muestreo uniforme a lo largo del perímetro
  const pts: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * vertices;   // en cuál lado (fraccional)
    const side = Math.floor(t) % vertices;
    const frac = t - Math.floor(t);
    const [x1, y1] = verts[side];
    const [x2, y2] = verts[(side + 1) % vertices];
    pts.push([x1 + (x2 - x1) * frac, y1 + (y2 - y1) * frac]);
  }
  return pts;
}

// Las 4 figuras del ciclo. Todas devuelven puntos en [-1..1] y luego se
// escalan por SHAPE_RADIUS y se desplazan a (0, CENTER_Y).
function buildShape(kind: "circle" | "square" | "octagon" | "triangle"): [number, number][] {
  switch (kind) {
    case "circle":   return circlePoints(NUM_PARTICLES);
    case "square":   return polygonPoints(4, NUM_PARTICLES, Math.PI / 4);
    case "octagon":  return polygonPoints(8, NUM_PARTICLES);
    // Triángulo apunta hacia arriba (rotación 0 con offset -PI/2 desde polygonPoints)
    case "triangle": return polygonPoints(3, NUM_PARTICLES);
  }
}

const SHAPE_CYCLE: Array<"circle" | "square" | "octagon" | "triangle"> = [
  "circle", "square", "octagon", "triangle",
];

// Easing suave (ease-in-out cúbico) para las transiciones entre formas
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

interface Particle {
  // Posición actual (px relativos al centro del canvas)
  x: number;
  y: number;
  // Movimiento caótico cuando la red se desarma (hover)
  rx: number;
  ry: number;
  vx: number;
  vy: number;
}

export function TrianglesCanvas({ accent, dim, hi }: {
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

    // Pre-computar las 4 figuras normalizadas (independientes de scale)
    const shapes = SHAPE_CYCLE.map(k => buildShape(k));

    // Partículas: arrancan directamente en la primera figura (círculo)
    let scale = logoScale();
    const scaleShape = (pts: [number, number][]) => pts.map(([nx, ny]) =>
      [nx * SHAPE_RADIUS * scale, ny * SHAPE_RADIUS * scale + CENTER_Y * scale] as [number, number]
    );

    let currentShapePx = scaleShape(shapes[0]);
    const particles: Particle[] = currentShapePx.map(([x, y]) => ({
      x, y,
      rx: (Math.random() - 0.5) * scale * 1.4,
      ry: (Math.random() - 0.5) * scale * 1.4,
      vx: (Math.random() - 0.5) * 0.7,
      vy: (Math.random() - 0.5) * 0.7,
    }));

    // Rebuild cache cuando cambia mucho el tamaño (evita jitter)
    let cachedShapesPx = shapes.map(scaleShape);

    const rebuildScale = () => {
      const s = logoScale();
      if (Math.abs(s - scale) > 40) {
        scale = s;
        cachedShapesPx = shapes.map(scaleShape);
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
    const CYCLE_MS = SHAPE_HOLD_MS + SHAPE_MORPH_MS;   // ciclo total por figura

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

      // ── Progreso del ciclo de figuras ────────────────────────────────────
      // Índice y fase (0..1) de morphing entre figura[i] → figura[i+1].
      // La primera parte del ciclo (hold) mantiene la figura estable, la
      // última parte (morph) transiciona con easing.
      const elapsed = reduce ? 0 : (now - t0);
      const cycleIdx = Math.floor(elapsed / CYCLE_MS);
      const cyclePos = (elapsed % CYCLE_MS);
      const fromIdx = cycleIdx % SHAPE_CYCLE.length;
      const toIdx = (fromIdx + 1) % SHAPE_CYCLE.length;
      let morph = 0;
      if (cyclePos > SHAPE_HOLD_MS) {
        morph = (cyclePos - SHAPE_HOLD_MS) / SHAPE_MORPH_MS;
        morph = Math.min(1, Math.max(0, morph));
        morph = easeInOutCubic(morph);
      }
      const shapeFrom = cachedShapesPx[fromIdx];
      const shapeTo = cachedShapesPx[toIdx];

      // ── Halo central suave ──────────────────────────────────────────────
      const centerAlpha = 0.28 * (1 - transicionRed * 0.7);
      if (centerAlpha > 0.02) {
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.75);
        grad.addColorStop(0, toRgba(accent, centerAlpha));
        grad.addColorStop(0.45, toRgba(accent, centerAlpha * 0.35));
        grad.addColorStop(1, toRgba(accent, 0));
        ctx.fillStyle = grad;
        ctx.fillRect(cx - S * 1.3, cy - S * 1.3, S * 2.6, S * 2.6);
      }

      // ── Contorno del triángulo (logo NovaMark) — SIEMPRE visible ────────
      // Este es el logo y no debe cubrirse. Se dibuja con opacidad estable,
      // solo cae un poco cuando la red se desarma (hover) para dejar respirar
      // el efecto interactivo.
      const outlineAlpha = 0.55 * (1 - transicionRed * 0.4);
      if (outlineAlpha > 0.01) {
        ctx.beginPath();
        NOVA_SHAPE.forEach(([nx, ny], i) => {
          const px = cx + nx * S;
          const py = cy + ny * S;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.strokeStyle = toRgba(accent, outlineAlpha);
        ctx.lineWidth = 1.8;
        ctx.stroke();

        // Vértices del logo con puntos más grandes
        ctx.fillStyle = toRgba(accent, outlineAlpha);
        NOVA_SHAPE.forEach(([nx, ny]) => {
          ctx.beginPath();
          ctx.arc(cx + nx * S, cy + ny * S, 3.2, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // ── Posición objetivo de cada partícula ─────────────────────────────
      // En modo idle: interpolación entre figura actual y siguiente (morph).
      // En modo hover: cada partícula se separa y vaga por el interior.
      const positions: { x: number; y: number; distMouse: number; depth: number }[] = [];
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const [fx, fy] = shapeFrom[i];
        const [tx, ty] = shapeTo[i];
        const shapeX = fx + (tx - fx) * morph;
        const shapeY = fy + (ty - fy) * morph;

        // Actualiza posición caótica cuando hay hover
        if (transicionRed > 0.1 && !reduce) {
          p.rx += p.vx * 0.4;
          p.ry += p.vy * 0.4;
          if (Math.abs(p.rx) > S * 0.85) p.vx *= -1;
          if (Math.abs(p.ry - CENTER_Y * S) > S * 0.85) p.vy *= -1;
        }

        // Interpolación entre posición-shape y posición-caótica
        const chaosX = p.rx;
        const chaosY = p.ry + CENTER_Y * S;
        const targetX = shapeX * (1 - transicionRed) + chaosX * transicionRed;
        const targetY = shapeY * (1 - transicionRed) + chaosY * transicionRed;

        // Suavizado hacia el objetivo (además del morph propio)
        p.x += (targetX - p.x) * (reduce ? 1 : 0.18);
        p.y += (targetY - p.y) * (reduce ? 1 : 0.18);

        const xF = cx + p.x;
        const yF = cy + p.y;
        const dm = Math.hypot(xF - mouse.x, yF - mouse.y);
        // Depth: partículas cerca del centro brillan un poco más
        const distC = Math.hypot(p.x, p.y - CENTER_Y * S);
        const depth = Math.max(0.4, 1 - (distC / (S * 0.6)) * 0.6);
        positions.push({ x: xF, y: yF, distMouse: dm, depth });
      }

      // ── Líneas entre partículas cercanas ────────────────────────────────
      const distMaxLineas = transicionRed > 0.3 ? S * 0.28 : S * 0.20;
      const dCerca = S * 0.4;
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const n1 = positions[i], n2 = positions[j];
          const d = Math.hypot(n1.x - n2.x, n1.y - n2.y);
          if (d < distMaxLineas) {
            const md = Math.min(n1.distMouse, n2.distMouse);
            const cerca = md < dCerca;
            const depthAvg = (n1.depth + n2.depth) / 2;
            ctx.beginPath();
            ctx.moveTo(n1.x, n1.y);
            ctx.lineTo(n2.x, n2.y);
            if (cerca) {
              const inten = 1 - md / dCerca;
              ctx.strokeStyle = toRgba(accent, 0.35 + inten * 0.55);
              ctx.lineWidth = 1.4;
            } else {
              const baseAlpha = transicionRed > 0.3 ? 0.24 : 0.28;
              const color = transicionRed > 0.3 ? accent : accent;
              ctx.strokeStyle = toRgba(color, baseAlpha * depthAvg);
              ctx.lineWidth = 1;
            }
            ctx.stroke();
          }
        }
      }

      // ── Partículas (nodos) ───────────────────────────────────────────────
      positions.forEach((n) => {
        const cerca = n.distMouse < dCerca;
        const size = cerca ? 3.6 : (2.2 + 1.2 * n.depth);
        ctx.beginPath();
        ctx.arc(n.x, n.y, size, 0, Math.PI * 2);
        if (cerca) {
          ctx.fillStyle = accent;
          ctx.shadowColor = accent;
          ctx.shadowBlur = 8;
        } else {
          ctx.fillStyle = toRgba(hi, 0.55 + 0.45 * n.depth);
          ctx.shadowBlur = 0;
        }
        ctx.fill();
      });
      // Reset shadow (evita que se acumule en próximos frames)
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
    // dim se recibe pero ya no se usa (transición cromática simplificada)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accent, dim, hi]);

  return <canvas ref={ref} style={{ display: "block", width: "100%", height: "100%" }} aria-hidden />;
}
