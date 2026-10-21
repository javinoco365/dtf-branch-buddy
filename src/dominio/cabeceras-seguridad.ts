/**
 * Cabeceras de seguridad de cada respuesta del servidor (S5, W2).
 *
 * Se APLICAN ya:
 * - frame-ancestors 'self' y X-Frame-Options SAMEORIGIN: ninguna web ajena
 *   puede meter el CRM en un marco para que alguien pulse «Borrar» o
 *   «Emitir» sin saberlo (clickjacking). Las vistas previas de PDF y de correo
 *   son marcos que pone el propio CRM (blob: y srcdoc), y siguen funcionando.
 * - base-uri, object-src y form-action: no cambian nada de lo que hace la
 *   aplicación y cierran tres vías clásicas de inyección.
 * - HSTS, nosniff, Referrer-Policy y Permissions-Policy.
 *
 * Solo se INFORMA (Content-Security-Policy-Report-Only), sin bloquear: la
 * política completa de scripts y conexiones. TanStack Start mete guiones en
 * línea para hidratar la página que cambian en cada respuesta, así que una
 * política sin 'unsafe-inline' necesita un nonce por petición; hasta entonces
 * se mira en la consola del navegador qué se saldría de la lista.
 */

/** El origen (https://host) de una URL, o null si no es una URL. */
function origen(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function cabecerasSeguridad(opciones: { supabaseUrl?: string }): Record<string, string> {
  const supabase = origen(opciones.supabaseUrl);
  const supabaseWs = supabase ? supabase.replace(/^http/, "ws") : null;
  const conexiones = ["'self'", supabase, supabaseWs].filter(Boolean).join(" ");

  const aplicada = [
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
  ].join("; ");

  const informada = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${conexiones}`,
    "frame-src 'self' blob:",
    "worker-src 'self' blob:",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
  ].join("; ");

  return {
    "Content-Security-Policy": aplicada,
    "Content-Security-Policy-Report-Only": informada,
    "X-Frame-Options": "SAMEORIGIN",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), payment=(), usb=()",
  };
}

/** Añade las cabeceras que la respuesta no traiga ya (no pisa las de una ruta). */
export function conCabecerasSeguridad(
  cabeceras: Headers,
  seguridad: Record<string, string>,
): Headers {
  const nuevas = new Headers(cabeceras);
  for (const [nombre, valor] of Object.entries(seguridad)) {
    if (!nuevas.has(nombre)) nuevas.set(nombre, valor);
  }
  return nuevas;
}
