/**
 * TrianglesCanvas.tsx
 * Animación 3D del login. Ciclo de dos figuras rotando sobre eje vertical:
 *   🌐 GLOBO (esfera abstracta con puntos uniformes en la superficie)
 *   🔻 LOGO STHENOVA (silueta NovaMark con volumen tipo lente)
 * Cada figura se mantiene 4 s con transición suave (900 ms), y todo el
 * cuerpo gira sobre el eje vertical dando una vuelta completa cada 20 s.
 *
 * Volumen real 3D — nunca colapsa a línea al rotar:
 *   - Globo: cada partícula tiene (θ, φ) fijos en la esfera; al rotar
 *     mantiene silueta circular igual que la Tierra vista de perfil.
 *   - Logo: cada partícula tiene profundidad z0 fija, modulada por una
 *     envoltura lente sqrt(1-r²) para dar cuerpo esférico a la silueta.
 *
 * Al pasar el cursor cerca del centro, las partículas se desarman en una
 * red caótica y las líneas cerca del cursor se iluminan.
 *
 * Accesibilidad: prefers-reduced-motion → congela rotación y ciclo.
 */

import { useEffect, useRef } from "react";

// Silueta NovaMark (sin normalizar aún — se hace en runtime)
const NOVA_RAW: [number, number][] = [
  [ 0,   -1.00],
  [ 1,    0.7419],
  [ 0,    0.3871],
  [-1,    0.7419],
];
const NOVA_MAX_R = Math.max(...NOVA_RAW.map(([x, y]) => Math.hypot(x, y)));
const NOVA_SHAPE: [number, number][] = NOVA_RAW.map(([x, y]) =>
  [x / NOVA_MAX_R, y / NOVA_MAX_R] as [number, number],
);

const SHAPE_HOLD_MS = 9000;                  // 1s más por figura
const SHAPE_MORPH_MS = 2200;                 // transición notoriamente más lenta
// Filosofía halftone/pixel-art: puntos en CUADRÍCULA REGULAR cada 2.5° de
// lat/lon (no aleatorios). Solo se dibujan los que caen en tierra. Esto
// produce el look "impreso" de globos corporativos world-class donde los
// continentes se ven como shapes de halftone.
const GRID_STEP_DEG = 2.5;                    // spacing del grid
const TARGET_OCEAN = 0;                       // CERO puntos de océano — todo lo visible es tierra
const ROTATION_PERIOD_MS = 45000;             // giro un poco más lento (era 40s)
const AXIS_TILT_DEG = 18;

const SHAPE_RADIUS = 0.72;
const PERSPECTIVE = 0.45;

type ShapeKind = "globe" | "novamark";
const SHAPE_CYCLE: ShapeKind[] = ["globe", "novamark"];

// ── Bitmap real de coastlines (Natural Earth 110m, rasterizado 180x90) ───
// 180 cols × 90 rows = 16200 celdas, ~4791 tierra (29.6% — coincide con la
// Tierra real). Cada celda 2° × 2°. Encoded como hex string (~4KB).
// col 0 = -180°, col 179 = +178°; row 0 = 89° N, row 89 = -89° S.
const WORLD_BITMAP_W = 180;
const WORLD_BITMAP_H = 90;
const WORLD_BITMAP_HEX =
  "00000000000000000000000000000000000000000000000000000000000000000000000000000000" +
  "00000000000000000000000000000000000000000000000000000000000000000007f800ffc00000" +
  "00000000000000000000000000000017ff3fffffe00000000000004000000000000000000061df0f" +
  "fffff0000f8000000003c000000000000000030027c3ffffff800020000000000600000000000000" +
  "00038afc007ffff00000000030007ffc001d80000000000e88b7b003fffe000000000c003ffffec0" +
  "0000080180009fc33fc00fffa00000300041dffffffffffffe00ffffffffffffffffffffffe00fff" +
  "1200000000000201fffffffffffffffffffffff800140020000000000000cfffffffffffffffffff" +
  "ffff06140000000000000000000fffffffff8034078000003e7fffffffffffffffffff01fdffffff" +
  "e01e0038000007e7ffffffffffffffff2f0007807ffffe01e4000000007e3ffffffffffffff82200" +
  "001001fffff80fe000000182c7fffffffffffffe00f000080007fffff9ff8000003820ffffffffff" +
  "ffffc00e000000007fffff9ffc000006cfffffffffffffffffc08000000003ffffffffc000000dff" +
  "fffffffffffffff4000000000017ffffff460000007fffffffffffffffff400000000000fffffffc" +
  "10000007ffffffffffffffffe400000000000fffffff600000007f7f97cffffffffffc0000000000" +
  "00ffffffe00000007f19f03cffffffffff8c00000000000ffffffc00000003c26f7fe7ffffffffe0" +
  "800000000000ffffff000000007c02dffe7fffffff8408000000000007fffff0000000018740ffe7" +
  "fffffffe630000000000003fffff000000001fe022ffffffffffc4f0000000000001ffffc0000000" +
  "03ff000ffffffffffc180000000000000ffff8000000007ffef7ffffffffffe0000000000000003f" +
  "c04000000007ffffffdffffffffe0000000000000005f80400000001fffffefe7fffffffc0000000" +
  "000000002f80000000001fffffe7f41ffffffc0000000000000000780c00000003ffffff7ff07fff" +
  "ff20000000000000000786100000007ffffffbfe07fcff0000000000000000003cc020000003ffff" +
  "ff9fe03f07e8000000000000000000fc000000003ffffff9f801e07f02000000000000000000f000" +
  "000007ffffffde001c01f020000000000000000003000000003ffffffe8001c01f82000000000000" +
  "00000010f0000003fffffff3000c013008000000000000000000aff000001fffffffe000a0120000" +
  "000000000000000001ff800000fffffffe00020000080000000000000000001fff00000687ffffc0" +
  "00002c1800000000000000000001fff80000001ffff800000143800000000000000000003fff8000" +
  "0001ffff000000187a00000000000000000003fffe0000003fffe0000000c7818000000000000000" +
  "003ffffc000001fffc00000006762b800000000000000007fffff000000fffc000000020101e0000" +
  "0000000000003fffff800000fffc00000001c001f08000000000000001fffff000000fffc0000000" +
  "00880d02000000000000001ffffe0000007ffc000000000000000000000000000000ffffe000000f" +
  "ffc20000000001c400000000000000000ffffe000000fffc2000000000fc6004000000000000003f" +
  "ffc000000fff8e000000001fe6000000000000000001fffc000000fff0e000000001ffe000000000" +
  "000000001fffc0000007ff0c00000000ffff808000000000000001fff00000007ff0c00000001fff" +
  "f800000000000000001ffc00000007fe0800000001ffffc00000000000000001ffc00000003fc000" +
  "0000001ffffe00000000000000003ff800000003fc0000000001ffffe00000000000000003ff8000" +
  "00001f80000000000ffffe00000000000000003ff000000001f00000000000f07fc0000000000000" +
  "0003f8000000000000000000000801f800800000000000007fc000000000000000000000000f8004" +
  "00000000000007e00000000000000000000000000000600000000000007a00000000000000000000" +
  "000003000c00000000000003c0000000000000000000000000100180000000000000780000000000" +
  "000000000000000000300000000000000780000000000000000000000000000000000000000000f0" +
  "0000000000000000800000000000000000000000000e000000000000000000000000000000000000" +
  "00000000700000000000000000000000000000000000000000000300000000000000000000000000" +
  "00000000000000000000000000000000000000000000000000000000000000000000000000000000" +
  "00000000000000000000000000000000000000000000000000000000000000000000000000000000" +
  "00000000000000000000000000000000000000020000000000000000000000000000000000000000" +
  "0000c00000000000001e00020ff9ffe000000000000000000c0000000000013fff87fffffffff000" +
  "00000000000003e00000001ffffffff3fffffffffffc000000000038400f000001ffffffffffffff" +
  "ffffffffe000000ffff4ffffc000007ffffffffffffffffffffff800001ffffffffe000001ffffff" +
  "ffffffffffffffffff00004fffffffffe00070fffffffffffffffffffffffff000000fffffffffe0" +
  "080ffffffffffffffffffffffffc000007fffffffffffffffffffffffffffffffffffffff80007fc" +
  "00000000000000000000000000000000000000000000000000000000000000000000000000000000" +
  "00000000000000000000000000000000000000000000000000";

// Decodifica una sola vez a Uint8Array para lookup rápido.
const WORLD_BITMAP = (() => {
  const buf = new Uint8Array(WORLD_BITMAP_HEX.length / 2);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = parseInt(WORLD_BITMAP_HEX.substr(i * 2, 2), 16);
  }
  return buf;
})();

/** ¿La partícula en (lat, lon) cae en tierra según el mapa mundial real? */
function isContinent(lat: number, lon: number): boolean {
  if (lat > 89 || lat < -89) return false;
  const col = Math.floor((lon + 179) / 2);
  const row = Math.floor((89 - lat) / 2);
  if (col < 0 || col >= WORLD_BITMAP_W || row < 0 || row >= WORLD_BITMAP_H) return false;
  const idx = row * WORLD_BITMAP_W + col;
  const byte = WORLD_BITMAP[idx >> 3];
  return (byte & (1 << (7 - (idx & 7)))) !== 0;
}

/** Distancia del rayo desde el origen al perímetro del polígono NovaMark. */
function novaRadiusAt(theta: number): number {
  const cx = Math.cos(theta), cy = Math.sin(theta);
  let minT = Infinity;
  for (let i = 0; i < NOVA_SHAPE.length; i++) {
    const [x1, y1] = NOVA_SHAPE[i];
    const [x2, y2] = NOVA_SHAPE[(i + 1) % NOVA_SHAPE.length];
    const dx = x2 - x1, dy = y2 - y1;
    const denom = cx * dy - cy * dx;
    if (Math.abs(denom) < 1e-9) continue;
    const t = (x1 * dy - y1 * dx) / denom;
    const s = (x1 * cy - y1 * cx) / denom;
    if (t > 1e-6 && s >= -1e-6 && s <= 1 + 1e-6 && t < minT) minT = t;
  }
  return minT === Infinity ? 1 : minT;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

interface Particle {
  // ── Coordenadas para el GLOBO (esfera de radio 1) ────────────────────
  sphereTheta: number;    // longitud [0..2π]
  sphereY: number;        // sin(latitud) — altura fija en la esfera; en [-1..1]
  sphereR: number;        // cos(latitud) — radio del anillo a esa altura; en [0..1]
  isLand: boolean;        // ¿cae en algún continente? (para brillo/tamaño)
  // ── Coordenadas para el LOGO (silueta 2D + profundidad tipo lente) ───
  r2d: number;
  theta2d: number;
  z0: number;
  // ── Posición renderizada + caos para hover ───────────────────────────
  x: number;
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
    const logoScale = () =>
      Math.max(160, Math.min(canvas.clientWidth, canvas.clientHeight) * 0.44);

    const mouse = { x: -1000, y: -1000, sobreCentro: false };

    const initParticles = (): Particle[] => {
      const S = logoScale();
      const out: Particle[] = [];

      // ── GRID REGULAR estilo halftone ─────────────────────────────────────
      // Recorremos la esfera en cuadrícula fija (cada GRID_STEP_DEG grados
      // de lat/lon). Para cada celda, si su centro cae en tierra, agregamos
      // una partícula. Como el paso longitudinal es constante pero los
      // meridianos convergen en los polos, ajustamos la densidad por latitud
      // multiplicando el paso de lon por 1/cos(lat) para densidad ~uniforme
      // en la superficie de la esfera (evita cluster en los polos).
      for (let lat = -80; lat <= 82; lat += GRID_STEP_DEG) {
        const latRad = (lat * Math.PI) / 180;
        // Paso de lon proporcional a 1/cos(lat) para densidad uniforme
        // (a lat 60°, cos=0.5, así lon avanza el doble para el mismo arco).
        const cosLat = Math.max(0.1, Math.cos(latRad));
        const lonStep = GRID_STEP_DEG / cosLat;
        for (let lon = -180; lon < 180; lon += lonStep) {
          if (!isContinent(lat, lon)) continue;
          const lonRad = (lon * Math.PI) / 180;
          const sphereY = Math.sin(latRad);
          const sphereR = Math.cos(latRad);
          const sphereTheta = lonRad + Math.PI;
          out.push(makeParticle(sphereTheta, sphereY, sphereR, true, S));
        }
      }
      return out;
    };

    // Fábrica de partícula — asigna también coords aleatorias para el LOGO.
    // Estrategia LOGO: 65% de las partículas se acomodan en el CONTORNO
    // LOGO — silueta muy definida: 88% en el CONTORNO (r=0.94-1.0), 12% en
    // anillo interior sutil. Cero puntos en el centro (menos ruido, más
    // silueta pura).
    function makeParticle(sphereTheta: number, sphereY: number, sphereR: number,
                            isLand: boolean, S: number): Particle {
      const bucket = Math.random();
      const r2d = bucket < 0.88
        ? 0.94 + Math.random() * 0.06     // contorno crisp
        : 0.60 + Math.random() * 0.25;    // anillo interior sutil
      const theta2d = Math.random() * Math.PI * 2;
      const z0 = 2 * Math.random() - 1;
      const x = sphereR * Math.cos(sphereTheta) * SHAPE_RADIUS * S;
      const y = sphereY * SHAPE_RADIUS * S;
      return {
        sphereTheta, sphereY, sphereR, isLand,
        r2d, theta2d, z0,
        x, y,
        rx: (Math.random() - 0.5) * S * 1.4,
        ry: (Math.random() - 0.5) * S * 1.4,
        vx: (Math.random() - 0.5) * 0.7,
        vy: (Math.random() - 0.5) * 0.7,
      };
    }

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
      mouse.sobreCentro = Math.hypot(dx, dy) < logoScale() * 0.7;
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
    // Rotación acumulada con velocidad variable: 1.0 en globo, 0.15 en logo.
    // Esto permite que durante el logo se pueda apreciar bien su silueta
    // sin el marear del giro rápido.
    let rotationAccum = 0;
    let lastFrame = t0;
    // Velocidad de rotación CONSTANTE para ambas figuras — el logo se lee
    // igual porque el 65% de sus partículas están en el contorno, la
    // silueta es reconocible aún girando.
    const speedFor = (_kind: ShapeKind) => 1.0;

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
      const cyclePos = elapsed % CYCLE_MS;
      const fromIdx = cycleIdx % SHAPE_CYCLE.length;
      const toIdx = (fromIdx + 1) % SHAPE_CYCLE.length;
      let morph = 0;
      if (cyclePos > SHAPE_HOLD_MS) {
        morph = Math.min(1, Math.max(0, (cyclePos - SHAPE_HOLD_MS) / SHAPE_MORPH_MS));
        morph = easeInOutCubic(morph);
      }
      const kindFrom = SHAPE_CYCLE[fromIdx];
      const kindTo = SHAPE_CYCLE[toIdx];

      // Rotación planetaria con velocidad variable por figura.
      //   globo → 1.0x   (una vuelta cada 35s)
      //   logo  → 0.15x  (la silueta apenas se mueve durante su hold)
      // Además pausa parcial durante hover.
      const dt = now - lastFrame;
      lastFrame = now;
      if (!reduce) {
        const speed = speedFor(kindFrom) + (speedFor(kindTo) - speedFor(kindFrom)) * morph;
        const hoverFactor = (1 - transicionRed * 0.8);
        rotationAccum += (dt / ROTATION_PERIOD_MS) * Math.PI * 2 * speed * hoverFactor;
      }
      const rotation = rotationAccum;
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

      // Calcula posición 3D de un tipo de figura para una partícula
      // Inclinación axial: rota TODO el globo un ángulo constante en el
      // plano XY (como el eje de la Tierra a ~23°). Se aplica DESPUÉS del
      // spin en Y, así el eje visible del planeta queda inclinado.
      const tiltRad = (AXIS_TILT_DEG * Math.PI) / 180;
      const cosT = Math.cos(tiltRad);
      const sinT = Math.sin(tiltRad);

      const computeShape = (
        p: Particle, kind: ShapeKind,
      ): { x: number; y: number; z: number } => {
        if (kind === "globe") {
          // GLOBO — punto fijo en la esfera, rotado sobre Y (spin) y luego
          // inclinado sobre eje Z (tilt tipo Tierra) para efecto premium.
          // IMPORTANTE: sphereY (=sin(lat)) sigue convención matemática
          // (norte positivo), pero canvas tiene y+ hacia ABAJO. Invertimos
          // aquí en el eje Y para que el norte aparezca ARRIBA en pantalla.
          const baseX = p.sphereR * Math.cos(p.sphereTheta);
          const baseZ = p.sphereR * Math.sin(p.sphereTheta);
          const spunX = baseX * cosR + baseZ * sinR;
          const spunZ = -baseX * sinR + baseZ * cosR;
          const spunY = -p.sphereY;    // ← norte arriba en canvas
          // Rotación en plano XY (tilt): x' = x·cosT - y·sinT ; y' = x·sinT + y·cosT
          return {
            x: spunX * cosT - spunY * sinT,
            y: spunX * sinT + spunY * cosT,
            z: spunZ,
          };
        }
        // NOVAMARK LENS — silueta 2D con profundidad tipo lente
        const rShape = novaRadiusAt(p.theta2d);
        const magnitude = p.r2d * rShape;
        const s2dX = magnitude * Math.cos(p.theta2d);
        const s2dY = magnitude * Math.sin(p.theta2d);
        const zEnv = Math.sqrt(Math.max(0, 1 - p.r2d * p.r2d)) * 0.65;
        const zLocal = p.z0 * zEnv;
        return {
          x: s2dX * cosR + zLocal * sinR,
          y: s2dY,
          z: -s2dX * sinR + zLocal * cosR,
        };
      };

      // ── Proyección y arreglo por profundidad ──────────────────────────
      // Peso "cuánto se ve como globo" (0 = logo puro, 1 = globo puro).
      // Se usa para atenuar/enfatizar la distinción tierra/océano — durante
      // el logo la distinción no aplica.
      const globeWeight = kindFrom === "globe"
        ? (kindTo === "globe" ? 1 : 1 - morph)
        : (kindTo === "globe" ? morph : 0);

      const positions: {
        x: number; y: number; distMouse: number; depth: number;
        depthAlpha: number; sizeMul: number; worldZ: number; isLand: boolean;
        origIdx: number;
      }[] = [];

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const posFrom = computeShape(p, kindFrom);
        const posTo = computeShape(p, kindTo);
        // Interpolación entre ambos objetivos (todavía en espacio normalizado
        // [-1..1] × [-1..1] × [-1..1] aprox.)
        const world = {
          x: posFrom.x + (posTo.x - posFrom.x) * morph,
          y: posFrom.y + (posTo.y - posFrom.y) * morph,
          z: posFrom.z + (posTo.z - posFrom.z) * morph,
        };
        // Escalar al canvas (la inversión Y de la esfera se hace dentro
        // de computeShape solo para el globo; el logo ya usa convención
        // canvas por naturaleza).
        const worldX = world.x * SHAPE_RADIUS * S;
        const worldY = world.y * SHAPE_RADIUS * S;
        const worldZ = world.z * SHAPE_RADIUS * S;

        // Perspectiva
        const perspFactor = 1 + (worldZ / S) * PERSPECTIVE;
        const perspX = worldX * perspFactor;
        const perspY = worldY * perspFactor;
        // Alpha por profundidad — al frente 1.0, al fondo 0.2
        const zNorm = worldZ / (SHAPE_RADIUS * S);   // aprox [-1..1]
        const depthAlpha = 0.2 + 0.8 * ((zNorm + 1) / 2);
        const sizeMul = 0.55 + 0.9 * Math.max(0, Math.min(1, (zNorm + 1) / 2));

        // Movimiento caótico en hover
        if (transicionRed > 0.1 && !reduce) {
          p.rx += p.vx * 0.4;
          p.ry += p.vy * 0.4;
          if (Math.abs(p.rx) > S * 1.1) p.vx *= -1;
          if (Math.abs(p.ry) > S * 1.1) p.vy *= -1;
        }
        const chaosX = p.rx;
        const chaosY = p.ry;
        const targetX = perspX * (1 - transicionRed) + chaosX * transicionRed;
        const targetY = perspY * (1 - transicionRed) + chaosY * transicionRed;

        p.x += (targetX - p.x) * (reduce ? 1 : 0.18);
        p.y += (targetY - p.y) * (reduce ? 1 : 0.18);

        const xF = cx + p.x;
        const yF = cy + p.y;
        const dm = Math.hypot(xF - mouse.x, yF - mouse.y);
        const distC = Math.hypot(p.x, p.y);
        const depth = Math.max(0.35, 1 - (distC / (S * 0.7)) * 0.6);
        positions.push({
          x: xF, y: yF, distMouse: dm, depth, depthAlpha, sizeMul, worldZ,
          isLand: p.isLand, origIdx: i,
        });
      }

      // ── Malla: SOLO líneas cerca del cursor (hover). Sin líneas en globo
      // ni logo — evita saturación con ~1850 puntos. La densidad los define.
      const dCerca = S * 0.4;
      if (transicionRed > 0.15) {
        const distMaxLineas = S * 0.12;
        const distMaxSquared = distMaxLineas * distMaxLineas;
        for (let i = 0; i < positions.length; i++) {
          for (let j = i + 1; j < positions.length; j++) {
            const n1 = positions[i], n2 = positions[j];
            const dx = n1.x - n2.x;
            const dy = n1.y - n2.y;
            const d2 = dx * dx + dy * dy;
            if (d2 >= distMaxSquared) continue;
            const md = Math.min(n1.distMouse, n2.distMouse);
            if (md >= dCerca) continue;
            const depthAlphaAvg = (n1.depthAlpha + n2.depthAlpha) / 2;
            const inten = 1 - md / dCerca;
            ctx.beginPath();
            ctx.moveTo(n1.x, n1.y);
            ctx.lineTo(n2.x, n2.y);
            ctx.strokeStyle = toRgba(accent, (0.30 + inten * 0.50) * depthAlphaAvg);
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }
        }
      }

      // ── Partículas — halftone style ─────────────────────────────────────
      // Puntos MUY pequeños y uniformes. En modo LOGO subsampleamos (solo
      // cada 3ra partícula) para evitar la saturación que el usuario reportó
      // con 1850 puntos amontonados en una silueta pequeña.
      const sorted = [...positions].sort((a, b) => a.worldZ - b.worldZ);
      const logoMode = globeWeight < 0.5;
      sorted.forEach((n) => {
        const cerca = n.distMouse < dCerca;
        // Subsample en logo: dibuja solo si (índice original % 3 === 0)
        if (logoMode && !cerca && (n.origIdx % 3) !== 0) return;
        const baseSize = 0.85 + 0.35 * n.sizeMul;
        const size = cerca ? 2.6 : baseSize;
        ctx.beginPath();
        ctx.arc(n.x, n.y, Math.max(0.4, size), 0, Math.PI * 2);
        if (cerca) {
          ctx.fillStyle = accent;
          ctx.shadowColor = accent;
          ctx.shadowBlur = 5;
        } else {
          const alpha = globeWeight > 0.5
            ? 0.88 * n.depthAlpha
            : 0.55 * (0.55 + 0.45 * n.depth) * n.depthAlpha;
          ctx.fillStyle = toRgba(hi, alpha);
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
