/**
 * El archivo: todos los documentos de un periodo (facturas y tickets de las
 * tiendas y del textil, y facturas de compra) y las URL para descargarlos.
 *
 * El ZIP no se monta aquí: una función en Vercel no puede responder con más de
 * 4,5 MB, y un trimestre de PDF lo pasa de largo. El servidor devuelve solo
 * datos y URL firmadas; el navegador descarga cada fichero directamente de
 * Storage y empaqueta (src/lib/zip-archivo.ts).
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tabla } from "./rpc";
import { leerTodas } from "./paginar";
import { referenciaFactura } from "./format";
import { rutaPdfTextil, rutaPdfTienda } from "./rutas-pdf";
import {
  deCompra,
  deFacturaTextil,
  deFacturaTienda,
  entraEnArchivo,
  type DocArchivo,
  type FilaCompra,
  type FilaFacturaTextil,
} from "@/dominio/archivo";

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida")
  .nullable();

/**
 * Los documentos del periodo, ya en la forma común del archivo. Sin borradores
 * ni compras borradas o sin registrar. Lee con el cliente del usuario: la RLS
 * decide qué tiendas ve.
 *
 * `desde` y `hasta` nulos es «todo».
 */
export const listarArchivo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ desde: fecha, hasta: fecha }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    // tabla() no tipa (types.ts no conoce todas estas columnas).
    const enRango = (q: any) => {
      let r = q;
      if (data.desde) r = r.gte("fecha", data.desde);
      if (data.hasta) r = r.lte("fecha", data.hasta);
      return r;
    };

    const [tiendas, ventas, textil, compras] = await Promise.all([
      tabla(sb, "tiendas").select("id, nombre"),
      leerTodas<any>((a, b) =>
        enRango(
          tabla(sb, "facturas")
            .select(
              "id, tienda_id, serie, ejercicio, numero, tipo, estado, fecha, cliente_nombre, cliente_nif, base_imponible, iva_total, total, pdf_url",
            )
            .neq("estado", "borrador"),
        )
          .order("fecha")
          .order("id")
          .range(a, b),
      ),
      leerTodas<any>((a, b) =>
        enRango(
          tabla(sb, "textil_facturas")
            .select(
              "id, numero, tipo, estado, fecha, cliente_nombre, cliente_nif, subtotal, iva, total, pdf_path, marca:textil_marcas(nombre)",
            )
            .neq("estado", "borrador"),
        )
          .order("fecha")
          .order("id")
          .range(a, b),
      ),
      leerTodas<any>((a, b) =>
        enRango(
          tabla(sb, "textil_compras")
            .select(
              "id, fecha, proveedor, nif_proveedor, numero, base, iva, total, liquido, estado, borrada_en, fichero_ruta",
            )
            .eq("estado", "registrada")
            .is("borrada_en", null),
        )
          .order("fecha")
          .order("id")
          .range(a, b),
      ),
    ]);
    for (const r of [tiendas, ventas, textil, compras]) {
      if (r.error) throw new Error(r.error.message);
    }

    const nombreTienda = new Map<string, string>(
      ((tiendas.data ?? []) as { id: string; nombre: string }[]).map((t) => [t.id, t.nombre]),
    );
    const docs: DocArchivo[] = [
      ...ventas.data.map((f) =>
        deFacturaTienda(
          f,
          referenciaFactura(f.serie, f.ejercicio, f.numero),
          nombreTienda.get(f.tienda_id) ?? null,
        ),
      ),
      ...(textil.data as FilaFacturaTextil[]).map(deFacturaTextil),
      ...(compras.data as FilaCompra[]).map(deCompra),
    ].filter(entraEnArchivo);
    // Lo más reciente arriba, como en las demás listas.
    docs.sort((x, y) => (y.fecha ?? "").localeCompare(x.fecha ?? "") || x.id.localeCompare(y.id));
    return docs;
  });

const item = z.object({ origen: z.enum(["tienda", "textil", "compra"]), id: z.string().uuid() });

/**
 * URL firmadas (diez minutos) de los ficheros de unos documentos, para
 * descargarlos y empaquetarlos en el navegador.
 *
 * Las rutas salen de la base, leída con el cliente del usuario: nunca del
 * navegador. Así nadie firma un fichero de una tienda que no es suya. Un
 * documento sin fichero vuelve con `url: null`.
 */
export const urlsArchivo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ items: z.array(item).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const ids = (o: string) => data.items.filter((i) => i.origen === o).map((i) => i.id);
    const idsTienda = ids("tienda");
    const idsTextil = ids("textil");
    const idsCompra = ids("compra");

    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const admin = adminComoUsuario(context.userId);

    // El PDF textil, como hasta ahora, solo para administradores.
    if (idsTextil.length) {
      const { data: rol } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId)
        .eq("role", "admin")
        .maybeSingle();
      if (!rol) throw new Error("Solo un administrador puede descargar los PDF del textil");
    }

    const [ventas, textil, compras] = await Promise.all([
      idsTienda.length
        ? tabla(sb, "facturas").select("id, tienda_id, estado").in("id", idsTienda)
        : { data: [], error: null },
      idsTextil.length
        ? tabla(sb, "textil_facturas").select("id, estado").in("id", idsTextil)
        : { data: [], error: null },
      idsCompra.length
        ? tabla(sb, "textil_compras").select("id, fichero_ruta").in("id", idsCompra)
        : { data: [], error: null },
    ]);
    for (const r of [ventas, textil, compras]) {
      if (r.error) throw new Error(r.error.message);
    }

    // Cada documento, con su bucket y su ruta.
    const rutas = new Map<string, { bucket: "facturas" | "compras"; ruta: string }>();
    for (const f of (ventas.data ?? []) as { id: string; tienda_id: string; estado: string }[]) {
      if (f.estado !== "borrador") {
        rutas.set(f.id, { bucket: "facturas", ruta: rutaPdfTienda(f.tienda_id, f.id) });
      }
    }
    for (const f of (textil.data ?? []) as { id: string; estado: string | null }[]) {
      // La ruta fija y no pdf_path: es la misma, y así vale aunque la fila no
      // la tenga apuntada todavía. Si el fichero no está, la firma falla y
      // vuelve sin URL.
      if (f.estado !== "borrador") {
        rutas.set(f.id, { bucket: "facturas", ruta: rutaPdfTextil(f.id) });
      }
    }
    for (const c of (compras.data ?? []) as { id: string; fichero_ruta: string | null }[]) {
      if (c.fichero_ruta) rutas.set(c.id, { bucket: "compras", ruta: c.fichero_ruta });
    }

    // Una llamada por bucket.
    const firmadas = new Map<string, string>();
    for (const bucket of ["facturas", "compras"] as const) {
      const lista = [...rutas.values()].filter((r) => r.bucket === bucket).map((r) => r.ruta);
      if (!lista.length) continue;
      const { data: urls, error } = await admin.storage
        .from(bucket)
        .createSignedUrls(lista, 60 * 10);
      if (error) throw new Error(`No se pudieron firmar los ficheros: ${error.message}`);
      for (const u of (urls ?? []) as {
        path: string | null;
        signedUrl: string;
        error: string | null;
      }[]) {
        if (u.path && u.signedUrl && !u.error) firmadas.set(`${bucket}:${u.path}`, u.signedUrl);
      }
    }

    return data.items.map((i) => {
      const r = rutas.get(i.id);
      return { ...i, url: r ? (firmadas.get(`${r.bucket}:${r.ruta}`) ?? null) : null };
    });
  });
