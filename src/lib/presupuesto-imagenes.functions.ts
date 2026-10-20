import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { faltaLaTabla, tabla } from "./rpc";
import {
  BUCKET_IMAGENES,
  MIGRACION_IMAGENES,
  columnaPresupuesto,
  leerFilasImagenes,
  type AmbitoImagenes,
} from "./presupuesto-imagenes-datos";
import {
  MAXIMO_IMAGENES_PRESUPUESTO,
  medidasALaVista,
  revisarImagen,
  rutaImagenPresupuesto,
} from "@/dominio/imagenes-presupuesto";

/**
 * Las imágenes de los presupuestos (tiendas y textil). Ver
 * 20261030100000_presupuesto_imagenes.sql.
 *
 * Las filas se leen y se escriben con la sesión de quien las usa: la RLS
 * decide (quien ve el presupuesto ve y toca sus imágenes) y la auditoría
 * apunta su autor. Los ficheros del bucket privado se suben y se borran en el
 * servidor con `adminComoUsuario`, después de comprobar con la sesión del
 * usuario que ve el presupuesto; se leen con URL firmada de la sesión.
 *
 * Sin la migración, `disponible: false`: la pantalla esconde las imágenes y
 * lo demás funciona como siempre.
 */

const AMBITOS = ["tienda", "textil"] as const;

/** El presupuesto, visto con la sesión del usuario: si no lo ve, no existe. */
async function presupuestoVisible(sb: unknown, ambito: AmbitoImagenes, id: string) {
  // select("*"): pedido_id solo existe en textil con la migración de confirmar.
  const { data, error } = await tabla(
    sb,
    ambito === "tienda" ? "presupuestos" : "textil_presupuestos",
  )
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Sin acceso a este presupuesto");
  return data as { id: string; empresa_id: string; pedido_id?: string | null };
}

/**
 * Las imágenes de un presupuesto, con un enlace firmado de 10 minutos para
 * verlas. Sin presupuesto (uno nuevo), solo si las imágenes están disponibles.
 */
export const listarImagenesPresupuesto = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ ambito: z.enum(AMBITOS), presupuestoId: z.string().uuid().nullable() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    if (!data.presupuestoId) {
      const { error } = await tabla(sb, "presupuesto_imagenes").select("id").limit(1);
      if (faltaLaTabla(error)) return { disponible: false, imagenes: [] };
      if (error) throw new Error(error.message);
      return { disponible: true, imagenes: [] };
    }
    const { disponible, filas } = await leerFilasImagenes(sb, data.ambito, data.presupuestoId);
    if (!disponible || filas.length === 0) return { disponible, imagenes: [] };
    const firmadas = await sb.storage.from(BUCKET_IMAGENES).createSignedUrls(
      filas.map((f) => f.ruta),
      600,
    );
    const porRuta = new Map((firmadas.data ?? []).map((f) => [f.path, f.signedUrl] as const));
    return {
      disponible,
      imagenes: filas.map((f) => ({
        id: f.id,
        nombre: f.nombre,
        url: porRuta.get(f.ruta) ?? null,
      })),
    };
  });

/**
 * Sube una imagen a un presupuesto ya guardado: se comprueba qué es por sus
 * bytes (no por el nombre), se guarda el fichero y se crea su fila. Si la
 * fila no se puede crear, el fichero se borra: nunca un fichero huérfano.
 */
export const subirImagenPresupuesto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    if (!(d instanceof FormData)) throw new Error("Falta la imagen");
    return z
      .object({
        ambito: z.enum(AMBITOS),
        presupuestoId: z.string().uuid(),
        fichero: z.instanceof(File, { message: "Falta la imagen" }),
      })
      .parse({
        ambito: d.get("ambito"),
        presupuestoId: d.get("presupuestoId"),
        fichero: d.get("fichero"),
      });
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const p = await presupuestoVisible(sb, data.ambito, data.presupuestoId);
    if (p.pedido_id) throw new Error("Este presupuesto ya es un pedido: no se cambia.");

    const { disponible, filas } = await leerFilasImagenes(sb, data.ambito, p.id);
    if (!disponible) {
      throw new Error(`Las imágenes necesitan la migración ${MIGRACION_IMAGENES}.`);
    }
    if (filas.length >= MAXIMO_IMAGENES_PRESUPUESTO) {
      throw new Error(`Como mucho, ${MAXIMO_IMAGENES_PRESUPUESTO} imágenes por presupuesto.`);
    }

    const bytes = new Uint8Array(await data.fichero.arrayBuffer());
    const revisada = revisarImagen(bytes, data.fichero.name || "La imagen");
    if (!revisada.ok) throw new Error(revisada.error);
    const { medidas } = revisada;
    const vista = medidasALaVista(medidas);

    const id = crypto.randomUUID();
    const ruta = rutaImagenPresupuesto(p.empresa_id, data.ambito, p.id, id, medidas.tipo);
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const admin = adminComoUsuario(context.userId);
    const subida = await admin.storage
      .from(BUCKET_IMAGENES)
      .upload(ruta, bytes, { contentType: medidas.tipo, upsert: false });
    if (subida.error) throw new Error(`No se pudo guardar la imagen: ${subida.error.message}`);

    const { error } = await tabla(sb, "presupuesto_imagenes").insert({
      id,
      [columnaPresupuesto(data.ambito)]: p.id,
      ruta,
      nombre: (data.fichero.name || "").slice(0, 200),
      tipo_mime: medidas.tipo,
      bytes: bytes.byteLength,
      ancho: vista.ancho,
      alto: vista.alto,
      orden: filas.length ? Math.max(...filas.map((f) => f.orden)) + 1 : 0,
    });
    if (error) {
      await admin.storage.from(BUCKET_IMAGENES).remove([ruta]);
      throw new Error(error.message);
    }
    return { id };
  });

/** Quita una imagen de un presupuesto: su fila y su fichero. */
export const quitarImagenPresupuesto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: fila, error } = await tabla(sb, "presupuesto_imagenes")
      .select("id, ruta, presupuesto_id, textil_presupuesto_id")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!fila) throw new Error("Sin acceso a esta imagen");
    const ambito: AmbitoImagenes = fila.presupuesto_id ? "tienda" : "textil";
    const p = await presupuestoVisible(
      sb,
      ambito,
      fila.presupuesto_id ?? fila.textil_presupuesto_id,
    );
    if (p.pedido_id) throw new Error("Este presupuesto ya es un pedido: no se cambia.");

    const { error: errBorrar } = await tabla(sb, "presupuesto_imagenes").delete().eq("id", data.id);
    if (errBorrar) throw new Error(errBorrar.message);
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const r = await adminComoUsuario(context.userId)
      .storage.from(BUCKET_IMAGENES)
      .remove([fila.ruta as string]);
    if (r.error) console.warn("[presupuesto] imagen quitada, fichero sin borrar:", r.error.message);
    return { ok: true };
  });
