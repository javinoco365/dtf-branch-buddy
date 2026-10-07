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
import { faltaLaColumna, faltaLaTabla, llamarRpc, tabla } from "@/lib/rpc";
import { leerTodas, trozos } from "@/lib/paginar";
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

const dia = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * Pedidos textil del rango, con lo justo para agregar y lo que costó la ropa
 * que salió del almacén para cada uno (ver costePorPedido).
 */
function useTextilPeriodo(rango: RangoFechas) {
  return useQuery({
    queryKey: ["textil-periodo", dia(rango.desde), dia(rango.hasta)],
    queryFn: async (): Promise<PedidoTextilResumen[]> => {
      const { data, error } = await leerTodas<PedidoTextilResumen & { id: string }>((a, b) =>
        tabla(supabase, "textil_pedidos")
          .select("id, fecha, estado, subtotal, iva, envio, total, cliente_id, marca_id")
          .gte("fecha", dia(rango.desde))
          .lte("fecha", dia(rango.hasta))
          .order("id")
          .range(a, b),
      );
      if (error) throw error;

      const movs: MovimientoCoste[] = [];
      let conAlmacen = true;
      for (const trozo of trozos(data.map((p) => p.id))) {
        const r = await tabla(supabase, "textil_stock_movimientos")
          .select("textil_pedido_id, motivo, cantidad, coste_unitario")
          .in("textil_pedido_id", trozo)
          .in("motivo", ["venta", "devolucion_cliente"]);
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
  for (const trozo of trozos([...new Set(ids)])) {
    const { data, error } = await tabla(supabase, nombre).select(`id, ${campo}`).in("id", trozo);
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

      let tiendas = await leer("presupuestos", ", tienda_id, pedido_id");
      const tiendasDisponible = !faltaLaTabla(tiendas.error);
      if (!tiendasDisponible) tiendas = { data: [], error: null };
      if (tiendas.error) throw new Error(tiendas.error.message);

      // El enlace del presupuesto textil con su pedido llegó en una migración
      // posterior: sin ella se leen igual, sin días hasta el pedido.
      let textil = await leer("textil_presupuestos", ", pedido_id");
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
      for (const trozo of trozos(ids)) {
        // Si el pedido ya tenía un seguimiento de antes, no se envió en el rango.
        const [p, previos] = await Promise.all([
          tabla(supabase, "pedidos").select("id, fecha_pedido, tienda_id, origen").in("id", trozo),
          tabla(supabase, "enlaces_seguimiento")
            .select("pedido_id")
            .in("pedido_id", trozo)
            .lt("created_at", desde),
        ]);
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
  documentos: DocumentoFiscal[];
  /** Nulo si la tabla de compras no existe todavía. */
  compras: CompraResumen[] | null;
  huecos: HuecoSerie[];
};

const CAMPOS_COMPRA = "id, estado, fecha, base, iva, total";
/** Columnas de la migración 20261013100000_compras_generales. */
const CAMPOS_COMPRA_GENERAL = "irpf, categoria, gasto_id";

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
      const r = await leerTodas<CompraResumen>((a, b) =>
        tabla(supabase, "textil_compras")
          .select(`${CAMPOS_COMPRA}, ${CAMPOS_COMPRA_GENERAL}`)
          .eq("estado", "registrada")
          .neq("categoria", "textil")
          .order("id")
          .range(a, b),
      );
      if (faltaLaColumna(r.error) || faltaLaTabla(r.error)) return [];
      if (r.error) throw new Error(r.error.message);
      return r.data;
    },
  });
}

/** Facturas, tickets y rectificativas emitidos en el rango, compras del rango y huecos de numeración. */
export function useFiscal(rango: RangoFechas) {
  const desde = dia(rango.desde);
  const hasta = dia(rango.hasta);
  return useQuery({
    queryKey: ["gerencia-fiscal", desde, hasta],
    queryFn: async (): Promise<DatosFiscal> => {
      const enRango = (nombre: string, campos: string) =>
        leerTodas<Record<string, unknown>>((a, b) =>
          tabla(supabase, nombre)
            .select(campos)
            .gte("fecha", desde)
            .lte("fecha", hasta)
            .order("id")
            .range(a, b),
        );
      const camposTextil =
        "id, tipo, estado, fecha, subtotal, iva, total, desglose_iva, rectifica_a_id";
      const [f, t0, c0] = await Promise.all([
        enRango(
          "facturas",
          "id, tipo, estado, fecha, tienda_id, base_imponible, iva_total, total, desglose_iva, pedido_id, rectifica_a_id",
        ),
        enRango("textil_facturas", `${camposTextil}, textil_pedido_id`),
        enRango("textil_compras", `${CAMPOS_COMPRA}, ${CAMPOS_COMPRA_GENERAL}`),
      ]);
      // Antes de la migración de tickets la factura textil no sabe su pedido.
      const t = faltaLaColumna(t0.error) ? await enRango("textil_facturas", camposTextil) : t0;
      // Antes de la de compras generales todas son de textil, sin IRPF ni gasto.
      const c = faltaLaColumna(c0.error) ? await enRango("textil_compras", CAMPOS_COMPRA) : c0;
      if (f.error) throw new Error(f.error.message);
      if (t.error) throw new Error(t.error.message);
      if (c.error && !faltaLaTabla(c.error)) throw new Error(c.error.message);

      let huecos: HuecoSerie[] = [];
      try {
        huecos = await llamarRpc<HuecoSerie[]>(supabase, "facturas_huecos_en_serie", {});
      } catch {
        // Sin la función no se puede comprobar: se enseña sin el control.
        huecos = [];
      }

      const documentos: DocumentoFiscal[] = [
        ...f.data.map((x) => ({
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
        })),
        ...t.data.map((x) => ({
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
        })),
      ];
      return {
        documentos,
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

/** Lee los documentos de unos pedidos y las rectificativas que los corrigen. */
async function documentosDe(
  nombre: "facturas" | "textil_facturas",
  campoPedido: "pedido_id" | "textil_pedido_id",
  ids: readonly string[],
): Promise<DocumentoDePedido[]> {
  const docs: DocumentoDePedido[] = [];
  const campos = `id, tipo, estado, rectifica_a_id, ${campoPedido}`;
  const leer = async (columna: string, valores: string[]) => {
    for (const trozo of trozos(valores)) {
      const r = await tabla(supabase, nombre).select(campos).in(columna, trozo);
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
      const deTienda = await documentosDe("facturas", "pedido_id", tienda);
      let delTextil: DocumentoDePedido[] = [];
      try {
        delTextil = await documentosDe("textil_facturas", "textil_pedido_id", textil);
      } catch (e) {
        // Antes de la migración de tickets la factura textil no sabe su pedido.
        if (!(e instanceof Error) || !/textil_pedido_id/.test(e.message)) throw e;
      }
      return [...deTienda, ...delTextil];
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
      const lineas: LineaTextil[] = [];
      for (const trozo of trozos([...pedidos])) {
        const r = await tabla(supabase, "textil_pedido_items")
          .select("descripcion, cantidad, subtotal")
          .in("pedido_id", trozo);
        if (r.error) throw new Error(r.error.message);
        lineas.push(...((r.data ?? []) as LineaTextil[]));
      }
      const [stock, marcas, compras] = await Promise.all([
        leerTodas<ArticuloStock>((a, b) =>
          tabla(supabase, "textil_stock")
            .select(
              "id, nombre, talla, color, cantidad, cantidad_minima, cantidad_reservada, coste_unitario, activa",
            )
            .order("id")
            .range(a, b),
        ),
        tabla(supabase, "textil_marcas").select("id, nombre"),
        leerTodas<CompraResumen>((a, b) =>
          tabla(supabase, "textil_compras")
            .select("id, estado, base, iva, total, categoria")
            .gte("fecha", desde)
            .lte("fecha", hasta)
            .order("id")
            .range(a, b),
        ),
      ]);
      // Solo las del textil; sin la migración de compras generales, todas lo son.
      const comprasTextil = faltaLaColumna(compras.error)
        ? await leerTodas<CompraResumen>((a, b) =>
            tabla(supabase, "textil_compras")
              .select("id, estado, base, iva, total")
              .gte("fecha", desde)
              .lte("fecha", hasta)
              .order("id")
              .range(a, b),
          )
        : {
            ...compras,
            data: compras.data.filter((x) => (x.categoria ?? "textil") === "textil"),
          };
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
