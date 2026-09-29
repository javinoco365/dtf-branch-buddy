import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { llamarRpc, tabla } from "./rpc";
import { generarFacturaPDF } from "@/lib/pdf-factura";
import type { TicketPDFData } from "@/lib/pdf-ticket";
import { descargarLogo } from "@/lib/logo-descarga";
import { referenciaFactura } from "@/lib/format";

// El cliente de servicio, sin tipar de más: types.ts no conoce varias de estas tablas.
type Sb = any;

/**
 * Lo que hace falta para imprimir una factura o un ticket de tienda, sacado
 * de lo que se congeló al emitir. Comprueba antes que quien lo pide es de la
 * tienda.
 */
async function leerDatosPdfFactura(supabaseAdmin: Sb, facturaId: string, userId: string) {
  const data = { factura_id: facturaId };
  const { data: factura, error: fErr } = await tabla(supabaseAdmin, "facturas")
    .select(
      "id, tienda_id, serie, numero, tipo, fecha, desglose_iva, receptor_snapshot, fecha_vencimiento, base_imponible, iva_total, total, notas, cliente_nombre, cliente_nif, cliente_direccion, emisor_nombre, emisor_cif, emisor_direccion, ejercicio, emisor_snapshot",
    )
    .eq("id", data.factura_id)
    .maybeSingle();
  if (fErr || !factura) throw new Error("Factura no encontrada");

  // Comprobar acceso a la tienda
  const { data: miembro } = await supabaseAdmin
    .from("tienda_usuarios")
    .select("tienda_id")
    .eq("tienda_id", factura.tienda_id)
    .eq("user_id", userId)
    .maybeSingle();
  const { data: rol } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!miembro && !rol) throw new Error("Sin acceso a esta factura");

  const { data: items } = await supabaseAdmin
    .from("factura_items")
    .select("descripcion, cantidad, unidad, precio_unitario, iva_rate, subtotal, iva, total")
    .eq("factura_id", factura.id);

  // Respaldo cuando la factura no tiene snapshot de emisor. Sale de empresas,
  // que es de donde emitir_factura() congela el emisor: leer de otro sitio es
  // arriesgarse a imprimir unos datos fiscales distintos de los emitidos.
  const { data: empresa } = await tabla(supabaseAdmin, "empresas")
    .select("razon_social, cif, direccion, codigo_postal, ciudad, provincia, pais")
    .eq("activa", true)
    .order("created_at")
    .limit(1)
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

  // El logo va congelado en el snapshot del emisor, junto al resto de la
  // identidad: una factura tiene que imprimirse siempre como se emitió,
  // aunque la tienda cambie de logo después.
  const logoUrl = (factura.emisor_snapshot as { logo_url?: string } | null)?.logo_url ?? null;

  const emisorSnapshot = (factura.emisor_snapshot ?? {}) as { nombre_comercial?: string };
  const pdfData: TicketPDFData = {
    nombre_comercial: emisorSnapshot.nombre_comercial ?? null,
    desglose: Array.isArray(factura.desglose_iva)
      ? (factura.desglose_iva as { tipo: number; base: number; cuota: number }[]).map((r) => ({
          tipo: Number(r.tipo),
          base: Number(r.base),
          cuota: Number(r.cuota),
        }))
      : null,
    referencia: referenciaFactura(factura.serie, factura.ejercicio, factura.numero),
    // Un ticket dice lo que es: factura simplificada (RD 1619/2012 art. 7.2).
    titulo: factura.tipo === "simplificada" ? "FACTURA SIMPLIFICADA" : undefined,
    logo: await descargarLogo(logoUrl),
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
    items: ((items ?? []) as any[]).map((it) => ({
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

  return { factura, pdfData };
}

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
    const { factura, pdfData } = await leerDatosPdfFactura(
      supabaseAdmin,
      data.factura_id,
      context.userId,
    );

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

/**
 * El ticket en 80 mm, para la impresora térmica. Se genera cada vez desde lo
 * congelado en la factura y se devuelve una URL de un rato para abrirlo.
 */
export const generarTicket80 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ factura_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const { generarTicketPDF } = await import("@/lib/pdf-ticket");
    const supabaseAdmin = adminComoUsuario(context.userId);
    const { factura, pdfData } = await leerDatosPdfFactura(
      supabaseAdmin,
      data.factura_id,
      context.userId,
    );

    const blob = await generarTicketPDF(pdfData);
    const path = `${factura.tienda_id}/${factura.id}-80mm.pdf`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("facturas")
      .upload(path, new Uint8Array(await blob.arrayBuffer()), {
        contentType: "application/pdf",
        upsert: true,
      });
    if (upErr) throw new Error(`Error subiendo el ticket: ${upErr.message}`);

    const { data: firmada } = await supabaseAdmin.storage
      .from("facturas")
      .createSignedUrl(path, 60 * 10);
    return { url: (firmada?.signedUrl as string | undefined) ?? null };
  });

/**
 * Manda por correo una factura o un ticket de tienda, con el PDF en A4
 * adjunto. Sale con el remitente y el servidor de correo de la tienda, los
 * mismos que el aviso de pedido enviado.
 *
 * Devuelve qué ha pasado en vez de lanzar si el servidor de correo falla: lo
 * enseña la pantalla a quien lo ha pedido.
 */
export const enviarDocumentoPorCorreo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        factura_id: z.string().uuid(),
        para: z.string().trim().email("Escribe un email válido"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    const { factura, pdfData } = await leerDatosPdfFactura(
      supabaseAdmin,
      data.factura_id,
      context.userId,
    );

    const { data: tienda } = await tabla(supabaseAdmin, "tiendas")
      .select("nombre, correo_remitente_nombre, correo_remitente_email")
      .eq("id", factura.tienda_id)
      .maybeSingle();
    if (!tienda?.correo_remitente_email) {
      return {
        ok: false as const,
        error: "La tienda no tiene remitente de correo. Ponlo en los ajustes de la tienda.",
      };
    }

    const esTicket = factura.tipo === "simplificada";
    const que = esTicket ? "el ticket" : "la factura";
    const asunto = `${esTicket ? "Ticket" : "Factura"} ${pdfData.referencia} · ${tienda.nombre}`;
    const texto =
      `Hola${pdfData.cliente.nombre ? ` ${pdfData.cliente.nombre}` : ""}:\n\n` +
      `Te adjuntamos ${que} ${pdfData.referencia}.\n\n` +
      `Un saludo,\n${tienda.nombre}`;

    const { enviarCorreo, textoAHtml } = await import("./correo.server");
    const { leerCredencialesSmtp } = await import("./smtp-credenciales");
    const blob = await generarFacturaPDF(pdfData);
    const resultado = await enviarCorreo(
      {
        de: tienda.correo_remitente_nombre
          ? `${tienda.correo_remitente_nombre} <${tienda.correo_remitente_email}>`
          : tienda.correo_remitente_email,
        para: data.para,
        asunto,
        texto,
        html: textoAHtml(texto),
        adjuntos: [
          {
            nombre: `${pdfData.referencia.replace(/[^A-Za-z0-9-]/g, "_")}.pdf`,
            contenido: new Uint8Array(await blob.arrayBuffer()),
            tipo: "application/pdf",
          },
        ],
      },
      await leerCredencialesSmtp(supabaseAdmin, factura.tienda_id),
    );
    return resultado.ok
      ? { ok: true as const, para: data.para }
      : { ok: false as const, error: resultado.error };
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
  /** 2026/0001. La compone la base, que es quien asigna el número. */
  referencia: string;
  tipo: "ordinaria" | "rectificativa" | "simplificada";
  base_imponible: number;
  iva_total: number;
  total: number;
};

/** Emite una factura ordinaria. El número lo pone la base, no esta función. */
export const emitirFactura = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        tienda_id: z.string().uuid(),
        receptor: receptorSchema,
        lineas: z.array(lineaSchema).min(1, "Una factura sin líneas no se emite"),
        // La base rechaza una fecha anterior a la última de la serie: la
        // numeración es correlativa y las fechas tienen que acompañarla.
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

/* ==========================================================================
 * Documento de un pedido: ticket o factura
 *
 * Qué toca lo decide `decidirDocumento()` (src/dominio/tickets.ts); que no se
 * pase del límite ni salgan dos documentos para el mismo pedido lo impide la
 * base, en emitir_factura(). Aquí solo se reúnen los datos y se llama.
 * ========================================================================== */

/** Miembro de la tienda o administrador. SECURITY DEFINER no mira la RLS, así que se mira aquí. */
async function comprobarAccesoTienda(sb: Sb, tiendaId: string, userId: string) {
  const [{ data: miembro }, { data: rol }] = await Promise.all([
    sb
      .from("tienda_usuarios")
      .select("tienda_id")
      .eq("tienda_id", tiendaId)
      .eq("user_id", userId)
      .maybeSingle(),
    sb.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
  ]);
  if (!miembro && !rol) throw new Error("Sin acceso a esta tienda");
}

/** Los límites del ticket de la empresa. Sin la migración de tickets, los de la ley. */
async function leerLimitesTicket(sb: Sb, empresaId: string | null) {
  const { LIMITES_TICKET } = await import("@/dominio/tickets");
  if (!empresaId) return LIMITES_TICKET;
  const { data } = await tabla(sb, "empresas")
    .select("limite_simplificada, limite_simplificada_particular")
    .eq("id", empresaId)
    .maybeSingle();
  const general = Number(data?.limite_simplificada);
  const particular = Number(data?.limite_simplificada_particular);
  return general > 0 && particular > 0 ? { general, particular } : LIMITES_TICKET;
}

type DocumentoLeido = {
  id: string;
  serie: string;
  ejercicio: number;
  numero: number;
  tipo: "ordinaria" | "rectificativa" | "simplificada";
  estado: string | null;
  rectifica_a_id: string | null;
  pedido_id: string | null;
};

/** Los documentos de unos pedidos, con las rectificativas que los corrigen. */
async function leerDocumentosDePedidos(sb: Sb, pedidoIds: string[]) {
  if (pedidoIds.length === 0) return { docs: [] as DocumentoLeido[], rectificados: [] as string[] };
  const { data: docs, error } = await tabla(sb, "facturas")
    .select("id, serie, ejercicio, numero, tipo, estado, rectifica_a_id, pedido_id")
    .in("pedido_id", pedidoIds);
  if (error) throw new Error(error.message);
  const ids = (docs ?? []).map((d: DocumentoLeido) => d.id);
  const { data: rect } = ids.length
    ? await tabla(sb, "facturas").select("rectifica_a_id").in("rectifica_a_id", ids)
    : { data: [] };
  return {
    docs: (docs ?? []) as DocumentoLeido[],
    rectificados: (rect ?? []).map((r: { rectifica_a_id: string }) => r.rectifica_a_id),
  };
}

/** Todo lo que hace falta para emitir el documento de un pedido. Solo lee. */
async function leerPedidoParaDocumento(sb: Sb, pedidoId: string, userId: string) {
  const { receptorDesdePedido, lineasDesdePedido } = await import("@/dominio/factura-desde-pedido");
  const { documentoVigente, esTipoFiscal } = await import("@/dominio/tickets");

  // tabla() y no .from(): direccion_facturacion no está en types.ts.
  const { data: pedido, error: pErr } = await tabla(sb, "pedidos")
    .select(
      "id, numero, empresa_id, tienda_id, cliente_id, cliente_nombre, cliente_email, direccion_facturacion, envio, notas",
    )
    .eq("id", pedidoId)
    .maybeSingle();
  if (pErr || !pedido) throw new Error("Pedido no encontrado");
  await comprobarAccesoTienda(sb, pedido.tienda_id, userId);

  const { docs, rectificados } = await leerDocumentosDePedidos(sb, [pedidoId]);
  const vigente = documentoVigente(docs, rectificados);

  const [{ data: items }, clienteRes] = await Promise.all([
    sb
      .from("pedido_items")
      .select("descripcion, cantidad, unidad, precio_unitario, iva_rate")
      .eq("pedido_id", pedidoId),
    pedido.cliente_id
      ? tabla(sb, "clientes")
          .select(
            "nombre, nif, direccion, codigo_postal, ciudad, provincia, pais, email, tipo_fiscal",
          )
          .eq("id", pedido.cliente_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const receptor = receptorDesdePedido(
    clienteRes.data,
    pedido.direccion_facturacion,
    pedido.cliente_nombre,
    pedido.cliente_email,
  );
  const tipoFiscal = esTipoFiscal(clienteRes.data?.tipo_fiscal)
    ? clienteRes.data.tipo_fiscal
    : null;
  const lineas = lineasDesdePedido(items ?? [], Number(pedido.envio || 0));

  return { pedido, vigente, receptor, lineas, tipoFiscal };
}

/**
 * Reúne lo que hace falta para emitir el documento de un pedido con un botón:
 * el receptor, las líneas y qué toca, ticket o factura.
 *
 * No emite nada — no llama a `emitir_factura()`, no asigna número, no
 * escribe una fila. Solo lee. La emisión de verdad la hace quien llama esto,
 * con una segunda petición, después de que alguien haya visto lo que va a
 * salir y lo confirme.
 *
 * Si el pedido ya tiene su ticket o su factura vigente, no prepara otro: lo
 * devuelve. Para cambiarlo, se rectifica primero.
 */
export const prepararFacturaPedido = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ pedido_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const { calcularTotales } = await import("@/dominio/importes");
    const { decidirDocumento } = await import("@/dominio/tickets");
    const supabaseAdmin = adminComoUsuario(context.userId);

    const { pedido, vigente, receptor, lineas, tipoFiscal } = await leerPedidoParaDocumento(
      supabaseAdmin,
      data.pedido_id,
      context.userId,
    );

    if (vigente) {
      return {
        ya_facturado: true as const,
        factura: {
          id: vigente.id,
          tipo: vigente.tipo,
          referencia: referenciaFactura(vigente.serie, vigente.ejercicio, vigente.numero),
        },
      };
    }

    if (lineas.length === 0) {
      throw new Error("Este pedido no tiene líneas: no hay nada que documentar.");
    }

    const limites = await leerLimitesTicket(supabaseAdmin, pedido.empresa_id ?? null);
    const total = calcularTotales(lineas).total;

    return {
      ya_facturado: false as const,
      tienda_id: pedido.tienda_id as string,
      cliente_id: (pedido.cliente_id as string | null) ?? null,
      receptor,
      lineas,
      sin_nif: !receptor.nif,
      notas: (pedido.notas as string | null) ?? null,
      total,
      tipo_fiscal: tipoFiscal,
      limites,
      decision: decidirDocumento(
        total,
        { nombre: receptor.nombre, nif: receptor.nif, tipo_fiscal: tipoFiscal },
        limites,
      ),
    };
  });

const tipoFiscalSchema = z.enum(["particular", "profesional"]).nullable().optional();

/**
 * Emite un ticket (factura simplificada). Sin NIF: si el cliente quiere
 * deducirse el IVA, lo que toca es factura.
 *
 * El límite lo comprueba la base con el tipo fiscal que se le diga aquí o, si
 * no, con el de la ficha del cliente.
 */
export const emitirTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        tienda_id: z.string().uuid(),
        lineas: z.array(lineaSchema).min(1, "Un ticket sin líneas no se emite"),
        fecha: z.string().optional(),
        cliente_id: z.string().uuid().nullable().optional(),
        pedido_id: z.string().uuid().nullable().optional(),
        nombre: z.string().nullable().optional(),
        tipo_fiscal: tipoFiscalSchema,
        notas: z.string().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const receptor: Record<string, string> = {};
    if (data.nombre?.trim()) receptor.nombre = data.nombre.trim();
    if (data.tipo_fiscal) receptor.tipo_fiscal = data.tipo_fiscal;
    return llamarRpc<ResultadoEmision>(supabaseAdmin, "emitir_factura", {
      _usuario_id: context.userId,
      _tienda_id: data.tienda_id,
      _receptor: receptor,
      _lineas: data.lineas,
      _fecha: data.fecha ?? new Date().toISOString().slice(0, 10),
      _cliente_id: data.cliente_id ?? null,
      _pedido_id: data.pedido_id ?? null,
      _notas: data.notas ?? null,
      _simplificada: true,
    });
  });

/** Un pedido cobrado y sin documento, con lo que toca emitirle. */
export type PedidoParaTicket = {
  id: string;
  numero: string;
  fecha: string;
  total: number;
  cliente_nombre: string | null;
  decision: import("@/dominio/tickets").DecisionDocumento;
};

/**
 * Los pedidos de una tienda cobrados enteros y sin ticket ni factura, en un
 * periodo, y qué toca a cada uno. Solo lee: es la vista previa del botón de
 * emitir en bloque.
 *
 * El periodo no es un adorno: emitir hoy tickets de ventas de hace meses es
 * una decisión fiscal, y se toma mirando qué entra.
 */
export const pedidosSinDocumento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        tienda_id: z.string().uuid(),
        desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const { clasificarParaTickets, documentoVigente, estaCobrado, esTipoFiscal } =
      await import("@/dominio/tickets");
    const sb = adminComoUsuario(context.userId);
    await comprobarAccesoTienda(sb, data.tienda_id, context.userId);

    const hastaExclusivo = new Date(`${data.hasta}T00:00:00Z`);
    hastaExclusivo.setUTCDate(hastaExclusivo.getUTCDate() + 1);

    const { data: pedidos, error } = await tabla(sb, "pedidos")
      .select("id, numero, empresa_id, fecha_pedido, total, cliente_id, cliente_nombre")
      .eq("tienda_id", data.tienda_id)
      .is("cancelado_en", null)
      .gte("fecha_pedido", `${data.desde}T00:00:00`)
      .lt("fecha_pedido", hastaExclusivo.toISOString())
      .order("fecha_pedido")
      .limit(500);
    if (error) throw new Error(error.message);
    const lista = (pedidos ?? []) as {
      id: string;
      numero: string;
      empresa_id: string | null;
      fecha_pedido: string;
      total: number;
      cliente_id: string | null;
      cliente_nombre: string | null;
    }[];
    const limites = await leerLimitesTicket(sb, lista[0]?.empresa_id ?? null);
    if (lista.length === 0) return { tickets: [], facturas: [], revisar: [], limites };

    const ids = lista.map((p) => p.id);
    const clienteIds = [...new Set(lista.map((p) => p.cliente_id).filter(Boolean))] as string[];
    const [{ data: cobros }, documentos, { data: clientes }] = await Promise.all([
      tabla(sb, "cobros").select("pedido_id, importe").in("pedido_id", ids),
      leerDocumentosDePedidos(sb, ids),
      clienteIds.length
        ? tabla(sb, "clientes").select("id, nombre, nif, tipo_fiscal").in("id", clienteIds)
        : Promise.resolve({ data: [] }),
    ]);

    const cobrado = new Map<string, number>();
    for (const c of (cobros ?? []) as { pedido_id: string; importe: number }[]) {
      cobrado.set(c.pedido_id, (cobrado.get(c.pedido_id) ?? 0) + Number(c.importe));
    }
    const docsPorPedido = new Map<string, DocumentoLeido[]>();
    for (const d of documentos.docs) {
      if (!d.pedido_id) continue;
      docsPorPedido.set(d.pedido_id, [...(docsPorPedido.get(d.pedido_id) ?? []), d]);
    }
    const fichas = new Map(
      (
        (clientes ?? []) as {
          id: string;
          nombre: string;
          nif: string | null;
          tipo_fiscal: string | null;
        }[]
      ).map((c) => [c.id, c]),
    );

    const candidatos = lista
      .filter((p) => estaCobrado(Number(p.total), cobrado.get(p.id) ?? 0))
      .filter((p) => !documentoVigente(docsPorPedido.get(p.id) ?? [], documentos.rectificados))
      .map((p) => {
        const ficha = p.cliente_id ? fichas.get(p.cliente_id) : undefined;
        return {
          id: p.id,
          numero: p.numero,
          fecha: p.fecha_pedido,
          total: Number(p.total),
          cliente_nombre: ficha?.nombre ?? p.cliente_nombre,
          cliente: ficha
            ? {
                nombre: ficha.nombre,
                nif: ficha.nif,
                tipo_fiscal: esTipoFiscal(ficha.tipo_fiscal) ? ficha.tipo_fiscal : null,
              }
            : { nombre: p.cliente_nombre, nif: null, tipo_fiscal: null },
        };
      });

    const c = clasificarParaTickets(candidatos, limites);
    const fila = (p: (typeof candidatos)[number]): PedidoParaTicket => ({
      id: p.id,
      numero: p.numero,
      fecha: p.fecha,
      total: p.total,
      cliente_nombre: p.cliente_nombre,
      decision: { documento: "ticket", limite: limites.general },
    });
    return {
      tickets: c.tickets.map(fila),
      facturas: c.facturas.map((p) => ({
        ...fila(p),
        decision: { documento: "factura" as const },
      })),
      revisar: c.revisar.map((r) => ({ ...fila(r.pedido), decision: r.decision })),
      limites,
    };
  });

/**
 * Emite los tickets de varios pedidos, uno detrás de otro.
 *
 * Cada pedido se vuelve a leer y a decidir aquí, en el servidor: la lista que
 * llega del navegador solo dice cuáles intentar. Uno que ya tenga documento o
 * que no quepa en un ticket se salta y se cuenta por qué; los demás siguen.
 * La base, además, no deja emitir dos veces el mismo pedido, así que repetir
 * la petición no duplica nada.
 */
export const emitirTicketsPedidos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        pedido_ids: z.array(z.string().uuid()).min(1).max(200),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminComoUsuario, supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const { calcularTotales } = await import("@/dominio/importes");
    const { decidirDocumento } = await import("@/dominio/tickets");
    const sb = adminComoUsuario(context.userId);
    const fecha = new Date().toISOString().slice(0, 10);

    const emitidos: { pedido: string; referencia: string }[] = [];
    const omitidos: { pedido: string; motivo: string }[] = [];

    for (const id of data.pedido_ids) {
      let numero = id;
      try {
        const { pedido, vigente, receptor, lineas, tipoFiscal } = await leerPedidoParaDocumento(
          sb,
          id,
          context.userId,
        );
        numero = pedido.numero ?? id;
        if (vigente) {
          omitidos.push({ pedido: numero, motivo: "ya tiene documento" });
          continue;
        }
        if (lineas.length === 0) {
          omitidos.push({ pedido: numero, motivo: "no tiene líneas" });
          continue;
        }
        const limites = await leerLimitesTicket(sb, pedido.empresa_id ?? null);
        const decision = decidirDocumento(
          calcularTotales(lineas).total,
          { nombre: receptor.nombre, nif: receptor.nif, tipo_fiscal: tipoFiscal },
          limites,
        );
        if (decision.documento !== "ticket") {
          omitidos.push({ pedido: numero, motivo: "no va en ticket: revísalo en el pedido" });
          continue;
        }
        const r = await llamarRpc<ResultadoEmision>(supabaseAdmin, "emitir_factura", {
          _usuario_id: context.userId,
          _tienda_id: pedido.tienda_id,
          _receptor: receptor.nombre ? { nombre: receptor.nombre } : {},
          _lineas: lineas,
          _fecha: fecha,
          _cliente_id: pedido.cliente_id ?? null,
          _pedido_id: id,
          _simplificada: true,
        });
        emitidos.push({ pedido: numero, referencia: r.referencia });
      } catch (e) {
        omitidos.push({ pedido: numero, motivo: (e as Error).message || "error al emitir" });
      }
    }

    return { emitidos, omitidos };
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
    // Un ticket canjeado ya no es el documento de esa venta: lo es la factura
    // que lo sustituyó, y es esa la que se rectifica.
    const { data: canje } = await tabla(supabaseAdmin, "facturas")
      .select("serie, ejercicio, numero")
      .eq("sustituye_a_id", data.factura_id)
      .maybeSingle();
    if (canje) {
      throw new Error(
        `Este ticket se canjeó por la factura ${referenciaFactura(canje.serie, canje.ejercicio, canje.numero)}: rectifica esa.`,
      );
    }
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

/* ==========================================================================
 * Por dónde empieza la numeración
 *
 * Solo hace falta una vez: el día que la numeración venga de otro programa y
 * haya que continuarla en vez de empezar por el 1. En cuanto hay una factura
 * emitida en la serie, la base cierra la puerta y estas funciones dejan de
 * poder mover nada.
 * ========================================================================== */

export type EstadoSerie = {
  tipo: "ordinaria" | "rectificativa" | "simplificada";
  serie: string;
  ejercicio: number;
  numero_inicial: number;
  ultimo_numero: number;
  proximo_numero: number;
  emitidas: number;
  se_puede_fijar: boolean;
};

/** En qué punto va cada serie del ejercicio. Solo lectura. */
export const leerEstadoSeries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        empresa_id: z.string().uuid(),
        ejercicio: z.number().int().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    const series = await llamarRpc<EstadoSerie[]>(supabaseAdmin, "serie_estado", {
      _empresa_id: data.empresa_id,
      _ejercicio: data.ejercicio ?? new Date().getFullYear(),
    });
    return { series: series ?? [] };
  });

/**
 * Fija el número de la próxima factura de una serie.
 *
 * La comprobación de que la serie está vacía la hace la base dentro del mismo
 * bloqueo que usa la emisión, no esta función: comprobarlo aquí dejaría una
 * rendija entre la comprobación y la escritura.
 */
export const fijarInicioSerie = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        empresa_id: z.string().uuid(),
        ejercicio: z.number().int(),
        tipo: z.enum(["ordinaria", "rectificativa", "simplificada"]),
        siguiente: z.number().int().min(1, "La próxima factura no puede ser la número 0"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return llamarRpc<{ serie: string; ejercicio: number; proximo_numero: number }>(
      supabaseAdmin,
      "serie_fijar_inicio",
      {
        _usuario_id: context.userId,
        _empresa_id: data.empresa_id,
        _ejercicio: data.ejercicio,
        _tipo: data.tipo,
        _siguiente: data.siguiente,
      },
    );
  });

/** Una línea congelada, lista para volver a emitirse igual. */
function lineasDeSnapshot(snapshot: unknown) {
  return ((Array.isArray(snapshot) ? snapshot : []) as any[]).map((l) => ({
    descripcion: String(l.descripcion ?? ""),
    cantidad: Number(l.cantidad ?? 0),
    unidad: String(l.unidad ?? "ud"),
    precio_unitario: Number(l.precio_unitario ?? 0),
    iva_rate: Number(l.iva_rate ?? 0),
  }));
}

/**
 * Canjea un ticket de tienda por una factura completa (en Verifactu, F3).
 *
 * La factura nueva lleva las mismas líneas que se congelaron en el ticket y
 * los datos fiscales que da ahora el cliente. El ticket no se toca. La base
 * comprueba que es un ticket, que no se canjeó ni rectificó antes y que la
 * factura suma lo mismo.
 */
export const canjearTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        factura_id: z.string().uuid(),
        receptor: receptorSchema.extend({
          nif: z.string().trim().min(1, "El canje necesita el NIF del cliente"),
        }),
        fecha: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminComoUsuario, supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const sb = adminComoUsuario(context.userId);
    const { data: ticket } = await tabla(sb, "facturas")
      .select("id, tienda_id, tipo, cliente_id, lineas_snapshot")
      .eq("id", data.factura_id)
      .maybeSingle();
    if (!ticket) throw new Error("El ticket no existe");
    await comprobarAccesoTienda(sb, ticket.tienda_id, context.userId);
    if (ticket.tipo !== "simplificada") throw new Error("Solo se canjean tickets");

    return llamarRpc<ResultadoEmision>(supabaseAdmin, "emitir_factura", {
      _usuario_id: context.userId,
      _tienda_id: ticket.tienda_id,
      _receptor: data.receptor,
      _lineas: lineasDeSnapshot(ticket.lineas_snapshot),
      _fecha: data.fecha ?? new Date().toISOString().slice(0, 10),
      _cliente_id: ticket.cliente_id ?? null,
      _notas: null,
      _sustituye_a_id: ticket.id,
    });
  });
