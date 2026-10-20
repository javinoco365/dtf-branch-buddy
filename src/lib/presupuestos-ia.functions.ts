import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { faltaLaColumna, faltaLaTabla, tabla } from "./rpc";
import { leerTodas } from "./paginar";
import { pdfEnBase64 } from "./pdf-presupuesto-datos";
import { diaEnEspana } from "@/dominio/fecha-documento";
import {
  avisoCatalogoParcial,
  catalogoTextilParaIa,
  catalogoTiendaParaIa,
  montarBorradorTextil,
  montarBorradorTienda,
  type BorradorTextil,
  type BorradorTienda,
  type ClienteCandidato,
  type ProductoCatalogoIa,
} from "@/dominio/presupuesto-ia";
import { extraerJpegsDePdf } from "@/dominio/imagenes-presupuesto";
import { aVarianteCatalogo, utilizable } from "@/dominio/stock-textil";

/**
 * Crear un presupuesto con IA: desde un documento (PDF o imagen) o desde un
 * texto libre. Ver docs/presupuestos-ia.md.
 *
 * NO ESCRIBE NADA. Devuelve un borrador del modelo de siempre (el mismo que
 * rellena el editor a mano), con los avisos de lo que hay que mirar, y las
 * fotos que se han podido sacar del PDF. El borrador abre el editor de
 * siempre y es la persona quien lo revisa y lo guarda.
 *
 * Todo lo que se lee (catálogo, stock, clientes) va con la sesión del
 * usuario: la RLS decide qué ve. La clave de la IA la pone el servidor.
 */

/** Si la IA está configurada (hay clave): si no, la pantalla lo dice y deja hacerlo a mano. */
export const hayIaPresupuestos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { hayLectorConfigurado } = await import("./lector-presupuestos.server");
    return { disponible: await hayLectorConfigurado() };
  });

/** Una foto sacada del PDF, para que la pantalla la proponga como imagen del presupuesto. */
export type ImagenExtraidaIa = { nombre: string; base64: string; ancho: number; alto: number };

export type PropuestaPresupuesto =
  | { ambito: "tienda"; borrador: BorradorTienda; extraidas: ImagenExtraidaIa[] }
  | { ambito: "textil"; borrador: BorradorTextil; extraidas: ImagenExtraidaIa[] };

const entrada = z
  .object({
    ambito: z.enum(["tienda", "textil"]),
    tiendaId: z.string().uuid().nullable(),
    texto: z.string().max(20_000, "El texto es demasiado largo: como mucho, 20.000 caracteres."),
    fichero: z.instanceof(File).nullable(),
  })
  .refine((d) => d.ambito === "textil" || d.tiendaId, { message: "Falta la tienda" })
  .refine((d) => d.fichero || d.texto.trim(), {
    message: "Escribe el presupuesto o sube un documento.",
  });

/** Los clientes de la ficha (los que ve el usuario), para casar el de la IA. */
async function leerClientes(sb: unknown): Promise<ClienteCandidato[]> {
  const { data, error } = await leerTodas<ClienteCandidato>((a, b) =>
    tabla(sb, "clientes")
      .select("id, nombre, email, telefono, nif, direccion")
      .order("nombre")
      .order("id")
      .range(a, b),
  );
  if (error) throw new Error(error.message);
  return data;
}

/** El catálogo de la tienda: sus productos activos y los generales, como en el editor. */
async function leerProductos(sb: unknown, tiendaId: string): Promise<ProductoCatalogoIa[]> {
  const { data: tienda } = await tabla(sb, "tiendas").select("id").eq("id", tiendaId).maybeSingle();
  if (!tienda) throw new Error("Sin acceso a esta tienda");
  const { data, error } = await leerTodas<ProductoCatalogoIa>((a, b) =>
    tabla(sb, "productos")
      .select("id, nombre, descripcion, unidad, precio_unitario")
      .eq("activo", true)
      .or(`tienda_id.eq.${tiendaId},tienda_id.is.null`)
      .order("nombre")
      .order("id")
      .range(a, b),
  );
  if (error) throw new Error(error.message);
  return data;
}

/** Las variantes de stock textil, con su producto si la base lo tiene (como listStock). */
async function leerVariantes(sb: unknown) {
  const leer = (campos: string) =>
    leerTodas<Record<string, unknown>>((a, b) =>
      tabla(sb, "textil_stock").select(campos).order("nombre").order("id").range(a, b),
    );
  let { data, error } = await leer(
    "*, producto:textil_productos(id, marca, referencia, nombre, categoria, activo)",
  );
  if (error && (error.code === "PGRST200" || faltaLaColumna(error) || faltaLaTabla(error))) {
    ({ data, error } = await leer("*"));
  }
  if (error) throw new Error(error.message);
  return (data ?? []).map(aVarianteCatalogo);
}

/**
 * Propone un presupuesto con IA. FormData: ambito ('tienda' o 'textil'),
 * tiendaId (en las tiendas), texto (el presupuesto escrito, o indicaciones
 * para el documento) y, si lo hay, fichero (PDF, JPG, PNG o WEBP).
 */
export const proponerPresupuesto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    if (!(d instanceof FormData)) throw new Error("Faltan los datos del presupuesto");
    const fichero = d.get("fichero");
    return entrada.parse({
      ambito: d.get("ambito"),
      tiendaId: d.get("tiendaId") || null,
      texto: String(d.get("texto") ?? ""),
      fichero: fichero instanceof File && fichero.size > 0 ? fichero : null,
    });
  })
  .handler(async ({ data, context }): Promise<PropuestaPresupuesto> => {
    const sb = context.supabase;
    const { leerPresupuestoConIa } = await import("./lector-presupuestos.server");
    const hoy = diaEnEspana(new Date());
    const fichero = data.fichero
      ? { bytes: new Uint8Array(await data.fichero.arrayBuffer()), tipo: data.fichero.type }
      : null;

    // Las fotos del PDF: solo se proponen; se guardan si la persona guarda.
    const extraidas: ImagenExtraidaIa[] = [];
    if (fichero && fichero.tipo === "application/pdf") {
      const fotos = extraerJpegsDePdf(fichero.bytes);
      for (const [i, f] of fotos.entries()) {
        extraidas.push({
          nombre: `imagen-${i + 1}-del-documento.jpg`,
          base64: await pdfEnBase64(new Blob([new Uint8Array(f.bytes)])),
          ancho: f.ancho,
          alto: f.alto,
        });
      }
    }

    if (data.ambito === "tienda") {
      const [productos, clientes] = await Promise.all([
        leerProductos(sb, data.tiendaId!),
        leerClientes(sb),
      ]);
      const lectura = await leerPresupuestoConIa({
        ambito: "tienda",
        catalogo: catalogoTiendaParaIa(productos, data.texto),
        texto: data.texto,
        fichero,
      });
      const borrador = montarBorradorTienda(lectura, { productos, clientes, hoy });
      const parcial = avisoCatalogoParcial(productos.length, "productos");
      if (parcial) borrador.avisos.push(parcial);
      return { ambito: "tienda", borrador, extraidas };
    }

    const [variantes, clientes] = await Promise.all([leerVariantes(sb), leerClientes(sb)]);
    const lectura = await leerPresupuestoConIa({
      ambito: "textil",
      catalogo: catalogoTextilParaIa(variantes, data.texto),
      texto: data.texto,
      fichero,
    });
    const borrador = montarBorradorTextil(lectura, { variantes, clientes, hoy });
    const parcial = avisoCatalogoParcial(variantes.filter(utilizable).length, "variantes");
    if (parcial) borrador.avisos.push(parcial);
    return { ambito: "textil", borrador, extraidas };
  });
