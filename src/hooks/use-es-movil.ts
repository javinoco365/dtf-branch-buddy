import { useSyncExternalStore } from "react";

/**
 * Si la pantalla es de móvil: por debajo de 768 px, el mismo corte que `md:`
 * de Tailwind, para que lo que se monta con esto cuadre con las clases
 * `md:hidden` / `max-md:hidden`.
 *
 * No es `useIsMobile` (`use-mobile.tsx`): aquel empieza en `false` y pinta
 * primero la vista de ordenador en el móvil, y lo usa la barra lateral. Este
 * lee el ancho al montar, sin esperar a un efecto (el panel no se pinta en el
 * servidor), y sigue los cambios al girar o redimensionar.
 *
 * `imprimiendo`: mientras el navegador prepara la impresión. Al imprimir manda
 * el ancho del papel y no el de la pantalla, así que quien monte solo una vista
 * debe montar las dos y dejar que el CSS elija, como antes.
 */
const CONSULTA = "(max-width: 767px)";
/** Hasta la tablet en vertical: por debajo de 1024 px, el corte de `lg:`. */
export const CONSULTA_TABLET = "(max-width: 1023px)";

// Una pareja de funciones (suscribirse y leer) por consulta, siempre las
// mismas: useSyncExternalStore se vuelve a suscribir si cambian.
const porConsulta = new Map<
  string,
  { suscribir: (avisar: () => void) => () => void; leer: () => boolean }
>();
function funcionesDe(consulta: string) {
  let f = porConsulta.get(consulta);
  if (!f) {
    f = {
      suscribir: (avisar) => {
        const mql = window.matchMedia(consulta);
        mql.addEventListener("change", avisar);
        return () => mql.removeEventListener("change", avisar);
      },
      leer: () => window.matchMedia(consulta).matches,
    };
    porConsulta.set(consulta, f);
  }
  return f;
}

let imprimiendo = false;
function suscribirImpresion(avisar: () => void) {
  const antes = () => {
    imprimiendo = true;
    avisar();
  };
  const despues = () => {
    imprimiendo = false;
    avisar();
  };
  window.addEventListener("beforeprint", antes);
  window.addEventListener("afterprint", despues);
  return () => {
    window.removeEventListener("beforeprint", antes);
    window.removeEventListener("afterprint", despues);
  };
}

/**
 * `consulta`: por omisión, el móvil (< 768 px). Con `CONSULTA_TABLET`, también
 * la tablet en vertical (< 1024 px), para las vistas que allí tampoco caben.
 */
export function useEsMovil(consulta: string = CONSULTA): {
  movil: boolean;
  imprimiendo: boolean;
} {
  const { suscribir, leer } = funcionesDe(consulta);
  const movil = useSyncExternalStore(suscribir, leer, () => false);
  const imp = useSyncExternalStore(
    suscribirImpresion,
    () => imprimiendo,
    () => false,
  );
  return { movil, imprimiendo: imp };
}
