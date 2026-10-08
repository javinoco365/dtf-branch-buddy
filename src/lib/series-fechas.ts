/**
 * La fecha del último documento de una serie: la que la base usa para no dejar
 * emitir hacia atrás (factura_comprobar_fecha). Misma consulta: las facturas de
 * tienda y las de textil, que comparten numeración, por empresa, serie y año.
 *
 * Recibe el cliente de Supabase de quien llama (en servidor, después de
 * comprobar el acceso): no importa nada de servidor por su cuenta.
 */

import { tabla } from "./rpc";
import { fechaEmision, notasConFechaOperacion } from "@/dominio/fecha-documento";

type Sb = any;

export type DocumentoSerie = "ticket" | "factura";

/** Las series de la empresa, como empresa_serie(): sin prefijo, cadena vacía. */
async function seriesDeEmpresa(sb: Sb, empresaId: string) {
  const { data, error } = await tabla(sb, "empresas")
    .select("serie_factura, serie_simplificada")
    .eq("id", empresaId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    factura: (data?.serie_factura as string | null) ?? "",
    ticket: (data?.serie_simplificada as string | null) ?? "",
  };
}

async function ultimaDe(
  sb: Sb,
  tablaNombre: string,
  empresaId: string,
  serie: string,
  ejercicio: number,
) {
  const { data, error } = await tabla(sb, tablaNombre)
    .select("fecha")
    .eq("empresa_id", empresaId)
    .eq("serie", serie)
    .eq("ejercicio", ejercicio)
    .order("fecha", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.fecha as string | null)?.slice(0, 10) ?? null;
}

async function ultimaDeSerie(sb: Sb, empresaId: string, serie: string, ejercicio: number) {
  const [tienda, textil] = await Promise.all([
    ultimaDe(sb, "facturas", empresaId, serie, ejercicio),
    ultimaDe(sb, "textil_facturas", empresaId, serie, ejercicio),
  ]);
  if (!tienda) return textil;
  if (!textil) return tienda;
  return tienda > textil ? tienda : textil;
}

/** La fecha ('yyyy-mm-dd') del último ticket o factura de la empresa en ese año, o null. */
export async function ultimaFechaSerie(
  sb: Sb,
  empresaId: string,
  documento: DocumentoSerie,
  ejercicio: number,
): Promise<string | null> {
  const series = await seriesDeEmpresa(sb, empresaId);
  return ultimaDeSerie(sb, empresaId, series[documento], ejercicio);
}

/** Las dos a la vez, para enseñarlas antes de emitir. */
export async function ultimasFechasSeries(
  sb: Sb,
  empresaId: string | null,
  ejercicio: number,
): Promise<{ ejercicio: number; ticket: string | null; factura: string | null }> {
  if (!empresaId) return { ejercicio, ticket: null, factura: null };
  const series = await seriesDeEmpresa(sb, empresaId);
  const [ticket, factura] = await Promise.all([
    ultimaDeSerie(sb, empresaId, series.ticket, ejercicio),
    ultimaDeSerie(sb, empresaId, series.factura, ejercicio),
  ]);
  return { ejercicio, ticket, factura };
}

/**
 * La fecha con la que emitir el documento de un pedido: la pedida o, si la
 * serie ya tiene uno posterior, la de ese, con la pedida escrita en las notas
 * como fecha de la operación (ver fechaEmision en src/dominio).
 */
export async function fechaParaEmitir(
  sb: Sb,
  empresaId: string | null,
  documento: DocumentoSerie,
  deseada: string,
  notas: string | null | undefined,
): Promise<{ fecha: string; fecha_operacion: string | null; notas: string | null }> {
  const ultima = empresaId
    ? await ultimaFechaSerie(sb, empresaId, documento, Number(deseada.slice(0, 4)))
    : null;
  const { fecha, fechaOperacion } = fechaEmision(deseada, ultima);
  return {
    fecha,
    fecha_operacion: fechaOperacion,
    notas: notasConFechaOperacion(notas, fechaOperacion),
  };
}
