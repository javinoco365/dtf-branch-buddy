/**
 * Lectura de pedidos y líneas por rango de fechas.
 *
 * Un solo sitio para las consultas que alimentan el cuadro de mando y las dos
 * pantallas de facturación, para que las tres midan lo mismo.
 *
 * El alcance lo pone la RLS: un usuario solo ve los pedidos de las tiendas a
 * las que pertenece. Cuando no se pasa `tiendaId`, la consulta devuelve todas
 * las tiendas que la política le permita.
 */

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { faltaLaTabla, tabla } from "@/lib/rpc";
import { ESTADO_CANCELADO, type LineaResumen, type PedidoResumen } from "@/dominio/kpis";
import { cobrosComoPedidos, type CobroFacturable } from "@/dominio/cobros";

const CAMPOS_PEDIDO = "fecha_pedido, tienda_id, estado, subtotal, iva, envio, total, metros_total";

export type RangoFechas = { desde: Date; hasta: Date };

type Filtro = RangoFechas & {
  /** Sin valor, consulta todas las tiendas visibles para el usuario. */
  tiendaId?: string;
};

function claveRango({ desde, hasta, tiendaId }: Filtro) {
  return [desde.toISOString(), hasta.toISOString(), tiendaId ?? "todas"];
}

/** Pedidos del rango, con lo justo para agregar. */
export function usePedidosPeriodo(filtro: Filtro) {
  return useQuery({
    queryKey: ["pedidos-periodo", ...claveRango(filtro)],
    queryFn: async (): Promise<PedidoResumen[]> => {
      let consulta = supabase
        .from("pedidos")
        .select(CAMPOS_PEDIDO)
        .gte("fecha_pedido", filtro.desde.toISOString())
        .lte("fecha_pedido", filtro.hasta.toISOString());

      if (filtro.tiendaId) consulta = consulta.eq("tienda_id", filtro.tiendaId);

      const { data, error } = await consulta;
      if (error) throw error;
      return (data ?? []) as PedidoResumen[];
    },
  });
}

/**
 * Los cobros textil del rango que cuentan como facturación —tarjeta y
 * transferencia; el efectivo va a Caja—, ya con la forma de un pedido para
 * sumarlos junto a los de las tiendas. Se fechan por el día del cobro.
 *
 * `disponible` sale en falso si la migración de cobros todavía no está
 * aplicada: la Consolidada sigue funcionando con las tiendas en vez de caerse
 * entera por una tabla que aún no existe.
 */
export function useCobrosTextilPeriodo(rango: RangoFechas) {
  return useQuery({
    queryKey: ["cobros-textil-periodo", rango.desde.toISOString(), rango.hasta.toISOString()],
    queryFn: async (): Promise<{ disponible: boolean; pedidos: PedidoResumen[] }> => {
      const { data, error } = await tabla(supabase, "cobros")
        .select("fecha, importe, metodo, pedido:textil_pedidos(iva, total)")
        .not("textil_pedido_id", "is", null)
        .in("metodo", ["tarjeta", "transferencia"])
        .gte("fecha", format(rango.desde, "yyyy-MM-dd"))
        .lte("fecha", format(rango.hasta, "yyyy-MM-dd"));

      // Solo «la tabla no existe»; cualquier otro error se enseña.
      if (faltaLaTabla(error)) {
        return { disponible: false, pedidos: [] };
      }
      if (error) throw error;
      return {
        disponible: true,
        pedidos: cobrosComoPedidos((data ?? []) as CobroFacturable[]),
      };
    },
  });
}

/**
 * Líneas de los pedidos del rango, para el desglose por producto.
 *
 * Filtra sobre la tabla incrustada con `!inner`, así que solo bajan las líneas
 * de pedidos que caen en el rango y no están cancelados.
 */
export function useLineasPeriodo(filtro: Filtro) {
  return useQuery({
    queryKey: ["lineas-periodo", ...claveRango(filtro)],
    queryFn: async (): Promise<LineaResumen[]> => {
      let consulta = supabase
        .from("pedido_items")
        .select("descripcion, cantidad, unidad, pedidos!inner(fecha_pedido, tienda_id, estado)")
        .gte("pedidos.fecha_pedido", filtro.desde.toISOString())
        .lte("pedidos.fecha_pedido", filtro.hasta.toISOString())
        .neq("pedidos.estado", ESTADO_CANCELADO);

      if (filtro.tiendaId) consulta = consulta.eq("pedidos.tienda_id", filtro.tiendaId);

      const { data, error } = await consulta;
      if (error) throw error;
      return (data ?? []) as LineaResumen[];
    },
  });
}

/** Tiendas visibles para el usuario, para el desglose consolidado. */
export function useTiendas() {
  return useQuery({
    queryKey: ["tiendas-listado"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tiendas")
        .select("id, nombre, color")
        .order("nombre");
      if (error) throw error;
      return data ?? [];
    },
  });
}
