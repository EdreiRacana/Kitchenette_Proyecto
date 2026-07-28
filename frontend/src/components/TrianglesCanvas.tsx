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

    const animar = () => {
      if (stopped) return;
      raf = requestAnimationFrame(animar);
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

      const cx = centroX();
      const cy = centroY();
      const S = scaleActual;

      const objetivo = mouse.sobreCentro ? 1 : 0;
      transicionRed += (objetivo - transicionRed) * 0.06;

      // 1) Wireframe tenue del contorno NovaMark de fondo — ancla visual del logo.
      //    Se atenúa cuando la red se desarma (transicionRed → 1).
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
      const nodos: Node[] = [];
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
          nodos.push({ x: xF, y: yF, distMouse: dm });
        }
      });

      // 3) Líneas / conexiones
      const distMaxLineas = S * (transicionRed > 0.3 ? 0.28 : 0.17);
      const dCerca = S * 0.4;
      for (let i = 0; i < nodos.length; i++) {
        for (let j = i + 1; j < nodos.length; j++) {
          const n1 = nodos[i], n2 = nodos[j];
          const d = Math.hypot(n1.x - n2.x, n1.y - n2.y);
          if (d < distMaxLineas) {
            const md = Math.min(n1.distMouse, n2.distMouse);
            const cerca = md < dCerca;
            ctx.beginPath();
            ctx.moveTo(n1.x, n1.y);
            ctx.lineTo(n2.x, n2.y);
            if (cerca) {
              const inten = 1 - md / dCerca;
              ctx.strokeStyle = toRgba(accent, 0.4 + inten * 0.6);
              ctx.lineWidth = 1.6;
            } else {
              ctx.strokeStyle = transicionRed > 0.3 ? toRgba(accent, 0.28) : toRgba(dim, 0.22);
              ctx.lineWidth = 1;
            }
            ctx.stroke();
          }
        }
      }

      // 4) Nodos
      nodos.forEach((n) => {
        const cerca = n.distMouse < dCerca;
        ctx.beginPath();
        ctx.arc(n.x, n.y, cerca ? 3.4 : 2.3, 0, Math.PI * 2);
        if (cerca) {
          ctx.fillStyle = accent;
          ctx.shadowColor = accent;
          ctx.shadowBlur = 8;
        } else {
          ctx.fillStyle = transicionRed > 0.3 ? accent : hi;
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
