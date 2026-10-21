/**
 * Server functions del escáner textil: proveedores, catálogo de productos,
 * memoria del escáner y fusión de variantes repetidas.
 *
 * Tolerantes a la migración: sin 20261028100000 (y siguientes) las lecturas
 * devuelven `disponible: false` y listas vacías, y las escrituras dicen qué
 * migración falta. Lo que ya funcionaba no depende de nada de aquí.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { exigeBorrar, exigeEscribir } from "./permisos-middleware";
import { faltaLaColumna, faltaLaFuncion, faltaLaTabla, llamarRpcConError, tabla } from "./rpc";
import { leerTodas } from "./paginar";
import { AVISO_MIGRACION_ESCANER, escanerAplicado, textoONulo } from "./escaner-textil";
import { claveNif, claveTexto } from "@/dominio/normalizar-textil";
import type { EntradaMemoria, ProductoTextil, Proveedor } from "@/dominio/tipos-textil";

/** La empresa activa: las tablas del escáner cuelgan de ella. */
async function empresaActiva(supabase: unknown): Promise<string> {
  const { data } = await tabla(supabase, "empresas")
    .select("id")
    .eq("activa", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!data?.id) throw new Error("No hay ninguna empresa activa configurada");
  return data.id as string;
}

/** La tabla o la columna todavía no existe: falta la migración del escáner. */
const faltaMigracion = (error: { code?: string } | null | undefined) =>
  faltaLaTabla(error) || faltaLaColumna(error);

const CAMPOS_PROVEEDOR = "id, nombre, nif, activo";
const CAMPOS_PRODUCTO = "id, marca, referencia, nombre, categoria, activo";

const aProveedor = (f: Record<string, unknown>): Proveedor => ({
  id: String(f.id),
  nombre: String(f.nombre ?? ""),
  nif: (f.nif as string | null) ?? null,
  activo: f.activo !== false,
});

const aProducto = (f: Record<string, unknown>): ProductoTextil => ({
  id: String(f.id),
  marca: (f.marca as string | null) ?? null,
  referencia: (f.referencia as string | null) ?? null,
  nombre: String(f.nombre ?? ""),
  categoria: (f.categoria as string | null) ?? null,
  activo: f.activo !== false,
});

/** ¿Están aplicadas las tres migraciones del escáner? */
export const estadoEscanerTextil = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => ({ aplicada: await escanerAplicado(context.supabase) }));

export type MemoriaEscaner = {
  disponible: boolean;
  proveedor: (Proveedor & { compras: number }) | null;
  entradas: EntradaMemoria[];
};

/**
 * El proveedor de una factura y lo que el escáner ha aprendido de él.
 *
 * Lo busca por id; si no, por NIF (`nif_clave`); si la factura no trae NIF,
 * por nombre el que tiene NIF, si es uno solo (la IA no leyó el NIF de un
 * proveedor que ya está en el catálogo); y si no, por nombre entre los que no
 * tienen NIF. Igual que el registro, que a este último le completa el NIF si
 * la factura lo trae.
 */
export const leerMemoriaEscaner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        proveedor_id: z.string().uuid().nullable().optional(),
        nif: z.string().nullable().optional(),
        proveedor: z.string().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<MemoriaEscaner> => {
    const sinMigracion: MemoriaEscaner = { disponible: false, proveedor: null, entradas: [] };
    const empresa = await empresaActiva(context.supabase);
    const buscar = () =>
      tabla(context.supabase, "proveedores").select(CAMPOS_PROVEEDOR).eq("empresa_id", empresa);

    let fila: Record<string, unknown> | null = null;
    const nif = claveNif(data.nif);
    const nombre = claveTexto(data.proveedor);
    if (data.proveedor_id) {
      const r = await buscar().eq("id", data.proveedor_id).maybeSingle();
      if (faltaMigracion(r.error)) return sinMigracion;
      if (r.error) throw new Error(r.error.message);
      fila = r.data;
    }
    if (!fila && nif) {
      const r = await buscar().eq("nif_clave", nif).maybeSingle();
      if (faltaMigracion(r.error)) return sinMigracion;
      if (r.error) throw new Error(r.error.message);
      fila = r.data;
    }
    if (!fila && nombre && !nif) {
      const r = await buscar().eq("nombre_clave", nombre).neq("nif_clave", "").limit(2);
      if (faltaMigracion(r.error)) return sinMigracion;
      if (r.error) throw new Error(r.error.message);
      if (r.data?.length === 1) fila = r.data[0] as Record<string, unknown>;
    }
    if (!fila && nombre) {
      const r = await buscar().eq("nombre_clave", nombre).eq("nif_clave", "").maybeSingle();
      if (faltaMigracion(r.error)) return sinMigracion;
      if (r.error) throw new Error(r.error.message);
      fila = r.data;
    }
    if (!fila) {
      // Sin nada con que buscar no se ha consultado la tabla: se mira que
      // exista, para no decir «disponible» sin la migración.
      if (!data.proveedor_id && !nif && !nombre) {
        const r = await tabla(context.supabase, "proveedores").select("id").limit(1);
        if (faltaMigracion(r.error)) return sinMigracion;
        if (r.error) throw new Error(r.error.message);
      }
      return { disponible: true, proveedor: null, entradas: [] };
    }

    const proveedor = aProveedor(fila);
    const compras = await tabla(context.supabase, "textil_compras")
      .select("id", { count: "exact", head: true })
      .eq("proveedor_id", proveedor.id);
    if (compras.error && !faltaMigracion(compras.error)) throw new Error(compras.error.message);

    // Por páginas: Supabase corta en 1000 filas sin avisar (ver paginar.ts).
    const memoria = await leerTodas<Record<string, unknown>>((a, b) =>
      tabla(context.supabase, "textil_referencias_proveedor")
        .select("id, clave, stock_id, unidades_por_pack, veces")
        .eq("proveedor_id", proveedor.id)
        .order("clave")
        .order("id")
        .range(a, b),
    );
    if (faltaMigracion(memoria.error)) return sinMigracion;
    if (memoria.error) throw new Error(memoria.error.message);

    return {
      disponible: true,
      proveedor: { ...proveedor, compras: compras.count ?? 0 },
      entradas: memoria.data.map((m) => ({
        id: String(m.id),
        clave: String(m.clave),
        stock_id: String(m.stock_id),
        unidades_por_pack: Number(m.unidades_por_pack ?? 1),
        veces: Number(m.veces ?? 1),
      })),
    };
  });

/** Olvida una entrada de la memoria del escáner (la siguiente factura no la usará). */
export const olvidarMemoriaEscaner = createServerFn({ method: "POST" })
  .middleware([exigeBorrar])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await tabla(context.supabase, "textil_referencias_proveedor")
      .delete()
      .eq("id", data.id);
    if (faltaMigracion(error)) throw new Error(AVISO_MIGRACION_ESCANER);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Los proveedores de la empresa, por nombre. */
export const listProveedores = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ disponible: boolean; proveedores: Proveedor[] }> => {
    const empresa = await empresaActiva(context.supabase);
    const r = await leerTodas<Record<string, unknown>>((a, b) =>
      tabla(context.supabase, "proveedores")
        .select(CAMPOS_PROVEEDOR)
        .eq("empresa_id", empresa)
        .order("nombre")
        .order("id")
        .range(a, b),
    );
    if (faltaMigracion(r.error)) return { disponible: false, proveedores: [] };
    if (r.error) throw new Error(r.error.message);
    return { disponible: true, proveedores: r.data.map(aProveedor) };
  });

/**
 * Corrige el nombre, el NIF o si está activo un proveedor (por ejemplo, un NIF
 * mal leído). No toca sus compras: conservan el texto de su factura.
 */
export const guardarProveedor = createServerFn({ method: "POST" })
  .middleware([exigeEscribir])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        nombre: z.string().trim().min(1, "Falta el nombre del proveedor."),
        nif: z.string().nullable(),
        activo: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: filas, error } = await tabla(context.supabase, "proveedores")
      .update({ nombre: data.nombre.trim(), nif: textoONulo(data.nif), activo: data.activo })
      .eq("id", data.id)
      .select("id");
    if (faltaMigracion(error)) throw new Error(AVISO_MIGRACION_ESCANER);
    if (error?.code === "23505") {
      throw new Error("Ya hay otro proveedor con ese NIF (o ese nombre, sin NIF).");
    }
    if (error) throw new Error(error.message);
    if (!filas?.length) throw new Error("El proveedor no existe.");
    return { ok: true as const };
  });

/** Los productos (modelos de prenda) de la empresa, por marca y nombre. */
export const listProductosTextil = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ disponible: boolean; productos: ProductoTextil[] }> => {
    const empresa = await empresaActiva(context.supabase);
    const r = await leerTodas<Record<string, unknown>>((a, b) =>
      tabla(context.supabase, "textil_productos")
        .select(CAMPOS_PRODUCTO)
        .eq("empresa_id", empresa)
        .order("marca", { nullsFirst: true })
        .order("nombre")
        .order("id")
        .range(a, b),
    );
    if (faltaMigracion(r.error)) return { disponible: false, productos: [] };
    if (r.error) throw new Error(r.error.message);
    return { disponible: true, productos: r.data.map(aProducto) };
  });

/** Alta o edición de un producto del catálogo textil. */
export const guardarProductoTextil = createServerFn({ method: "POST" })
  .middleware([exigeEscribir])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        marca: z.string().nullable(),
        referencia: z.string().nullable(),
        nombre: z.string().trim().min(1, "Falta el nombre del producto."),
        categoria: z.string().nullable(),
        activo: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const campos = {
      marca: textoONulo(data.marca),
      referencia: textoONulo(data.referencia),
      nombre: data.nombre.trim(),
      categoria: textoONulo(data.categoria),
      ...(data.activo === undefined ? {} : { activo: data.activo }),
    };
    const r = data.id
      ? await tabla(context.supabase, "textil_productos")
          .update(campos)
          .eq("id", data.id)
          .select("id")
          .maybeSingle()
      : await tabla(context.supabase, "textil_productos")
          .insert({ ...campos, empresa_id: await empresaActiva(context.supabase) })
          .select("id")
          .single();
    if (faltaMigracion(r.error)) throw new Error(AVISO_MIGRACION_ESCANER);
    if (r.error?.code === "23505") {
      throw new Error("Ya existe un producto con esa marca y referencia (o ese nombre).");
    }
    if (r.error) throw new Error(r.error.message);
    if (!r.data?.id) throw new Error("El producto no existe.");
    return { id: String(r.data.id) };
  });

export type ResultadoFusion = { unidades: number; reservas: number; lineas: number };

/**
 * Fusiona una variante repetida en la buena: pasa sus unidades (con dos
 * ajustes al coste medio), sus reservas, las líneas de presupuestos, pedidos y
 * compras en borrador y la memoria del escáner. Todo en una transacción de la
 * base (`textil_stock_fusionar`), con autor.
 */
export const fusionarVariantes = createServerFn({ method: "POST" })
  .middleware([exigeBorrar])
  .inputValidator((d: unknown) =>
    z.object({ origen: z.string().uuid(), destino: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<ResultadoFusion> => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const { data: r, error } = await llamarRpcConError<ResultadoFusion>(
      adminComoUsuario(context.userId),
      "textil_stock_fusionar",
      { _origen: data.origen, _destino: data.destino, _usuario_id: context.userId },
    );
    if (faltaLaFuncion(error)) throw new Error(AVISO_MIGRACION_ESCANER);
    if (error) throw new Error(error.message);
    return {
      unidades: Number(r?.unidades ?? 0),
      reservas: Number(r?.reservas ?? 0),
      lineas: Number(r?.lineas ?? 0),
    };
  });
