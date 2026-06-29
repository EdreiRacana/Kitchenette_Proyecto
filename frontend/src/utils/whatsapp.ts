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
