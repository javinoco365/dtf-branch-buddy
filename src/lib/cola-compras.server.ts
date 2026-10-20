/**
 * La cola de facturas recibidas, en el servidor: leer con la IA, validar,
 * reintentar una vez y dejar la factura en la cola con sus motivos, o como
 * error visible. Nunca a medias ni en silencio.
 *
 * Solo servidor: usa el lector (con su clave de API). Se importa
 * dinámicamente desde los handlers de `compras.functions.ts`.
 */

import { faltaLaColumna, faltaLaTabla, tabla } from "./rpc";
import { proformasAplicado } from "./escaner-textil";
import { leerFactura } from "./lector-facturas.server";
// Reexportado para que compras.functions lo cargue con el mismo import() que
// el resto: lector-facturas.server ya se importa aquí de forma normal, y
// cargarlo también con import() puede romper el arranque del servidor (ver
// src/arquitectura/importaciones-mixtas.test.ts).
export { hayLectorConfigurado } from "./lector-facturas.server";
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
import { claveNif, claveTexto } from "@/dominio/normalizar-textil";
import { sugerirProformas, type ProformaFila, type SugerenciaProforma } from "@/dominio/proformas";
import type { TipoDocumentoCompra } from "@/dominio/tipos-textil";

/** Columnas para buscar duplicados (sin las de proformas, sin su migración). */
const CAMPOS_DUPLICADO_SIEMPRE =
  "id, proveedor, nif_proveedor, numero, fecha, liquido, total, fichero_huella, estado, borrada_en";
/** Con las migraciones de proformas: el tipo y el casado, para no marcar el par como duplicado. */
const CAMPOS_DUPLICADO = `${CAMPOS_DUPLICADO_SIEMPRE}, tipo_documento, proforma_id`;

/** Lo que pide `ProformaFila` de una proforma candidata (sin líneas: aún no hay variantes). */
const CAMPOS_PROFORMA =
  "id, proveedor, nif_proveedor, proveedor_id, numero, fecha, categoria, base, total, liquido, " +
  "estado, borrada_en, tipo_documento, estado_pago, fecha_pago";

/** Motivo extra: la IA dice proforma y la base todavía no sabe de proformas. */
export const MOTIVO_PROFORMA_SIN_MIGRACION =
  "Es una proforma, pero falta aplicar la migración de proformas: no la registres hasta entonces.";

/**
 * El proveedor del catálogo, como `leerMemoriaEscaner`: por NIF y, sin NIF,
 * por nombre. Sin la tabla o sus columnas (migración del escáner), ninguno.
 */
async function proveedorDelCatalogo(
  supabase: unknown,
  nif: string | null,
  nombre: string | null,
): Promise<string | null> {
  const n = claveNif(nif);
  const t = claveTexto(nombre);
  const buscar = () => tabla(supabase, "proveedores").select("id");
  const r = n
    ? await buscar().eq("nif_clave", n).limit(2)
    : t
      ? await buscar().eq("nombre_clave", t).limit(2)
      : { data: [], error: null };
  if (faltaLaTabla(r.error) || faltaLaColumna(r.error)) return null;
  if (r.error) throw new Error(r.error.message);
  const filas = (r.data ?? []) as { id: string }[];
  // Dos con el mismo nombre: no se sabe cuál; se queda en la clave de proveedor.
  return filas.length === 1 ? filas[0].id : null;
}

/**
 * Las proformas registradas, sin borrar y sin factura del mismo proveedor que
 * el documento, puntuadas por `sugerirProformas`. Nunca casa: propone. Sin la
 * migración de proformas, ninguna.
 */
async function proformasCandidatas(
  supabase: unknown,
  id: string,
  compra: ReturnType<typeof normalizarCompra>,
  categoria: string | null,
  clave: string,
): Promise<SugerenciaProforma[]> {
  const proveedorId = await proveedorDelCatalogo(supabase, compra.nif_proveedor, compra.proveedor);
  const condiciones = [
    ...(clave ? [`proveedor_clave.eq.${clave}`] : []),
    ...(proveedorId ? [`proveedor_id.eq.${proveedorId}`] : []),
  ];
  if (condiciones.length === 0) return [];
  const r = await tabla(supabase, "textil_compras")
    .select(CAMPOS_PROFORMA)
    .eq("tipo_documento", "proforma")
    .eq("estado", "registrada")
    .is("borrada_en", null)
    .neq("id", id)
    .or(condiciones.join(","));
  if (faltaLaColumna(r.error)) return [];
  if (r.error) throw new Error(r.error.message);
  const filas = (r.data ?? []) as ProformaFila[];
  if (filas.length === 0) return [];

  // Las que ya tienen factura no se proponen.
  const casadasR = await tabla(supabase, "textil_compras")
    .select("proforma_id")
    .in(
      "proforma_id",
      filas.map((f) => f.id),
    );
  if (faltaLaColumna(casadasR.error)) return [];
  if (casadasR.error) throw new Error(casadasR.error.message);
  const casadas = new Set(
    ((casadasR.data ?? []) as { proforma_id: string | null }[])
      .map((f) => f.proforma_id)
      .filter((v): v is string => !!v),
  );

  return sugerirProformas(
    {
      id,
      proveedor: compra.proveedor,
      nif_proveedor: compra.nif_proveedor,
      proveedor_id: proveedorId,
      fecha: compra.fecha,
      base: compra.base,
      total: compra.total,
      categoria,
      referencia_proforma: compra.referencia_proforma ?? null,
      unidades: null,
    },
    filas,
    casadas,
  );
}

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

/** Motivo de revisión cuando la base todavía no tiene las columnas de línea del escáner. */
export const MOTIVO_SIN_COLUMNAS_ESCANER =
  "Falta aplicar la migración 20261028100000: se han guardado las líneas sin tipo, talla, color ni referencia.";

export type OpcionesProcesar = {
  /**
   * La factura se subió desde Textil › Compras: es textil, lo diga o no la IA
   * (y no sale el motivo «La IA no sabe qué es»).
   */
  categoria?: "textil";
};

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
  opciones?: OpcionesProcesar,
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
    // Subida desde Textil: la categoría no la decide la IA.
    const categoria = opciones?.categoria ?? r.lectura.categoria;
    const avisos = avisosQueImportan(revisarCompra(compra), categoria);
    const tipoIva = compra.base > 0 ? tipoProbable(compra.base, compra.iva) : null;
    const tipoIrpf = (compra.base > 0 && tipoIrpfProbable(compra.base, compra.irpf)) || 0;

    // Las que tienen el mismo proveedor, para buscar duplicados.
    const clave = claveProveedor(compra.nif_proveedor, compra.proveedor);
    const buscarDuplicados = (campos: string) =>
      tabla(supabase, "textil_compras").select(campos).eq("proveedor_clave", clave).neq("id", id);
    let candidatas = clave ? await buscarDuplicados(CAMPOS_DUPLICADO) : { data: [], error: null };
    // Sin las migraciones de proformas: sin tipo ni casado (todas son facturas).
    if (clave && faltaLaColumna(candidatas.error)) {
      candidatas = await buscarDuplicados(CAMPOS_DUPLICADO_SIEMPRE);
    }
    if (candidatas.error) throw new Error(candidatas.error.message);

    // Lo que dijo la IA: factura, proforma o null si dudó. Sin la migración
    // de proformas no hay selector: no se pide elegir ni se habla de proformas
    // (salvo el aviso de que falta la migración).
    const tipo: TipoDocumentoCompra | null = r.lectura.tipo_documento ?? null;
    const conProformas = await proformasAplicado(supabase);
    const yo: CompraComparable = {
      id,
      proveedor: compra.proveedor,
      nif_proveedor: compra.nif_proveedor,
      numero: compra.numero,
      fecha: compra.fecha,
      total: compra.total,
      tipo_documento: conProformas ? (tipo ?? "factura") : "factura",
    };
    const duplicados = duplicadosDe(yo, (candidatas.data ?? []) as CompraComparable[]);

    // Una factura (o un documento dudoso) puede ser la de una proforma ya
    // registrada: se proponen, nunca se casan solas.
    const proformas =
      tipo !== "proforma"
        ? await proformasCandidatas(supabase, id, compra, categoria ?? null, clave)
        : [];

    // Una línea sin cantidad no se puede guardar (la base exige cantidad > 0).
    const lineas = compra.lineas.filter((l) => l.descripcion && l.cantidad > 0);
    const motivos = [
      ...(aviso ? [aviso] : []),
      ...motivosRevision({
        confianza: r.lectura.confianza,
        dudas: r.lectura.dudas,
        avisos,
        tipoIva,
        categoria,
        duplicados,
        ...(conProformas ? { tipoDocumento: tipo } : {}),
        proformas,
      }),
      ...(tipo === "proforma" && !conProformas ? [MOTIVO_PROFORMA_SIN_MIGRACION] : []),
      ...(lineas.length < compra.lineas.length
        ? [`${compra.lineas.length - lineas.length} línea(s) sin cantidad no se han guardado.`]
        : []),
    ];

    const cabecera = {
      proveedor: compra.proveedor,
      nif_proveedor: compra.nif_proveedor,
      numero: compra.numero,
      fecha: compra.fecha,
      concepto: r.lectura.concepto,
      categoria: categoria ?? "otros",
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
    };
    const actualizar = (campos: Record<string, unknown>) =>
      tabla(supabase, "textil_compras").update(campos).eq("id", id);
    let { error } = await actualizar({ ...cabecera, tipo_documento: tipo ?? "factura" });
    // Sin las migraciones de proformas, sin la columna (la duda queda en lectura_ia).
    if (faltaLaColumna(error)) ({ error } = await actualizar(cabecera));
    if (error) throw new Error(error.message);

    const borradas = await tabla(supabase, "textil_compra_lineas").delete().eq("compra_id", id);
    if (borradas.error) throw new Error(borradas.error.message);
    if (lineas.length > 0) {
      const deSiempre = lineas.map((l, i) => ({
        compra_id: id,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        precio_unitario: l.precio_unitario,
        importe: l.importe,
        unidad: l.unidad ?? null,
        orden: i,
      }));
      // Con la migración 20261028100000, además lo que la IA leyó de la prenda.
      const conEscaner = lineas.map((l, i) => ({
        ...deSiempre[i],
        tipo: l.tipo ?? "articulo",
        referencia: l.referencia ?? null,
        marca: l.marca ?? null,
        modelo: l.modelo ?? null,
        color: l.color ?? null,
        talla: l.talla ?? null,
        ean: l.ean ?? null,
        unidades_por_pack: l.unidades_por_pack ?? 1,
      }));
      // Con las migraciones de proformas, además la línea del papel de la que sale.
      const conProformas = lineas.map((l, i) => ({
        ...conEscaner[i],
        linea_papel: l.linea_papel ?? null,
      }));
      const insertar = (filas: Record<string, unknown>[]) =>
        tabla(supabase, "textil_compra_lineas").insert(filas);
      let { error: errLineas } = await insertar(conProformas);
      // Sin linea_papel: las del escáner, sin motivo extra.
      if (faltaLaColumna(errLineas)) ({ error: errLineas } = await insertar(conEscaner));
      if (faltaLaColumna(errLineas)) {
        ({ error: errLineas } = await tabla(supabase, "textil_compra_lineas").insert(deSiempre));
        if (!errLineas) {
          motivos.push(MOTIVO_SIN_COLUMNAS_ESCANER);
          const { error: errMotivo } = await tabla(supabase, "textil_compras")
            .update({ revision_motivo: motivos.join("\n") })
            .eq("id", id);
          if (errMotivo) throw new Error(errMotivo.message);
        }
      }
      if (errLineas) throw new Error(errLineas.message);
    }
    return { resultado: "pendiente", id, motivos };
  } catch (e) {
    return marcarError(
      `La lectura no se pudo guardar: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
