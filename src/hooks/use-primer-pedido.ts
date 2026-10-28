import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { llamarRpcConError } from "@/lib/rpc";
import type { ResumenPrimerPedido } from "@/dominio/primer-pedido";

export type OrigenPedido = "tienda" | "textil";

/** La clave de las consultas del primer pedido: se invalida al decidir. */
export const CLAVE_PRIMER_PEDIDO = "primer-pedido";
const CLAVE = CLAVE_PRIMER_PEDIDO;

/**
 * Para los pedidos que enseña la pantalla, lo que dice la base sobre si son el
 * primero de su cliente (primer_pedido_resumen, que mira TODOS los pedidos de
 * la empresa, no solo los cargados). Mientras la migración 20261103100000 no
 * esté aplicada, o si la consulta falla, no hay etiquetas: la lista sigue igual.
 */
export function usePrimerPedido(origen: OrigenPedido, ids: readonly string[]) {
  const orden = [...ids].sort();
  const { data } = useQuery({
    queryKey: [CLAVE, origen, orden],
    enabled: orden.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const mapa = new Map<string, ResumenPrimerPedido>();
      // De 200 en 200: la URL de la llamada tiene un límite.
      for (let i = 0; i < orden.length; i += 200) {
        const lote = orden.slice(i, i + 200);
        const { data: filas, error } = await llamarRpcConError<
          (ResumenPrimerPedido & { id: string })[]
        >(supabase, "primer_pedido_resumen", {
          _tienda: origen === "tienda" ? lote : [],
          _textil: origen === "textil" ? lote : [],
        });
        if (error) {
          console.warn("[primer pedido]", error.message);
          return mapa;
        }
        for (const f of filas ?? []) mapa.set(f.id, f);
      }
      return mapa;
    },
  });
  return data ?? new Map<string, ResumenPrimerPedido>();
}
