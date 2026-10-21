import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { exigeBorrar, exigeEscribir } from "./permisos-middleware";
import { faltaLaTabla, llamarRpc, tabla } from "./rpc";
import { exigirFilas } from "./acceso";
import { leerTodas } from "./paginar";
import {
  ambitoPresupuesto,
  documentoPresupuesto,
  prefijoDeTienda,
  referenciaPresupuesto,
  totalesPresupuesto,
  type EstadoPresupuesto,
} from "@/dominio/presupuestos";
import { lineasDireccion } from "@/dominio/direcciones";
import { diaEnEspana } from "@/dominio/fecha-documento";
import { resolverIdentidad } from "@/dominio/plantilla-presupuesto";
import {
  generarPresupuestoPDF,
  type PresupuestoPDFData,
  type VistaPreviaPresupuesto,
} from "@/lib/pdf-presupuesto";
import {
  leerEmisorEmpresa,
  leerPlantillaPresupuesto,
  pdfEnBase64,
  texto,
  webLegible,
} from "@/lib/pdf-presupuesto-datos";
import { descargarLogo } from "@/lib/logo-descarga";
import { BUCKET_IMAGENES, imagenesParaPdf, rutasImagenes } from "@/lib/presupuesto-imagenes-datos";

/**
 * Presupuestos de las tiendas. Ver 20261001100000_presupuestos_tiendas.sql.
 *
 * Todo va con la sesión de quien los usa: la RLS decide qué tiendas puede ver
 * y tocar. El número lo da siguiente_numero(), con la fila del contador
 * bloqueada: dos presupuestos a la vez no se llevan el mismo.
 */

export type LineaPresupuestoGuardada = {
  id: string;
  producto_id: string | null;
  orden: number;
  descripcion: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
  iva_rate: number;
  subtotal: number;
  iva: number;
  total: number;
};

export type Presupuesto = {
  id: string;
  empresa_id: string;
  tienda_id: string;
  numero: string;
  cliente_id: string | null;
  cliente_nombre: string | null;
  cliente_email: string | null;
  cliente_telefono: string | null;
  fecha: string;
  validez_dias: number;
  estado: EstadoPresupuesto;
  subtotal: number;
  iva: number;
  envio: number;
  total: number;
  notas: string | null;
  pedido_id: string | null;
  /** El pedido que salió al confirmarlo, si salió. */
  pedido: { numero: string } | null;
  created_at: string;
  items: LineaPresupuestoGuardada[];
};

const ESTADOS = ["borrador", "enviado", "aceptado", "rechazado"] as const;

export const listPresupuestosTienda = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ tiendaId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Por páginas: Supabase corta en 1000 filas sin avisar (ver paginar.ts).
    const { data: filas, error } = await leerTodas<Presupuesto>((a, b) =>
      tabla(context.supabase, "presupuestos")
        .select("*, items:presupuesto_items(*), pedido:pedidos(numero)")
        .eq("tienda_id", data.tiendaId)
        .order("fecha", { ascending: false })
        .order("numero", { ascending: false })
        .order("id")
        .range(a, b),
    );
    if (faltaLaTabla(error)) return { disponible: false, presupuestos: [] as Presupuesto[] };
    if (error) throw new Error(error.message);
    const presupuestos = filas.map((p) => ({
      ...p,
      items: [...(p.items ?? [])].sort((a, b) => a.orden - b.orden),
    }));
    return { disponible: true, presupuestos };
  });

const lineaSchema = z.object({
  producto_id: z.string().uuid().nullable().optional(),
  descripcion: z.string().trim().min(1, "Cada línea necesita una descripción"),
  cantidad: z.number().positive("La cantidad tiene que ser mayor que cero"),
  unidad: z.string().trim().min(1).max(8),
  precio_unitario: z.number().nonnegative("El precio no puede ser negativo"),
  iva_rate: z.number().min(0).max(100),
});

export const guardarPresupuesto = createServerFn({ method: "POST" })
  .middleware([exigeEscribir])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        tienda_id: z.string().uuid(),
        cliente_id: z.string().uuid().nullable().optional(),
        cliente_nombre: z.string().trim().min(1, "Elige o escribe el cliente"),
        cliente_email: z.string().trim().nullable().optional(),
        cliente_telefono: z.string().trim().nullable().optional(),
        fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida"),
        validez_dias: z.number().int().positive("La validez tiene que ser de al menos un día"),
        envio: z.number().nonnegative().default(0),
        notas: z.string().nullable().optional(),
        lineas: z.array(lineaSchema).min(1, "El presupuesto necesita al menos una línea"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const t = totalesPresupuesto(
      data.lineas.map((l) => ({ ...l, producto_id: l.producto_id ?? null })),
      data.envio,
    );

    const cabecera = {
      cliente_id: data.cliente_id ?? null,
      cliente_nombre: data.cliente_nombre,
      cliente_email: data.cliente_email || null,
      cliente_telefono: data.cliente_telefono || null,
      fecha: data.fecha,
      validez_dias: data.validez_dias,
      envio: t.envio,
      subtotal: t.subtotal,
      iva: t.iva,
      total: t.total,
      notas: data.notas?.trim() || null,
    };

    let presupuestoId = data.id;
    if (data.id) {
      const { data: actual } = await tabla(sb, "presupuestos")
        .select("id, tienda_id, pedido_id")
        .eq("id", data.id)
        .maybeSingle();
      if (!actual || actual.tienda_id !== data.tienda_id) {
        throw new Error("Sin acceso a este presupuesto");
      }
      if (actual.pedido_id) {
        throw new Error("Este presupuesto ya es un pedido: no se puede cambiar.");
      }
      const { error } = await tabla(sb, "presupuestos").update(cabecera).eq("id", data.id);
      if (error) throw new Error(error.message);
      const { error: errBorrar } = await tabla(sb, "presupuesto_items")
        .delete()
        .eq("presupuesto_id", data.id);
      if (errBorrar) throw new Error(errBorrar.message);
    } else {
      // La tienda con la sesión de quien crea: si no es suya, no la ve.
      const { data: tienda } = await tabla(sb, "tiendas")
        .select("id, empresa_id, prefijo, slug, nombre")
        .eq("id", data.tienda_id)
        .maybeSingle();
      if (!tienda) throw new Error("Sin acceso a esta tienda");

      const ejercicio = Number(data.fecha.slice(0, 4));
      const n = await llamarRpc<number>(sb, "siguiente_numero", {
        _empresa_id: tienda.empresa_id,
        _ambito: ambitoPresupuesto(tienda.id),
        _ejercicio: ejercicio,
      });
      const { data: creado, error } = await tabla(sb, "presupuestos")
        .insert({
          ...cabecera,
          empresa_id: tienda.empresa_id,
          tienda_id: tienda.id,
          numero: referenciaPresupuesto(prefijoDeTienda(tienda), ejercicio, n),
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      presupuestoId = creado.id as string;
    }

    const { error: errLineas } = await tabla(sb, "presupuesto_items").insert(
      t.lineas.map((l, i) => ({
        presupuesto_id: presupuestoId,
        producto_id: l.producto_id ?? null,
        orden: i,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        unidad: l.unidad,
        precio_unitario: l.precio_unitario,
        iva_rate: l.iva_rate,
        subtotal: l.subtotal,
        iva: l.iva,
        total: l.total,
      })),
    );
    if (errLineas) throw new Error(errLineas.message);
    return { id: presupuestoId! };
  });

export const cambiarEstadoPresupuesto = createServerFn({ method: "POST" })
  .middleware([exigeEscribir])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), estado: z.enum(ESTADOS) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: filas, error } = await tabla(context.supabase, "presupuestos")
      .update({ estado: data.estado })
      .eq("id", data.id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!filas?.length) throw new Error("Sin acceso a este presupuesto");
    return { ok: true };
  });

export const borrarPresupuesto = createServerFn({ method: "POST" })
  .middleware([exigeBorrar])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: actual } = await tabla(context.supabase, "presupuestos")
      .select("id, pedido_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!actual) throw new Error("Sin acceso a este presupuesto");
    if (actual.pedido_id) {
      throw new Error("Este presupuesto ya es un pedido: bórralo desde el pedido si hace falta.");
    }
    // Las imágenes: sus filas se van en cascada; los ficheros, después.
    const rutas = await rutasImagenes(context.supabase, "tienda", data.id);
    const { data: borrados, error } = await tabla(context.supabase, "presupuestos")
      .delete()
      .eq("id", data.id)
      .select("id");
    if (error) throw new Error(error.message);
    // Si la RLS no ha dejado borrarlo, sus imágenes tampoco se tocan.
    exigirFilas(borrados, "el presupuesto");
    if (rutas.length) {
      const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
      const r = await adminComoUsuario(context.userId).storage.from(BUCKET_IMAGENES).remove(rutas);
      if (r.error) console.warn("[presupuesto] no se borraron sus imágenes:", r.error.message);
    }
    return { ok: true };
  });

/**
 * Confirma un presupuesto: crea su pedido con las mismas líneas e importes, y
 * lo deja aceptado. Lo hace confirmar_presupuesto() en la base, en una sola
 * transacción y con el presupuesto bloqueado: dos clics no crean dos pedidos.
 */
export const confirmarPresupuesto = createServerFn({ method: "POST" })
  .middleware([exigeEscribir])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const pedidoId = await llamarRpc<string>(context.supabase, "confirmar_presupuesto", {
      _presupuesto_id: data.id,
    });
    const { data: pedido } = await tabla(context.supabase, "pedidos")
      .select("id, numero")
      .eq("id", pedidoId)
      .maybeSingle();
    return { id: pedidoId, numero: (pedido?.numero as string | undefined) ?? null };
  });

// ---------------------------------------------------------------------------
// El PDF
// ---------------------------------------------------------------------------

/** Lo que se lee de una tienda para el PDF de sus presupuestos. */
const COLUMNAS_TIENDA_PDF =
  "id, empresa_id, nombre, logo_url, color, woo_url, telefono, correo_remitente_email";

/** La validez de un presupuesto nuevo: la de la base (`presupuestos.validez_dias`). */
const VALIDEZ_POR_DEFECTO = 30;

/** Una fila tal como llega de la base: `tabla()` no la tipa. */
type Fila = Record<string, unknown>;

/** El nombre, el logo y el color de la tienda: lo que sale si la plantilla no lo cambia. */
const identidadTienda = (tienda: Fila | null) => ({
  nombre: texto(tienda?.nombre),
  logo_url: texto(tienda?.logo_url),
  color: texto(tienda?.color),
});

/**
 * Los datos del PDF de un presupuesto de tienda, sin logo ni color: la
 * identidad (nombre comercial, logo y color) la pone quien llama, con la
 * plantilla (`resolverIdentidad`). Lo comparten el PDF y la vista previa del
 * editor, para que la vista previa sea de verdad lo que saldrá.
 *
 * El emisor es la sociedad (`empresas`, la misma que sale en las facturas); la
 * web, el correo de contacto y el teléfono de respaldo, los de la tienda. Del
 * cliente, el nombre, el correo y el teléfono congelados en el presupuesto; el
 * NIF y la dirección, de su ficha si la tiene.
 *
 * Sin presupuesto (la vista previa de una tienda que todavía no tiene
 * ninguno), uno vacío con la fecha de hoy en España: sin líneas, sin número y
 * sin cliente. Nunca líneas de ejemplo.
 */
async function datosPdfTienda(
  sb: unknown,
  tienda: Fila,
  p: Fila | null,
): Promise<PresupuestoPDFData> {
  const [emisor, cliente] = await Promise.all([
    leerEmisorEmpresa(sb, String(p?.empresa_id ?? tienda.empresa_id)),
    p?.cliente_id
      ? tabla(sb, "clientes")
          .select("nombre, empresa, nif, direccion, codigo_postal, ciudad, provincia, pais")
          .eq("id", p.cliente_id)
          .maybeSingle()
          .then((r: { data: Fila | null }) => r.data)
      : Promise.resolve(null as Fila | null),
  ]);

  const fecha = texto(p?.fecha) ?? diaEnEspana(new Date());
  const validez_dias = p ? Number(p.validez_dias) : VALIDEZ_POR_DEFECTO;
  type Guardado = Parameters<typeof documentoPresupuesto>[0];
  const documento = documentoPresupuesto(
    p
      ? {
          ...(p as Guardado),
          fecha,
          validez_dias,
          items: (p.items as Guardado["items"] | null) ?? [],
        }
      : { fecha, validez_dias, envio: 0, subtotal: 0, iva: 0, total: 0, items: [] },
  );

  return {
    numero: texto(p?.numero) ?? "",
    fecha,
    validez_dias,
    documento,
    emisor: {
      nombre_comercial: texto(tienda.nombre) ?? "",
      razon_social: emisor.razon_social,
      cif: emisor.cif,
      direccion: emisor.direccion,
      email: texto(tienda.correo_remitente_email) ?? emisor.email,
      telefono: emisor.telefono ?? texto(tienda.telefono),
      web: webLegible(tienda.woo_url),
    },
    cliente: {
      nombre: texto(p?.cliente_nombre) ?? texto(cliente?.nombre) ?? "",
      empresa: texto(cliente?.empresa),
      nif: texto(cliente?.nif),
      direccion: lineasDireccion({
        direccion: cliente?.direccion,
        codigo_postal: cliente?.codigo_postal,
        ciudad: cliente?.ciudad,
        provincia: cliente?.provincia,
        pais: cliente?.pais,
      }),
      email: texto(p?.cliente_email),
      telefono: texto(p?.cliente_telefono),
    },
    notas: texto(p?.notas),
    logo: null,
    color: null,
  };
}

/**
 * El PDF de un presupuesto, para descargarlo: devuelve el nombre del fichero
 * y el PDF en base64.
 *
 * Se genera cada vez con lo que hay guardado, porque un presupuesto se edita y
 * su PDF tiene que decir lo de ahora. No se guarda en Storage: no es un
 * documento fiscal y se rehace en un momento. Sale con la plantilla de su
 * tienda (Ajustes generales → PDF de presupuestos), o con la de siempre si no
 * tiene.
 *
 * Todo se lee con la sesión de quien lo pide: si la RLS no le deja ver el
 * presupuesto, no hay PDF.
 */
export const pdfPresupuesto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: p, error } = await tabla(sb, "presupuestos")
      .select("*, items:presupuesto_items(*)")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!p) throw new Error("Sin acceso a este presupuesto");

    const [{ data: tienda }, { plantilla, logo_url }, imagenes] = await Promise.all([
      tabla(sb, "tiendas").select(COLUMNAS_TIENDA_PDF).eq("id", p.tienda_id).maybeSingle(),
      leerPlantillaPresupuesto(sb, { ambito: "tienda", tiendaId: p.tienda_id }),
      imagenesParaPdf(sb, "tienda", p.id),
    ]);
    const datos = await datosPdfTienda(sb, tienda ?? { empresa_id: p.empresa_id }, p);
    const identidad = resolverIdentidad(plantilla, logo_url, identidadTienda(tienda));

    const blob = await generarPresupuestoPDF(
      {
        ...datos,
        emisor: { ...datos.emisor, nombre_comercial: identidad.nombre_comercial },
        logo: await descargarLogo(identidad.logo_url),
        color: identidad.color,
        imagenes,
      },
      plantilla,
    );
    return { nombre: `${p.numero}.pdf`, base64: await pdfEnBase64(blob) };
  });

/**
 * Para el editor de plantillas: los datos del último presupuesto de la tienda
 * (el más reciente por fecha y número), listos para maquetar con la plantilla
 * que se está editando; sin presupuestos, uno vacío. Sin logo ni color: el
 * editor los resuelve con la plantilla a partir de `base`.
 */
export const vistaPreviaPresupuestoTienda = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ tiendaId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<VistaPreviaPresupuesto> => {
    const sb = context.supabase;
    const [{ data: tienda, error: errorTienda }, { data: p, error }] = await Promise.all([
      tabla(sb, "tiendas").select(COLUMNAS_TIENDA_PDF).eq("id", data.tiendaId).maybeSingle(),
      tabla(sb, "presupuestos")
        .select("*, items:presupuesto_items(*)")
        .eq("tienda_id", data.tiendaId)
        .order("fecha", { ascending: false })
        .order("numero", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (errorTienda) throw new Error(errorTienda.message);
    if (!tienda) throw new Error("Sin acceso a esta tienda");
    if (error && !faltaLaTabla(error)) throw new Error(error.message);

    const presupuesto = (p as Fila | null) ?? null;
    return {
      datos: await datosPdfTienda(sb, tienda, presupuesto),
      base: identidadTienda(tienda),
      numero: texto(presupuesto?.numero),
    };
  });
