
import axios from 'axios';

// --- Config del retry (cubre el cold start de Render free, ~30-60s) ---
const MAX_RETRIES = 14;           // reintentos ante cold start (Render free puede tardar +60s en despertar)
const RETRY_DELAY = 5000;         // 5s entre reintentos
const PER_REQUEST_TIMEOUT = 30000; // 30s por intento

const RETRYABLE_STATUS = [502, 503, 504]; // Render levantando el contenedor

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1',
    timeout: PER_REQUEST_TIMEOUT,
    headers: {
        'Content-Type': 'application/json',
    },
});

// --- Aviso de "servidor despertando" para que la UI pinte un estado bonito ---
const wakingListeners = new Set();
let waking = false;
function setWaking(v) {
    if (waking === v) return;
    waking = v;
    wakingListeners.forEach((fn) => fn(v));
}
// Suscríbete desde un componente; regresa función para desuscribir.
export function onServerWaking(fn) {
    wakingListeners.add(fn);
    fn(waking); // estado actual de arranque
    return () => wakingListeners.delete(fn);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Origen del backend (sin el sufijo /api/v1). El frontend vive en otro dominio
// en Render, así que las rutas relativas que devuelven las subidas (p. ej.
// "/static/inventory/x.webp") hay que anteponerles este origen para que el
// navegador las pida al backend y no al propio frontend.
export const BACKEND_ORIGIN = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1').replace(/\/api\/v1\/?$/, '');

// Resuelve una URL de medios: deja intactas las absolutas (http/https/data/blob)
// y a las rutas relativas del backend les antepone BACKEND_ORIGIN.
export function resolveMediaUrl(url?: string): string {
    if (!url) return '';
    if (/^(https?:|data:|blob:)/i.test(url)) return url;
    if (url.startsWith('/')) return BACKEND_ORIGIN + url;
    return url;
}

function isRetryable(error) {
    // timeout (ECONNABORTED) o red caída/sin respuesta
    if (error.code === 'ECONNABORTED' || !error.response) return true;
    // Render despertando
    return RETRYABLE_STATUS.includes(error.response.status);
}

// --- Request interceptor: auth token ---
api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// --- Response interceptor: retry ante cold start ---
api.interceptors.response.use(
    (response) => {
        setWaking(false);
        return response;
    },
    async (error) => {
        const config = error.config;
        if (!config || !isRetryable(error)) {
            setWaking(false);
            return Promise.reject(error);
        }
        config._retry = config._retry ?? 0;
        if (config._retry >= MAX_RETRIES) {
            setWaking(false); // se agotaron los intentos -> que el catch caiga a demo
            return Promise.reject(error);
        }
        config._retry += 1;
        setWaking(true); // primer fallo retryable -> avisamos a la UI
        await sleep(RETRY_DELAY);
        return api(config);
    }
);

export default api;


