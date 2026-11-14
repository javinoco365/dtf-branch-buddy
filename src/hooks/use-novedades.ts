import { useCallback, useEffect, useState } from "react";
import { NOVEDADES, cuantasSinVer, guardarVistas, leerVistas } from "@/dominio/novedades";

/** Dónde se guarda, en este dispositivo, lo que ya se ha visto. */
const CLAVE = "crm:novedades-vistas";
/** Aviso a las demás piezas de la misma pestaña (el evento `storage` solo llega a las otras). */
const EVENTO = "crm:novedades-vistas";

function leer(): Set<string> {
  try {
    return leerVistas(window.localStorage.getItem(CLAVE));
  } catch {
    return new Set();
  }
}

/**
 * Las novedades vistas en este dispositivo y cómo marcarlas todas.
 *
 * Antes de montar (en el servidor) no hay nada que leer: se da por visto todo,
 * para que el número del menú no aparezca y desaparezca al cargar.
 */
export function useNovedadesVistas() {
  const [vistas, setVistas] = useState<Set<string> | null>(null);

  useEffect(() => {
    const refrescar = () => setVistas(leer());
    refrescar();
    const alGuardarOtraPestana = (e: StorageEvent) => {
      if (e.key === CLAVE) refrescar();
    };
    window.addEventListener("storage", alGuardarOtraPestana);
    window.addEventListener(EVENTO, refrescar);
    return () => {
      window.removeEventListener("storage", alGuardarOtraPestana);
      window.removeEventListener(EVENTO, refrescar);
    };
  }, []);

  const marcarTodas = useCallback(() => {
    try {
      window.localStorage.setItem(CLAVE, guardarVistas(NOVEDADES));
    } catch {
      // Sin almacenamiento (modo privado): el número volverá a salir. No pasa nada.
    }
    window.dispatchEvent(new Event(EVENTO));
  }, []);

  return { vistas, marcarTodas };
}

/** El número del menú: novedades que no se han visto en este dispositivo. */
export function useAvisoNovedades(): number {
  const { vistas } = useNovedadesVistas();
  return vistas ? cuantasSinVer(NOVEDADES, vistas) : 0;
}
