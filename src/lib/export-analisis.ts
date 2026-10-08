/**
 * Exportar los pedidos para análisis (ver src/dominio/export-analisis.ts).
 *
 * Se lee desde el navegador, con el cliente del usuario: manda la RLS, y el
 * fichero no pasa por Vercel, que no deja responder con más de 4,5 MB. Todo
 * por páginas: Supabase corta en 1000 filas sin avisar.
 */

import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { faltaLaColumna, faltaLaTabla, tabla } from "@/lib/rpc";
import { leerTodas } from "@/lib/paginar";
import { referenciaFactura } from "@/lib/format";
import { descargarBlob } from "@/lib/csv";
import {
  construirExportAnalisis,
  serializarExportAnalisis,
  type AjustesExport,
  type CobroExport,
  type DocumentoExport,
  type LineaExport,
  type PedidoExport,
} from "@/dominio/export-analisis";
import { sanearNombre } from "@/dominio/archivo";
import { AJUSTES_POR_DEFECTO } from "@/dominio/gerencia";

type Fila = Record<string, any>;

/**
 * Lee y descarga. `tiendaId` vacío: todas las tiendas que el usuario puede ver.
 * Devuelve el alcance con el nombre de la tienda tal como se leyó, para que el
 * aviso diga lo mismo que el fichero.
 */
export async function exportarPedidosParaAnalisis({
  tiendaId,
}: {
  tiendaId?: string | null;
}): Promise<{ pedidos: number; avisos: string[]; alcance: string }> {
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
    // Con "*": metros_origen y precio_metro_usado pueden no existir todavía.
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
            "id, pedido_id, tipo, serie, ejercicio, numero, fecha, estado, base_imponible, iva_total, total, fecha_vencimiento, rectifica_a_id, sustituye_a_id",
          )
          .not("pedido_id", "is", null)
          .neq("estado", "borrador"),
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
  // supabase-js no lanza: un fallo de red también llega como `error`.
  for (const r of [pedidos, lineas, documentos, tiendas, empresa]) {
    if (r.error) throw new Error(r.error.message);
  }
  if (cobros.error && !faltaLaTabla(cobros.error)) throw new Error(cobros.error.message);
  if (cobros.error) avisos.push("Sin la tabla de cobros: los cobros salen vacíos.");
  if (!empresa.data) avisos.push("Sin empresa activa: el coste por metro de hoy sale 0.");
  // Sin la migración 20261020100000 las líneas no dicen de dónde salen sus
  // metros, y PostgREST no avisa: select("*") simplemente no trae la columna.
  if (lineas.data.length > 0 && !lineas.data.some((l) => "metros_origen" in l)) {
    avisos.push(
      "Sin la migración 20261020100000 no se sabe de dónde salen los metros: los pedidos web salen con metros_de 'sin_origen', metros_estimados false y eur_metro_medido null.",
    );
  }

  // Como la sincronización: sin ajustes guardados, los de fábrica.
  const ajustes: AjustesExport = {
    precio_metro: AJUSTES_POR_DEFECTO.precio_metro,
    web_sin_pagar_cuenta: AJUSTES_POR_DEFECTO.web_sin_pagar_cuenta,
    de_fabrica: true,
  };
  if (empresa.data?.id) {
    // Como leerAjustesGerencia: sin la migración del precio (20261010100000)
    // se lee lo de antes, y el precio es el de fábrica.
    const leer = (conPrecio: boolean) =>
      tabla(supabase, "gerencia_ajustes")
        .select(conPrecio ? "precio_metro, web_sin_pagar_cuenta" : "web_sin_pagar_cuenta")
        .eq("empresa_id", empresa.data.id)
        .maybeSingle();
    const r0 = await leer(true);
    const sinPrecio = faltaLaColumna(r0.error);
    const r = sinPrecio ? await leer(false) : r0;
    if (r.error) {
      avisos.push(
        faltaLaTabla(r.error)
          ? "Sin la migración de Ajustes de Gerencia: van los ajustes de fábrica."
          : "No se pudieron leer los Ajustes de Gerencia: van los de fábrica.",
      );
    } else {
      if (sinPrecio) {
        avisos.push(
          `Sin la migración 20261010100000: el precio por metro es el de fábrica (${AJUSTES_POR_DEFECTO.precio_metro} €).`,
        );
      }
      if (r.data) {
        ajustes.de_fabrica = false;
        if (Number(r.data.precio_metro) > 0) ajustes.precio_metro = Number(r.data.precio_metro);
        if (typeof r.data.web_sin_pagar_cuenta === "boolean") {
          ajustes.web_sin_pagar_cuenta = r.data.web_sin_pagar_cuenta;
        }
      }
    }
  }

  const listaTiendas = ((tiendas.data ?? []) as Fila[]).filter(
    (t) => !tiendaId || t.id === tiendaId,
  );
  const alcance = tiendaId ? (listaTiendas[0]?.nombre ?? "Tienda") : "Todas las tiendas";

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
    cancelado_en: p.cancelado_en ?? null,
    motivo_cancelacion: p.motivo_cancelacion ?? null,
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
    tiendas: listaTiendas.map((t) => ({ id: t.id, nombre: t.nombre })),
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
      base_imponible: f.base_imponible,
      iva_total: f.iva_total,
      total: f.total,
      fecha_vencimiento: f.fecha_vencimiento ?? null,
      rectifica_a_id: f.rectifica_a_id ?? null,
      sustituye_a_id: f.sustituye_a_id ?? null,
    })),
    costesMetro: {
      consumibles: Number(empresa.data?.coste_consumibles_metro ?? 0),
      packaging: Number(empresa.data?.coste_packaging_metro ?? 0),
      electricidad: Number(empresa.data?.coste_electricidad_metro ?? 0),
    },
    ajustes,
    avisos,
  });

  const nombre = `analisis-pedidos_${sanearNombre(alcance, 40)}_${format(new Date(), "yyyy-MM-dd")}.json`;
  descargarBlob(
    nombre,
    new Blob([serializarExportAnalisis(e)], { type: "application/json;charset=utf-8" }),
  );
  return { pedidos: e.pedidos.length, avisos: e.avisos, alcance };
}
