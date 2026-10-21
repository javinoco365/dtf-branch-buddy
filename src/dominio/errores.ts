/**
 * Errores para personas.
 *
 * La mayoría de los errores de la app ya vienen en castellano y pensados para
 * quien la usa: los escriben las server functions y las funciones de la base
 * («Tu nivel no permite borrar», «La factura ya está registrada…»). Esos se
 * dejan tal cual.
 *
 * Los que no: los que llegan de más abajo (el navegador, PostgREST, Postgres,
 * Supabase Auth), en inglés y en jerga: «Failed to fetch», «new row violates
 * row-level security policy», «duplicate key value violates unique
 * constraint». Esos se traducen a lo que le pasa a quien está delante y qué
 * puede hacer, y el texto original queda como detalle, para quien tenga que
 * mirarlo.
 */

export interface ErrorLegible {
  /** Lo que se le dice a la persona. */
  texto: string;
  /** El mensaje original, si se ha traducido: para quien tenga que mirarlo. */
  detalle: string | null;
}

const REGLAS: { patron: RegExp; texto: string }[] = [
  {
    patron: /failed to fetch|networkerror|load failed|network request failed|fetch failed/i,
    texto: "No hay conexión con el servidor. Comprueba internet y vuelve a intentarlo.",
  },
  {
    patron: /jwt expired|invalid jwt|refresh token|session (?:not found|expired)/i,
    texto: "La sesión ha caducado. Sal y vuelve a entrar.",
  },
  {
    patron: /row-level security|permission denied|(?:code|código|sqlstate)\W{0,4}42501/i,
    texto: "No tienes permiso para hacer esto. Si crees que deberías, habla con un administrador.",
  },
  {
    patron: /duplicate key|(?:code|código|sqlstate)\W{0,4}23505/i,
    texto: "Ya existe uno igual: está repetido.",
  },
  {
    patron: /foreign key|(?:code|código|sqlstate)\W{0,4}23503/i,
    texto: "No se puede: hay otros datos que dependen de este.",
  },
  {
    patron: /not-null constraint|null value in column|(?:code|código|sqlstate)\W{0,4}23502/i,
    texto: "Falta un dato obligatorio.",
  },
  {
    patron: /check constraint|(?:code|código|sqlstate)\W{0,4}23514|invalid input (?:syntax|value)/i,
    texto: "Algún dato no tiene un valor válido. Revisa lo que has escrito.",
  },
  {
    patron: /timed out|timeout|gateway time-?out|canceling statement/i,
    texto: "El servidor ha tardado demasiado en responder. Vuelve a intentarlo.",
  },
  {
    patron: /internal server error|bad gateway|service unavailable/i,
    texto: "Ha fallado algo en el servidor. Vuelve a intentarlo y, si se repite, avisa.",
  },
  {
    patron: /unexpected token|is not valid json|json\.parse/i,
    texto: "El servidor ha respondido algo inesperado. Vuelve a intentarlo.",
  },
];

/**
 * El texto para la persona. `porDefecto` es lo que se dice si no hay mensaje
 * (un error vacío o que no es un Error).
 */
export function errorParaPersonas(
  mensaje: string | null | undefined,
  porDefecto = "No se ha podido completar. Vuelve a intentarlo.",
): ErrorLegible {
  const original = (mensaje ?? "").trim();
  if (!original) return { texto: porDefecto, detalle: null };
  const regla = REGLAS.find((r) => r.patron.test(original));
  return regla ? { texto: regla.texto, detalle: original } : { texto: original, detalle: null };
}

/**
 * Lo que le pasó a la lectura de una factura, para la persona. El lector
 * guarda su error técnico («El lector de facturas ha respondido 400 (tras un
 * reintento)», «La lectura no tiene la forma esperada: confianza está fuera de
 * rango»); en la cola se dice qué hacer.
 */
export function errorLecturaParaPersonas(mensaje: string): ErrorLegible {
  const original = mensaje.trim();
  if (/facturas_key|anthropic_api_key|vault|secreto|no está configurado/i.test(original)) {
    return {
      texto: "La lectura automática no está activada: da esta factura de alta a mano.",
      detalle: original,
    };
  }
  if (/forma esperada|fuera de rango|no es del tipo|no es un valor permitido/i.test(original)) {
    return {
      texto: "La lectura salió incompleta. Vuelve a leerla (↻) o dala de alta a mano.",
      detalle: original,
    };
  }
  if (/ha respondido|sin código|reintento/i.test(original)) {
    return {
      texto: "El lector no ha podido con este fichero. Vuelve a leerlo (↻) o dalo de alta a mano.",
      detalle: original,
    };
  }
  return errorParaPersonas(original);
}
