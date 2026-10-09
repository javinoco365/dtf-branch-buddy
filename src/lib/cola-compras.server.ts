/**
 * La cola de facturas recibidas, en el servidor: leer con la IA, validar,
 * reintentar una vez y dejar la factura en la cola con sus motivos, o como
 * error visible. Nunca a medias ni en silencio.
 *
 * Solo servidor: usa el lector (con su clave de API). Se importa
 * dinámicamente desde los handlers de `compras.functions.ts`.
 */

import { tabla } from "./rpc";
import { leerFactura } from "./lector-facturas.server";
import { normalizarCompra, revisarCompra } from "@/dominio/factura-compra";
import { TIPO_IVA_GENERAL, tipoIrpfProbable, tipoProbable } from "@/dominio/compras";
import {
  avisosQueImportan,
  claveProveedor,
  duplicadosDe,
  motivosRevision,
  validarLectura,
  type CompraComparable,
  type LecturaIa,
} from "@/dominio/cola-compras";

/** Columnas para buscar duplicados. */
const CAMPOS_DUPLICADO =
  "id, proveedor, nif_proveedor, numero, fecha, liquido, total, fichero_huella, estado, borrada_en";

/**
 * Lee el fichero y valida la lectura. Si la lectura falla o no tiene la forma
 * esperada, lo intenta una vez más; si vuelve a fallar, dice por qué.
 */
export async function leerYValidar(
  bytes: Uint8Array,
  tipoMime: string,
): Promise<{ ok: true; lectura: LecturaIa; bruto: unknown } | { ok: false; error: string }> {
  let error = "";
  for (let intento = 1; intento <= 2; intento++) {
    try {
      const bruto = await leerFactura(bytes, tipoMime);
      const v = validarLectura(bruto);
      if (v.ok) return { ok: true, lectura: v.lectura, bruto };
      error = v.error;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, error: `${error} (tras un reintento)` };
}

/** SHA-256 del fichero, en hexadecimal: el mismo PDF da siempre la misma. */
export async function huellaDe(bytes: Uint8Array): Promise<string> {
  const resumen = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(resumen)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type Resultado =
  | { resultado: "pendiente"; id: string; motivos: string[] }
  | { resultado: "error"; id: string; motivo: string };

/**
 * Lee la factura de una fila de la cola y la deja pendiente de revisión, con
 * lo leído y sus motivos; o como error, con el motivo. La fila ya existe:
 * así, pase lo que pase, la factura se ve.
 */
export async function procesarFactura(
  supabase: unknown,
  id: string,
  bytes: Uint8Array,
  tipoMime: string,
  aviso: string | null,
): Promise<Resultado> {
  const marcarError = async (motivo: string): Promise<Resultado> => {
    await tabla(supabase, "textil_compras")
      .update({ revision: "error", revision_motivo: motivo })
      .eq("id", id);
    return { resultado: "error", id, motivo };
  };

  const r = await leerYValidar(bytes, tipoMime);
  if (!r.ok) return marcarError(r.error);

  try {
    const compra = normalizarCompra(r.lectura);
    const avisos = avisosQueImportan(revisarCompra(compra), r.lectura.categoria);
    const tipoIva = compra.base > 0 ? tipoProbable(compra.base, compra.iva) : null;
    const tipoIrpf = (compra.base > 0 && tipoIrpfProbable(compra.base, compra.irpf)) || 0;

    // Las que tienen el mismo proveedor, para buscar duplicados.
    const clave = claveProveedor(compra.nif_proveedor, compra.proveedor);
    const candidatas = clave
      ? await tabla(supabase, "textil_compras")
          .select(CAMPOS_DUPLICADO)
          .eq("proveedor_clave", clave)
          .neq("id", id)
      : { data: [], error: null };
    if (candidatas.error) throw new Error(candidatas.error.message);
    const yo: CompraComparable = {
      id,
      proveedor: compra.proveedor,
      nif_proveedor: compra.nif_proveedor,
      numero: compra.numero,
      fecha: compra.fecha,
      total: compra.total,
    };
    const duplicados = duplicadosDe(yo, (candidatas.data ?? []) as CompraComparable[]);

    // Una línea sin cantidad no se puede guardar (la base exige cantidad > 0).
    const lineas = compra.lineas.filter((l) => l.descripcion && l.cantidad > 0);
    const motivos = [
      ...(aviso ? [aviso] : []),
      ...motivosRevision({
        confianza: r.lectura.confianza,
        dudas: r.lectura.dudas,
        avisos,
        tipoIva,
        categoria: r.lectura.categoria,
        duplicados,
      }),
      ...(lineas.length < compra.lineas.length
        ? [`${compra.lineas.length - lineas.length} línea(s) sin cantidad no se han guardado.`]
        : []),
    ];

    const { error } = await tabla(supabase, "textil_compras")
      .update({
        proveedor: compra.proveedor,
        nif_proveedor: compra.nif_proveedor,
        numero: compra.numero,
        fecha: compra.fecha,
        concepto: r.lectura.concepto,
        categoria: r.lectura.categoria ?? "otros",
        base: compra.base,
        iva: compra.iva,
        irpf: compra.irpf,
        total: compra.total,
        tipo_iva: tipoIva ?? TIPO_IVA_GENERAL,
        tipo_irpf: tipoIrpf,
        confianza: Math.round(r.lectura.confianza * 100) / 100,
        revision: "pendiente",
        revision_motivo: motivos.length ? motivos.join("\n") : null,
        lectura_ia: r.bruto,
      })
      .eq("id", id);
    if (error) throw new Error(error.message);

    const borradas = await tabla(supabase, "textil_compra_lineas").delete().eq("compra_id", id);
    if (borradas.error) throw new Error(borradas.error.message);
    if (lineas.length > 0) {
      const { error: errLineas } = await tabla(supabase, "textil_compra_lineas").insert(
        lineas.map((l, i) => ({
          compra_id: id,
          descripcion: l.descripcion,
          cantidad: l.cantidad,
          precio_unitario: l.precio_unitario,
          importe: l.importe,
          unidad: l.unidad ?? null,
          orden: i,
        })),
      );
      if (errLineas) throw new Error(errLineas.message);
    }
    return { resultado: "pendiente", id, motivos };
  } catch (e) {
    return marcarError(
      `La lectura no se pudo guardar: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
