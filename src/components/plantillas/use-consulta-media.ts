import { useSyncExternalStore } from "react";

/**
 * Si la pantalla cumple una consulta de medios («(min-width: 1280px)»), y
 * avisa cuando cambia. Sirve para pintar una sola vez lo que es caro (el
 * visor del PDF) en vez de dos veces con una de ellas oculta.
 */
export function useConsultaMedia(consulta: string): boolean {
  return useSyncExternalStore(
    (aviso) => {
      const m = window.matchMedia(consulta);
      m.addEventListener("change", aviso);
      return () => m.removeEventListener("change", aviso);
    },
    () => window.matchMedia(consulta).matches,
    () => false,
  );
}
