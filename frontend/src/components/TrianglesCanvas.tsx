/**
 * TrianglesCanvas.tsx
 * Fondo animado del login que reproduce la silueta del logo NovaMark:
 * un triángulo con un notch en la base (punto arriba, dos puntas abajo,
 * hendidura al centro). Los nodos se distribuyen dentro de esa silueta
 * en una malla triangular, cada terna rota individualmente, y cuando el
 * cursor se acerca al centro la estructura "se desarma" en una red
 * caótica y las líneas cercanas al cursor se iluminan.
 *
 * Colores: recibe accent (Nova institucional), dim y hi. NO usa verdes.
 * Accesibilidad: respeta prefers-reduced-motion (congela la animación).
 * Limpieza: cancela raf y quita listeners al desmontar.
 *
 * Ligado al logo:
 *  - La malla se dibuja SOLO dentro del polígono NovaMark (0,-1)(1,0.75)(0,0.39)(-1,0.75)
 *  - Además se pinta un wireframe muy tenue del contorno atrás, para que
 *    el ojo vea que la animación es una "descomposición" del logo.
 */

import { useEffect, useRef } from "react";

interface Tri {
  baseX: number;
  baseY: number;
  angulo: number;
  vRot: number;
  radio: number;
  rx: number;
  ry: number;
  vx: number;
  vy: number;
}

interface Node { x: number; y: number; distMouse: number; }

// Silueta NovaMark normalizada a [-1..1] (mismo polígono que el SVG del logo,
// polygon points="0,-62 62,46 0,24 -62,46" → dividido entre 62).
const NOVA_SHAPE: [number, number][] = [
  [ 0,   -1.00],   // punta superior
  [ 1,    0.7419], // punta inferior derecha (46/62)
  [ 0,    0.3871], // notch central inferior (24/62)
  [-1,    0.7419], // punta inferior izquierda
];

/** Point-in-polygon (ray casting), robusto para polígonos convexos/cóncavos. */
function pointInPoly(px: number, py: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
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

    // Escala del logo dentro del canvas: ~48% del lado más corto para dejar
    // aire alrededor. Tamaño mínimo garantizado para pantallas móviles.
    const logoScale = () => Math.max(140, Math.min(canvas.clientWidth, canvas.clientHeight) * 0.48);

    const mouse = { x: -1000, y: -1000, sobreCentro: false };

    // Genera un enjambre de puntos dentro de la silueta usando una malla
    // triangular y filtrando por point-in-poly. Cantidad controlada por
    // `paso` en unidades normalizadas (-1..1).
    const buildSwarm = (): Tri[] => {
      const paso = 0.18;
      const pts: [number, number][] = [];
      for (let y = -1.05; y <= 0.80; y += paso) {
        // Offset alternado en x para malla triangular (más orgánico que rejilla)
        const offset = (Math.round((y + 1) / paso) % 2) * (paso / 2);
        for (let x = -1.05; x <= 1.05; x += paso) {
          const px = x + offset;
          // Margen interior para que los sub-triángulos no se salgan del borde
          if (pointInPoly(px, y, NOVA_SHAPE) && pointInPoly(px * 0.94, y * 0.94, NOVA_SHAPE)) {
            pts.push([px, y]);
          }
        }
      }
      const S = logoScale();
      return pts.map(([nx, ny]) => ({
        baseX: nx * S,
        baseY: ny * S,
        angulo: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.028,
        radio: Math.max(9, S * 0.045),
        rx: (Math.random() - 0.5) * S * 1.8,
        ry: (Math.random() - 0.5) * S * 1.8,
        vx: (Math.random() - 0.5) * 0.7,
        vy: (Math.random() - 0.5) * 0.7,
      }));
    };

    let triangulos = buildSwarm();
    let scaleActual = logoScale();

    // Rebuild solo cuando cambia significativamente el tamaño (evita jitter
    // al arrastrar el borde de la ventana).
    const onResizeSwarm = () => {
      const s = logoScale();
      if (Math.abs(s - scaleActual) > 40) {
        scaleActual = s;
        triangulos = buildSwarm();
      }
    };
    window.addEventListener("resize", onResizeSwarm);

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

    // ─── B: Pulso ambiente ──────────────────────────────────────────────
    // Cada ~5.5s se dispara una onda que crece del centro hacia afuera.
    // Los nodos que cruza la onda brillan brevemente. Solo se lanza en
    // estado idle (sin red desarmada) y no si el usuario prefiere reducir
    // movimiento. Con easing cúbico para que se sienta orgánico.
    const PULSE_PERIOD = 5500;
    const PULSE_DURATION = 1400;
    const t0 = performance.now();
    let nextPulseAt = t0 + PULSE_PERIOD * 0.6;   // primer pulso más temprano
    let activePulseStart: number | null = null;

    const animar = () => {
      if (stopped) return;
      raf = requestAnimationFrame(animar);
      const now = performance.now();
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

      const cx = centroX();
      const cy = centroY();
      const S = scaleActual;

      const objetivo = mouse.sobreCentro ? 1 : 0;
      transicionRed += (objetivo - transicionRed) * 0.06;

      // Programar próximo pulso (solo si estamos idle)
      if (!reduce && transicionRed < 0.25 && now >= nextPulseAt && activePulseStart === null) {
        activePulseStart = now;
        nextPulseAt = now + PULSE_PERIOD;
      }
      let pulseRadius = 0;
      let pulseIntensity = 0;
      if (activePulseStart !== null) {
        const p = (now - activePulseStart) / PULSE_DURATION;
        if (p >= 1) {
          activePulseStart = null;
        } else {
          // ease-out cúbico para el radio, ease bell para la intensidad
          pulseRadius = (1 - Math.pow(1 - p, 3)) * S * 1.05;
          pulseIntensity = Math.sin(p * Math.PI) * (1 - transicionRed);
        }
      }

      // ─── A: Halo de la cúspide ──────────────────────────────────────────
      // Emisión de luz suave desde el vértice superior del NovaMark.
      // Se atenúa cuando se desarma la red.
      const apexAlpha = 0.32 * (1 - transicionRed * 0.7);
      if (apexAlpha > 0.02) {
        const ax = cx + NOVA_SHAPE[0][0] * S;
        const ay = cy + NOVA_SHAPE[0][1] * S;
        const grad = ctx.createRadialGradient(ax, ay, 0, ax, ay, S * 0.55);
        grad.addColorStop(0, toRgba(accent, apexAlpha));
        grad.addColorStop(0.4, toRgba(accent, apexAlpha * 0.35));
        grad.addColorStop(1, toRgba(accent, 0));
        ctx.fillStyle = grad;
        ctx.fillRect(cx - S * 1.2, cy - S * 1.2, S * 2.4, S * 2.4);
      }

      // 1) Wireframe tenue del contorno NovaMark de fondo — ancla visual del logo.
      const outlineAlpha = 0.14 * (1 - transicionRed * 0.85);
      if (outlineAlpha > 0.01) {
        ctx.beginPath();
        NOVA_SHAPE.forEach(([nx, ny], i) => {
          const px = cx + nx * S;
          const py = cy + ny * S;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.strokeStyle = toRgba(accent, outlineAlpha);
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      // 2) Actualizar posiciones y calcular vértices
      const nodos: (Node & { depth: number; pulseBoost: number })[] = [];
      const depthMax = S * 0.95;   // distancia de referencia para atenuación de borde
      triangulos.forEach((t) => {
        if (!reduce) t.angulo += t.vRot;
        for (let i = 0; i < 3; i++) {
          const a = t.angulo + (i * Math.PI * 2) / 3;
          const tx = t.baseX + Math.cos(a) * t.radio;
          const ty = t.baseY + Math.sin(a) * t.radio;
          if (transicionRed > 0.1 && !reduce) {
            t.rx += t.vx * 0.35;
            t.ry += t.vy * 0.35;
            if (Math.abs(t.rx) > S * 0.9) t.vx *= -1;
            if (Math.abs(t.ry) > S * 0.9) t.vy *= -1;
          }
          const xF = cx + (tx * (1 - transicionRed) + (t.rx + Math.cos(a) * S * 0.05) * transicionRed);
          const yF = cy + (ty * (1 - transicionRed) + (t.ry + Math.sin(a) * S * 0.05) * transicionRed);
          const dm = Math.hypot(xF - mouse.x, yF - mouse.y);
          // A: profundidad — nodos cercanos al centro brillan más
          const distC = Math.hypot(xF - cx, yF - cy);
          // depth: 1 en centro, ~0.35 en borde (clamp)
          const depth = Math.max(0.35, 1 - (distC / depthMax) * 0.75);
          // B: contribución del pulso — banda delgada alrededor del radio actual
          let pulseBoost = 0;
          if (pulseIntensity > 0) {
            const bandDist = Math.abs(distC - pulseRadius);
            const bandWidth = S * 0.14;
            if (bandDist < bandWidth) {
              pulseBoost = (1 - bandDist / bandWidth) * pulseIntensity;
            }
          }
          nodos.push({ x: xF, y: yF, distMouse: dm, depth, pulseBoost });
        }
      });

      // 3) Líneas / conexiones — atenuadas por profundidad promedio del par
      const distMaxLineas = S * (transicionRed > 0.3 ? 0.28 : 0.17);
      const dCerca = S * 0.4;
      for (let i = 0; i < nodos.length; i++) {
        for (let j = i + 1; j < nodos.length; j++) {
          const n1 = nodos[i], n2 = nodos[j];
          const d = Math.hypot(n1.x - n2.x, n1.y - n2.y);
          if (d < distMaxLineas) {
            const md = Math.min(n1.distMouse, n2.distMouse);
            const cerca = md < dCerca;
            const depthAvg = (n1.depth + n2.depth) / 2;
            const pulseAvg = (n1.pulseBoost + n2.pulseBoost) / 2;
            ctx.beginPath();
            ctx.moveTo(n1.x, n1.y);
            ctx.lineTo(n2.x, n2.y);
            if (cerca) {
              const inten = 1 - md / dCerca;
              ctx.strokeStyle = toRgba(accent, 0.4 + inten * 0.6);
              ctx.lineWidth = 1.6;
            } else {
              const baseAlpha = transicionRed > 0.3 ? 0.28 : 0.22;
              const color = transicionRed > 0.3 ? accent : dim;
              // Depth atenúa; pulso ilumina temporalmente
              const alpha = baseAlpha * depthAvg + pulseAvg * 0.45;
              ctx.strokeStyle = toRgba(pulseAvg > 0.1 ? accent : color, Math.min(0.95, alpha));
              ctx.lineWidth = 1 + pulseAvg * 0.6;
            }
            ctx.stroke();
          }
        }
      }

      // 4) Nodos — tamaño y brillo modulados por profundidad + pulso
      nodos.forEach((n) => {
        const cerca = n.distMouse < dCerca;
        const sizeBase = cerca ? 3.4 : (2.0 + 1.2 * n.depth);
        const size = sizeBase + n.pulseBoost * 1.6;
        ctx.beginPath();
        ctx.arc(n.x, n.y, size, 0, Math.PI * 2);
        if (cerca) {
          ctx.fillStyle = accent;
          ctx.shadowColor = accent;
          ctx.shadowBlur = 8;
        } else if (n.pulseBoost > 0.1) {
          ctx.fillStyle = accent;
          ctx.shadowColor = accent;
          ctx.shadowBlur = 6 * n.pulseBoost;
        } else {
          // hi en centro, dim en borde (mezcla por depth)
          const useAccent = transicionRed > 0.3;
          ctx.fillStyle = toRgba(useAccent ? accent : hi, 0.55 + 0.45 * n.depth);
          ctx.shadowBlur = 0;
        }
        ctx.fill();
      });
    };
    animar();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("resize", onResizeSwarm);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
    };
  }, [accent, dim, hi]);

  return <canvas ref={ref} style={{ display: "block", width: "100%", height: "100%" }} aria-hidden />;
}
