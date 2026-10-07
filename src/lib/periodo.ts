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
import { faltaLaColumna, faltaLaTabla, tabla } from "@/lib/rpc";
import { leerTodas } from "@/lib/paginar";
import { ESTADO_CANCELADO, type LineaResumen, type PedidoResumen } from "@/dominio/kpis";
import { TIENDA_TEXTIL, type MetodoCobro } from "@/dominio/cobros";
import { consolidarCobro, type CobroConsolidado, type CriterioFecha } from "@/dominio/facturacion";

const CAMPOS_PEDIDO =
  "fecha_pedido, tienda_id, estado, subtotal, iva, envio, total, metros_total, origen, cliente_id";

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
      // Con sus devoluciones, para restarlas de lo vendido, y con el coste
      // por metro congelado al crear el pedido (ver kpis.ts).
      // Por páginas: Supabase corta en 1000 filas sin avisar (ver paginar.ts).
      const leer = (conCoste: boolean) =>
        leerTodas<unknown>((a, b) => {
          let consulta = tabla(supabase, "pedidos")
            .select(
              `${CAMPOS_PEDIDO}${conCoste ? ", coste_metro_snapshot" : ""}, devoluciones:pedido_devoluciones(importe)`,
            )
            .gte("fecha_pedido", filtro.desde.toISOString())
            .lte("fecha_pedido", filtro.hasta.toISOString());
          if (filtro.tiendaId) consulta = consulta.eq("tienda_id", filtro.tiendaId);
          return consulta.order("id").range(a, b);
        });

      let { data, error } = await leer(true);
      // Sin la migración 20261007100000_cifras_fiables la columna no existe:
      // se lee sin ella y el margen usa el coste actual, como antes.
      if (faltaLaColumna(error)) ({ data, error } = await leer(false));
      if (error) throw error;
      type Fila = PedidoResumen & { devoluciones?: { importe: number | string }[] | null };
      return ((data ?? []) as unknown as Fila[]).map(({ devoluciones, ...p }) => ({
        ...p,
        devuelto: (devoluciones ?? []).reduce((s, d) => s + (Number(d.importe) || 0), 0),
      }));
    },
  });
}

type FilaCobroTienda = {
  id: string;
  fecha: string;
  importe: number | string;
  propina: number | string;
  metodo: MetodoCobro;
  previo: boolean;
  pedido: {
    id: string;
    numero: string;
    fecha_pedido: string;
    tienda_id: string;
    cliente_nombre: string | null;
    total: number | string;
    iva: number | string;
    envio: number | string | null;
    metros_total: number | string | null;
  };
};

type FilaCobroTextil = Omit<FilaCobroTienda, "pedido"> & {
  pedido: {
    id: string;
    numero: string;
    fecha: string;
    cliente_nombre: string | null;
    total: number | string;
    iva: number | string;
    envio: number | string | null;
  };
};

const CAMPOS_COBRO = "id, fecha, importe, propina, metodo, previo";

/**
 * Todos los cobros del rango, de las tiendas y del textil, ya repartidos y
 * fechados según el criterio: por la fecha del pedido (lo vendido en el
 * periodo) o por la del cobro (lo que entró en el periodo).
 *
 * Dos consultas, una por tipo de pedido, porque el pedido de un cobro está en
 * una tabla o en la otra y cada una filtra por su propia fecha. El `!inner`
 * deja en cada una solo los cobros de su tipo.
 *
 * `disponible` sale en falso si la migración de cobros todavía no está
 * aplicada, en vez de romper la pantalla entera.
 */
export function useCobrosPeriodo(rango: RangoFechas, criterio: CriterioFecha) {
  return useQuery({
    queryKey: ["cobros-periodo", criterio, rango.desde.toISOString(), rango.hasta.toISOString()],
    queryFn: async (): Promise<{ disponible: boolean; cobros: CobroConsolidado[] }> => {
      const dia = (d: Date) => format(d, "yyyy-MM-dd");

      let tiendas = tabla(supabase, "cobros").select(
        `${CAMPOS_COBRO}, pedido:pedidos!inner(id, numero, fecha_pedido, tienda_id, cliente_nombre, total, iva, envio, metros_total)`,
      );
      let textil = tabla(supabase, "cobros").select(
        `${CAMPOS_COBRO}, pedido:textil_pedidos!inner(id, numero, fecha, cliente_nombre, total, iva, envio)`,
      );
      if (criterio === "pedido") {
        tiendas = tiendas
          .gte("pedido.fecha_pedido", rango.desde.toISOString())
          .lte("pedido.fecha_pedido", rango.hasta.toISOString());
        textil = textil.gte("pedido.fecha", dia(rango.desde)).lte("pedido.fecha", dia(rango.hasta));
      } else {
        tiendas = tiendas.gte("fecha", dia(rango.desde)).lte("fecha", dia(rango.hasta));
        textil = textil.gte("fecha", dia(rango.desde)).lte("fecha", dia(rango.hasta));
      }

      const [rt, rx] = await Promise.all([
        leerTodas<unknown>((a, b) => tiendas.order("id").range(a, b)),
        leerTodas<unknown>((a, b) => textil.order("id").range(a, b)),
      ]);
      // Solo «la tabla no existe»; cualquier otro error se enseña.
      if (faltaLaTabla(rt.error)) return { disponible: false, cobros: [] };
      if (rt.error) throw rt.error;
      if (rx.error) throw rx.error;

      const deTiendas = ((rt.data ?? []) as FilaCobroTienda[]).map((c) =>
        consolidarCobro(
          {
            ...c,
            tienda_id: c.pedido.tienda_id,
            pedido: {
              id: c.pedido.id,
              numero: c.pedido.numero,
              fecha: c.pedido.fecha_pedido,
              cliente_nombre: c.pedido.cliente_nombre,
              total: c.pedido.total,
              iva: c.pedido.iva,
              envio: c.pedido.envio,
              metros: c.pedido.metros_total,
            },
          },
          criterio,
        ),
      );
      const delTextil = ((rx.data ?? []) as FilaCobroTextil[]).map((c) =>
        consolidarCobro(
          {
            ...c,
            tienda_id: TIENDA_TEXTIL.id,
            pedido: { ...c.pedido, metros: 0 },
          },
          criterio,
        ),
      );
      return { disponible: true, cobros: [...deTiendas, ...delTextil] };
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
      const { data, error } = await leerTodas<unknown>((a, b) => {
        let consulta = tabla(supabase, "pedido_items")
          .select("descripcion, cantidad, unidad, pedidos!inner(fecha_pedido, tienda_id, estado)")
          .gte("pedidos.fecha_pedido", filtro.desde.toISOString())
          .lte("pedidos.fecha_pedido", filtro.hasta.toISOString())
          .neq("pedidos.estado", ESTADO_CANCELADO);
        if (filtro.tiendaId) consulta = consulta.eq("pedidos.tienda_id", filtro.tiendaId);
        return consulta.order("id").range(a, b);
      });
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
