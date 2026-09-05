/**
 * Recargar sola la página cuando se ha desplegado una versión nueva.
 *
 * Aquí va todo lo que toca el navegador: `sessionStorage`, los avisos de Vite
 * y la recarga en sí. La decisión de si hay que recargar o no está en
 * `src/dominio/despliegue.ts`, que se prueba sin navegador.
 *
 * El motivo está explicado allí: con el panel abierto durante un despliegue,
 * el fichero de arranque en memoria pide trozos de código cuyo nombre ya no
 * existe, y la aplicación entera se cae con una pantalla de error.
 */
import { decidirRecarga } from "@/dominio/despliegue";

/**
 * `sessionStorage` y no `localStorage` a propósito: el freno tiene que durar
 * lo que dure la pestaña, no quedarse guardado en el equipo. Y una pestaña
 * nueva empieza limpia, que es lo que se quiere.
 */
const CLAVE = "dtfculture:ultima-recarga-despliegue";

function leerUltimoIntento(): number | null {
  try {
    const guardado = sessionStorage.getItem(CLAVE);
    if (!guardado) return null;
    const valor = Number(guardado);
    return Number.isFinite(valor) ? valor : null;
  } catch {
    // En navegación privada leer sessionStorage puede lanzar. Sin freno se
    // recarga igualmente: es preferible a dejar la pantalla de error puesta.
    return null;
  }
}

function anotarIntento(ahora: number) {
  try {
    sessionStorage.setItem(CLAVE, String(ahora));
  } catch {
    // Si no se puede anotar, el freno no existe. Se acepta: sin sessionStorage
    // tampoco hay bucle, porque cada recarga vuelve a empezar de cero.
  }
}

/**
 * Si el error es de versión vieja y no se ha recargado hace nada, recarga.
 *
 * @returns `true` si ha lanzado la recarga. Quien llama debe entonces pintar
 *          un «Actualizando…» y no la pantalla de error: la página se está
 *          yendo.
 */
export function intentarRecargaPorVersionVieja(error: unknown): boolean {
  if (typeof window === "undefined") return false;

  const ahora = Date.now();
  const { recargar, motivo } = decidirRecarga({
    error,
    ahora,
    ultimoIntento: leerUltimoIntento(),
  });

  if (!recargar) {
    if (motivo === "ya-se-intento") {
      // Que quede en la consola: si alguien ve la pantalla de error después de
      // esto, es que el trozo falta de verdad en el servidor y hay que mirar
      // el despliegue, no la caché del navegador.
      console.error(
        "[Despliegue] El código sigue sin cargar después de recargar. " +
          "No es la caché del navegador: falta un fichero en el servidor.",
        error,
      );
    }
    return false;
  }

  anotarIntento(ahora);
  console.warn("[Despliegue] Hay una versión nueva. Recargando para cogerla.", error);
  window.location.reload();
  return true;
}

/**
 * Engancha los avisos que llegan por fuera de React.
 *
 * - `vite:preloadError` lo lanza Vite cuando no consigue precargar un trozo.
 *   Llamando a `preventDefault()` se evita que además reviente por su cuenta.
 * - `unhandledrejection` recoge los imports que fallan sin que nadie los
 *   atrape, que es lo que pasa al navegar entre secciones.
 *
 * Devuelve la función para desengancharlos.
 */
export function registrarAvisosDeVersionVieja(): () => void {
  if (typeof window === "undefined") return () => {};

  const alPrecargar = (evento: Event) => {
    const error = (evento as Event & { payload?: unknown }).payload ?? evento;
    if (intentarRecargaPorVersionVieja(error)) evento.preventDefault();
  };

  const alRechazar = (evento: PromiseRejectionEvent) => {
    intentarRecargaPorVersionVieja(evento.reason);
  };

  window.addEventListener("vite:preloadError", alPrecargar);
  window.addEventListener("unhandledrejection", alRechazar);

  return () => {
    window.removeEventListener("vite:preloadError", alPrecargar);
    window.removeEventListener("unhandledrejection", alRechazar);
  };
}
