// Abre WhatsApp (app o Web) con el número y mensaje precargados, usando la
// cuenta de WhatsApp de quien da clic — no requiere ninguna API ni
// configuración por empresa. Si el teléfono no tiene código de país se
// asume México (52).
export function waLink(phone: string, message?: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 10) digits = `52${digits}`;
  const text = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${digits}${text}`;
}

export function openWhatsApp(phone: string, message?: string) {
  window.open(waLink(phone, message), "_blank");
}

// Comparte un archivo (PDF de ticket, imagen, etc.) usando el share sheet
// nativo del sistema — el usuario elige WhatsApp, Correo, AirDrop, etc. y
// el PDF viaja como adjunto REAL. Funciona en iOS Safari 15+ y Android
// Chrome. En navegadores sin `navigator.share` con archivos devuelve false
// para que el caller haga fallback (por ejemplo, texto vía wa.me).
export async function shareFile(file: File, opts: { title?: string; text?: string } = {}): Promise<boolean> {
  const nav = navigator as any;
  if (!nav.canShare || !nav.share) return false;
  const shareData: any = { files: [file], title: opts.title, text: opts.text };
  try {
    if (!nav.canShare(shareData)) return false;
    await nav.share(shareData);
    return true;
  } catch (e: any) {
    // AbortError = el usuario canceló el share sheet — se considera manejado
    if (e?.name === "AbortError") return true;
    return false;
  }
}
