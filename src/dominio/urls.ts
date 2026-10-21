/**
 * Si el servidor puede pedir una URL que viene de la base (un logo): solo
 * https y nunca a una dirección interna escrita a mano.
 *
 * No resuelve DNS (un nombre público que apunte a una IP interna pasaría):
 * es la primera barrera, y la descarga va además sin seguir redirecciones.
 */
export function urlExternaSegura(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host.includes(".") && !host.includes(":")) return false; // localhost, nombres internos
  if (host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return false;
  }
  // IPv6 literal: ninguna (los logos van por nombre).
  if (host.includes(":")) return false;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false; // metadatos de la nube
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  return true;
}

/**
 * Un logo incrustado en la propia URL (`data:image/png;base64,...`). No sale a
 * la red, así que no hay nada que filtrar por dirección: basta con que sea una
 * imagen PNG, JPG o WEBP en base64. Devuelve el tipo y los bytes que ocupa una
 * vez decodificado, o null si no es un logo incrustado válido.
 */
export function logoIncrustado(url: string): { tipo: string; bytes: number } | null {
  const m = url
    .trim()
    .match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!m) return null;
  const base64 = m[2];
  const relleno = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return { tipo: m[1].toLowerCase(), bytes: Math.floor((base64.length * 3) / 4) - relleno };
}
