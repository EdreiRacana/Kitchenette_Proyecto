// SVG choropleth de estados de México. Carga /data/mexico-states.geojson
// (público, ~180 KB) y colorea cada estado por intensidad de ventas.
// Adaptado del componente que aportó el cliente — mismo comportamiento,
// estilos inline con tokens (t) para coherencia con el resto del proyecto.

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { GeoStateRow } from "./types";

type Tokens = any;

// Normaliza nombres de estados del GeoJSON (Zacatecas, Ciudad de México, etc.)
// al mismo esquema que el backend devuelve (state_name puede diferir en tildes
// o mayúsculas). También mapea a state_code cuando sea necesario.
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
  "nuevo leon": "Nuevo León",
  "queretaro": "Querétaro",
  "querétaro de arteaga": "Querétaro",
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

interface GeoFeature {
  type: string;
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: any;
  };
  properties: Record<string, any>;
}

interface GeoData {
  type: string;
  features: GeoFeature[];
}

interface Props {
  t: Tokens;
  data: GeoStateRow[];   // filas del backend con revenue, units, share_pct
  selectedState?: string | null;
  onStateClick?: (state: { name: string; sales: number; row?: GeoStateRow }) => void;
}

export default function MexicoMap({ t, data, selectedState = null, onStateClick }: Props) {
  const [geoData, setGeoData] = useState<GeoData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoveredState, setHoveredState] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/mexico-states.geojson")
      .then(r => {
        if (!r.ok) throw new Error("No se pudo cargar mexico-states.geojson");
        return r.json();
      })
      .then(json => { if (!cancelled) setGeoData(json); })
      .catch(e => { if (!cancelled) setError(e?.message || "Error al cargar mapa"); });
    return () => { cancelled = true; };
  }, []);

  // Índice de ventas por nombre normalizado
  const salesByName = useMemo(() => {
    const idx: Record<string, GeoStateRow> = {};
    for (const s of data) {
      idx[s.state_name.toLowerCase()] = s;
    }
    return idx;
  }, [data]);

  const maxRevenue = useMemo(() => {
    return Math.max(1, ...data.map(s => s.revenue));
  }, [data]);

  // Calcular bounds del mapa (una vez cargado)
  const bounds = useMemo(() => {
    if (!geoData) return null;
    const coords: [number, number][] = [];
    for (const feat of geoData.features) {
      const g = feat.geometry;
      if (g.type === "Polygon") {
        for (const polygon of g.coordinates as [number, number][][]) {
          for (const pt of polygon) coords.push(pt);
        }
      } else if (g.type === "MultiPolygon") {
        for (const multi of g.coordinates as [number, number][][][]) {
          for (const polygon of multi) {
            for (const pt of polygon) coords.push(pt);
          }
        }
      }
    }
    if (coords.length === 0) return null;
    const lons = coords.map(p => p[0]);
    const lats = coords.map(p => p[1]);
    return {
      minLon: Math.min(...lons), maxLon: Math.max(...lons),
      minLat: Math.min(...lats), maxLat: Math.max(...lats),
    };
  }, [geoData]);

  if (error) {
    return (
      <div style={{ padding: 40, color: t.bad, textAlign: "center", fontSize: 12 }}>
        Error al cargar mapa: {error}
      </div>
    );
  }
  if (!geoData || !bounds) {
    return (
      <div style={{
        padding: 40, color: t.textLo, textAlign: "center", fontSize: 12,
        display: "flex", alignItems: "center", justifyContent: "center", height: "100%",
      }}>
        Cargando mapa…
      </div>
    );
  }

  const W = 1000, H = 700;
  const project = ([lon, lat]: [number, number]): [number, number] => {
    const x = ((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * W;
    const y = H - ((lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * H;
    return [x, y];
  };

  const buildPath = (feature: GeoFeature): string => {
    const polyToPath = (polygon: [number, number][]) =>
      polygon.map((pt, i) => {
        const [x, y] = project(pt);
        return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      }).join(" ") + " Z";
    const g = feature.geometry;
    if (g.type === "Polygon") {
      return (g.coordinates as [number, number][][]).map(polyToPath).join(" ");
    }
    if (g.type === "MultiPolygon") {
      return (g.coordinates as [number, number][][][])
        .map(multi => multi.map(polyToPath).join(" "))
        .join(" ");
    }
    return "";
  };

  const getStateName = (feat: GeoFeature): string => {
    const raw = feat.properties?.NOMGEO
                || feat.properties?.NOMBRE
                || feat.properties?.name
                || feat.properties?.NAME_1
                || "";
    return normalizeStateName(String(raw));
  };

  // Colorea por intensidad — usa `t.nova` como color base con opacidad variable
  const fillFor = (stateName: string): string => {
    const s = salesByName[stateName.toLowerCase()];
    if (!s || s.revenue <= 0) return t.panel2 || "rgba(255,255,255,0.04)";
    const ratio = Math.min(1, s.revenue / maxRevenue);
    // 0.15 mínimo → 0.75 máximo
    const alpha = 0.15 + ratio * 0.60;
    const rgb = hexToRgb(t.nova || "#33B2F5");
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha.toFixed(2)})`;
  };

  const hoveredRow = hoveredState ? salesByName[hoveredState.toLowerCase()] : null;
  const containerStyle: CSSProperties = {
    position: "relative", width: "100%", height: "100%",
    display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
  };

  return (
    <div style={containerStyle}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "100%", overflow: "visible" }}>
        <defs>
          <filter id="mexicoGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {geoData.features.map((feat, i) => {
          const name = getStateName(feat);
          const isSelected = selectedState === name;
          const isHovered = hoveredState === name;
          const row = salesByName[name.toLowerCase()];
          return (
            <path
              key={name || i}
              d={buildPath(feat)}
              fill={
                isSelected ? (t.nova || "#33B2F5") + "77"
                : isHovered ? (t.nova || "#33B2F5") + "55"
                : fillFor(name)
              }
              stroke={
                isSelected || isHovered
                  ? (t.nova || "#33B2F5")
                  : (t.border || "rgba(255,255,255,0.15)")
              }
              strokeWidth={isSelected || isHovered ? 1.5 : 0.6}
              filter={isSelected ? "url(#mexicoGlow)" : "none"}
              style={{
                cursor: "pointer",
                transition: "fill 0.15s ease, stroke 0.15s ease",
              }}
              onMouseEnter={() => setHoveredState(name)}
              onMouseLeave={() => setHoveredState(null)}
              onClick={() => onStateClick?.({
                name, sales: row?.revenue || 0, row,
              })}
            />
          );
        })}
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
  const full = clean.length === 3
    ? clean.split("").map(c => c + c).join("")
    : clean;
  return {
    r: parseInt(full.slice(0, 2), 16) || 51,
    g: parseInt(full.slice(2, 4), 16) || 178,
    b: parseInt(full.slice(4, 6), 16) || 245,
  };
}
