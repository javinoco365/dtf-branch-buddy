/**
 * Los datos del Resumen diario de Gerencia.
 *
 * Solo lectura y con la RLS del usuario, como el resto de Gerencia. Se lee
 * una vez el tramo entero (el periodo y el de comparación, que van seguidos)
 * y el Resumen de cada uno se calcula en el navegador (resumen-diario.ts):
 * cambiar la jornada o los metros por hora recalcula sin volver a leer.
 *
 * Qué pedidos hacen falta:
 * - los pedidos con fecha en el tramo (lo pedido);
 * - los realizados desde el principio del tramo, sean del día que sean (lo
 *   realizado, y la cola de un periodo pasado: lo que se hizo después);
 * - los que siguen abiertos (la cola de hoy).
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { faltaLaColumna, faltaLaTabla, tabla } from "@/lib/rpc";
import { leerTodas, trozos } from "@/lib/paginar";
import { useFiscal } from "@/lib/gerencia";
import { TIENDA_TEXTIL } from "@/dominio/cobros";
import { apuntesDeVenta } from "@/dominio/canjes";
import { tramoDeConsulta } from "@/dominio/dia-pedido";
import { diasDelRango, type Rango } from "@/dominio/periodos";
import { ventaDeTextil, ventaDeTienda } from "@/dominio/gerencia";
import { costePorPedido, type MovimientoCoste } from "@/dominio/textil";
import type { PedidoResumen } from "@/dominio/kpis";
import type {
  CobroParaResumen,
  DocumentoParaResumen,
  PedidoParaResumen,
} from "@/dominio/resumen-diario";

const ABIERTOS = ["pendiente", "en_produccion", "imprimiendo", "listo"];

const CAMPOS_PEDIDO =
  "id, fecha_pedido, tienda_id, estado, subtotal, iva, envio, total, metros_total, origen, cliente_id, coste_metro_snapshot, devoluciones:pedido_devoluciones(importe)";
const CAMPOS_TEXTIL = "id, fecha, estado, subtotal, iva, envio, total, cliente_id, marca_id";
/** Columnas de la migración 20261027100000_pedidos_realizado. */
const CAMPOS_REALIZADO = "realizado_en, coste_envio_real";

type Error_ = { code?: string; message: string } | null;
type FilaTienda = PedidoResumen & {
  id: string;
  realizado_en?: string | null;
  coste_envio_real?: number | string | null;
  devoluciones?: { importe: number | string }[] | null;
};
type FilaTextil = {
  id: string;
  fecha: string;
  estado: string;
  subtotal: number | string | null;
  iva: number | string | null;
  envio: number | string | null;
  total: number | string | null;
  cliente_id: string | null;
  marca_id: string | null;
  realizado_en?: string | null;
  coste_envio_real?: number | string | null;
};

export type DatosResumen = {
  pedidos: PedidoParaResumen[];
  cobros: CobroParaResumen[];
  /** Falso si la migración 20261027100000_pedidos_realizado no está aplicada. */
  conRealizado: boolean;
  /** Falso si la tabla de cobros no existe todavía. */
  conCobros: boolean;
};

/** Lee las tres consultas de una tabla y junta las filas sin repetir. */
async function leerTres<T extends { id: string }>(
  consultas: (() => PromiseLike<{ data: T[]; error: Error_ }>)[],
): Promise<{ data: T[]; error: Error_ }> {
  const r = await Promise.all(consultas.map((c) => c()));
  const error = r.find((x) => x.error)?.error ?? null;
  if (error) return { data: [], error };
  const porId = new Map<string, T>();
  for (const x of r) for (const f of x.data) porId.set(f.id, f);
  return { data: [...porId.values()], error: null };
}

async function leerPedidosTienda(desde: string, hasta: string, conRealizado: boolean) {
  const tramo = tramoDeConsulta(desde, hasta);
  const campos = `${CAMPOS_PEDIDO}${conRealizado ? `, ${CAMPOS_REALIZADO}` : ""}`;
  const base = () => tabla(supabase, "pedidos").select(campos);
  const consultas = [
    () =>
      leerTodas<FilaTienda>((a, b) =>
        base()
          .gte("fecha_pedido", tramo.desde)
          .lt("fecha_pedido", tramo.hasta)
          .order("id")
          .range(a, b),
      ),
    () =>
      leerTodas<FilaTienda>((a, b) =>
        base().in("estado", ABIERTOS).lt("fecha_pedido", tramo.hasta).order("id").range(a, b),
      ),
  ];
  if (conRealizado) {
    consultas.push(() =>
      leerTodas<FilaTienda>((a, b) =>
        base()
          .gte("realizado_en", tramo.desde)
          .lt("fecha_pedido", tramo.hasta)
          .order("id")
          .range(a, b),
      ),
    );
  }
  return leerTres<FilaTienda>(consultas);
}

async function leerPedidosTextil(desde: string, hasta: string, conRealizado: boolean) {
  const tramo = tramoDeConsulta(desde, hasta);
  const campos = `${CAMPOS_TEXTIL}${conRealizado ? `, ${CAMPOS_REALIZADO}` : ""}`;
  const base = () => tabla(supabase, "textil_pedidos").select(campos);
  const consultas = [
    () =>
      leerTodas<FilaTextil>((a, b) =>
        base().gte("fecha", desde).lte("fecha", hasta).order("id").range(a, b),
      ),
    () =>
      leerTodas<FilaTextil>((a, b) =>
        base().in("estado", ABIERTOS).lte("fecha", hasta).order("id").range(a, b),
      ),
  ];
  if (conRealizado) {
    consultas.push(() =>
      leerTodas<FilaTextil>((a, b) =>
        base().gte("realizado_en", tramo.desde).lte("fecha", hasta).order("id").range(a, b),
      ),
    );
  }
  return leerTres<FilaTextil>(consultas);
}

/** Lo cobrado de cada pedido (con IVA, sin propinas), sea cuando sea. */
async function cobradoPorPedido(
  columna: "pedido_id" | "textil_pedido_id",
  ids: readonly string[],
): Promise<Map<string, number>> {
  const total = new Map<string, number>();
  for (const trozo of trozos(ids)) {
    const r = await leerTodas<Record<string, string | number>>((a, b) =>
      tabla(supabase, "cobros")
        .select(`id, ${columna}, importe`)
        .in(columna, trozo)
        .order("id")
        .range(a, b),
    );
    if (r.error) throw new Error(r.error.message);
    for (const c of r.data) {
      const id = c[columna] as string;
      total.set(id, (total.get(id) ?? 0) + (Number(c.importe) || 0));
    }
  }
  return total;
}

/** Los pedidos de tienda con número de seguimiento: llevan envío. */
async function conSeguimiento(ids: readonly string[]): Promise<Set<string>> {
  const r = new Set<string>();
  for (const trozo of trozos(ids)) {
    const x = await tabla(supabase, "enlaces_seguimiento")
      .select("pedido_id")
      .in("pedido_id", trozo);
    if (x.error) throw new Error(x.error.message);
    for (const f of (x.data ?? []) as { pedido_id: string }[]) r.add(f.pedido_id);
  }
  return r;
}

/** Lo que costó la ropa que salió del almacén para cada pedido textil. */
async function costeTextil(ids: readonly string[]): Promise<Map<string, number> | null> {
  const movs: MovimientoCoste[] = [];
  for (const trozo of trozos(ids)) {
    const r = await tabla(supabase, "textil_stock_movimientos")
      .select("textil_pedido_id, motivo, cantidad, coste_unitario")
      .in("textil_pedido_id", trozo)
      .in("motivo", ["venta", "devolucion_cliente"]);
    // Sin la migración del almacén no hay coste: el textil va sin él.
    if (faltaLaTabla(r.error)) return null;
    if (r.error) throw new Error(r.error.message);
    movs.push(...((r.data ?? []) as MovimientoCoste[]));
  }
  return costePorPedido(movs);
}

/** Los cobros con fecha en el tramo, de tienda y del textil, por negocio. */
async function cobrosDelTramo(desde: string, hasta: string) {
  return leerTodas<{
    id: string;
    fecha: string;
    importe: number | string;
    pedido: { tienda_id: string } | null;
    textil_pedido_id: string | null;
  }>((a, b) =>
    tabla(supabase, "cobros")
      .select("id, fecha, importe, textil_pedido_id, pedido:pedidos(tienda_id)")
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("id")
      .range(a, b),
  );
}

/**
 * Pedidos y cobros del tramo para el Resumen. `tramo` va del primer día del
 * periodo de comparación (si lo hay) al último del periodo.
 */
export function useDatosResumen(tramo: Rango) {
  const dias = diasDelRango(tramo);
  return useQuery({
    queryKey: ["gerencia", "resumen-diario", dias?.desde, dias?.hasta],
    enabled: !!dias,
    queryFn: async (): Promise<DatosResumen> => {
      const { desde, hasta } = dias!;
      let conRealizado = true;
      let [t, x] = await Promise.all([
        leerPedidosTienda(desde, hasta, true),
        leerPedidosTextil(desde, hasta, true),
      ]);
      // Sin la migración del Resumen: se lee sin las columnas nuevas.
      if (faltaLaColumna(t.error) || faltaLaColumna(x.error)) {
        conRealizado = false;
        [t, x] = await Promise.all([
          leerPedidosTienda(desde, hasta, false),
          leerPedidosTextil(desde, hasta, false),
        ]);
      }
      if (t.error) throw new Error(t.error.message);
      if (x.error) throw new Error(x.error.message);

      const idsTienda = t.data.map((p) => p.id);
      const idsTextil = x.data.map((p) => p.id);
      const cobrosTramo = await cobrosDelTramo(desde, hasta);
      const conCobros = !faltaLaTabla(cobrosTramo.error);
      if (cobrosTramo.error && conCobros) throw new Error(cobrosTramo.error.message);
      const [cobradoTienda, cobradoTextil, seguimiento, costes] = await Promise.all([
        conCobros ? cobradoPorPedido("pedido_id", idsTienda) : new Map<string, number>(),
        conCobros ? cobradoPorPedido("textil_pedido_id", idsTextil) : new Map<string, number>(),
        conSeguimiento(idsTienda),
        costeTextil(idsTextil),
      ]);

      const pedidos: PedidoParaResumen[] = [
        ...t.data.map(({ devoluciones, realizado_en, coste_envio_real, ...p }) => ({
          ...ventaDeTienda({
            ...p,
            devuelto: (devoluciones ?? []).reduce((s, d) => s + (Number(d.importe) || 0), 0),
          }),
          id: p.id,
          negocio: p.tienda_id,
          realizado_en: realizado_en ?? null,
          coste_envio_real: coste_envio_real ?? null,
          con_envio: (Number(p.envio) || 0) > 0 || seguimiento.has(p.id),
          cobrado: cobradoTienda.get(p.id) ?? 0,
        })),
        ...x.data.map((p) => ({
          ...ventaDeTextil({ ...p, coste: costes ? (costes.get(p.id) ?? null) : null }),
          id: p.id,
          negocio: TIENDA_TEXTIL.id,
          realizado_en: p.realizado_en ?? null,
          coste_envio_real: p.coste_envio_real ?? null,
          con_envio: (Number(p.envio) || 0) > 0,
          cobrado: cobradoTextil.get(p.id) ?? 0,
        })),
      ];
      const cobros: CobroParaResumen[] = cobrosTramo.data.map((c) => ({
        negocio: c.textil_pedido_id ? TIENDA_TEXTIL.id : (c.pedido?.tienda_id ?? ""),
        fecha: c.fecha,
        importe: c.importe,
      }));
      return { pedidos, cobros, conRealizado, conCobros };
    },
  });
}

/**
 * Lo facturado del tramo: tickets, facturas y rectificativas emitidos, cada
 * uno en su fecha y con los canjes de ticket por factura casados (el ticket
 * cuenta una vez), igual que en la pestaña Fiscal. En base imponible.
 */
export function useDocumentosResumen(tramo: Rango) {
  const fiscal = useFiscal(tramo);
  const data: DocumentoParaResumen[] | undefined = fiscal.data
    ? apuntesDeVenta(fiscal.data.documentos, fiscal.data.referencias).map((a) => ({
        negocio: a.documento.tienda_id,
        fecha: a.documento.fecha,
        base: a.signo * (Number(a.importes.base) || 0),
      }))
    : undefined;
  return { data, error: fiscal.error, isPending: fiscal.isPending };
}
