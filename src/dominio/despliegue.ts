/**
 * Cuándo un error es «se ha desplegado una versión nueva» y hay que recargar.
 *
 * Lógica pura: no toca `window`, ni `sessionStorage`, ni la red. Se prueba sin
 * navegador.
 *
 * ## El problema
 *
 * La aplicación no se descarga entera de golpe: cada sección va en su propio
 * fichero, con un apaño en el nombre —`route-BYXMqSa_.js`— y se pide al
 * navegador solo cuando hace falta. Ese apaño cambia en cada compilación, y
 * `_headers` manda cachear `/assets/*` durante un año como inmutable.
 *
 * Al desplegar, quien tuviera el panel abierto se queda con el fichero de
 * arranque viejo en memoria, que pide un trozo cuyo nombre ya no existe en el
 * servidor. El navegador recibe un 404 y la pantalla entera se cae con
 * «This page didn't load». Pasó el 5 de septiembre de 2026 con el panel.
 *
 * La solución no es tocar la caché: es darse cuenta de que el error significa
 * «tienes una versión vieja» y volver a cargar la página, que ya trae el
 * fichero de arranque nuevo.
 *
 * ## Por qué no vale con mirar si el mensaje trae «fetch»
 *
 * Porque una llamada normal a Supabase que se cae sin cobertura también dice
 * `Failed to fetch`, y recargar ahí no arregla nada: deja al usuario dando
 * vueltas y perdiendo lo que estuviera escribiendo. Solo cuentan los mensajes
 * que hablan de un **módulo** que no se ha podido importar.
 */

/**
 * Lo que dice cada navegador cuando no consigue traerse un trozo de código.
 * No hay un error normalizado para esto, así que hay que ir por el texto.
 */
const SENAS: readonly RegExp[] = [
  // Chrome, Edge, Opera.
  /failed to fetch dynamically imported module/i,
  // Firefox.
  /error loading dynamically imported module/i,
  // Safari.
  /importing a module script failed/i,
  // Vite, cuando el que falla es el CSS de la sección.
  /unable to preload css/i,
  // Vite, al precargar el trozo antes de necesitarlo.
  /failed to fetch dynamically imported/i,
];

/** El nombre que usan los empaquetadores para este fallo. */
const NOMBRES = new Set(["ChunkLoadError"]);

function textoDelError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (error && typeof error === "object") {
    const posible = error as { message?: unknown; name?: unknown };
    const partes = [posible.name, posible.message].filter((p) => typeof p === "string");
    if (partes.length) return partes.join(": ");
  }
  return "";
}

function nombreDelError(error: unknown): string {
  if (error instanceof Error) return error.name;
  if (error && typeof error === "object") {
    const posible = (error as { name?: unknown }).name;
    if (typeof posible === "string") return posible;
  }
  return "";
}

/**
 * ¿Este error es el de un trozo de código que ya no existe en el servidor?
 */
export function esErrorDeVersionVieja(error: unknown): boolean {
  if (NOMBRES.has(nombreDelError(error))) return true;
  const texto = textoDelError(error);
  if (!texto) return false;
  return SENAS.some((sena) => sena.test(texto));
}

/**
 * Cuánto se espera antes de admitir otra recarga por el mismo motivo.
 *
 * Es la red de seguridad contra el bucle. Si el trozo falta de verdad —un
 * despliegue subido a medias, y no una pestaña vieja— recargar no lo arregla:
 * la página volvería a caerse, a recargar, y a caerse, para siempre. Pasado
 * este rato sin recargas se vuelve a permitir, porque entonces ya es otro
 * despliegue distinto y no el bucle.
 */
export const ESPERA_ENTRE_RECARGAS_MS = 20_000;

export type DecisionRecarga = {
  recargar: boolean;
  /** Para el registro: por qué se ha decidido eso. */
  motivo: "no-es-de-version" | "recarga" | "ya-se-intento";
};

/**
 * Qué hacer ante un error, sabiendo cuándo fue el último intento de recarga.
 *
 * @param ahora            marca de tiempo actual, en milisegundos.
 * @param ultimoIntento    marca del intento anterior, o `null` si no hubo.
 */
export function decidirRecarga({
  error,
  ahora,
  ultimoIntento,
}: {
  error: unknown;
  ahora: number;
  ultimoIntento: number | null;
}): DecisionRecarga {
  if (!esErrorDeVersionVieja(error)) return { recargar: false, motivo: "no-es-de-version" };

  // Una marca del futuro, o ilegible, es basura: se trata como si no hubiera
  // habido intento. Si no, un reloj mal puesto bloquearía la recarga para
  // siempre.
  const valida =
    typeof ultimoIntento === "number" &&
    Number.isFinite(ultimoIntento) &&
    ultimoIntento <= ahora &&
    ahora - ultimoIntento < ESPERA_ENTRE_RECARGAS_MS;

  if (valida) return { recargar: false, motivo: "ya-se-intento" };
  return { recargar: true, motivo: "recarga" };
}
