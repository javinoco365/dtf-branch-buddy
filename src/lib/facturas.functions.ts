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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

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

    const pdfData: FacturaPDFData = {
      serie: factura.serie ?? "",
      numero: factura.numero ?? 0,
      fecha: factura.fecha ?? new Date().toISOString(),
      fecha_vencimiento: factura.fecha_vencimiento,
      emisor: {
        nombre: factura.emisor_nombre ?? "",
        cif: factura.emisor_cif ?? "",
        direccion: factura.emisor_direccion ?? "",
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

    await supabaseAdmin
      .from("facturas")
      .update({ pdf_url: signed.signedUrl })
      .eq("id", factura.id);

    return { ok: true, path, url: signed.signedUrl };
  });