import { useEffect, useRef } from "react";
import axios from "axios";
import { BACKEND_ORIGIN } from "../services/api";

// Mientras `active` sea true (hubo error de conexión), sondea /health cada 10s
// con axios crudo (sin el interceptor de reintentos) y, en cuanto el backend
// responda, dispara `onRecover` para recargar los datos automáticamente —
// el usuario no tiene que picar "Reintentar".
export function useServerRecovery(active: boolean, onRecover: () => void) {
  const cb = useRef(onRecover);
  cb.current = onRecover;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        await axios.get(`${BACKEND_ORIGIN}/health`, { timeout: 8000 });
        if (!cancelled) cb.current();
      } catch {
        // sigue caído; se reintenta en el próximo tick
      }
    }, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, [active]);
}
