/**
 * Exportar los pedidos para análisis (ver src/dominio/export-analisis.ts).
 *
 * Se lee desde el navegador, con el cliente del usuario: manda la RLS, y el
 * fichero no pasa por Vercel, que no deja responder con más de 4,5 MB. Todo
 * por páginas: Supabase corta en 1000 filas sin avisar.
 */

import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { faltaLaTabla, tabla } from "@/lib/rpc";
import { leerTodas } from "@/lib/paginar";
import { referenciaFactura } from "@/lib/format";
import { descargarBlob } from "@/lib/csv";
import {
  construirExportAnalisis,
  serializarExportAnalisis,
  type CobroExport,
  type DocumentoExport,
  type LineaExport,
  type PedidoExport,
} from "@/dominio/export-analisis";
import { sanearNombre } from "@/dominio/archivo";

type Fila = Record<string, any>;

/** Lee y descarga. `tiendaId` vacío: todas las tiendas que el usuario puede ver. */
export async function exportarPedidosParaAnalisis({
  tiendaId,
  alcance,
}: {
  tiendaId?: string | null;
  alcance: string;
}): Promise<{ pedidos: number; avisos: string[] }> {
  const avisos: string[] = [];
  const deTienda = <Q extends { eq: (c: string, v: string) => Q }>(q: Q, columna: string) =>
    tiendaId ? q.eq(columna, tiendaId) : q;

  const [pedidos, lineas, cobros, documentos, tiendas, empresa] = await Promise.all([
    leerTodas<Fila>((a, b) =>
      deTienda(
        tabla(supabase, "pedidos").select("*, devoluciones:pedido_devoluciones(importe)"),
        "tienda_id",
      )
        .order("id")
        .range(a, b),
    ),
    leerTodas<Fila>((a, b) =>
      deTienda(
        tabla(supabase, "pedido_items").select("*, pedido:pedidos!inner(tienda_id)"),
        "pedido.tienda_id",
      )
        .order("id")
        .range(a, b),
    ),
    leerTodas<Fila>((a, b) =>
      deTienda(
        tabla(supabase, "cobros").select(
          "id, pedido_id, fecha, importe, propina, metodo, pedido:pedidos!inner(tienda_id)",
        ),
        "pedido.tienda_id",
      )
        .order("id")
        .range(a, b),
    ),
    leerTodas<Fila>((a, b) =>
      deTienda(
        tabla(supabase, "facturas")
          .select(
            "id, pedido_id, tipo, serie, ejercicio, numero, fecha, estado, total, rectifica_a_id, sustituye_a_id",
          )
          .not("pedido_id", "is", null),
        "tienda_id",
      )
        .order("id")
        .range(a, b),
    ),
    tabla(supabase, "tiendas").select("id, nombre"),
    tabla(supabase, "empresas")
      .select("id, coste_consumibles_metro, coste_packaging_metro, coste_electricidad_metro")
      .eq("activa", true)
      .order("created_at")
      .limit(1)
      .maybeSingle(),
  ]);
  if (pedidos.error) throw new Error(pedidos.error.message);
  if (lineas.error) throw new Error(lineas.error.message);
  if (documentos.error) throw new Error(documentos.error.message);
  if (cobros.error && !faltaLaTabla(cobros.error)) throw new Error(cobros.error.message);
  if (cobros.error) avisos.push("Sin la tabla de cobros: los cobros salen vacíos.");

  let precioMetro: number | null = null;
  if (empresa.data?.id) {
    const { data: ajustes } = await tabla(supabase, "gerencia_ajustes")
      .select("precio_metro")
      .eq("empresa_id", empresa.data.id)
      .maybeSingle();
    if (ajustes?.precio_metro != null) precioMetro = Number(ajustes.precio_metro);
  }

  const filasPedidos = pedidos.data.map((p): PedidoExport => ({
    id: p.id,
    numero: p.numero,
    tienda_id: p.tienda_id,
    fecha_pedido: p.fecha_pedido,
    origen: p.origen,
    estado: p.estado,
    estado_pago: p.estado_pago,
    estado_produccion: p.estado_produccion,
    estado_envio: p.estado_envio,
    cliente_id: p.cliente_id,
    cliente_nombre: p.cliente_nombre,
    metodo_pago: p.metodo_pago,
    subtotal: p.subtotal,
    iva: p.iva,
    envio: p.envio,
    total: p.total,
    metros_total: p.metros_total,
    coste_metro_snapshot: p.coste_metro_snapshot ?? null,
    devuelto: ((p.devoluciones ?? []) as { importe: number | string }[]).reduce(
      (s, x) => s + (Number(x.importe) || 0),
      0,
    ),
  }));

  const e = construirExportAnalisis({
    generado: new Date(),
    alcance,
    tiendas: ((tiendas.data ?? []) as Fila[])
      .filter((t) => !tiendaId || t.id === tiendaId)
      .map((t) => ({ id: t.id, nombre: t.nombre })),
    pedidos: filasPedidos,
    lineas: lineas.data as LineaExport[],
    cobros: (cobros.error ? [] : cobros.data) as CobroExport[],
    documentos: documentos.data.map((f): DocumentoExport => ({
      id: f.id,
      pedido_id: f.pedido_id,
      tipo: f.tipo,
      referencia: referenciaFactura(f.serie, f.ejercicio, f.numero),
      fecha: f.fecha,
      estado: f.estado,
      total: f.total,
      rectifica_a_id: f.rectifica_a_id ?? null,
      sustituye_a_id: f.sustituye_a_id ?? null,
    })),
    costesMetro: {
      consumibles: Number(empresa.data?.coste_consumibles_metro ?? 0),
      packaging: Number(empresa.data?.coste_packaging_metro ?? 0),
      electricidad: Number(empresa.data?.coste_electricidad_metro ?? 0),
    },
    precioMetroAjustes: precioMetro,
    avisos,
  });

  const nombre = `analisis-pedidos_${sanearNombre(alcance, 40)}_${format(new Date(), "yyyy-MM-dd")}.json`;
  descargarBlob(
    nombre,
    new Blob([serializarExportAnalisis(e)], { type: "application/json;charset=utf-8" }),
  );
  return { pedidos: e.pedidos.length, avisos };
}
