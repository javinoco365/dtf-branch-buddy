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

function suscribirAncho(avisar: () => void) {
  const mql = window.matchMedia(CONSULTA);
  mql.addEventListener("change", avisar);
  return () => mql.removeEventListener("change", avisar);
}

const anchoDeMovil = () => window.matchMedia(CONSULTA).matches;

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

export function useEsMovil(): { movil: boolean; imprimiendo: boolean } {
  const movil = useSyncExternalStore(suscribirAncho, anchoDeMovil, () => false);
  const imp = useSyncExternalStore(
    suscribirImpresion,
    () => imprimiendo,
    () => false,
  );
  return { movil, imprimiendo: imp };
}
