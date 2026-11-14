import { createContext, useContext } from "react";
import type { EstadoQuienSoy, PersonaCuenta } from "@/dominio/quien-soy";

/**
 * Quién está delante cuando una cuenta la usan varios socios. Lo rellena
 * QuienSoyProvider (src/components/QuienSoy.tsx), dentro de AppShell.
 */
export type QuienSoy = {
  estado: EstadoQuienSoy;
  /** La persona elegida (o la única de la cuenta); null si no hay o falta elegir. */
  persona: PersonaCuenta | null;
  elegir: (id: string) => void;
  /** Aún no se sabe qué socios tiene la cuenta: no decidir nada todavía. */
  cargando: boolean;
  /**
   * No se ha podido leer qué socios tiene la cuenta. El CRM sigue (como «sin
   * personas»), pero no se puede firmar nada: quien lo use lo ve y reintenta.
   */
  error: Error | null;
  reintentar: () => void;
};

export const QuienSoyContexto = createContext<QuienSoy>({
  estado: { tipo: "sin-personas" },
  persona: null,
  elegir: () => {},
  cargando: false,
  error: null,
  reintentar: () => {},
});

export const useQuienSoy = () => useContext(QuienSoyContexto);
