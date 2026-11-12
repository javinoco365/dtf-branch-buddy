/**
 * «¿Quién eres?»: qué socio está delante cuando una cuenta la usan varios.
 *
 * Una cuenta de acceso no es una persona: la de gerencia la usan varios socios
 * y la de Javier Cárdenas, solo él (tabla socio_cuentas, migración
 * 20261115100000). Reglas:
 *
 *   - Sin socios en la cuenta: el CRM funciona como siempre, sin preguntar.
 *   - Con uno: entra ya identificado y no hay nada que elegir.
 *   - Con varios: se pregunta en cada inicio de sesión y, hasta elegir, no se
 *     usa el CRM. La elección vale para esa sesión (en todas sus pestañas).
 *     El dispositivo recuerda la última persona y la pone la primera.
 *
 * No es una contraseña: sirve para saber de quién es cada tarea, no para
 * limitar lo que se ve.
 */

export type PersonaCuenta = { id: string; nombre: string };

/** Lo que se guarda en el dispositivo al elegir: quién y en qué sesión. */
export type EleccionGuardada = { socioId: string; sesion: string };

export type EstadoQuienSoy =
  | { tipo: "sin-personas" }
  | {
      tipo: "identificado";
      persona: PersonaCuenta;
      personas: PersonaCuenta[];
      puedeCambiar: boolean;
    }
  | { tipo: "elegir"; personas: PersonaCuenta[]; ultimaId: string | null };

/** La última persona elegida en el dispositivo, la primera; las demás, como vienen. */
export function ordenarConUltima(
  personas: PersonaCuenta[],
  ultimaId: string | null,
): PersonaCuenta[] {
  const ultima = personas.find((p) => p.id === ultimaId);
  return ultima ? [ultima, ...personas.filter((p) => p.id !== ultimaId)] : [...personas];
}

/**
 * En qué punto está quien usa la cuenta.
 *
 * `sesion` identifica el inicio de sesión actual: una elección hecha en otro
 * inicio de sesión ya no vale y se vuelve a preguntar.
 */
export function estadoQuienSoy(
  personas: PersonaCuenta[],
  guardada: EleccionGuardada | null,
  sesion: string | null,
  ultimaId: string | null,
): EstadoQuienSoy {
  if (personas.length === 0) return { tipo: "sin-personas" };
  if (personas.length === 1) {
    return { tipo: "identificado", persona: personas[0], personas, puedeCambiar: false };
  }
  const elegida =
    guardada && sesion && guardada.sesion === sesion
      ? personas.find((p) => p.id === guardada.socioId)
      : undefined;
  if (elegida) return { tipo: "identificado", persona: elegida, personas, puedeCambiar: true };
  const ultima = personas.some((p) => p.id === ultimaId) ? ultimaId : null;
  return { tipo: "elegir", personas: ordenarConUltima(personas, ultima), ultimaId: ultima };
}

/** Lee la elección guardada; cualquier cosa que no tenga la forma esperada, null. */
export function leerEleccion(texto: string | null | undefined): EleccionGuardada | null {
  if (!texto) return null;
  try {
    const v = JSON.parse(texto) as unknown;
    if (
      v &&
      typeof v === "object" &&
      typeof (v as EleccionGuardada).socioId === "string" &&
      typeof (v as EleccionGuardada).sesion === "string"
    ) {
      return { socioId: (v as EleccionGuardada).socioId, sesion: (v as EleccionGuardada).sesion };
    }
  } catch {
    // Un valor roto en el dispositivo equivale a no haber elegido.
  }
  return null;
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
