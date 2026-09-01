// ErrorBoundary global: evita pantalla blanca cuando un componente crashea.
// En vez de que la app se caiga silenciosamente por un ReferenceError o
// por un objeto renderizado como React child, muestra una pantalla de
// recuperacion con detalles del error y botones "Recargar" / "Volver al
// tablero".
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
    this.setState({ info });
  }

  private reset = () => this.setState({ error: null, info: null });
  private reload = () => window.location.reload();
  private goHome = () => { window.location.hash = ""; this.reload(); };

  render() {
    if (!this.state.error) return this.props.children;

    const err = this.state.error;
    const stack = (err?.stack || "").split("\n").slice(0, 6).join("\n");

    return (
      <div style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #05091a 0%, #0d1530 100%)",
        color: "#E4ECFB", padding: "48px 20px",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      }}>
        <div style={{
          maxWidth: 640, width: "100%",
          background: "rgba(18,28,52,0.7)",
          border: "1px solid rgba(180,215,255,0.18)",
          borderRadius: 16, padding: 28,
          backdropFilter: "blur(18px) saturate(160%)",
          boxShadow: "0 20px 50px rgba(0,0,0,0.4)",
        }}>
          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: "#F87171" }}>
            Algo inesperado ocurrió
          </div>
          <div style={{ fontSize: 13, color: "rgba(180,200,235,0.75)", marginBottom: 18, lineHeight: 1.55 }}>
            La aplicación encontró un error mientras cargaba esta vista.
            El resto del sistema sigue funcionando — puedes volver al tablero
            o recargar la página.
          </div>

          <div style={{
            background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 10, padding: "10px 14px", marginBottom: 18,
            fontSize: 12.5, color: "#FCA5A5", fontFamily: "Menlo, monospace",
            whiteSpace: "pre-wrap", overflowX: "auto",
          }}>
            {err?.name || "Error"}: {err?.message || String(err)}
            {stack && <div style={{ color: "rgba(200,215,240,0.5)", marginTop: 8, fontSize: 11 }}>{stack}</div>}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={this.goHome}
              style={{
                padding: "10px 18px", borderRadius: 10, border: "none",
                background: "linear-gradient(135deg, #33B2F5, #1e3a8a)",
                color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer",
              }}>
              Volver al tablero
            </button>
            <button onClick={this.reload}
              style={{
                padding: "10px 18px", borderRadius: 10,
                border: "1px solid rgba(180,215,255,0.25)",
                background: "transparent", color: "#DEE9FB",
                fontWeight: 600, fontSize: 13, cursor: "pointer",
              }}>
              Recargar
            </button>
            <button onClick={this.reset}
              style={{
                padding: "10px 18px", borderRadius: 10,
                border: "1px solid rgba(180,215,255,0.15)",
                background: "transparent", color: "rgba(180,200,235,0.7)",
                fontWeight: 500, fontSize: 12.5, cursor: "pointer",
              }}>
              Intentar de nuevo
            </button>
          </div>
        </div>
      </div>
    );
  }
}
