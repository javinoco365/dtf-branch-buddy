import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { faltaLaColumna, llamarRpc, tabla } from "./rpc";
import { normalizarCompra, revisarCompra } from "@/dominio/factura-compra";
import { CATEGORIAS_COMPRA, FORMAS_PAGO } from "@/dominio/compras";
import { avisoDuplicado, type CompraComparable } from "@/dominio/cola-compras";

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
    return { disponible: await hayLectorConfigurado() };
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
    const { leerYValidar } = await import("./cola-compras.server");
    const bytes = new Uint8Array(await data.fichero.arrayBuffer());
    // Validada contra el esquema, con un reintento; si no, el error se ve.
    const r = await leerYValidar(bytes, data.fichero.type);
    if (!r.ok) throw new Error(r.error);
    const bruto = r.bruto;

    const compra = normalizarCompra(r.lectura);
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
  // Solo desde la pantalla general (con la migración 20261013100000).
  irpf: z.number().min(0).optional(),
  categoria: z.enum(CATEGORIAS_COMPRA.map((c) => c.valor) as [string, ...string[]]).optional(),
  gasto_id: z.string().uuid().nullable().optional(),
  // Con la migración 20261014100000: la base calcula los importes con estos tipos.
  tipo_iva: z.number().min(0).max(1).optional(),
  tipo_irpf: z.number().min(0).max(1).optional(),
  liquido_origen: z.enum(["calculado", "factura"]).optional(),
  nota_descuadre: z.string().trim().nullable().optional(),
  concepto: z.string().trim().nullable().optional(),
  forma_pago: z
    .enum(FORMAS_PAGO.map((f) => f.valor) as [string, ...string[]])
    .nullable()
    .optional(),
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
    // Registrarla es confirmarla: la ha revisado una persona.
    const antes = await tabla(context.supabase, "textil_compras")
      .select("revision")
      .eq("id", data.id)
      .maybeSingle();
    const conCola = !faltaLaColumna(antes.error) && antes.data?.revision !== undefined;
    if (conCola && antes.data?.revision !== "revisada") {
      const { error } = await tabla(context.supabase, "textil_compras")
        .update({ revision: "revisada" })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
    }
    try {
      const movidas = await llamarRpc<number>(context.supabase, "textil_compra_registrar", {
        _compra_id: data.id,
      });
      return { movidas };
    } catch (e) {
      // Si no se registra, vuelve a la cola como estaba.
      if (conCola && antes.data?.revision !== "revisada") {
        await tabla(context.supabase, "textil_compras")
          .update({ revision: antes.data?.revision })
          .eq("id", data.id);
      }
      const mensaje = e instanceof Error ? e.message : String(e);
      if (/textil_compras_factura_unica|duplicate key/i.test(mensaje)) {
        throw new Error(
          "Esta factura (mismo proveedor y número) ya está registrada. Si es un duplicado, bórrala.",
        );
      }
      throw e;
    }
  });

/**
 * Las compras, con sus líneas. `soloTextil`: solo las de textil (todas, sin
 * la migración de compras generales, que lo son). `generales` dice si la
 * migración está aplicada.
 */
export const listCompras = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ soloTextil: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const prueba = await tabla(context.supabase, "textil_compras").select("categoria").limit(1);
    const generales = !faltaLaColumna(prueba.error);
    const prueba2 = await tabla(context.supabase, "textil_compras").select("liquido").limit(1);
    // Con la migración 20261014100000 la base calcula los importes.
    const recibidas = !faltaLaColumna(prueba2.error);
    const prueba3 = await tabla(context.supabase, "textil_compras").select("revision").limit(1);
    // Con la migración 20261015100000 hay cola de revisión y subida de varias.
    const cola = !faltaLaColumna(prueba3.error);
    let consulta = tabla(context.supabase, "textil_compras").select(
      "*, lineas:textil_compra_lineas(*)",
    );
    if (generales && data.soloTextil) consulta = consulta.eq("categoria", "textil");
    const { data: compras, error } = await consulta
      .order("fecha", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { compras: (compras ?? []) as any[], generales, recibidas, cola };
  });

/**
 * Borra una compra.
 *
 * - Un borrador (no ha contado nunca) se borra de verdad.
 * - Una factura registrada no se borra: se marca como borrada (borrado
 *   lógico) y deja de contar. La de textil, nunca: ya movió stock.
 */
export const borrarCompra = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: compra } = await tabla(context.supabase, "textil_compras")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!compra) throw new Error("La compra no existe");
    if (compra.estado === "registrada") {
      if ((compra.categoria ?? "textil") === "textil") {
        throw new Error(
          `La compra ${compra.numero ?? ""} ya movió stock y no se borra: queda como ` +
            "justificante de por qué entró ese género. Para corregir, haz un ajuste " +
            "de inventario.",
        );
      }
      if (!("borrada_en" in compra)) {
        throw new Error(
          "Una factura registrada no se borra. Falta aplicar la migración 20261014100000.",
        );
      }
      const { error } = await tabla(context.supabase, "textil_compras")
        .update({ borrada_en: new Date().toISOString() })
        .eq("id", data.id)
        .is("borrada_en", null);
      if (error) throw new Error(error.message);
      return { ok: true, logico: true };
    }
    const { error } = await tabla(context.supabase, "textil_compras").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, logico: false };
  });

/** Marca una factura recibida como pagada (con su fecha) o la vuelve a pendiente. */
export const pagarCompra = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        fecha_pago: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida")
          .nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await tabla(context.supabase, "textil_compras")
      .update({
        estado_pago: data.fecha_pago ? "pagada" : "pendiente",
        fecha_pago: data.fecha_pago,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Cola de revisión: varias facturas, leídas con IA, que confirma una persona
// ---------------------------------------------------------------------------

const TIPOS_FICHERO: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const ficheroDe = (d: unknown) => {
  if (!(d instanceof FormData)) throw new Error("Falta el fichero");
  const fichero = d.get("fichero");
  if (!(fichero instanceof File)) throw new Error("Falta el fichero");
  if (!TIPOS_FICHERO[fichero.type]) {
    throw new Error(
      `Formato no admitido (${fichero.type || "desconocido"}). Sube un PDF, un JPG o un PNG.`,
    );
  }
  if (fichero.size > 10 * 1024 * 1024) throw new Error("El fichero pesa más de 10 MB.");
  return { fichero };
};

/**
 * Sube una factura a la cola: guarda el fichero en compras/ronoca/<año>/,
 * crea la fila (para que se vea pase lo que pase), la lee con IA y la deja
 * pendiente de revisión o como error. Si el mismo fichero ya está subido, no
 * hace nada y lo dice.
 */
export const subirFacturaRecibida = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(ficheroDe)
  .handler(async ({ data, context }) => {
    const { huellaDe, procesarFactura } = await import("./cola-compras.server");
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const bytes = new Uint8Array(await data.fichero.arrayBuffer());
    const huella = await huellaDe(bytes);

    const previas = await tabla(context.supabase, "textil_compras")
      .select("id, proveedor, numero, fecha, estado, borrada_en")
      .eq("fichero_huella", huella);
    if (faltaLaColumna(previas.error)) {
      throw new Error("Falta aplicar la migración 20261015100000 (cola de revisión).");
    }
    if (previas.error) throw new Error(previas.error.message);
    const filas = (previas.data ?? []) as CompraComparable[];
    const viva = filas.find((p) => !p.borrada_en);
    if (viva) {
      return {
        resultado: "duplicado" as const,
        motivo: avisoDuplicado({ nivel: "archivo", de: viva, borrada: false }),
      };
    }
    const borrada = filas.find((p) => p.borrada_en);

    const empresa_id = await empresaActiva(context.supabase);
    const id = crypto.randomUUID();
    const ruta = `ronoca/${new Date().getFullYear()}/${id}.${TIPOS_FICHERO[data.fichero.type]}`;
    const admin = adminComoUsuario(context.userId);
    const subida = await admin.storage
      .from("compras")
      .upload(ruta, bytes, { contentType: data.fichero.type, upsert: false });
    if (subida.error) throw new Error(`No se pudo guardar el fichero: ${subida.error.message}`);

    const { error } = await tabla(context.supabase, "textil_compras").insert({
      id,
      empresa_id,
      categoria: "otros",
      revision: "pendiente",
      revision_motivo: "Leyendo con IA…",
      fichero_ruta: ruta,
      fichero_huella: huella,
      notas: `Fichero: ${data.fichero.name}`,
    });
    if (error) throw new Error(error.message);

    return procesarFactura(
      context.supabase,
      id,
      bytes,
      data.fichero.type,
      borrada ? avisoDuplicado({ nivel: "archivo", de: borrada, borrada: true }) : null,
    );
  });

/** Vuelve a leer con IA una factura de la cola (por ejemplo, una que dio error). */
export const releerFacturaRecibida = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { procesarFactura } = await import("./cola-compras.server");
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const { data: fila, error } = await tabla(context.supabase, "textil_compras")
      .select("estado, fichero_ruta")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!fila) throw new Error("La factura no existe");
    if (fila.estado !== "borrador") throw new Error("Una factura registrada no se vuelve a leer.");
    if (!fila.fichero_ruta)
      throw new Error("Esta factura no tiene fichero: se dio de alta a mano.");
    const descarga = await adminComoUsuario(context.userId)
      .storage.from("compras")
      .download(fila.fichero_ruta);
    if (descarga.error || !descarga.data) throw new Error("No se encuentra el fichero.");
    const extension = String(fila.fichero_ruta).split(".").pop() ?? "";
    const tipo =
      Object.entries(TIPOS_FICHERO).find(([, ext]) => ext === extension)?.[0] ?? "application/pdf";
    await tabla(context.supabase, "textil_compras")
      .update({ revision: "pendiente", revision_motivo: "Leyendo con IA…" })
      .eq("id", data.id);
    return procesarFactura(
      context.supabase,
      data.id,
      new Uint8Array(await descarga.data.arrayBuffer()),
      tipo,
      null,
    );
  });

/** Un enlace temporal (10 minutos) para ver el fichero de una factura. */
export const verFicheroCompra = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const { data: fila } = await tabla(context.supabase, "textil_compras")
      .select("fichero_ruta")
      .eq("id", data.id)
      .maybeSingle();
    if (!fila?.fichero_ruta) throw new Error("Esta factura no tiene fichero.");
    const firmada = await adminComoUsuario(context.userId)
      .storage.from("compras")
      .createSignedUrl(fila.fichero_ruta, 600);
    if (firmada.error || !firmada.data) throw new Error("No se pudo abrir el fichero.");
    return { url: firmada.data.signedUrl };
  });

/**
 * Guarda el fichero de una compra que todavía no lo tiene: la que se leyó sin
 * la cola (el fichero se leía y se tiraba), la que se dio de alta a mano y
 * cualquiera de antes. Sirve también con la compra ya registrada: el fichero
 * no cambia ningún importe ni ninguna línea.
 *
 * No sustituye uno que ya está: el fichero es el justificante, y cambiarlo
 * sin dejar rastro es justo lo que no se puede hacer.
 */
export const adjuntarFicheroCompra = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const { fichero } = ficheroDe(d);
    const id = z
      .string()
      .uuid()
      .parse((d as FormData).get("id"));
    return { id, fichero };
  })
  .handler(async ({ data, context }) => {
    const { huellaDe } = await import("./cola-compras.server");
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const { data: compra, error } = await tabla(context.supabase, "textil_compras")
      .select("id, fecha, fichero_ruta")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!compra) throw new Error("La compra no existe");
    if (compra.fichero_ruta) throw new Error("Esta compra ya tiene su fichero.");

    const bytes = new Uint8Array(await data.fichero.arrayBuffer());
    const huella = await huellaDe(bytes);
    // El mismo fichero en otra compra viva es, casi seguro, la misma factura dos veces.
    const previas = await tabla(context.supabase, "textil_compras")
      .select("id, proveedor, numero, fecha, estado, borrada_en")
      .eq("fichero_huella", huella)
      .is("borrada_en", null)
      .neq("id", data.id);
    const conHuella = !faltaLaColumna(previas.error);
    if (conHuella && previas.error) throw new Error(previas.error.message);
    const otra = ((previas.data ?? []) as CompraComparable[])[0];
    if (conHuella && otra) {
      throw new Error(avisoDuplicado({ nivel: "archivo", de: otra, borrada: false }));
    }

    const anio = String(compra.fecha ?? new Date().toISOString()).slice(0, 4);
    const ruta = `ronoca/${anio}/${compra.id}.${TIPOS_FICHERO[data.fichero.type]}`;
    const admin = adminComoUsuario(context.userId);
    const subida = await admin.storage
      .from("compras")
      .upload(ruta, bytes, { contentType: data.fichero.type, upsert: false });
    if (subida.error) throw new Error(`No se pudo guardar el fichero: ${subida.error.message}`);

    const { error: updErr } = await tabla(context.supabase, "textil_compras")
      .update(conHuella ? { fichero_ruta: ruta, fichero_huella: huella } : { fichero_ruta: ruta })
      .eq("id", compra.id);
    if (updErr) {
      // Sin la fila apuntándolo, el fichero no lo encontraría nadie.
      await admin.storage.from("compras").remove([ruta]);
      throw new Error(updErr.message);
    }
    return { ruta };
  });
