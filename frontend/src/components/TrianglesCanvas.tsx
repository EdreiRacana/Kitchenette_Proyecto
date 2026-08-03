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

const SHAPE_HOLD_MS = 5500;
const SHAPE_MORPH_MS = 1200;
// Filosofía: MENOS puntos con MÁS contraste. Los continentes se leen por el
// contraste (denso vs vacío), no por la cantidad total de puntos.
const NUM_PARTICLES = 520;
const TARGET_LAND = 460;               // 88% del total en tierra
const TARGET_OCEAN = 60;               // 12% océano (solo backdrop mínimo)
const ROTATION_PERIOD_MS = 40000;
const AXIS_TILT_DEG = 18;

const SHAPE_RADIUS = 0.72;
const PERSPECTIVE = 0.45;

type ShapeKind = "globe" | "novamark";
const SHAPE_CYCLE: ShapeKind[] = ["globe", "novamark"];

// ── Máscara aproximada de continentes ─────────────────────────────────────
// Cada entrada: [latitud, longitud, radio_angular_deg] representa un "blob"
// terrestre. La unión de estos blobs bosqueja los continentes de forma
// reconocible: partículas dentro de algún blob se marcan como "continente"
// y se pintan brillantes; el resto (océano) queda tenue.
const LANDMASSES: [number, number, number][] = [
  // NORTEAMÉRICA — Alaska, Canadá, USA, México, Centroamérica
  [68, -150, 12],  [65, -130, 14], [60, -110, 16], [55, -105, 18],
  [50, -100, 18], [45, -90, 16],  [42, -75, 14],  [38, -85, 14],
  [35, -100, 14], [30, -100, 12], [25, -100, 10], [22, -105, 8],
  [17, -90, 8],
  // Groenlandia
  [75, -40, 10],   [70, -45, 12],
  // SUDAMÉRICA — Venezuela, Brasil, Argentina, Chile, Perú
  [8, -68, 12],    [0, -60, 15],   [-8, -55, 15],  [-15, -55, 14],
  [-25, -55, 14],  [-30, -65, 12], [-40, -68, 9],  [-48, -72, 6],
  [-55, -68, 4],
  // EUROPA — más detalle: UK, Iberia, Balcanes, Escandinavia, Rusia oeste
  [58, -3, 6],     [50, 5, 8],     [55, 15, 10],   [45, 12, 10],
  [42, 18, 8],     [40, 25, 8],    [60, 15, 10],   [65, 25, 10],
  [55, 35, 12],
  // ÁFRICA — Sahara, Sahel, Congo, Sudáfrica
  [30, 5, 10],     [25, 15, 12],   [20, 25, 12],   [15, 30, 12],
  [10, 20, 12],    [5, 25, 12],    [0, 20, 12],    [-5, 22, 12],
  [-15, 20, 12],   [-22, 25, 12],  [-30, 22, 8],
  // Madagascar
  [-20, 47, 5],
  // ASIA — Siberia, Kazajstán, China, Corea, Japón, Medio Oriente
  [60, 60, 14],    [65, 90, 14],   [65, 120, 12],  [60, 145, 10],
  [50, 60, 12],    [50, 90, 14],   [45, 110, 12],  [45, 130, 10],
  [40, 75, 12],    [40, 105, 12],  [35, 128, 6],   [37, 138, 5],
  [35, 45, 10],    [30, 55, 8],    [28, 68, 10],
  // India + subcontinente
  [22, 78, 14],    [15, 78, 10],
  // Sudeste asiático — Indochina, Indonesia, Filipinas
  [15, 100, 10],   [10, 105, 8],   [5, 115, 8],    [0, 112, 8],
  [-5, 120, 8],    [12, 122, 5],
  // Nueva Guinea
  [-6, 140, 8],
  // AUSTRALIA
  [-22, 122, 10],  [-25, 135, 12], [-28, 148, 10], [-35, 148, 6],
  // Antártida
  [-80, -60, 20],  [-80, 0, 20],   [-80, 60, 20],  [-80, 120, 20],
  [-80, 180, 20],
];

/** Distancia angular (great-circle) entre dos puntos (grados). */
function greatCircleDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const cosD = Math.sin(φ1) * Math.sin(φ2) + Math.cos(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.acos(Math.max(-1, Math.min(1, cosD))) * 180) / Math.PI;
}

/** ¿La partícula en (lat, lon) cae dentro de algún blob terrestre? */
function isContinent(lat: number, lon: number): boolean {
  for (const [bl, bo, r] of LANDMASSES) {
    if (greatCircleDeg(lat, lon, bl, bo) < r) return true;
  }
  return false;
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

      // ── (A) TIERRA: sampleados DENTRO de los blobs de LANDMASSES.
      // Cada blob aporta puntos proporcionales a su radio² (blobs grandes
      // → más puntos, densidad uniforme por área).
      const landTotalWeight = LANDMASSES.reduce((a, [, , r]) => a + r * r, 0);
      for (const [blat, blon, brad] of LANDMASSES) {
        const nHere = Math.max(1, Math.round(TARGET_LAND * (brad * brad) / landTotalWeight));
        for (let k = 0; k < nHere; k++) {
          // Muestreo dentro del casquete esférico de radio `brad` alrededor
          // de (blat, blon). Uniforme dentro del disco angular.
          const u = Math.random();
          const angDist = Math.sqrt(u) * brad;       // 0..brad grados
          const bearing = Math.random() * 2 * Math.PI;
          // Desplazamiento en lat/lon (aprox — bien para blobs pequeños)
          const dLat = angDist * Math.cos(bearing);
          const dLon = angDist * Math.sin(bearing) / Math.max(0.15, Math.cos(blat * Math.PI / 180));
          const lat = Math.max(-89, Math.min(89, blat + dLat));
          const lon = ((blon + dLon + 540) % 360) - 180;
          // A esfera
          const latRad = lat * Math.PI / 180;
          const lonRad = lon * Math.PI / 180;
          const sphereY = Math.sin(latRad);
          const sphereR = Math.cos(latRad);
          const sphereTheta = lonRad + Math.PI;      // origen en lon=-180

          out.push(makeParticle(sphereTheta, sphereY, sphereR, true, S));
        }
      }

      // ── (B) OCÉANO: uniformes en la esfera, saltando los que caen en
      // tierra (para no duplicar densidad continental).
      let oceanAdded = 0;
      let attempts = 0;
      while (oceanAdded < TARGET_OCEAN && attempts < 8000) {
        attempts++;
        const sphereY = 2 * Math.random() - 1;
        const sphereR = Math.sqrt(Math.max(0, 1 - sphereY * sphereY));
        const sphereTheta = Math.random() * Math.PI * 2;
        const lat = Math.asin(sphereY) * 180 / Math.PI;
        const lon = ((sphereTheta * 180 / Math.PI + 180) % 360) - 180;
        if (isContinent(lat, lon)) continue;
        out.push(makeParticle(sphereTheta, sphereY, sphereR, false, S));
        oceanAdded++;
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
          const baseX = p.sphereR * Math.cos(p.sphereTheta);
          const baseZ = p.sphereR * Math.sin(p.sphereTheta);
          const spunX = baseX * cosR + baseZ * sinR;
          const spunZ = -baseX * sinR + baseZ * cosR;
          const spunY = p.sphereY;
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
        // Escalar al canvas
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
          isLand: p.isLand,
        });
      }

      // ── Malla: líneas entre partículas cercanas ─────────────────────────
      // Durante el globo, SOLO líneas tierra-tierra en rango corto para
      // que los continentes se lean como bloques cohesionados (no atravesar
      // océanos). Durante el logo, todas las conexiones para silueta.
      // Distancias distintas por modo — más generosas en globo para atar puntos cercanos de tierra.
      const distMaxLineasLand = S * 0.10;    // corto — solo dentro del mismo continente
      const distMaxLineasLogo = S * 0.14;
      const distMaxLineas = globeWeight > 0.5 ? distMaxLineasLand : distMaxLineasLogo;
      const dCerca = S * 0.4;
      const distMaxSquared = distMaxLineas * distMaxLineas;
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const n1 = positions[i], n2 = positions[j];
          const dx = n1.x - n2.x;
          const dy = n1.y - n2.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= distMaxSquared) continue;

          // Filtro globo: solo tierra-tierra
          if (globeWeight > 0.5 && !(n1.isLand && n2.isLand)) continue;

          const d = Math.sqrt(d2);
          const md = Math.min(n1.distMouse, n2.distMouse);
          const cerca = md < dCerca;
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
            // Líneas tierra-tierra en globo: más marcadas para tejer continentes
            const baseAlpha = globeWeight > 0.5 ? 0.55 : 0.32;
            ctx.strokeStyle = toRgba(accent, baseAlpha * fadeByDist * depthAlphaAvg);
            ctx.lineWidth = globeWeight > 0.5 ? 1.1 : 1;
          }
          ctx.stroke();
        }
      }

      // ── Partículas (ordenadas por profundidad Z para 3D real) ───────────
      // CONTRASTE MÁXIMO en modo globo: tierra grande + brillante + con glow;
      // océano MUY tenue (backdrop de estrellitas). El contraste es lo que
      // hace visibles los continentes, no la cantidad total de puntos.
      const sorted = [...positions].sort((a, b) => a.worldZ - b.worldZ);
      sorted.forEach((n) => {
        const cerca = n.distMouse < dCerca;
        const baseSize = 1.4 + 0.9 * n.depth;
        // Boost fuerte de tamaño para tierra durante globo
        const landBoost = 1 + globeWeight * (n.isLand ? 0.9 : -0.55);
        const size = cerca ? 3.4 : baseSize * n.sizeMul * landBoost;
        ctx.beginPath();
        ctx.arc(n.x, n.y, Math.max(0.5, size), 0, Math.PI * 2);
        if (cerca) {
          ctx.fillStyle = accent;
          ctx.shadowColor = accent;
          ctx.shadowBlur = 8;
        } else if (globeWeight > 0.5 && n.isLand) {
          // Tierra: brillante + halo sutil para reforzar visibilidad
          ctx.fillStyle = toRgba(hi, 0.95 * n.depthAlpha);
          ctx.shadowColor = accent;
          ctx.shadowBlur = 3.5;
        } else {
          const globeAlpha = n.isLand ? 0.90 : 0.08;   // océano casi invisible
          const logoAlpha = 0.55;
          const baseAlpha = globeAlpha * globeWeight + logoAlpha * (1 - globeWeight);
          ctx.fillStyle = toRgba(hi, baseAlpha * (0.55 + 0.45 * n.depth) * n.depthAlpha);
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
