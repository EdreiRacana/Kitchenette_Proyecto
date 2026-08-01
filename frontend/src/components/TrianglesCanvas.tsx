/**
 * TrianglesCanvas.tsx
 * Fondo animado del login. Un enjambre de partículas rellena una figura
 * que cambia cíclicamente:
 *   círculo → cuadrado → octágono → NovaMark (silueta del logo) → círculo → …
 * La figura gira sobre su eje vertical con perspectiva 3D (como un planeta):
 * los puntos que quedan "atrás" se atenúan y se contraen; los que quedan
 * "adelante" se ven más grandes y brillantes.
 *
 * Interacción: hover cerca del centro desarma la red y las líneas cerca
 * del cursor se iluminan (comportamiento original preservado).
 *
 * Accesibilidad: prefers-reduced-motion → congela la rotación y el ciclo.
 */

import { useEffect, useRef } from "react";

// Silueta NovaMark cruda (max radius ≈ 1.245 con [1, 0.7419])
const NOVA_RAW: [number, number][] = [
  [ 0,   -1.00],
  [ 1,    0.7419],
  [ 0,    0.3871],
  [-1,    0.7419],
];
// Normalizada a max radius = 1 para que quepa en el mismo envelope que los
// otros polígonos regulares del ciclo.
const NOVA_MAX_R = Math.max(...NOVA_RAW.map(([x, y]) => Math.hypot(x, y)));
const NOVA_SHAPE: [number, number][] = NOVA_RAW.map(([x, y]) =>
  [x / NOVA_MAX_R, y / NOVA_MAX_R] as [number, number]
);

const SHAPE_HOLD_MS = 3000;         // tiempo que se mantiene cada forma
const SHAPE_MORPH_MS = 900;         // transición suave entre formas
const NUM_PARTICLES = 180;          // enjambre (mesh interior)
const ROTATION_PERIOD_MS = 22000;   // una vuelta cada 22 s (planeta)

// Espacio de la figura. Sin logo estático detrás, aprovechamos más pantalla.
// Ligeramente arriba para dejar aire al footer del formulario en móvil.
const CENTER_Y = 0;
const SHAPE_RADIUS = 0.68;

// Perspectiva del giro planetario: profundidad relativa. Con 0.35 los puntos
// del "polo cerca" se agrandan ~35% y los del "polo lejos" se encogen igual.
const PERSPECTIVE = 0.35;

type ShapeKind = "circle" | "square" | "octagon" | "novamark";
const SHAPE_CYCLE: ShapeKind[] = ["circle", "square", "octagon", "novamark"];

/** Radio del contorno de un polígono regular con N vértices (circunradio=1)
 *  en el ángulo θ. */
function polyRadiusAt(theta: number, sides: number, rotOffset = 0): number {
  const seg = (2 * Math.PI) / sides;
  const th = ((theta - rotOffset) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  const local = (th % seg) - seg / 2;
  return Math.cos(seg / 2) / Math.cos(local);
}

/** Intersección del rayo desde el origen en ángulo θ contra un polígono
 *  arbitrario. Devuelve la distancia al contorno (o 1 si algo raro pasa). */
function rayPolyRadius(theta: number, poly: [number, number][]): number {
  const cx = Math.cos(theta), cy = Math.sin(theta);
  let minT = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const dx = x2 - x1, dy = y2 - y1;
    const denom = cx * dy - cy * dx;
    if (Math.abs(denom) < 1e-9) continue;
    const t = (x1 * dy - y1 * dx) / denom;
    const s = (x1 * cy - y1 * cx) / denom;
    if (t > 1e-6 && s >= -1e-6 && s <= 1 + 1e-6) {
      if (t < minT) minT = t;
    }
  }
  return minT === Infinity ? 1 : minT;
}

function shapeRadiusAt(theta: number, kind: ShapeKind): number {
  switch (kind) {
    case "circle":   return 1;
    case "square":   return polyRadiusAt(theta, 4, Math.PI / 4);
    case "octagon":  return polyRadiusAt(theta, 8, 0);
    case "novamark": return rayPolyRadius(theta, NOVA_SHAPE);
  }
}

/** Vértices/puntos del contorno para dibujar la guía tenue de la figura. */
function shapeCorners(kind: ShapeKind): [number, number][] {
  switch (kind) {
    case "circle": {
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
    case "novamark":
      return NOVA_SHAPE.map(([x, y]) => [x, y] as [number, number]);
  }
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

interface Particle {
  r: number;
  theta: number;
  x: number;    // xy renderizado (con perspectiva ya aplicada)
  y: number;
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
    const logoScale = () => Math.max(160, Math.min(canvas.clientWidth, canvas.clientHeight) * 0.44);

    const mouse = { x: -1000, y: -1000, sobreCentro: false };

    const initParticles = (): Particle[] => {
      const S = logoScale();
      const out: Particle[] = [];
      for (let i = 0; i < NUM_PARTICLES; i++) {
        const nearEdge = i < NUM_PARTICLES * 0.30;
        const r = nearEdge
          ? 0.85 + Math.random() * 0.15
          : Math.sqrt(Math.random()) * 0.98;
        const theta = Math.random() * Math.PI * 2;
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

      // ── Rotación planetaria: eje vertical, con perspectiva ─────────────
      // El eje Y se conserva; la coordenada X del punto en la figura se rota
      // en 3D: worldX = shapeX * cos(rot), worldZ = shapeX * sin(rot).
      // Luego se aplica factor de perspectiva basado en Z (los puntos "hacia
      // el frente" se agrandan y brillan, los "atrás" se contraen y atenúan).
      // Se pausa parcialmente cuando hay hover.
      const rotation = reduce ? 0
        : (elapsed / ROTATION_PERIOD_MS) * Math.PI * 2 * (1 - transicionRed * 0.8);
      const cosR = Math.cos(rotation);
      const sinR = Math.sin(rotation);

      // ── Halo central suave ──────────────────────────────────────────────
      const centerAlpha = 0.24 * (1 - transicionRed * 0.7);
      if (centerAlpha > 0.02) {
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 1.05);
        grad.addColorStop(0, toRgba(accent, centerAlpha));
        grad.addColorStop(0.45, toRgba(accent, centerAlpha * 0.35));
        grad.addColorStop(1, toRgba(accent, 0));
        ctx.fillStyle = grad;
        ctx.fillRect(cx - S * 1.6, cy - S * 1.6, S * 3.2, S * 3.2);
      }

      // ── Contorno guía de la figura actual del ciclo (rotado + perspectiva) ──
      const shapeOutlineAlpha = 0.20 * (1 - transicionRed);
      if (shapeOutlineAlpha > 0.02) {
        const cornersFrom = shapeCorners(kindFrom);
        const cornersTo = shapeCorners(kindTo);
        const useCorners = morph < 0.5 ? cornersFrom : cornersTo;
        const outAlpha = shapeOutlineAlpha * (1 - Math.abs(morph - 0.5) * 2 * 0.6);

        const project = (nx: number, ny: number): [number, number, number] => {
          // Escala al espacio de figura
          const sx = nx * SHAPE_RADIUS * S;
          const sy = ny * SHAPE_RADIUS * S + CENTER_Y * S;
          // Rotación eje Y (3D)
          const wX = sx * cosR;
          const wZ = sx * sinR;
          const depth = 1 + (wZ / S) * PERSPECTIVE;
          const px = cx + wX * depth;
          const py = cy + sy * (1 + PERSPECTIVE * 0.15 * (wZ / S));
          // depthAlpha va 0..1 (1 = al frente, 0 = atrás)
          const depthAlpha = 0.35 + 0.65 * ((wZ / S + 1) / 2);
          return [px, py, depthAlpha];
        };

        // Traza el contorno como polilínea (segmentos individuales para que
        // cada tramo pueda tener alpha propio; simplificación: alpha promedio).
        for (let i = 0; i < useCorners.length; i++) {
          const [nx1, ny1] = useCorners[i];
          const [nx2, ny2] = useCorners[(i + 1) % useCorners.length];
          const [p1x, p1y, a1] = project(nx1, ny1);
          const [p2x, p2y, a2] = project(nx2, ny2);
          const alpha = outAlpha * (a1 + a2) / 2;
          if (alpha < 0.01) continue;
          ctx.beginPath();
          ctx.moveTo(p1x, p1y);
          ctx.lineTo(p2x, p2y);
          ctx.strokeStyle = toRgba(accent, alpha);
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Vértices (solo si la figura tiene esquinas — círculo no cuenta)
        const drawVertexDots = (corners: [number, number][], alpha: number) => {
          corners.forEach(([nx, ny]) => {
            const [px, py, da] = project(nx, ny);
            ctx.beginPath();
            ctx.arc(px, py, 2.6, 0, Math.PI * 2);
            ctx.fillStyle = toRgba(accent, alpha * da);
            ctx.fill();
          });
        };
        if (kindFrom !== "circle") drawVertexDots(cornersFrom, shapeOutlineAlpha * (1 - morph) * 1.6);
        if (kindTo !== "circle") drawVertexDots(cornersTo, shapeOutlineAlpha * morph * 1.6);
      }

      // ── Posiciones de partículas (interpolación entre figuras + planeta) ──
      const positions: {
        x: number; y: number; distMouse: number; depth: number; depthAlpha: number;
      }[] = [];
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const rFrom = shapeRadiusAt(p.theta, kindFrom);
        const rTo = shapeRadiusAt(p.theta, kindTo);
        const rShape = rFrom + (rTo - rFrom) * morph;
        const magnitude = p.r * rShape * SHAPE_RADIUS * S;

        // Posición base en el plano de la figura (2D)
        const shapeX = magnitude * Math.cos(p.theta);
        const shapeY = magnitude * Math.sin(p.theta) + CENTER_Y * S;

        // Rotación 3D sobre eje Y (planeta)
        const worldX = shapeX * cosR;
        const worldZ = shapeX * sinR;
        const depthScale = 1 + (worldZ / S) * PERSPECTIVE;
        const perspX = worldX * depthScale;
        const perspY = shapeY * (1 + PERSPECTIVE * 0.15 * (worldZ / S));
        const depthAlpha = 0.35 + 0.65 * ((worldZ / S + 1) / 2);   // 0.35 atrás → 1.0 al frente

        // Movimiento caótico en hover
        if (transicionRed > 0.1 && !reduce) {
          p.rx += p.vx * 0.4;
          p.ry += p.vy * 0.4;
          if (Math.abs(p.rx) > S * 1.1) p.vx *= -1;
          if (Math.abs(p.ry - CENTER_Y * S) > S * 1.1) p.vy *= -1;
        }
        const chaosX = p.rx;
        const chaosY = p.ry + CENTER_Y * S;
        const targetX = perspX * (1 - transicionRed) + chaosX * transicionRed;
        const targetY = perspY * (1 - transicionRed) + chaosY * transicionRed;

        p.x += (targetX - p.x) * (reduce ? 1 : 0.18);
        p.y += (targetY - p.y) * (reduce ? 1 : 0.18);

        const xF = cx + p.x;
        const yF = cy + p.y;
        const dm = Math.hypot(xF - mouse.x, yF - mouse.y);
        const distC = Math.hypot(p.x, p.y - CENTER_Y * S);
        const depth = Math.max(0.35, 1 - (distC / (S * 0.7)) * 0.6);
        positions.push({ x: xF, y: yF, distMouse: dm, depth, depthAlpha });
      }

      // ── Malla: líneas entre partículas cercanas ─────────────────────────
      const distMaxLineas = transicionRed > 0.3 ? S * 0.22 : S * 0.16;
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
            const depthAlphaAvg = (n1.depthAlpha + n2.depthAlpha) / 2;
            const fadeByDist = 1 - d / distMaxLineas;
            ctx.beginPath();
            ctx.moveTo(n1.x, n1.y);
            ctx.lineTo(n2.x, n2.y);
            if (cerca) {
              const inten = 1 - md / dCerca;
              ctx.strokeStyle = toRgba(accent, (0.35 + inten * 0.55) * depthAlphaAvg);
              ctx.lineWidth = 1.4;
            } else {
              const baseAlpha = transicionRed > 0.3 ? 0.20 : 0.30;
              ctx.strokeStyle = toRgba(accent, baseAlpha * depthAvg * fadeByDist * depthAlphaAvg);
              ctx.lineWidth = 1;
            }
            ctx.stroke();
          }
        }
      }

      // ── Partículas ──────────────────────────────────────────────────────
      positions.forEach((n) => {
        const cerca = n.distMouse < dCerca;
        // Tamaño modulado por depthAlpha (adelante grande, atrás pequeño)
        const baseSize = 1.4 + 0.9 * n.depth;
        const size = cerca ? 3.2 : (baseSize * (0.6 + 0.6 * n.depthAlpha));
        ctx.beginPath();
        ctx.arc(n.x, n.y, size, 0, Math.PI * 2);
        if (cerca) {
          ctx.fillStyle = accent;
          ctx.shadowColor = accent;
          ctx.shadowBlur = 8;
        } else {
          ctx.fillStyle = toRgba(hi, (0.35 + 0.5 * n.depth) * n.depthAlpha);
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
