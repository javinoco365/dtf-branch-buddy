import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Volver a pedir todas las lecturas que han fallado, y saber si se está
 * haciendo: para el botón «Reintentar» de un error que junta varias lecturas
 * (la cuenta de resultados, una pestaña de Gerencia) o cuando quien lo
 * enseña no tiene a mano el `refetch` de su consulta.
 */
export function useReintentarFallidas() {
  const qc = useQueryClient();
  const [reintentando, setReintentando] = useState(false);
  const reintentar = useCallback(() => {
    setReintentando(true);
    void qc
      .refetchQueries({ predicate: (q) => q.state.status === "error" })
      .finally(() => setReintentando(false));
  }, [qc]);
  return { reintentar, reintentando };
}
