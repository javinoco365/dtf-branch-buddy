import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generarFacturaPDF, type FacturaPDFData } from "@/lib/pdf-factura";

/**
 * Genera el PDF de una factura, lo sube al bucket privado `facturas`
 * en la ruta `{tienda_id}/{factura_id}.pdf` y guarda la URL firmada
 * en `facturas.pdf_url`.
 */
export const generarYSubirFacturaPDF = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ factura_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);

    const { data: factura, error: fErr } = await supabaseAdmin
      .from("facturas")
      .select(
        "id, tienda_id, serie, numero, fecha, fecha_vencimiento, base_imponible, iva_total, total, notas, cliente_nombre, cliente_nif, cliente_direccion, emisor_nombre, emisor_cif, emisor_direccion",
      )
      .eq("id", data.factura_id)
      .maybeSingle();
    if (fErr || !factura) throw new Error("Factura no encontrada");

    // Comprobar acceso a la tienda
    const { data: miembro } = await supabaseAdmin
      .from("tienda_usuarios")
      .select("tienda_id")
      .eq("tienda_id", factura.tienda_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    const { data: rol } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!miembro && !rol) throw new Error("Sin acceso a esta factura");

    const { data: items } = await supabaseAdmin
      .from("factura_items")
      .select("descripcion, cantidad, unidad, precio_unitario, iva_rate, subtotal, iva, total")
      .eq("factura_id", factura.id);

    // Fallback a empresa_global cuando la factura no tiene snapshot de emisor.
    const { data: empresa } = await supabaseAdmin
      .from("empresa_global")
      .select("razon_social, cif, direccion, codigo_postal, ciudad, provincia, pais")
      .eq("id", true)
      .maybeSingle();
    const empresaDireccion =
      [
        empresa?.direccion,
        [empresa?.codigo_postal, empresa?.ciudad].filter(Boolean).join(" "),
        empresa?.provincia,
        empresa?.pais,
      ]
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter(Boolean)
        .join(", ") || "";

    const emisorNombre =
      (factura.emisor_nombre && factura.emisor_nombre.trim()) || empresa?.razon_social || "";
    const emisorCif = (factura.emisor_cif && factura.emisor_cif.trim()) || empresa?.cif || "";
    const emisorDireccion =
      (factura.emisor_direccion && factura.emisor_direccion.trim()) || empresaDireccion;

    const pdfData: FacturaPDFData = {
      serie: factura.serie ?? "",
      numero: factura.numero ?? 0,
      fecha: factura.fecha ?? new Date().toISOString(),
      fecha_vencimiento: factura.fecha_vencimiento,
      emisor: {
        nombre: emisorNombre,
        cif: emisorCif,
        direccion: emisorDireccion,
      },
      cliente: {
        nombre: factura.cliente_nombre ?? "",
        nif: factura.cliente_nif,
        direccion: factura.cliente_direccion,
      },
      items: (items ?? []).map((it) => ({
        descripcion: it.descripcion ?? "",
        cantidad: Number(it.cantidad ?? 0),
        unidad: it.unidad ?? "u",
        precio_unitario: Number(it.precio_unitario ?? 0),
        iva_rate: Number(it.iva_rate ?? 0),
        subtotal: Number(it.subtotal ?? 0),
        iva: Number(it.iva ?? 0),
        total: Number(it.total ?? 0),
      })),
      base_imponible: Number(factura.base_imponible ?? 0),
      iva_total: Number(factura.iva_total ?? 0),
      total: Number(factura.total ?? 0),
      notas: factura.notas,
    };

    const blob = await generarFacturaPDF(pdfData);
    const arrayBuffer = await blob.arrayBuffer();
    const path = `${factura.tienda_id}/${factura.id}.pdf`;

    const { error: upErr } = await supabaseAdmin.storage
      .from("facturas")
      .upload(path, new Uint8Array(arrayBuffer), {
        contentType: "application/pdf",
        upsert: true,
      });
    if (upErr) throw new Error(`Error subiendo PDF: ${upErr.message}`);

    // URL firmada (1 año) para mostrar/descargar desde la UI
    const { data: signed, error: sErr } = await supabaseAdmin.storage
      .from("facturas")
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    if (sErr || !signed) throw new Error("No se pudo generar la URL firmada");

    await supabaseAdmin.from("facturas").update({ pdf_url: signed.signedUrl }).eq("id", factura.id);

    return { ok: true, path, url: signed.signedUrl };
  });

/* ==========================================================================
 * Emisión de facturas
 *
 * Todo pasa por funciones de base de datos. El navegador ya no puede insertar
 * ni modificar facturas: perdió el permiso en la migración
 * 20260902130000_motor_facturacion.sql.
 *
 * El número de factura se asigna dentro de la transacción de `emitir_factura`,
 * con la fila de la serie bloqueada. Nunca aquí, nunca en el cliente.
 *
 * NOTA SOBRE TIPOS: `src/integrations/supabase/types.ts` está generado y todavía
 * no conoce estas funciones. Hasta que se regenere después de aplicar las
 * migraciones, las llamadas van por `llamarRpc`, que hace el casting en un solo
 * sitio en lugar de esparcir `any` por cada llamada.
 * ========================================================================== */

const lineaSchema = z.object({
  descripcion: z.string().min(1, "Cada línea necesita descripción"),
  cantidad: z.number(),
  unidad: z.string().default("ud"),
  precio_unitario: z.number(),
  iva_rate: z.number().min(0).max(100),
});

const receptorSchema = z.object({
  nombre: z.string().min(1, "El nombre del cliente es obligatorio"),
  nif: z.string().nullable().optional(),
  direccion: z.string().nullable().optional(),
  codigo_postal: z.string().nullable().optional(),
  ciudad: z.string().nullable().optional(),
  provincia: z.string().nullable().optional(),
  pais: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
});

type ResultadoEmision = {
  id: string;
  serie: string;
  numero: number;
  ejercicio: number;
  tipo: "ordinaria" | "rectificativa";
  base_imponible: number;
  iva_total: number;
  total: number;
};

async function llamarRpc<T>(
  cliente: unknown,
  funcion: string,
  argumentos: Record<string, unknown>,
): Promise<T> {
  const rpc = (
    cliente as {
      rpc: (
        f: string,
        a: Record<string, unknown>,
      ) => Promise<{ data: T; error: { message: string } | null }>;
    }
  ).rpc;
  const { data, error } = await rpc.call(cliente, funcion, argumentos);
  if (error) throw new Error(error.message);
  return data;
}

/** Emite una factura ordinaria. El número lo pone la base, no esta función. */
export const emitirFactura = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        tienda_id: z.string().uuid(),
        receptor: receptorSchema,
        lineas: z.array(lineaSchema).min(1, "Una factura sin líneas no se emite"),
        fecha: z.string().optional(),
        fecha_vencimiento: z.string().nullable().optional(),
        cliente_id: z.string().uuid().nullable().optional(),
        pedido_id: z.string().uuid().nullable().optional(),
        notas: z.string().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return llamarRpc<ResultadoEmision>(supabaseAdmin, "emitir_factura", {
      _usuario_id: context.userId,
      _tienda_id: data.tienda_id,
      _receptor: data.receptor,
      _lineas: data.lineas,
      _fecha: data.fecha ?? new Date().toISOString().slice(0, 10),
      _fecha_vencimiento: data.fecha_vencimiento ?? null,
      _cliente_id: data.cliente_id ?? null,
      _pedido_id: data.pedido_id ?? null,
      _notas: data.notas ?? null,
      _rectifica_a_id: null,
      _motivo_rectificacion: null,
    });
  });

/**
 * Anula una factura emitida.
 *
 * No la borra ni la modifica: emite una rectificativa con las mismas líneas en
 * negativo. Las dos quedan en el libro y suman cero.
 */
export const anularFactura = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        factura_id: z.string().uuid(),
        // Códigos de la normativa. R1 es el motivo general por error fundado
        // en derecho; los demás cubren los supuestos del artículo 80 de la Ley
        // del IVA.
        motivo: z.enum(["R1", "R2", "R3", "R4", "R5"]).default("R1"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return llamarRpc<ResultadoEmision>(supabaseAdmin, "anular_factura", {
      _usuario_id: context.userId,
      _factura_id: data.factura_id,
      _motivo: data.motivo,
    });
  });

/** Cambia el estado de cobro. No toca nada del documento fiscal. */
export const cambiarEstadoCobro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        factura_id: z.string().uuid(),
        estado: z.enum(["emitida", "pagada", "vencida"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await llamarRpc<null>(supabaseAdmin, "factura_cambiar_estado_cobro", {
      _usuario_id: context.userId,
      _factura_id: data.factura_id,
      _estado: data.estado,
    });
    return { ok: true };
  });
