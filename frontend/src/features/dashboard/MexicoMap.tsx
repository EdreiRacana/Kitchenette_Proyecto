// SVG choropleth de estados de México con paths embebidos (sin fetch).
// Los paths vienen de mxStatePaths.ts (32 entidades federativas INEGI 2025,
// aportadas por el cliente). Ventajas vs geojson externo: renderiza al
// instante, cero red, cero riesgo de fallo por 404, un solo archivo.

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { MX_STATE_PATHS, MX_VIEWBOX } from "./mxStatePaths";
import type { GeoStateRow } from "./types";

type Tokens = any;

// Normalización: el aria-label de los paths puede diferir del state_name
// que devuelve el backend (ej. "Coahuila de Zaragoza" vs "Coahuila").
// Este map se aplica en ambos sentidos para hacer match.
const NAME_ALIASES: Record<string, string> = {
  "distrito federal": "Ciudad de México",
  "df": "Ciudad de México",
  "cdmx": "Ciudad de México",
  "ciudad de mexico": "Ciudad de México",
  "mexico": "Estado de México",
  "estado de mexico": "Estado de México",
  "edomex": "Estado de México",
  "michoacan": "Michoacán",
  "michoacán de ocampo": "Michoacán",
  "michoacan de ocampo": "Michoacán",
  "nuevo leon": "Nuevo León",
  "queretaro": "Querétaro",
  "querétaro de arteaga": "Querétaro",
  "queretaro de arteaga": "Querétaro",
  "san luis potosi": "San Luis Potosí",
  "yucatan": "Yucatán",
  "veracruz de ignacio de la llave": "Veracruz",
  "coahuila de zaragoza": "Coahuila",
};

function normalizeStateName(raw: string): string {
  if (!raw) return "";
  const key = raw.trim().toLowerCase();
  return NAME_ALIASES[key] || raw;
}

interface Props {
  t: Tokens;
  data: GeoStateRow[];
  selectedState?: string | null;
  onStateClick?: (state: { name: string; sales: number; row?: GeoStateRow }) => void;
}

export default function MexicoMap({ t, data, selectedState = null, onStateClick }: Props) {
  const [hoveredState, setHoveredState] = useState<string | null>(null);

  // Índice por nombre normalizado — hace match tanto si viene "CDMX" como
  // "Ciudad de México" o "Distrito Federal".
  const salesByName = useMemo(() => {
    const idx: Record<string, GeoStateRow> = {};
    for (const s of data) {
      const norm = normalizeStateName(s.state_name).toLowerCase();
      idx[norm] = s;
    }
    return idx;
  }, [data]);

  const maxRevenue = useMemo(() => Math.max(1, ...data.map(s => s.revenue)), [data]);

  // Nunca usar t.panel2 aquí — es el mismo color del contenedor (invisible).
  // Los estados sin venta se pintan con un gris tenue independiente del theme.
  const fillFor = (stateName: string): string => {
    const norm = normalizeStateName(stateName).toLowerCase();
    const s = salesByName[norm];
    if (!s || s.revenue <= 0) return "rgba(255,255,255,0.06)";
    const ratio = Math.min(1, s.revenue / maxRevenue);
    const alpha = 0.22 + ratio * 0.65;
    const rgb = hexToRgb(t.nova || "#33B2F5");
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha.toFixed(2)})`;
  };

  const hoveredNorm = hoveredState ? normalizeStateName(hoveredState).toLowerCase() : "";
  const hoveredRow = hoveredState ? salesByName[hoveredNorm] : null;

  const containerStyle: CSSProperties = {
    position: "relative", width: "100%", height: "100%",
    display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
  };

  return (
    <div style={containerStyle}>
      <svg
        viewBox={`0 0 ${MX_VIEWBOX.width} ${MX_VIEWBOX.height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "100%", overflow: "visible" }}
      >
        <defs>
          <filter id="mexico-map-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g strokeLinejoin="round" vectorEffect="non-scaling-stroke">
          {MX_STATE_PATHS.map((p, i) => {
            const isSelected = selectedState === p.name;
            const isHovered = hoveredState === p.name;
            const norm = normalizeStateName(p.name).toLowerCase();
            const row = salesByName[norm];
            const fill =
              isSelected ? (t.nova || "#33B2F5") + "aa"
              : isHovered ? (t.nova || "#33B2F5") + "77"
              : fillFor(p.name);
            // Borde siempre visible: verde neón tenue (marca STHENOVA),
            // se refuerza en selección/hover con el azul nova.
            const stroke =
              isSelected || isHovered
                ? (t.nova || "#33B2F5")
                : "rgba(0,255,156,0.45)";
            return (
              <path
                key={p.name || i}
                d={p.d}
                fill={fill}
                stroke={stroke}
                strokeWidth={isSelected || isHovered ? 1.5 : 0.9}
                filter={isSelected || isHovered ? "url(#mexico-map-glow)" : undefined}
                style={{
                  cursor: "pointer",
                  transition: "fill 0.15s ease, stroke 0.15s ease",
                }}
                onMouseEnter={() => setHoveredState(p.name)}
                onMouseLeave={() => setHoveredState(null)}
                onClick={() => onStateClick?.({
                  name: p.name, sales: row?.revenue || 0, row,
                })}
              />
            );
          })}
        </g>
      </svg>

      {hoveredState && (
        <div style={{
          position: "absolute", top: 12, right: 12,
          padding: "10px 14px",
          background: "rgba(15,20,30,0.85)",
          border: `1px solid ${t.nova || "#33B2F5"}55`,
          borderRadius: 10,
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          pointerEvents: "none",
          minWidth: 180,
          boxShadow: `0 0 20px ${(t.nova || "#33B2F5")}22`,
        }}>
          <div style={{ color: t.textHi, fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
            {hoveredState}
          </div>
          {hoveredRow ? (
            <>
              <div style={{ color: t.textMid, fontSize: 11, marginBottom: 2 }}>
                Ventas: <b style={{ color: t.good || "#22c55e" }}>
                  ${(hoveredRow.revenue || 0).toLocaleString("es-MX", { maximumFractionDigits: 0 })}
                </b>
              </div>
              <div style={{ color: t.textLo, fontSize: 10.5 }}>
                {hoveredRow.units.toLocaleString("es-MX")} unid. · {hoveredRow.orders_count} pedidos · {hoveredRow.share_pct.toFixed(1)}%
              </div>
            </>
          ) : (
            <div style={{ color: t.textLo, fontSize: 11 }}>Sin ventas registradas</div>
          )}
        </div>
      )}
    </div>
  );
}


function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map(c => c + c).join("") : clean;
  return {
    r: parseInt(full.slice(0, 2), 16) || 51,
    g: parseInt(full.slice(2, 4), 16) || 178,
    b: parseInt(full.slice(4, 6), 16) || 245,
  };
}
