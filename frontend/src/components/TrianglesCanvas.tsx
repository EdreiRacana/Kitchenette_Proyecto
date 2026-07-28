/**
 * TrianglesCanvas.tsx
 * Animación de fondo para el login: sub-triángulos rotando en formación
 * piramidal. Cuando el cursor se acerca al centro, la estructura se
 * "desarma" en una red caótica de nodos flotantes, y las líneas cercanas
 * al cursor se iluminan.
 *
 * Adaptación del prototipo del cliente:
 *  - Verde neón → color Nova institucional (recibido como prop).
 *  - Fondo verde oscuro → transparente (el contenedor pone el fondo).
 *  - respetamos prefers-reduced-motion: si está prendido, no anima.
 */

import { useEffect, useRef } from "react";

interface Node {
  x: number;
  y: number;
  distMouse: number;
}

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

export function TrianglesCanvas({ accent, dim, hi }: {
  accent: string;   // color Nova (líneas + nodos iluminados)
  dim: string;      // color líneas en reposo (t.textLo o similar)
  hi: string;       // color nodos en reposo (t.textHi o t.textMid)
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

    const mouse = { x: -1000, y: -1000, sobreCentro: false };

    const filas = 5;
    const tamanoBase = 220;
    const triangulos: Tri[] = [];
    for (let f = 0; f < filas; f++) {
      const cantidad = f + 1;
      const yNivel = (f / filas - 0.35) * tamanoBase;
      for (let c = 0; c < cantidad; c++) {
        const xNivel = (c - (cantidad - 1) / 2) * (tamanoBase / filas);
        triangulos.push({
          baseX: xNivel,
          baseY: yNivel,
          angulo: Math.random() * Math.PI * 2,
          vRot: (Math.random() - 0.5) * 0.03,
          radio: 24,
          rx: (Math.random() - 0.5) * 400,
          ry: (Math.random() - 0.5) * 400,
          vx: (Math.random() - 0.5) * 0.8,
          vy: (Math.random() - 0.5) * 0.8,
        });
      }
    }

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      const dx = mouse.x - centroX();
      const dy = mouse.y - centroY();
      mouse.sobreCentro = Math.hypot(dx, dy) < 200;
    };
    const onLeave = () => { mouse.x = -1000; mouse.y = -1000; mouse.sobreCentro = false; };
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);

    // Helper: convierte "#RRGGBB" a "rgba(R,G,B,a)".
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

      const objetivo = mouse.sobreCentro ? 1 : 0;
      transicionRed += (objetivo - transicionRed) * 0.06;

      const nodos: Node[] = [];

      triangulos.forEach((t) => {
        if (!reduce) t.angulo += t.vRot;
        for (let i = 0; i < 3; i++) {
          const a = t.angulo + (i * Math.PI * 2) / 3;
          const tx = t.baseX + Math.cos(a) * t.radio;
          const ty = t.baseY + Math.sin(a) * t.radio;
          if (transicionRed > 0.1 && !reduce) {
            t.rx += t.vx * 0.3;
            t.ry += t.vy * 0.3;
            if (Math.abs(t.rx) > 220) t.vx *= -1;
            if (Math.abs(t.ry) > 220) t.vy *= -1;
          }
          const xF = centroX() + (tx * (1 - transicionRed) + (t.rx + Math.cos(a) * 15) * transicionRed);
          const yF = centroY() + (ty * (1 - transicionRed) + (t.ry + Math.sin(a) * 15) * transicionRed);
          const dm = Math.hypot(xF - mouse.x, yF - mouse.y);
          nodos.push({ x: xF, y: yF, distMouse: dm });
        }
      });

      const distMaxLineas = transicionRed > 0.3 ? 90 : 55;
      for (let i = 0; i < nodos.length; i++) {
        for (let j = i + 1; j < nodos.length; j++) {
          const n1 = nodos[i];
          const n2 = nodos[j];
          const d = Math.hypot(n1.x - n2.x, n1.y - n2.y);
          if (d < distMaxLineas) {
            const md = Math.min(n1.distMouse, n2.distMouse);
            const cerca = md < 120;
            ctx.beginPath();
            ctx.moveTo(n1.x, n1.y);
            ctx.lineTo(n2.x, n2.y);
            if (cerca) {
              const inten = 1 - md / 120;
              ctx.strokeStyle = toRgba(accent, 0.4 + inten * 0.6);
              ctx.lineWidth = 1.8;
            } else {
              ctx.strokeStyle = transicionRed > 0.3 ? toRgba(accent, 0.3) : toRgba(dim, 0.25);
              ctx.lineWidth = 1;
            }
            ctx.stroke();
          }
        }
      }

      nodos.forEach((n) => {
        const cerca = n.distMouse < 120;
        ctx.beginPath();
        ctx.arc(n.x, n.y, cerca ? 3.5 : 2.5, 0, Math.PI * 2);
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
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
    };
  }, [accent, dim, hi]);

  return <canvas ref={ref} style={{ display: "block", width: "100%", height: "100%" }} aria-hidden />;
}
