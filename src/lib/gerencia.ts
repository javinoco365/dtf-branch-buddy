/**
 * Los datos del panel de Gerencia.
 *
 * Solo lectura y siempre con la RLS del usuario. Usan las mismas claves de
 * caché que las pantallas de Caja, Cobros pendientes y Conciliación, así que
 * lo que ya se leyó allí no se vuelve a pedir.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import {
  faltaLaColumna,
  faltaLaFuncion,
  faltaLaTabla,
  filasDeFuncion,
  llamarRpc,
  llamarRpcConError,
  tabla,
} from "@/lib/rpc";
import { enParalelo, leerTodas, PETICIONES_A_LA_VEZ, trozos } from "@/lib/paginar";
import { leerPorIds } from "@/lib/leer-por-ids";
import { usePedidosPeriodo, type RangoFechas } from "@/lib/periodo";
import { listarMovimientosCaja } from "@/lib/caja.functions";
import { listMovimientosBanco } from "@/lib/banco.functions";
import { leerAjustesGerencia } from "@/lib/gerencia.functions";
import {
  ventaDeTextil,
  ventaDeTienda,
  type MovimientoBancoResumen,
  type PedidoTextilResumen,
  type Venta,
} from "@/dominio/gerencia";
import type { PedidoPendiente } from "@/dominio/pendientes";
import type { VentaCliente } from "@/dominio/clientela";
import type { PresupuestoResumen } from "@/dominio/comercial";
import { ESTADOS_ABIERTOS, type EnvioPedido, type PedidoTaller } from "@/dominio/produccion";
import { TIENDA_TEXTIL } from "@/dominio/cobros";
import {
  costePorPedido,
  type ArticuloStock,
  type LineaTextil,
  type MovimientoCoste,
} from "@/dominio/textil";
import type { CompraResumen, DocumentoDePedido, DocumentoFiscal } from "@/dominio/fiscal";
import { comprasQueCuentan } from "@/dominio/compras";
import { valorAFecha, valorMovimiento, type MovimientoAlmacen } from "@/dominio/cuenta-almacen";
import {
  controlComprasEntradas,
  resumenControles,
  type ResumenControles,
  type CompraControl,
  type ControlCompras,
  type EntradaControl,
} from "@/dominio/controles-almacen";
import type { CompraPendiente } from "@/dominio/pagos-proveedores";
import type { ProformaFila } from "@/dominio/proformas";
import { proformasAplicado } from "@/lib/escaner-textil";
import { sumarImportes } from "@/dominio/sumatorios";
import { diaEnEspana } from "@/dominio/fecha-documento";
import { diasDelRango } from "@/dominio/periodos";

const dia = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * Pedidos textil del rango, con lo justo para agregar y lo que costó la ropa
 * que salió del almacén para cada uno (ver costePorPedido).
 */
function useTextilPeriodo(rango: RangoFechas) {
  return useQuery({
    queryKey: ["textil-periodo", dia(rango.desde), dia(rango.hasta)],
    queryFn: async (): Promise<PedidoTextilResumen[]> => {
      // Un rango vacío (el del periodo anterior cuando no se compara) no trae
      // nada, igual que usePedidosPeriodo y useCobrosPeriodo. Se corta aquí y
      // no con `enabled: false`: así `data` llega (vacía) y quien espera a las
      // ventas previas no se queda cargando para siempre.
      if (!diasDelRango(rango)) return [];
      const { data, error } = await leerTodas<PedidoTextilResumen & { id: string }>((a, b) =>
        tabla(supabase, "textil_pedidos")
          .select("id, fecha, estado, subtotal, iva, envio, total, cliente_id, marca_id")
          .gte("fecha", dia(rango.desde))
          .lte("fecha", dia(rango.hasta))
          .order("id")
          .range(a, b),
      );
      if (error) throw error;

      // Los trozos se piden a la vez y se recorren en su orden, con la misma
      // regla que en serie: el primer trozo que falla decide. Si dice que
      // falta la tabla del almacén, ningún pedido lleva coste (no se mezclan
      // trozos con y sin él); si es otro error, se lanza.
      const respuestas = await enParalelo(
        trozos(data.map((p) => p.id)),
        PETICIONES_A_LA_VEZ,
        async (trozo) =>
          await tabla(supabase, "textil_stock_movimientos")
            .select("textil_pedido_id, motivo, cantidad, coste_unitario")
            .in("textil_pedido_id", trozo)
            .in("motivo", ["venta", "devolucion_cliente"]),
      );
      const movs: MovimientoCoste[] = [];
      let conAlmacen = true;
      for (const r of respuestas) {
        // Sin la migración del almacén no hay coste: el textil va sin él.
        if (faltaLaTabla(r.error)) {
          conAlmacen = false;
          break;
        }
        if (r.error) throw new Error(r.error.message);
        movs.push(...((r.data ?? []) as MovimientoCoste[]));
      }
      const costes = costePorPedido(movs);
      return data.map((p) => ({ ...p, coste: conAlmacen ? (costes.get(p.id) ?? null) : null }));
    },
  });
}

/** Todo lo vendido en el rango: pedidos de todas las tiendas y del textil. */
export function useVentasGerencia(rango: RangoFechas) {
  const tiendas = usePedidosPeriodo(rango);
  const textil = useTextilPeriodo(rango);
  const data = useMemo<Venta[] | undefined>(
    () =>
      tiendas.data && textil.data
        ? [...tiendas.data.map(ventaDeTienda), ...textil.data.map(ventaDeTextil)]
        : undefined,
    [tiendas.data, textil.data],
  );
  return {
    data,
    isPending: tiendas.isPending || textil.isPending,
    error: tiendas.error ?? textil.error,
  };
}

/** Lo que se debe hoy: la misma vista y la misma caché que Cobros pendientes. */
export function usePendientesCobro() {
  return useQuery({
    queryKey: ["cobros-pendientes-pedidos", "todas"],
    queryFn: async (): Promise<{ disponible: boolean; pedidos: PedidoPendiente[] }> => {
      const { data, error } = await leerTodas<PedidoPendiente>((a, b) =>
        tabla(supabase, "pedidos_pendientes_cobro")
          .select("*")
          .order("tipo")
          .order("id")
          .range(a, b),
      );
      if (faltaLaTabla(error)) return { disponible: false, pedidos: [] };
      if (error) throw error;
      return { disponible: true, pedidos: (data ?? []) as PedidoPendiente[] };
    },
  });
}

/** Los apuntes de caja del rango, como los lee la pantalla de Caja. */
export function useCajaPeriodo(rango: RangoFechas) {
  const listar = useServerFn(listarMovimientosCaja);
  const desde = dia(rango.desde);
  const hasta = dia(rango.hasta);
  return useQuery({
    queryKey: ["caja", desde, hasta],
    queryFn: () => listar({ data: { desde, hasta } }),
  });
}

/** Los movimientos del banco del rango, con si están casados o no. */
export function useBancoPeriodo(rango: RangoFechas) {
  const listar = useServerFn(listMovimientosBanco);
  const consulta = useQuery({ queryKey: ["banco-movimientos"], queryFn: () => listar() });
  const desde = dia(rango.desde);
  const hasta = dia(rango.hasta);
  const data = useMemo<MovimientoBancoResumen[] | undefined>(
    () =>
      (
        consulta.data as
          { fecha: string; importe: number | string; conciliacion?: unknown }[] | undefined
      )
        ?.filter((m) => m.fecha >= desde && m.fecha <= hasta)
        .map((m) => ({
          fecha: m.fecha,
          importe: m.importe,
          conciliado: Array.isArray(m.conciliacion)
            ? m.conciliacion.length > 0
            : m.conciliacion != null,
        })),
    [consulta.data, desde, hasta],
  );
  return { data, isPending: consulta.isPending, error: consulta.error };
}

/**
 * El coste por metro de hoy (consumibles + packaging + electricidad). Misma
 * consulta y misma caché que el dashboard.
 */
export function useCosteMetroActual(): number {
  const { data } = useQuery({
    queryKey: ["empresa_costes"],
    queryFn: async () => {
      const { data } = await tabla(supabase, "empresas")
        .select("coste_consumibles_metro, coste_packaging_metro, coste_electricidad_metro")
        .eq("activa", true)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      return data;
    },
  });
  return (
    Number(data?.coste_consumibles_metro ?? 0) +
    Number(data?.coste_packaging_metro ?? 0) +
    Number(data?.coste_electricidad_metro ?? 0)
  );
}

/** Gastos fijos, objetivos y ajustes de Gerencia. */
export function useAjustesGerencia() {
  const leer = useServerFn(leerAjustesGerencia);
  return useQuery({ queryKey: ["gerencia-ajustes"], queryFn: () => leer() });
}

// ---------------------------------------------------------------------------
// Clientes, Comercial y Producción. Cada pestaña lee lo suyo solo cuando se
// abre: las pestañas cerradas no se montan.
// ---------------------------------------------------------------------------

const canalDeOrigen = (origen: string | null | undefined) =>
  origen === "woocommerce" ? ("web" as const) : ("manual" as const);

type FilaHistorialTienda = PedidoResumenFila & {
  cliente_nombre: string | null;
  devoluciones?: { importe: number | string }[] | null;
};
type PedidoResumenFila = Parameters<typeof ventaDeTienda>[0];

/**
 * Todos los pedidos de la historia, de tiendas y textil, con su cliente. Hace
 * falta la historia entera para saber quién es nuevo y quién lleva tiempo
 * sin pedir.
 */
export function useHistorialClientes() {
  return useQuery({
    queryKey: ["gerencia-historial-clientes"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<VentaCliente[]> => {
      const [t, x] = await Promise.all([
        leerTodas<FilaHistorialTienda>((a, b) =>
          tabla(supabase, "pedidos")
            .select(
              "id, fecha_pedido, tienda_id, estado, subtotal, iva, envio, total, metros_total, origen, cliente_id, cliente_nombre, devoluciones:pedido_devoluciones(importe)",
            )
            .order("id")
            .range(a, b),
        ),
        leerTodas<PedidoTextilResumen & { cliente_nombre: string | null }>((a, b) =>
          tabla(supabase, "textil_pedidos")
            .select("id, fecha, estado, subtotal, iva, envio, total, cliente_id, cliente_nombre")
            .order("id")
            .range(a, b),
        ),
      ]);
      if (t.error) throw new Error(t.error.message);
      if (x.error) throw new Error(x.error.message);
      return [
        ...t.data.map(({ devoluciones, cliente_nombre, ...p }) => ({
          ...ventaDeTienda({
            ...p,
            devuelto: (devoluciones ?? []).reduce((s, d) => s + (Number(d.importe) || 0), 0),
          }),
          cliente_nombre,
        })),
        ...x.data.map((p) => ({ ...ventaDeTextil(p), cliente_nombre: p.cliente_nombre })),
      ];
    },
  });
}

export type DatosComercial = {
  /** Falso si la migración de presupuestos de tienda no está aplicada. */
  tiendasDisponible: boolean;
  /** Los del periodo, por su fecha. */
  periodo: PresupuestoResumen[];
  /** Todos los enviados sin respuesta, sean del periodo que sean. */
  enviados: PresupuestoResumen[];
};

type FilaPresupuesto = Omit<PresupuestoResumen, "tienda_id" | "fecha_pedido"> & {
  tienda_id?: string;
  pedido_id?: string | null;
};

/** Las fechas de los pedidos creados desde presupuestos, por su id. */
async function fechasDePedidos(
  nombre: "pedidos" | "textil_pedidos",
  ids: string[],
): Promise<Map<string, string>> {
  const campo = nombre === "pedidos" ? "fecha_pedido" : "fecha";
  const mapa = new Map<string, string>();
  // Trozos a la vez; se juntan en su orden y se lanza el primer error en
  // orden, como en serie.
  const respuestas = await enParalelo(
    trozos([...new Set(ids)]),
    PETICIONES_A_LA_VEZ,
    async (trozo) => await tabla(supabase, nombre).select(`id, ${campo}`).in("id", trozo),
  );
  for (const { data, error } of respuestas) {
    if (error) throw new Error(error.message);
    for (const f of (data ?? []) as Record<string, string>[]) mapa.set(f.id, f[campo]);
  }
  return mapa;
}

/** Presupuestos de tiendas y textil: los del periodo y los que esperan respuesta. */
export function useComercial(rango: RangoFechas) {
  const desde = dia(rango.desde);
  const hasta = dia(rango.hasta);
  return useQuery({
    queryKey: ["gerencia-comercial", desde, hasta],
    queryFn: async (): Promise<DatosComercial> => {
      const campos = "id, numero, fecha, estado, total, validez_dias, cliente_nombre";
      const leer = (nombre: string, extra: string) =>
        leerTodas<FilaPresupuesto>((a, b) =>
          tabla(supabase, nombre)
            .select(`${campos}${extra}`)
            .or(`and(fecha.gte.${desde},fecha.lte.${hasta}),estado.eq.enviado`)
            .order("id")
            .range(a, b),
        );

      // Tiendas y textil a la vez; los errores se miran en el mismo orden que
      // antes (primero tiendas).
      let [tiendas, textil] = await Promise.all([
        leer("presupuestos", ", tienda_id, pedido_id"),
        leer("textil_presupuestos", ", pedido_id"),
      ]);
      const tiendasDisponible = !faltaLaTabla(tiendas.error);
      if (!tiendasDisponible) tiendas = { data: [], error: null };
      if (tiendas.error) throw new Error(tiendas.error.message);

      // El enlace del presupuesto textil con su pedido llegó en una migración
      // posterior: sin ella se leen igual, sin días hasta el pedido.
      if (faltaLaColumna(textil.error)) textil = await leer("textil_presupuestos", "");
      if (textil.error) throw new Error(textil.error.message);

      const conPedido = (filas: FilaPresupuesto[]) =>
        filas.filter((f) => f.pedido_id).map((f) => f.pedido_id as string);
      const [fechasTienda, fechasTextil] = await Promise.all([
        fechasDePedidos("pedidos", conPedido(tiendas.data)),
        fechasDePedidos("textil_pedidos", conPedido(textil.data)),
      ]);

      const todos: PresupuestoResumen[] = [
        ...tiendas.data.map(({ pedido_id, ...p }) => ({
          ...p,
          tienda_id: p.tienda_id ?? "",
          fecha_pedido: pedido_id ? (fechasTienda.get(pedido_id) ?? null) : null,
        })),
        ...textil.data.map(({ pedido_id, ...p }) => ({
          ...p,
          tienda_id: TIENDA_TEXTIL.id,
          fecha_pedido: pedido_id ? (fechasTextil.get(pedido_id) ?? null) : null,
        })),
      ];
      return {
        tiendasDisponible,
        periodo: todos.filter((p) => p.fecha >= desde && p.fecha <= hasta),
        enviados: todos.filter((p) => p.estado === "enviado"),
      };
    },
  });
}

/** Los pedidos que todavía no han salido del taller, de cualquier fecha. */
export function useTaller() {
  return useQuery({
    queryKey: ["gerencia-taller"],
    queryFn: async (): Promise<PedidoTaller[]> => {
      const [t, x] = await Promise.all([
        leerTodas<{
          fecha_pedido: string;
          estado: string;
          tienda_id: string;
          origen: string | null;
          metros_total: number | string | null;
          total: number | string | null;
        }>((a, b) =>
          tabla(supabase, "pedidos")
            .select("id, fecha_pedido, estado, tienda_id, origen, metros_total, total")
            .in("estado", [...ESTADOS_ABIERTOS])
            .order("id")
            .range(a, b),
        ),
        leerTodas<{ fecha: string; estado: string; total: number | string | null }>((a, b) =>
          tabla(supabase, "textil_pedidos")
            .select("id, fecha, estado, total")
            .in("estado", [...ESTADOS_ABIERTOS])
            .order("id")
            .range(a, b),
        ),
      ]);
      if (t.error) throw new Error(t.error.message);
      if (x.error) throw new Error(x.error.message);
      return [
        ...t.data.map((p) => ({
          fecha_pedido: p.fecha_pedido,
          estado: p.estado,
          tienda_id: p.tienda_id,
          canal: canalDeOrigen(p.origen),
          metros_total: p.metros_total,
          total: p.total,
        })),
        ...x.data.map((p) => ({
          fecha_pedido: `${p.fecha.slice(0, 10)}T12:00:00`,
          estado: p.estado,
          tienda_id: TIENDA_TEXTIL.id,
          canal: "textil" as const,
          metros_total: 0,
          total: p.total,
        })),
      ];
    },
  });
}

/**
 * Los pedidos de tienda enviados en el rango: los que recibieron su primer
 * enlace de seguimiento en esas fechas. El textil no guarda cuándo se envió.
 */
export function useEnvios(rango: RangoFechas) {
  const desde = rango.desde.toISOString();
  const hasta = rango.hasta.toISOString();
  return useQuery({
    queryKey: ["gerencia-envios", desde, hasta],
    queryFn: async (): Promise<EnvioPedido[]> => {
      const enlaces = await leerTodas<{ pedido_id: string; created_at: string }>((a, b) =>
        tabla(supabase, "enlaces_seguimiento")
          .select("id, pedido_id, created_at")
          .gte("created_at", desde)
          .lte("created_at", hasta)
          .order("id")
          .range(a, b),
      );
      if (enlaces.error) throw new Error(enlaces.error.message);

      // El primero de cada pedido dentro del rango.
      const primero = new Map<string, string>();
      for (const e of enlaces.data) {
        const antes = primero.get(e.pedido_id);
        if (!antes || e.created_at < antes) primero.set(e.pedido_id, e.created_at);
      }
      const ids = [...primero.keys()];
      type FilaPedido = {
        id: string;
        fecha_pedido: string;
        tienda_id: string;
        origen: string | null;
      };
      const pedidos = new Map<string, FilaPedido>();
      // Los trozos a la vez (cada uno con sus dos consultas); se recorren en
      // su orden, con el mismo orden de errores que en serie.
      const respuestas = await enParalelo(trozos(ids), PETICIONES_A_LA_VEZ, (trozo) =>
        // Si el pedido ya tenía un seguimiento de antes, no se envió en el rango.
        Promise.all([
          tabla(supabase, "pedidos").select("id, fecha_pedido, tienda_id, origen").in("id", trozo),
          tabla(supabase, "enlaces_seguimiento")
            .select("pedido_id")
            .in("pedido_id", trozo)
            .lt("created_at", desde),
        ]),
      );
      for (const [p, previos] of respuestas) {
        if (p.error) throw new Error(p.error.message);
        if (previos.error) throw new Error(previos.error.message);
        const yaEnviados = new Set(
          ((previos.data ?? []) as { pedido_id: string }[]).map((x) => x.pedido_id),
        );
        for (const f of (p.data ?? []) as FilaPedido[]) {
          if (!yaEnviados.has(f.id)) pedidos.set(f.id, f);
        }
      }
      return [...pedidos.entries()].map(([id, p]) => ({
        fecha_pedido: p.fecha_pedido,
        enviado_en: primero.get(id)!,
        tienda_id: p.tienda_id,
        canal: canalDeOrigen(p.origen),
      }));
    },
  });
}

// ---------------------------------------------------------------------------
// Margen, Fiscal y Textil
// ---------------------------------------------------------------------------

/** Una clave corta para una lista de ids: cambia si cambia la lista. */
function claveIds(ids: readonly string[]): string {
  let h = 0;
  for (const id of ids) for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return `${ids.length}:${h}`;
}

export type HuecoSerie = { serie: string; ejercicio: number; numero_ausente: number };

export type DatosFiscal = {
  /** Los emitidos y borradores con fecha en el rango. */
  documentos: DocumentoFiscal[];
  /**
   * Los de fuera del rango que hacen falta para casar los canjes de ticket
   * por factura de los del rango: el ticket de cada factura de canje y la
   * factura (y su ticket) de cada rectificativa. Solo se miran: no cuentan.
   */
  referencias: DocumentoFiscal[];
  /** Nulo si la tabla de compras no existe todavía. */
  compras: CompraResumen[] | null;
  huecos: HuecoSerie[];
};

const CAMPOS_COMPRA = "id, estado, fecha, base, iva, total";
/** Columnas de la migración 20261013100000_compras_generales. */
const CAMPOS_COMPRA_GENERAL = "irpf, categoria, gasto_id";
/** Columnas de la migración 20261014100000_compras_recibidas. */
const CAMPOS_COMPRA_RECIBIDA = "cuota_iva, cuota_irpf, liquido, liquido_origen, borrada_en";
/**
 * De la más nueva a la más vieja: se queda con la primera que la base conoce.
 * La primera, con las migraciones de proformas (20261029…): `tipo_documento`,
 * para que la proforma no cuente (importesDeCompra). Va delante de las de
 * siempre, que se quedan: sin ella, la cadena sigue cayendo a la de recibidas.
 */
const CAMPOS_COMPRA_POR_MIGRACION = [
  `${CAMPOS_COMPRA}, ${CAMPOS_COMPRA_GENERAL}, ${CAMPOS_COMPRA_RECIBIDA}, tipo_documento`,
  `${CAMPOS_COMPRA}, ${CAMPOS_COMPRA_GENERAL}, ${CAMPOS_COMPRA_RECIBIDA}`,
  `${CAMPOS_COMPRA}, ${CAMPOS_COMPRA_GENERAL}`,
  CAMPOS_COMPRA,
];

/** Lee compras con las columnas más nuevas que existan. */
async function leerCompras(
  consulta: (
    campos: string,
  ) => Promise<{ data: CompraResumen[]; error: { code?: string; message: string } | null }>,
): Promise<{ data: CompraResumen[]; error: { code?: string; message: string } | null }> {
  let r = await consulta(CAMPOS_COMPRA_POR_MIGRACION[0]);
  for (const campos of CAMPOS_COMPRA_POR_MIGRACION.slice(1)) {
    if (!faltaLaColumna(r.error)) break;
    r = await consulta(campos);
  }
  // Sin las borradas, y con los importes que cuentan.
  return r.error ? r : { data: comprasQueCuentan(r.data), error: null };
}

/**
 * Las facturas de compra registradas que no son de textil, de cualquier
 * fecha: una máquina comprada hace dos años se sigue amortizando hoy, y el
 * recibo de un gasto fijo cuenta en su mes. Sin la migración de compras
 * generales no hay ninguna.
 */
export function useComprasGerencia() {
  return useQuery({
    queryKey: ["gerencia-compras"],
    queryFn: async (): Promise<CompraResumen[]> => {
      // Sin la migración de compras generales (sin «categoria»), no hay ninguna.
      const r = await leerCompras((campos) =>
        leerTodas<CompraResumen>((a, b) =>
          tabla(supabase, "textil_compras")
            .select(campos)
            .eq("estado", "registrada")
            .neq("categoria", "textil")
            .order("id")
            .range(a, b),
        ),
      );
      if (faltaLaColumna(r.error) || faltaLaTabla(r.error)) return [];
      if (r.error) throw new Error(r.error.message);
      return r.data;
    },
  });
}

type FilaDocumento = Record<string, unknown>;
type Lectura = { data: FilaDocumento[]; error: { code?: string; message: string } | null };

const CAMPOS_FACTURA =
  "id, tipo, estado, fecha, tienda_id, base_imponible, iva_total, total, desglose_iva, pedido_id, rectifica_a_id, sustituye_a_id";
const CAMPOS_TEXTIL = "id, tipo, estado, fecha, subtotal, iva, total, desglose_iva, rectifica_a_id";
/** El pedido y el canje del textil llegaron con la misma migración (tickets). */
const CAMPOS_TEXTIL_CANJE = `${CAMPOS_TEXTIL}, textil_pedido_id, sustituye_a_id`;

const deFactura = (x: FilaDocumento): DocumentoFiscal => ({
  id: x.id as string,
  tipo: x.tipo as DocumentoFiscal["tipo"],
  estado: x.estado as string,
  fecha: x.fecha as string,
  tienda_id: x.tienda_id as string,
  base: x.base_imponible as number,
  iva: x.iva_total as number,
  total: x.total as number,
  desglose_iva: x.desglose_iva as DocumentoFiscal["desglose_iva"],
  pedido_id: (x.pedido_id as string | null) ?? null,
  rectifica_a_id: (x.rectifica_a_id as string | null) ?? null,
  sustituye_a_id: (x.sustituye_a_id as string | null) ?? null,
});

const deFacturaTextil = (x: FilaDocumento): DocumentoFiscal => ({
  id: x.id as string,
  tipo: (x.tipo ?? "ordinaria") as DocumentoFiscal["tipo"],
  estado: x.estado as string,
  fecha: x.fecha as string,
  tienda_id: TIENDA_TEXTIL.id,
  base: x.subtotal as number,
  iva: x.iva as number,
  total: x.total as number,
  desglose_iva: x.desglose_iva as DocumentoFiscal["desglose_iva"],
  pedido_id: (x.textil_pedido_id as string | null) ?? null,
  rectifica_a_id: (x.rectifica_a_id as string | null) ?? null,
  sustituye_a_id: (x.sustituye_a_id as string | null) ?? null,
});

/**
 * Los documentos de una tabla que faltan para casar los canjes de `filas`:
 * el ticket de cada factura de canje (`sustituye_a_id`) y la factura de cada
 * rectificativa (`rectifica_a_id`), y luego el ticket de esas facturas. Se
 * leen por id, con las mismas columnas, hasta que no falta ninguno.
 */
async function referenciasDeCanje(
  nombre: "facturas" | "textil_facturas",
  campos: string,
  filas: readonly FilaDocumento[],
): Promise<Lectura> {
  const conocidos = new Set(filas.map((x) => x.id as string));
  const leidas: FilaDocumento[] = [];
  let ultimas = filas;
  for (;;) {
    const faltan = [
      ...new Set(
        ultimas
          .flatMap((x) => [x.sustituye_a_id, x.rectifica_a_id])
          .filter((id): id is string => typeof id === "string" && !conocidos.has(id)),
      ),
    ];
    if (!faltan.length) return { data: leidas, error: null };
    const r = await leerPorIds<FilaDocumento>(faltan, (trozo, a, b) =>
      tabla(supabase, nombre).select(campos).in("id", trozo).order("id").range(a, b),
    );
    if (r.error) return { data: leidas, error: r.error };
    for (const id of faltan) conocidos.add(id);
    leidas.push(...r.data);
    ultimas = r.data;
  }
}

/**
 * Facturas, tickets y rectificativas emitidos en el rango, los documentos de
 * fuera que hacen falta para casar sus canjes, compras del rango y huecos de
 * numeración.
 */
export function useFiscal(rango: RangoFechas) {
  const desde = dia(rango.desde);
  const hasta = dia(rango.hasta);
  return useQuery({
    queryKey: ["gerencia-fiscal", desde, hasta],
    queryFn: async (): Promise<DatosFiscal> => {
      const enRango = (nombre: string, campos: string) =>
        leerTodas<FilaDocumento>((a, b) =>
          tabla(supabase, nombre)
            .select(campos)
            .gte("fecha", desde)
            .lte("fecha", hasta)
            .order("id")
            .range(a, b),
        );
      const [f, t0, c] = await Promise.all([
        enRango("facturas", CAMPOS_FACTURA),
        enRango("textil_facturas", CAMPOS_TEXTIL_CANJE),
        leerCompras(
          (campos) =>
            enRango("textil_compras", campos) as Promise<{
              data: CompraResumen[];
              error: { code?: string; message: string } | null;
            }>,
        ),
      ]);
      // Antes de la migración de tickets la factura textil no sabe su pedido
      // ni canjea tickets.
      const camposTextil = faltaLaColumna(t0.error) ? CAMPOS_TEXTIL : CAMPOS_TEXTIL_CANJE;
      const t = faltaLaColumna(t0.error) ? await enRango("textil_facturas", camposTextil) : t0;
      if (f.error) throw new Error(f.error.message);
      if (t.error) throw new Error(t.error.message);
      if (c.error && !faltaLaTabla(c.error)) throw new Error(c.error.message);

      const [rf, rt] = await Promise.all([
        referenciasDeCanje("facturas", CAMPOS_FACTURA, f.data),
        referenciasDeCanje("textil_facturas", camposTextil, t.data),
      ]);
      if (rf.error) throw new Error(rf.error.message);
      if (rt.error) throw new Error(rt.error.message);

      let huecos: HuecoSerie[] = [];
      try {
        huecos = await llamarRpc<HuecoSerie[]>(supabase, "facturas_huecos_en_serie", {});
      } catch {
        // Sin la función no se puede comprobar: se enseña sin el control.
        huecos = [];
      }

      return {
        documentos: [...f.data.map(deFactura), ...t.data.map(deFacturaTextil)],
        referencias: [...rf.data.map(deFactura), ...rt.data.map(deFacturaTextil)],
        compras: faltaLaTabla(c.error) ? null : (c.data as CompraResumen[]),
        huecos: (huecos ?? []).map((h) => ({
          serie: h.serie,
          ejercicio: h.ejercicio,
          numero_ausente: h.numero_ausente,
        })),
      };
    },
  });
}

/**
 * El día del primer documento de venta emitido del CRM: factura o ticket,
 * de tienda o del textil, sin borradores. Desde su trimestre el CRM sabe lo
 * que se vende, y desde ahí se compensa el 303 (ver `inicioHistorial303`).
 * Nulo si todavía no hay ninguno.
 */
export function usePrimeraVenta() {
  return useQuery({
    queryKey: ["gerencia-primera-venta"],
    queryFn: async (): Promise<string | null> => {
      const primera = async (nombre: "facturas" | "textil_facturas") => {
        // Un estado vacío (textil antiguo) es un documento emitido, como en resumenIva.
        const r = await tabla(supabase, nombre)
          .select("fecha")
          .or("estado.is.null,estado.neq.borrador")
          .order("fecha", { ascending: true })
          .limit(1);
        if (r.error) throw new Error(r.error.message);
        return ((r.data ?? []) as { fecha: string | null }[])[0]?.fecha ?? null;
      };
      const fechas = (await Promise.all([primera("facturas"), primera("textil_facturas")])).filter(
        (x): x is string => !!x,
      );
      return fechas.length ? fechas.map((x) => x.slice(0, 10)).sort()[0] : null;
    },
  });
}

/** Lee los documentos de unos pedidos y las rectificativas que los corrigen. */
async function documentosDe(
  nombre: "facturas" | "textil_facturas",
  campoPedido: "pedido_id" | "textil_pedido_id",
  ids: readonly string[],
): Promise<DocumentoDePedido[]> {
  const docs: DocumentoDePedido[] = [];
  const campos = `id, tipo, estado, rectifica_a_id, ${campoPedido}`;
  // Los trozos de cada paso a la vez, recorridos en su orden: mismos
  // documentos, mismo orden y el mismo primer error que en serie. Las
  // rectificativas dependen de los documentos leídos: siguen siendo dos pasos.
  const leer = async (columna: string, valores: string[]) => {
    const respuestas = await enParalelo(
      trozos(valores),
      PETICIONES_A_LA_VEZ,
      async (trozo) => await tabla(supabase, nombre).select(campos).in(columna, trozo),
    );
    for (const r of respuestas) {
      if (r.error) throw new Error(r.error.message);
      for (const d of (r.data ?? []) as Record<string, string | null>[]) {
        docs.push({
          id: d.id as string,
          tipo: d.tipo as DocumentoDePedido["tipo"],
          estado: d.estado,
          rectifica_a_id: d.rectifica_a_id,
          pedido_id: d[campoPedido],
        });
      }
    }
  };
  await leer(campoPedido, [...ids]);
  // Las rectificativas pueden no llevar el pedido: se buscan por lo que rectifican.
  await leer(
    "rectifica_a_id",
    docs.map((d) => d.id),
  );
  return docs;
}

/**
 * Los documentos fiscales de unos pedidos (tienda y textil), para saber
 * cuáles se han vendido sin factura ni ticket.
 */
export function useDocumentosDePedidos(ventas: readonly Venta[]) {
  const tienda = ventas.filter((v) => v.canal !== "textil" && v.id).map((v) => v.id as string);
  const textil = ventas.filter((v) => v.canal === "textil" && v.id).map((v) => v.id as string);
  return useQuery({
    queryKey: ["gerencia-docs-pedidos", claveIds(tienda), claveIds(textil)],
    queryFn: async (): Promise<DocumentoDePedido[]> => {
      // Tienda y textil a la vez. Los errores se miran en el mismo orden que
      // en serie: primero el de tienda, luego el del textil.
      const [deTienda, delTextil] = await Promise.allSettled([
        documentosDe("facturas", "pedido_id", tienda),
        documentosDe("textil_facturas", "textil_pedido_id", textil),
      ]);
      if (deTienda.status === "rejected") throw deTienda.reason;
      if (delTextil.status === "rejected") {
        const e = delTextil.reason;
        // Antes de la migración de tickets la factura textil no sabe su pedido.
        if (!(e instanceof Error) || !/textil_pedido_id/.test(e.message)) throw e;
        return deTienda.value;
      }
      return [...deTienda.value, ...delTextil.value];
    },
  });
}

export type DatosTextil = {
  lineas: LineaTextil[];
  stock: ArticuloStock[] | null;
  marcas: { id: string; nombre: string }[];
  compras: CompraResumen[] | null;
};

/** Las líneas de los pedidos textil dados, el almacén, las marcas y las compras del rango. */
export function useTextilGerencia(rango: RangoFechas, pedidos: readonly string[]) {
  const desde = dia(rango.desde);
  const hasta = dia(rango.hasta);
  return useQuery({
    queryKey: ["gerencia-textil", desde, hasta, claveIds(pedidos)],
    queryFn: async (): Promise<DatosTextil> => {
      // Las líneas por trozos a la vez y, al mismo tiempo, el almacén, las
      // marcas y las compras. Los errores se miran en el mismo orden que en
      // serie: primero las líneas (en el orden de sus trozos), luego lo demás.
      const lecturaLineas = enParalelo(
        trozos([...pedidos]),
        PETICIONES_A_LA_VEZ,
        async (trozo) =>
          await tabla(supabase, "textil_pedido_items")
            .select("descripcion, cantidad, subtotal")
            .in("pedido_id", trozo),
      );
      const lecturaResto = Promise.all([
        leerTodas<ArticuloStock>((a, b) =>
          tabla(supabase, "textil_stock")
            .select(
              "id, nombre, talla, color, cantidad, cantidad_minima, cantidad_reservada, coste_unitario, activa",
            )
            .order("id")
            .range(a, b),
        ),
        tabla(supabase, "textil_marcas").select("id, nombre"),
        leerCompras((campos) =>
          leerTodas<CompraResumen>((a, b) =>
            tabla(supabase, "textil_compras")
              .select(campos)
              .gte("fecha", desde)
              .lte("fecha", hasta)
              .order("id")
              .range(a, b),
          ),
        ),
      ]);
      // Si las líneas fallan se lanza su error sin esperar a lo demás: que su
      // rechazo, si lo hubiera, no quede como promesa sin atender.
      lecturaResto.catch(() => {});
      const lineas: LineaTextil[] = [];
      for (const r of await lecturaLineas) {
        if (r.error) throw new Error(r.error.message);
        lineas.push(...((r.data ?? []) as LineaTextil[]));
      }
      const [stock, marcas, compras] = await lecturaResto;
      // Solo las del textil; sin la migración de compras generales, todas lo son.
      const comprasTextil = compras.error
        ? compras
        : { ...compras, data: compras.data.filter((x) => (x.categoria ?? "textil") === "textil") };
      if (stock.error && !faltaLaTabla(stock.error)) throw new Error(stock.error.message);
      if (marcas.error) throw new Error(marcas.error.message);
      if (comprasTextil.error && !faltaLaTabla(comprasTextil.error)) {
        throw new Error(comprasTextil.error.message);
      }
      return {
        lineas,
        stock: stock.error ? null : stock.data,
        marcas: (marcas.data ?? []) as { id: string; nombre: string }[],
        compras: comprasTextil.error ? null : comprasTextil.data,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Cuentas del almacén textil (migraciones 20261028…)
// ---------------------------------------------------------------------------

export type DatosMovimientosAlmacen = {
  movimientos: MovimientoAlmacen[];
  /**
   * false sin la migración 20261028100000: no hay `fecha` ni `compra_id`, cada
   * movimiento cuenta por el día de su `created_at` (una compra, el día que se
   * registró y no el de la factura).
   */
  conFecha: boolean;
};

const CAMPOS_MOV_ALMACEN = "id, stock_id, motivo, cantidad, coste_unitario, created_at";
/** Columnas de la migración 20261028100000_escaner_textil_esquema. */
const CAMPOS_MOV_ESCANER = "fecha, compra_id";

/**
 * Todos los movimientos del almacén textil, de cualquier fecha: la cuenta
 * del almacén necesita lo anterior al periodo (existencias iniciales) y el
 * filtro por fecha efectiva lo hace el dominio (`cuentaAlmacen`), porque una
 * compra registrada hoy puede llevar la fecha de una factura de hace un mes.
 * Nulo sin la tabla de movimientos.
 */
export function useMovimientosAlmacen() {
  return useQuery({
    queryKey: ["almacen-movimientos"],
    queryFn: async (): Promise<DatosMovimientosAlmacen | null> => {
      const leer = (campos: string) =>
        leerTodas<MovimientoAlmacen>((a, b) =>
          tabla(supabase, "textil_stock_movimientos").select(campos).order("id").range(a, b),
        );
      let conFecha = true;
      // Con las migraciones de proformas, además el importe de los ajustes de coste.
      let r = await leer(
        `${CAMPOS_MOV_ALMACEN}, textil_pedido_id, ${CAMPOS_MOV_ESCANER}, importe_ajuste`,
      );
      if (faltaLaColumna(r.error)) {
        r = await leer(`${CAMPOS_MOV_ALMACEN}, textil_pedido_id, ${CAMPOS_MOV_ESCANER}`);
      }
      if (faltaLaColumna(r.error)) {
        conFecha = false;
        r = await leer(`${CAMPOS_MOV_ALMACEN}, textil_pedido_id`);
      }
      if (faltaLaTabla(r.error)) return null;
      if (r.error) throw new Error(r.error.message);

      // Las «salen» de la regularización (devolución a proveedor enlazada a
      // una factura casada con su proforma) corrigen una entrada: van a
      // Compras, no a pérdidas (cuentaAlmacen).
      const casadas = await facturasCasadas();
      const movimientos = casadas.size
        ? r.data.map((m) =>
            m.motivo === "devolucion_proveedor" && m.compra_id && casadas.has(m.compra_id)
              ? { ...m, regularizacion: true }
              : m,
          )
        : r.data;
      return { movimientos, conFecha };
    },
  });
}

export type DatosControlesAlmacen =
  | { disponible: false }
  | {
      disponible: true;
      compras: ControlCompras;
      /** Filas de `stock_descuadres()`; nulo si no se pudo leer. */
      variantes: number | null;
      /** Filas de `stock_reservas_descuadres()`; nulo si no se pudo leer. */
      reservas: number | null;
      /**
       * Valor del almacén según la caché: Σ por variante de
       * redondear(cantidad × coste_unitario, 2). Nulo si no se pudo leer.
       */
      valorCache: number | null;
    };

const CAMPOS_COMPRA_CONTROL = "id, numero, proveedor, fecha, base, estado";
const CAMPOS_COMPRA_CONTROL_POR_MIGRACION = [
  // Con las migraciones de proformas: el par proforma + factura se comprueba junto.
  `${CAMPOS_COMPRA_CONTROL}, categoria, borrada_en, tipo_documento, proforma_id, casado_resumen`,
  `${CAMPOS_COMPRA_CONTROL}, categoria, borrada_en`,
  `${CAMPOS_COMPRA_CONTROL}, categoria`,
  CAMPOS_COMPRA_CONTROL,
];

/**
 * Los ids de las facturas casadas con una proforma, de cualquier fecha.
 * Vacío sin las migraciones de proformas.
 */
async function facturasCasadas(): Promise<Set<string>> {
  const r = await leerTodas<{ id: string }>((a, b) =>
    tabla(supabase, "textil_compras")
      .select("id")
      .not("proforma_id", "is", null)
      .order("id")
      .range(a, b),
  );
  if (faltaLaColumna(r.error) || faltaLaTabla(r.error)) return new Set();
  if (r.error) throw new Error(r.error.message);
  return new Set(r.data.map((f) => f.id));
}

/** Los ids de las proformas que ya tienen factura, de cualquier fecha. Vacío sin la migración. */
async function proformasCasadas(): Promise<Set<string>> {
  const r = await leerTodas<{ id: string; proforma_id: string }>((a, b) =>
    tabla(supabase, "textil_compras")
      .select("id, proforma_id")
      .not("proforma_id", "is", null)
      .order("id")
      .range(a, b),
  );
  if (faltaLaColumna(r.error) || faltaLaTabla(r.error)) return new Set();
  if (r.error) throw new Error(r.error.message);
  return new Set(r.data.map((f) => f.proforma_id));
}

/** Cuántas filas devuelve una función de la base; nulo si no se puede leer. */
async function contarFilas(funcion: string): Promise<number | null> {
  const { data, error } = await llamarRpcConError<unknown[]>(supabase, funcion, {});
  if (error) return null;
  return Array.isArray(data) ? data.length : null;
}

/**
 * Lo que necesitan los controles del almacén: las compras textil
 * registradas con fecha en el rango frente a sus entradas de stock, las
 * variantes y reservas descuadradas y el valor de la caché. Sin la migración
 * 20261028100000 (sin `compra_id` en los movimientos), `disponible: false`.
 */
export function useControlesAlmacen(rango: RangoFechas) {
  const desde = dia(rango.desde);
  const hasta = dia(rango.hasta);
  return useQuery({
    queryKey: ["almacen-controles", desde, hasta],
    queryFn: async (): Promise<DatosControlesAlmacen> => {
      const leerCompras = (campos: string) =>
        leerTodas<CompraControl>((a, b) =>
          tabla(supabase, "textil_compras")
            .select(campos)
            .eq("estado", "registrada")
            .gte("fecha", desde)
            .lte("fecha", hasta)
            .order("id")
            .range(a, b),
        );
      const lecturaCompras = (async () => {
        let compras = await leerCompras(CAMPOS_COMPRA_CONTROL_POR_MIGRACION[0]);
        let camposLeidos = CAMPOS_COMPRA_CONTROL_POR_MIGRACION[0];
        for (const campos of CAMPOS_COMPRA_CONTROL_POR_MIGRACION.slice(1)) {
          if (!faltaLaColumna(compras.error)) break;
          compras = await leerCompras(campos);
          camposLeidos = campos;
        }
        return { compras, camposLeidos };
      })();
      // Qué consulta de entradas usar se decide aquí y no por el error: sin la
      // migración 20261029100000, 'ajuste_coste' en el filtro da 22P02 (valor
      // de enum no válido), que faltaLaColumna no reconoce.
      const lecturaProformas = proformasAplicado(supabase);
      // La sonda, las compras y la comprobación de proformas van a la vez; se
      // miran en el mismo orden que en serie (sonda, compras, proformas). Si
      // la sonda corta antes, que los otros dos no queden sin atender.
      lecturaCompras.catch(() => {});
      lecturaProformas.catch(() => {});

      // Sin el enlace de los movimientos con su compra no hay nada que comprobar.
      const enlace = await tabla(supabase, "textil_stock_movimientos").select("compra_id").limit(1);
      if (faltaLaColumna(enlace.error) || faltaLaTabla(enlace.error)) {
        return { disponible: false };
      }
      if (enlace.error) throw new Error(enlace.error.message);

      const { compras, camposLeidos } = await lecturaCompras;
      if (compras.error) throw new Error(compras.error.message);

      const conProformas = await lecturaProformas;

      // El otro miembro de cada par, aunque su fecha caiga fuera del rango:
      // la proforma de cada factura casada y la factura de cada proforma.
      const todas = [...compras.data];
      if (conProformas && camposLeidos === CAMPOS_COMPRA_CONTROL_POR_MIGRACION[0]) {
        const yaEstan = new Set(todas.map((c) => c.id));
        const faltanProformas = todas
          .map((c) => c.proforma_id)
          .filter((id): id is string => !!id && !yaEstan.has(id));
        const idsProformas = todas.filter((c) => c.tipo_documento === "proforma").map((c) => c.id);
        // Las proformas que faltan y las facturas de las proformas (en trozos
        // de 100, como las entradas) a la vez; los errores, en el orden de
        // antes: primero las proformas, luego cada trozo de facturas.
        const [proformas, porTrozo] = await Promise.all([
          leerPorIds<CompraControl>(faltanProformas, (trozo, a, b) =>
            tabla(supabase, "textil_compras")
              .select(camposLeidos)
              .in("id", trozo)
              .order("id")
              .range(a, b),
          ),
          enParalelo(trozos(idsProformas, 100), PETICIONES_A_LA_VEZ, (trozo) =>
            leerTodas<CompraControl>((a, b) =>
              tabla(supabase, "textil_compras")
                .select(camposLeidos)
                .eq("estado", "registrada")
                .in("proforma_id", trozo)
                .order("id")
                .range(a, b),
            ),
          ),
        ]);
        if (proformas.error) throw new Error(proformas.error.message);
        const facturas: CompraControl[] = [];
        for (const f of porTrozo) {
          if (f.error) throw new Error(f.error.message);
          facturas.push(...f.data);
        }
        for (const c of [...proformas.data, ...facturas]) {
          if (!yaEstan.has(c.id)) {
            yaEstan.add(c.id);
            todas.push(c);
          }
        }
      }
      // Solo las del textil (sin categoría, de antes de las compras generales, lo son).
      const delTextil = todas.filter((c) => !c.categoria || c.categoria === "textil");

      const entradas: EntradaControl[] = [];
      // En trozos de 100: una URL con cientos de UUID la corta PostgREST. Los
      // trozos a la vez, recorridos en su orden (mismo primer error).
      const porTrozoEntradas = await enParalelo(
        trozos(
          delTextil.map((c) => c.id),
          100,
        ),
        PETICIONES_A_LA_VEZ,
        (trozo) =>
          leerTodas<EntradaControl & { id: string }>((a, b) => {
            const consulta = tabla(supabase, "textil_stock_movimientos");
            return (
              conProformas
                ? consulta
                    .select("id, motivo, cantidad, coste_unitario, compra_id, importe_ajuste")
                    .in("motivo", ["compra", "ajuste_coste"])
                : consulta
                    .select("id, motivo, cantidad, coste_unitario, compra_id")
                    .eq("motivo", "compra")
            )
              .in("compra_id", trozo)
              .order("id")
              .range(a, b);
          }),
      );
      for (const r of porTrozoEntradas) {
        if (r.error) throw new Error(r.error.message);
        entradas.push(...r.data);
      }

      const [variantes, reservas, stock] = await Promise.all([
        contarFilas("stock_descuadres"),
        contarFilas("stock_reservas_descuadres"),
        leerTodas<{ id: string; cantidad: number | string; coste_unitario: number | string }>(
          (a, b) =>
            tabla(supabase, "textil_stock")
              .select("id, cantidad, coste_unitario")
              .order("id")
              .range(a, b),
        ),
      ]);

      return {
        disponible: true,
        compras: controlComprasEntradas(delTextil, entradas),
        variantes,
        reservas,
        valorCache: stock.error
          ? null
          : sumarImportes(stock.data, (s) =>
              valorMovimiento({
                cantidad: s.cantidad ?? 0,
                coste_unitario: s.coste_unitario ?? 0,
              }),
            ),
      };
    },
  });
}

const CAMPOS_PAGO_PROVEEDOR =
  "id, proveedor, nif_proveedor, numero, fecha, liquido, total, estado, estado_pago, borrada_en";

/**
 * Las facturas de compra registradas y pendientes de pago, de cualquier
 * fecha y categoría. Nulo sin la migración 20261014100000 (sin `estado_pago`)
 * o sin la tabla de compras.
 */
export function usePagosProveedores() {
  return useQuery({
    queryKey: ["gerencia-pagos-proveedores"],
    queryFn: async (): Promise<CompraPendiente[] | null> => {
      const leer = (campos: string) =>
        leerTodas<CompraPendiente>((a, b) =>
          tabla(supabase, "textil_compras")
            .select(campos)
            .eq("estado", "registrada")
            .eq("estado_pago", "pendiente")
            .order("id")
            .range(a, b),
        );
      // Con el tipo de documento y el casado (proformas, 20261029…: lo ya
      // pagado con la proforma no se debe) y el proveedor del
      // catálogo (20261028100000) si existen; si no, sin ellos.
      let r = await leer(`${CAMPOS_PAGO_PROVEEDOR}, proveedor_id, tipo_documento, casado_resumen`);
      if (faltaLaColumna(r.error)) r = await leer(`${CAMPOS_PAGO_PROVEEDOR}, proveedor_id`);
      if (faltaLaColumna(r.error)) r = await leer(CAMPOS_PAGO_PROVEEDOR);
      if (faltaLaColumna(r.error) || faltaLaTabla(r.error)) return null;
      if (r.error) throw new Error(r.error.message);
      // Una proforma casada no cuenta: su pago vive en la factura.
      const casadas = await proformasCasadas();
      return casadas.size
        ? r.data.map((c) => (casadas.has(c.id) ? { ...c, casada: true } : c))
        : r.data;
    },
  });
}

/**
 * Proformas registradas, sin borrar y sin factura (`compras_proformas_pendientes()`),
 * de cualquier fecha: no dependen del periodo. Nulo sin las migraciones de
 * proformas. Sirve al aviso de Gerencia, a los anticipos de Tesorería, a Textil
 * y al resumen diario.
 */
export function useProformasPendientes() {
  return useQuery({
    queryKey: ["proformas-pendientes"],
    queryFn: async (): Promise<ProformaFila[] | null> => {
      const r = await leerTodas<ProformaFila>((a, b) =>
        filasDeFuncion(supabase, "compras_proformas_pendientes")
          .select(
            "id, empresa_id, proveedor, nif_proveedor, proveedor_id, numero, fecha, categoria, " +
              "base, total, liquido, estado_pago, fecha_pago, fichero_ruta",
          )
          .order("fecha")
          .order("id")
          .range(a, b),
      );
      if (faltaLaFuncion(r.error)) return null;
      if (r.error) throw new Error(r.error.message);
      return r.data.map((p) => ({ ...p, tipo_documento: "proforma", estado: "registrada" }));
    },
  });
}

/**
 * El resumen de los controles del almacén con lo que leen
 * `useControlesAlmacen` y `useMovimientosAlmacen`: la diferencia de valor
 * caché − libro es contra el libro a hoy (día de Madrid, como la fecha
 * efectiva). Nulo sin la migración o mientras se lee.
 */
export function resumenControlesAlmacen(
  datos: DatosControlesAlmacen | undefined,
  movimientos: readonly MovimientoAlmacen[] | null | undefined,
  hoy: Date,
): ResumenControles | null {
  if (!datos || !datos.disponible) return null;
  const libro = movimientos ? valorAFecha(movimientos, diaEnEspana(hoy)).valor : null;
  return resumenControles(
    datos.compras,
    datos.variantes,
    datos.reservas,
    datos.valorCache === null || libro === null ? null : datos.valorCache - libro,
  );
}
