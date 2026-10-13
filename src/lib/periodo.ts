/**
 * Lectura de pedidos y líneas por rango de fechas.
 *
 * Un solo sitio para las consultas que alimentan el cuadro de mando y las dos
 * pantallas de facturación, para que las tres midan lo mismo.
 *
 * Los pedidos de tienda entran por su día, el de su ticket, como en la lista
 * de Pedidos (ver dia-pedido.ts), y no por su instante: un pedido web guarda
 * la hora de la web como si fuera UTC, y cortando en la medianoche de Madrid
 * el de las 23:15 del 31 de octubre contaba en noviembre. Se pide a la base un
 * día más por cada lado (tramoDeConsulta) y lo que sobra se quita aquí por el
 * día del pedido. Los días del periodo son los del selector, en la hora del
 * navegador (diasDelRango).
 *
 * El alcance lo pone la RLS: un usuario solo ve los pedidos de las tiendas a
 * las que pertenece. Cuando no se pasa `tiendaId`, la consulta devuelve todas
 * las tiendas que la política le permita.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { faltaLaColumna, faltaLaTabla, tabla } from "@/lib/rpc";
import { leerTodas } from "@/lib/paginar";
import { ESTADO_CANCELADO, type LineaResumen, type PedidoResumen } from "@/dominio/kpis";
import { TIENDA_TEXTIL, type MetodoCobro } from "@/dominio/cobros";
import { consolidarCobro, type CobroConsolidado, type CriterioFecha } from "@/dominio/facturacion";
import { pedidoEnDias, tramoDeConsulta, type FechaPedido } from "@/dominio/dia-pedido";
import { diasDelRango } from "@/dominio/periodos";

const CAMPOS_PEDIDO =
  "id, fecha_pedido, tienda_id, estado, subtotal, iva, envio, total, metros_total, origen, cliente_id";

export type RangoFechas = { desde: Date; hasta: Date };

type Filtro = RangoFechas & {
  /** Sin valor, consulta todas las tiendas visibles para el usuario. */
  tiendaId?: string;
};

function claveRango({ desde, hasta, tiendaId }: Filtro) {
  return [desde.toISOString(), hasta.toISOString(), tiendaId ?? "todas"];
}

/** Pedidos del rango, por su día (ver arriba), con lo justo para agregar. */
export function usePedidosPeriodo(filtro: Filtro) {
  return useQuery({
    queryKey: ["pedidos-periodo", ...claveRango(filtro)],
    queryFn: async (): Promise<PedidoResumen[]> => {
      // Un rango vacío (el de las pantallas que no comparan) no trae nada.
      const dias = diasDelRango(filtro);
      if (!dias) return [];
      const tramo = tramoDeConsulta(dias.desde, dias.hasta);
      // Con sus devoluciones, para restarlas de lo vendido, y con el coste
      // por metro congelado al crear el pedido (ver kpis.ts).
      // Por páginas: Supabase corta en 1000 filas sin avisar (ver paginar.ts).
      const leer = (conCoste: boolean) =>
        leerTodas<unknown>((a, b) => {
          let consulta = tabla(supabase, "pedidos")
            .select(
              `${CAMPOS_PEDIDO}${conCoste ? ", coste_metro_snapshot" : ""}, devoluciones:pedido_devoluciones(importe)`,
            )
            .gte("fecha_pedido", tramo.desde)
            .lt("fecha_pedido", tramo.hasta);
          if (filtro.tiendaId) consulta = consulta.eq("tienda_id", filtro.tiendaId);
          return consulta.order("id").range(a, b);
        });

      let { data, error } = await leer(true);
      // Sin la migración 20261007100000_cifras_fiables la columna no existe:
      // se lee sin ella y el margen usa el coste actual, como antes.
      if (faltaLaColumna(error)) ({ data, error } = await leer(false));
      if (error) throw error;
      type Fila = PedidoResumen & { devoluciones?: { importe: number | string }[] | null };
      return ((data ?? []) as unknown as Fila[])
        .filter((p) => pedidoEnDias(p, dias.desde, dias.hasta))
        .map(({ devoluciones, ...p }) => ({
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
    origen: string | null;
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
 * deja en cada una solo los cobros de su tipo. Por la fecha del pedido, los de
 * tienda van por el día del pedido (ver arriba).
 *
 * `disponible` sale en falso si la migración de cobros todavía no está
 * aplicada, en vez de romper la pantalla entera.
 */
export function useCobrosPeriodo(rango: RangoFechas, criterio: CriterioFecha) {
  return useQuery({
    queryKey: ["cobros-periodo", criterio, rango.desde.toISOString(), rango.hasta.toISOString()],
    queryFn: async (): Promise<{ disponible: boolean; cobros: CobroConsolidado[] }> => {
      // Un rango vacío (el de las pantallas que no comparan) no trae nada.
      const dias = diasDelRango(rango);
      if (!dias) return { disponible: true, cobros: [] };

      let tiendas = tabla(supabase, "cobros").select(
        `${CAMPOS_COBRO}, pedido:pedidos!inner(id, numero, fecha_pedido, origen, tienda_id, cliente_nombre, total, iva, envio, metros_total)`,
      );
      let textil = tabla(supabase, "cobros").select(
        `${CAMPOS_COBRO}, pedido:textil_pedidos!inner(id, numero, fecha, cliente_nombre, total, iva, envio)`,
      );
      if (criterio === "pedido") {
        const tramo = tramoDeConsulta(dias.desde, dias.hasta);
        tiendas = tiendas
          .gte("pedido.fecha_pedido", tramo.desde)
          .lt("pedido.fecha_pedido", tramo.hasta);
        textil = textil.gte("pedido.fecha", dias.desde).lte("pedido.fecha", dias.hasta);
      } else {
        tiendas = tiendas.gte("fecha", dias.desde).lte("fecha", dias.hasta);
        textil = textil.gte("fecha", dias.desde).lte("fecha", dias.hasta);
      }

      const [rt, rx] = await Promise.all([
        leerTodas<unknown>((a, b) => tiendas.order("id").range(a, b)),
        leerTodas<unknown>((a, b) => textil.order("id").range(a, b)),
      ]);
      // Solo «la tabla no existe»; cualquier otro error se enseña.
      if (faltaLaTabla(rt.error)) return { disponible: false, cobros: [] };
      if (rt.error) throw rt.error;
      if (rx.error) throw rx.error;

      // Por la fecha del pedido, sin el día de más por cada lado.
      const filasTiendas = ((rt.data ?? []) as FilaCobroTienda[]).filter(
        (c) => criterio !== "pedido" || pedidoEnDias(c.pedido, dias.desde, dias.hasta),
      );
      const deTiendas = filasTiendas.map((c) =>
        consolidarCobro(
          {
            ...c,
            tienda_id: c.pedido.tienda_id,
            pedido: {
              id: c.pedido.id,
              numero: c.pedido.numero,
              fecha: c.pedido.fecha_pedido,
              origen: c.pedido.origen,
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
 * de pedidos que caen en el rango (con el día de más por cada lado, que se
 * quita aquí) y no están cancelados.
 */
export function useLineasPeriodo(filtro: Filtro) {
  return useQuery({
    queryKey: ["lineas-periodo", ...claveRango(filtro)],
    queryFn: async (): Promise<LineaResumen[]> => {
      const dias = diasDelRango(filtro);
      if (!dias) return [];
      const tramo = tramoDeConsulta(dias.desde, dias.hasta);
      const { data, error } = await leerTodas<LineaResumen & { pedidos: FechaPedido }>((a, b) => {
        let consulta = tabla(supabase, "pedido_items")
          .select(
            "descripcion, cantidad, unidad, pedidos!inner(fecha_pedido, origen, tienda_id, estado)",
          )
          .gte("pedidos.fecha_pedido", tramo.desde)
          .lt("pedidos.fecha_pedido", tramo.hasta)
          .neq("pedidos.estado", ESTADO_CANCELADO);
        if (filtro.tiendaId) consulta = consulta.eq("pedidos.tienda_id", filtro.tiendaId);
        return consulta.order("id").range(a, b);
      });
      if (error) throw error;
      return data.filter((l) => pedidoEnDias(l.pedidos, dias.desde, dias.hasta));
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
