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
import { faltaLaTabla, tabla } from "@/lib/rpc";
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

const dia = (d: Date) => format(d, "yyyy-MM-dd");

/** Pedidos textil del rango, con lo justo para agregar. */
function useTextilPeriodo(rango: RangoFechas) {
  return useQuery({
    queryKey: ["textil-periodo", dia(rango.desde), dia(rango.hasta)],
    queryFn: async (): Promise<PedidoTextilResumen[]> => {
      const { data, error } = await supabase
        .from("textil_pedidos")
        .select("fecha, estado, subtotal, iva, envio, total, cliente_id")
        .gte("fecha", dia(rango.desde))
        .lte("fecha", dia(rango.hasta));
      if (error) throw error;
      return (data ?? []) as PedidoTextilResumen[];
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
      const { data, error } = await tabla(supabase, "pedidos_pendientes_cobro").select("*");
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
