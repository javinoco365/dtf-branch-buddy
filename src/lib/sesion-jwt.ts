/**
 * El identificador del inicio de sesión que lleva el token de Supabase
 * (`session_id`). Es el mismo mientras dura la sesión, aunque el token se
 * renueve cada hora, y cambia al volver a entrar.
 *
 * Sirve para que «¿Quién eres?» se pregunte en cada inicio de sesión y no en
 * cada renovación del token. No se usa `user.last_sign_in_at`: es de la cuenta,
 * no de la sesión, y cambiaría en el ordenador de uno cuando otro entra con la
 * misma cuenta desde el móvil.
 *
 * Solo lee el token; no lo verifica (eso lo hace Supabase en cada petición).
 */
export function idDeSesion(accessToken: string | null | undefined): string | null {
  if (!accessToken) return null;
  const partes = accessToken.split(".");
  if (partes.length < 2 || !partes[1]) return null;
  try {
    const base64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
    const relleno = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const carga = JSON.parse(atob(relleno)) as { session_id?: unknown };
    return typeof carga.session_id === "string" && carga.session_id ? carga.session_id : null;
  } catch {
    return null;
  }
}
