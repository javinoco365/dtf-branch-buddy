/**
 * «¿Quién eres?»: qué socio está delante cuando una cuenta la usan varios.
 *
 * Una cuenta de acceso no es una persona: la de gerencia la usan varios socios
 * y la de Javier Cárdenas, solo él (tabla socio_cuentas, migración
 * 20261115100000). Reglas:
 *
 *   - Sin socios en la cuenta: el CRM funciona como siempre, sin preguntar.
 *   - Con uno: entra ya identificado y no hay nada que elegir.
 *   - Con varios: la persona se guarda en el DISPOSITIVO, no en la cuenta.
 *     Un dispositivo que ya eligió entra directo con esa persona, aunque se
 *     salga y se vuelva a entrar. Se pregunta (y, hasta elegir, no se usa el
 *     CRM) en un dispositivo que no ha elegido nunca, o si la persona guardada
 *     no es de la cuenta con la que se entra. Se cambia desde la cabecera.
 *
 * No es una contraseña: sirve para saber de quién es cada tarea, no para
 * limitar lo que se ve.
 */

export type PersonaCuenta = { id: string; nombre: string };

export type EstadoQuienSoy =
  | { tipo: "sin-personas" }
  | {
      tipo: "identificado";
      persona: PersonaCuenta;
      personas: PersonaCuenta[];
      puedeCambiar: boolean;
    }
  | { tipo: "elegir"; personas: PersonaCuenta[] };

/**
 * En qué punto está quien usa la cuenta. `guardadaId` es la persona que tiene
 * guardada el dispositivo (o null si no ha elegido nunca).
 */
export function estadoQuienSoy(
  personas: PersonaCuenta[],
  guardadaId: string | null,
): EstadoQuienSoy {
  if (personas.length === 0) return { tipo: "sin-personas" };
  if (personas.length === 1) {
    return { tipo: "identificado", persona: personas[0], personas, puedeCambiar: false };
  }
  const guardada = personas.find((p) => p.id === guardadaId);
  if (guardada) return { tipo: "identificado", persona: guardada, personas, puedeCambiar: true };
  return { tipo: "elegir", personas };
}

/** Las iniciales para el avatar: «Javier Novoa» → «JN»; «Álvaro» → «Á». */
export function iniciales(nombre: string): string {
  return nombre
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toLocaleUpperCase("es-ES"))
    .join("");
}
