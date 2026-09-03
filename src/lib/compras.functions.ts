import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { llamarRpc, tabla } from "./rpc";
import { normalizarCompra, revisarCompra } from "@/dominio/factura-compra";

/** La lectura del modelo, guardada tal cual. Si no se puede leer, no se guarda. */
function parsearLectura(texto: string | null | undefined): unknown {
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

/** La empresa activa. Toda compra cuelga de ella. */
async function empresaActiva(supabase: any): Promise<string> {
  const { data } = await tabla(supabase, "empresas")
    .select("id")
    .eq("activa", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!data?.id) throw new Error("No hay ninguna empresa activa configurada");
  return data.id as string;
}

export const hayLector = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { hayLectorConfigurado } = await import("./lector-facturas.server");
    return { disponible: hayLectorConfigurado() };
  });

/**
 * Lee un fichero de factura y devuelve lo que ha entendido, con sus avisos.
 *
 * No escribe nada. Lo que sale de aquí va a una pantalla para revisarlo: la
 * lectura de un modelo es una propuesta, y los movimientos de stock que
 * generaría no se pueden borrar después.
 */
export const leerFacturaCompra = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    if (!(d instanceof FormData)) throw new Error("Falta el fichero");
    const fichero = d.get("fichero");
    if (!(fichero instanceof File)) throw new Error("Falta el fichero");
    return { fichero };
  })
  .handler(async ({ data }) => {
    const { leerFactura } = await import("./lector-facturas.server");
    const bytes = new Uint8Array(await data.fichero.arrayBuffer());
    const bruto = await leerFactura(bytes, data.fichero.type);

    const compra = normalizarCompra(bruto);
    // La lectura en bruto viaja como texto: es JSON libre y el serializador de
    // las server functions solo mueve formas que conoce. Se guarda tal cual
    // para poder comparar después lo que dijo el modelo con lo que se corrigió.
    return { compra, avisos: revisarCompra(compra), bruto_json: JSON.stringify(bruto) };
  });

const lineaSchema = z.object({
  descripcion: z.string().min(1),
  cantidad: z.number().positive(),
  precio_unitario: z.number(),
  importe: z.number(),
  unidad: z.string().optional().nullable(),
  stock_id: z.string().uuid().optional().nullable(),
});

const compraSchema = z.object({
  id: z.string().uuid().optional(),
  proveedor: z.string().optional().nullable(),
  nif_proveedor: z.string().optional().nullable(),
  numero: z.string().optional().nullable(),
  fecha: z.string().optional().nullable(),
  base: z.number(),
  iva: z.number(),
  total: z.number(),
  notas: z.string().optional().nullable(),
  lectura_ia: z.string().optional().nullable(),
  lineas: z.array(lineaSchema),
});

/** Guarda el borrador. Todavía no ha tocado el stock. */
export const guardarCompra = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => compraSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { id, lineas, lectura_ia, ...cabecera } = data;
    const empresa_id = await empresaActiva(context.supabase);

    let compraId = id;
    if (id) {
      const { error } = await tabla(context.supabase, "textil_compras")
        .update(cabecera)
        .eq("id", id);
      if (error) throw new Error(error.message);
      const { error: delErr } = await tabla(context.supabase, "textil_compra_lineas")
        .delete()
        .eq("compra_id", id);
      if (delErr) throw new Error(delErr.message);
    } else {
      const { data: fila, error } = await tabla(context.supabase, "textil_compras")
        .insert({ ...cabecera, empresa_id, lectura_ia: parsearLectura(lectura_ia) })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      compraId = fila.id as string;
    }

    if (lineas.length > 0) {
      const { error } = await tabla(context.supabase, "textil_compra_lineas").insert(
        lineas.map((l, i) => ({ ...l, compra_id: compraId, orden: i })),
      );
      if (error) throw new Error(error.message);
    }
    return { id: compraId };
  });

/** Registra la compra: las líneas casadas entran en el libro de stock. */
export const registrarCompra = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const movidas = await llamarRpc<number>(context.supabase, "textil_compra_registrar", {
      _compra_id: data.id,
    });
    return { movidas };
  });

export const listCompras = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await tabla(context.supabase, "textil_compras")
      .select("*, lineas:textil_compra_lineas(*)")
      .order("fecha", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const borrarCompra = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: compra } = await tabla(context.supabase, "textil_compras")
      .select("estado, numero")
      .eq("id", data.id)
      .maybeSingle();
    if (!compra) throw new Error("La compra no existe");
    if (compra.estado === "registrada") {
      throw new Error(
        `La compra ${compra.numero ?? ""} ya movió stock y no se borra: queda como ` +
          "justificante de por qué entró ese género. Para corregir, haz un ajuste " +
          "de inventario.",
      );
    }
    const { error } = await tabla(context.supabase, "textil_compras").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
