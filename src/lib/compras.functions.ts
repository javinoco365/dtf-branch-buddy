import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { faltaLaColumna, faltaLaFuncion, llamarRpc, llamarRpcConError, tabla } from "./rpc";
import { leerTodas } from "./paginar";
import {
  AVISO_MIGRACION_ESCANER,
  AVISO_MIGRACION_PROFORMAS,
  escanerAplicado,
  mensajeErrorEscaner,
  proformasAplicado,
  textoONulo,
} from "./escaner-textil";
import { normalizarCompra, revisarCompra } from "@/dominio/factura-compra";
import { CATEGORIAS_COMPRA, FORMAS_PAGO } from "@/dominio/compras";
import { avisoDuplicado, type CompraComparable } from "@/dominio/cola-compras";
import { normalizarEan } from "@/dominio/normalizar-textil";
import { conCostesDeEntrada } from "@/dominio/reparto-compra";
import type { EntradaProforma } from "@/dominio/proformas";
import {
  METODOS_CASADO,
  TIPOS_DOCUMENTO_COMPRA,
  TIPOS_LINEA_COMPRA,
  type LineaRegistro,
  type NuevaVariante,
  type RegistroCompra,
  type ResultadoRegistro,
} from "@/dominio/tipos-textil";

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
    const { hayLectorConfigurado } = await import("./cola-compras.server");
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
  cantidad: z.number().positive("La cantidad de cada línea tiene que ser mayor que cero."),
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

type DatosCompra = z.infer<typeof compraSchema>;

/**
 * Guarda el borrador (cabecera y líneas). Todavía no ha tocado el stock. Lo
 * usan `guardarCompra` y el camino viejo de `guardarYRegistrarCompra`.
 */
async function guardarBorrador(supabase: unknown, data: DatosCompra): Promise<{ id: string }> {
  const { id, lineas, lectura_ia, ...cabecera } = data;
  const empresa_id = await empresaActiva(supabase);

  let compraId = id;
  if (id) {
    const { error } = await tabla(supabase, "textil_compras").update(cabecera).eq("id", id);
    if (error) throw new Error(error.message);
    const { error: delErr } = await tabla(supabase, "textil_compra_lineas")
      .delete()
      .eq("compra_id", id);
    if (delErr) throw new Error(delErr.message);
  } else {
    const { data: fila, error } = await tabla(supabase, "textil_compras")
      .insert({ ...cabecera, empresa_id, lectura_ia: parsearLectura(lectura_ia) })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    compraId = fila.id as string;
  }

  if (lineas.length > 0) {
    const { error } = await tabla(supabase, "textil_compra_lineas").insert(
      lineas.map((l, i) => ({ ...l, compra_id: compraId, orden: i })),
    );
    if (error) throw new Error(error.message);
  }
  return { id: compraId! };
}

/**
 * Registra un borrador ya guardado con `textil_compra_registrar` (el camino
 * viejo, sin reparto): las líneas casadas entran en el libro de stock.
 */
async function registrarBorrador(supabase: unknown, id: string): Promise<{ movidas: number }> {
  // Registrarla es confirmarla: la ha revisado una persona.
  const antes = await tabla(supabase, "textil_compras")
    .select("revision")
    .eq("id", id)
    .maybeSingle();
  const conCola = !faltaLaColumna(antes.error) && antes.data?.revision !== undefined;
  if (conCola && antes.data?.revision !== "revisada") {
    const { error } = await tabla(supabase, "textil_compras")
      .update({ revision: "revisada" })
      .eq("id", id);
    if (error) throw new Error(error.message);
  }
  try {
    const movidas = await llamarRpc<number>(supabase, "textil_compra_registrar", {
      _compra_id: id,
    });
    return { movidas };
  } catch (e) {
    // Si no se registra, vuelve a la cola como estaba.
    if (conCola && antes.data?.revision !== "revisada") {
      await tabla(supabase, "textil_compras")
        .update({ revision: antes.data?.revision })
        .eq("id", id);
    }
    const mensaje = e instanceof Error ? e.message : String(e);
    if (/textil_compras_factura_unica|duplicate key/i.test(mensaje)) {
      throw new Error(
        "Esta factura (mismo proveedor y número) ya está registrada. Si es un duplicado, bórrala.",
      );
    }
    throw e;
  }
}

/** Guarda el borrador. Todavía no ha tocado el stock. */
export const guardarCompra = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => compraSchema.parse(d))
  .handler(async ({ data, context }) => guardarBorrador(context.supabase, data));

/** Registra la compra: las líneas casadas entran en el libro de stock. */
export const registrarCompra = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => registrarBorrador(context.supabase, data.id));

// ---------------------------------------------------------------------------
// Guardar y registrar en una sola transacción (escáner textil)
// ---------------------------------------------------------------------------

const nuevaVarianteSchema = z
  .object({
    producto_id: z.string().uuid().nullable(),
    producto: z
      .object({
        marca: z.string().nullable(),
        referencia: z.string().nullable(),
        nombre: z.string().trim().min(1),
        categoria: z.string().nullable(),
      })
      .nullable(),
    color: z.string().nullable(),
    talla: z.string().nullable(),
    ean: z.string().nullable(),
    sku: z.string().nullable(),
    precio_venta: z.number().min(0),
    cantidad_minima: z.number().min(0),
  })
  .refine((v) => v.producto_id !== null || v.producto !== null, {
    message: "La variante nueva necesita un producto: elige uno o escribe el nuevo.",
  });

const lineaRegistroSchema = z.object({
  descripcion: z.string().trim().min(1, "Hay líneas sin descripción."),
  cantidad: z.number().positive("La cantidad de cada línea tiene que ser mayor que cero."),
  precio_unitario: z.number(),
  importe: z.number(),
  unidad: z.string().nullable(),
  tipo: z.enum(TIPOS_LINEA_COMPRA),
  referencia: z.string().nullable(),
  marca: z.string().nullable(),
  modelo: z.string().nullable(),
  color: z.string().nullable(),
  talla: z.string().nullable(),
  ean: z.string().nullable(),
  unidades_por_pack: z.number().positive("Las unidades por pack tienen que ser mayores que cero."),
  stock_id: z.string().uuid().nullable(),
  nueva_variante: nuevaVarianteSchema.nullable(),
  casado_metodo: z.enum(METODOS_CASADO).nullable(),
  // Con las migraciones de proformas: la línea del papel de la que sale (partida por tallas).
  linea_papel: z.number().int().positive().nullable().optional(),
});

const registroSchema = compraSchema.extend({
  id: z.string().uuid().nullable().optional(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Falta la fecha de la factura (AAAA-MM-DD)."),
  proveedor_id: z.string().uuid().nullable().optional(),
  lectura_ia: z.string().nullable().optional(),
  lineas: z.array(lineaRegistroSchema),
  // Con las migraciones de proformas (20261029…): qué documento es y, en una
  // factura, la proforma con la que se casa.
  tipo_documento: z.enum(TIPOS_DOCUMENTO_COMPRA).optional(),
  proforma_id: z.string().uuid().nullable().optional(),
});

export type EntradaRegistroCompra = z.input<typeof registroSchema>;
export type SalidaRegistroCompra = ResultadoRegistro & { atomica: boolean };

/**
 * Guarda y registra una compra en una sola transacción de la base
 * (`textil_compra_guardar_y_registrar`): cabecera, líneas, proveedor, variantes
 * nuevas, memoria del escáner y movimientos de stock. Si algo falla, no queda
 * nada a medias.
 *
 * En textil, el reparto de portes, descuentos y otros cargos lo hace aquí el
 * servidor (el del navegador solo se enseña) y la base lo vuelve a comprobar
 * al céntimo.
 *
 * Sin la migración 20261028100200, cae al camino viejo (guardar el borrador y
 * `textil_compra_registrar`) si la compra no necesita nada nuevo; si lo
 * necesita, lo dice.
 *
 * Una proforma, o una factura casada con su proforma, solo se registra con las
 * migraciones de proformas aplicadas, y nunca por el camino viejo: la función
 * vieja ignoraría `tipo_documento` y `proforma_id` en silencio y el género de la
 * proforma entraría dos veces (contrato, A12).
 */
export const guardarYRegistrarCompra = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => registroSchema.parse(d))
  .handler(async ({ data, context }): Promise<SalidaRegistroCompra> => {
    const { lineas: lineasEntrada, lectura_ia, ...cab } = data;
    const id = cab.id ?? null;
    const categoria = cab.categoria ?? "textil";
    const tipoDocumento = cab.tipo_documento ?? "factura";
    const proformaId = cab.proforma_id ?? null;
    const conProforma = tipoDocumento === "proforma" || proformaId !== null;
    if (conProforma && !(await proformasAplicado(context.supabase))) {
      throw new Error(AVISO_MIGRACION_PROFORMAS);
    }
    const empresa_id = id ? null : await empresaActiva(context.supabase);

    // EAN: en la línea, uno que no vale se manda nulo (el aviso ya lo vio la
    // persona); en una variante nueva, no se crea con un EAN que no vale.
    const lineas: LineaRegistro[] = lineasEntrada.map((l, i) => {
      let nueva: NuevaVariante | null = null;
      if (l.nueva_variante) {
        const escrito = textoONulo(l.nueva_variante.ean);
        const ean = escrito ? normalizarEan(escrito) : null;
        if (escrito && !ean) {
          throw new Error(mensajeErrorEscaner({ linea: i, codigo: "E-EAN-1", datos: [escrito] }));
        }
        nueva = { ...l.nueva_variante, ean };
      }
      return {
        ...l,
        ean: normalizarEan(l.ean),
        nueva_variante: nueva,
        unidades_stock: null,
        coste_total_entrada: null,
        coste_unitario_entrada: null,
        linea_papel: l.linea_papel ?? null,
      };
    });

    /**
     * Sin las migraciones del escáner: guardar el borrador y
     * `textil_compra_registrar`, como antes de esta obra.
     */
    const caminoViejo = async (): Promise<SalidaRegistroCompra> => {
      // Red de seguridad: con proforma, el camino viejo duplicaría el stock.
      if (conProforma) throw new Error(AVISO_MIGRACION_PROFORMAS);
      // Sin la migración: lo nuevo (variantes que crear, packs que entran al
      // stock) no se puede registrar por el camino viejo sin perderlo. Una
      // línea de portes o de descuento sin variante sí: no mueve stock, como
      // siempre (sin repartir; si se bloquease, una factura textil con portes
      // no se podría registrar hasta aplicar la migración). Y casada con una
      // variante, también: la revisión de siempre (sin el escáner) obliga a
      // casar todas las líneas, y el camino viejo las guarda sin tipo, así que
      // entran como artículo, que es lo que hacía antes de esta obra.
      const necesitaEscaner =
        categoria === "textil" &&
        lineas.some(
          (l) => l.nueva_variante !== null || (l.stock_id !== null && l.unidades_por_pack !== 1),
        );
      if (necesitaEscaner) throw new Error(AVISO_MIGRACION_ESCANER);

      // Solo las columnas de siempre: sin proveedor_id, sin las de proformas
      // (aquí siempre factura sin proforma) ni los campos nuevos de línea.
      const {
        proveedor_id: _sinProveedor,
        tipo_documento: _sinTipo,
        proforma_id: _sinProforma,
        ...cabeceraVieja
      } = cab;
      void _sinProveedor;
      void _sinTipo;
      void _sinProforma;
      const { id: guardada } = await guardarBorrador(context.supabase, {
        ...cabeceraVieja,
        id: id ?? undefined,
        lectura_ia: lectura_ia ?? null,
        lineas: lineas.map((l) => ({
          descripcion: l.descripcion,
          cantidad: l.cantidad,
          precio_unitario: l.precio_unitario,
          importe: l.importe,
          unidad: l.unidad,
          stock_id: l.stock_id,
        })),
      });
      const { movidas } = await registrarBorrador(context.supabase, guardada);
      return {
        id: guardada,
        movidas,
        variantes_creadas: 0,
        aprendidas: 0,
        proveedor_id: null,
        proveedor_nuevo: false,
        tipo_documento: "factura",
        proforma_id: null,
        casado: null,
        atomica: false,
      };
    };

    // El reparto que manda es este, no el del navegador. Sin las migraciones
    // no hay reparto ni comprobación al céntimo: la factura se registra como
    // antes (una que no cuadra con su base no se bloquea por algo que aún no
    // existe en la base). La proforma y la factura casada pasan también por el
    // reparto (contrato, A1); si no cuadra, se dice: nunca camino viejo.
    let conCostes = lineas;
    if (categoria === "textil") {
      const r = conCostesDeEntrada(lineas, cab.base);
      if (r.ok) conCostes = r.lineas;
      else if (conProforma || (await escanerAplicado(context.supabase))) {
        throw new Error(mensajeErrorEscaner(r.errores[0]));
      } else return caminoViejo();
    }

    const lecturaIa = parsearLectura(lectura_ia);
    const _compra: RegistroCompra = {
      id,
      empresa_id,
      proveedor_id: cab.proveedor_id ?? null,
      proveedor: cab.proveedor ?? null,
      nif_proveedor: cab.nif_proveedor ?? null,
      numero: cab.numero ?? null,
      fecha: cab.fecha,
      base: cab.base,
      iva: cab.iva,
      total: cab.total,
      categoria,
      tipo_iva: cab.tipo_iva ?? null,
      tipo_irpf: cab.tipo_irpf ?? null,
      liquido_origen: cab.liquido_origen ?? null,
      // Solo lo que manda la pantalla: lo que no manda (Textil › Compras no
      // manda concepto, IRPF ni forma de pago) se conserva en el borrador de
      // la cola, como hacía guardarCompra.
      ...(cab.irpf === undefined ? {} : { irpf: cab.irpf }),
      ...(cab.gasto_id === undefined ? {} : { gasto_id: cab.gasto_id }),
      ...(cab.nota_descuadre === undefined ? {} : { nota_descuadre: cab.nota_descuadre }),
      ...(cab.concepto === undefined ? {} : { concepto: cab.concepto }),
      ...(cab.forma_pago === undefined ? {} : { forma_pago: cab.forma_pago }),
      ...(cab.notas === undefined ? {} : { notas: cab.notas }),
      lectura_ia: lecturaIa,
      lineas: conCostes,
      tipo_documento: tipoDocumento,
      proforma_id: proformaId,
    };

    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const { data: resultado, error } = await llamarRpcConError<ResultadoRegistro>(
      adminComoUsuario(context.userId),
      "textil_compra_guardar_y_registrar",
      { _compra, _usuario_id: context.userId },
    );

    // Sin la función, el camino viejo; con proforma, caminoViejo lanza el aviso.
    if (faltaLaFuncion(error)) return caminoViejo();
    // Los mensajes de la base ya son para la persona (contrato, 1.4).
    if (error) throw new Error(error.message);
    if (!resultado) throw new Error("La base no ha devuelto el resultado del registro.");
    return {
      id: resultado.id,
      movidas: Number(resultado.movidas ?? 0),
      variantes_creadas: Number(resultado.variantes_creadas ?? 0),
      aprendidas: Number(resultado.aprendidas ?? 0),
      proveedor_id: resultado.proveedor_id ?? null,
      proveedor_nuevo: Boolean(resultado.proveedor_nuevo),
      tipo_documento: resultado.tipo_documento ?? "factura",
      proforma_id: resultado.proforma_id ?? null,
      casado: resultado.casado ?? null,
      atomica: true,
    };
  });

/**
 * Las compras, con sus líneas. `soloTextil`: solo las de textil (todas, sin
 * la migración de compras generales, que lo son). `generales` dice si la
 * migración está aplicada; `proformas`, si lo están las de proformas.
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
    // Con las migraciones 20261028…: revisión con el escáner textil.
    const escaner = await escanerAplicado(context.supabase);
    // Con las migraciones 20261029…: proformas y casado con su factura.
    const proformas = await proformasAplicado(context.supabase);
    // Por páginas: Supabase corta en 1000 filas sin avisar (ver paginar.ts).
    const { data: compras, error } = await leerTodas<any>((a, b) => {
      let consulta = tabla(context.supabase, "textil_compras").select(
        // Pista por columna: con la migración del escáner, los movimientos de
        // stock enlazan compras y líneas, y sin pista PostgREST puede ver dos
        // relaciones (PGRST201) y dejar la lista sin cargar.
        "*, lineas:textil_compra_lineas!compra_id(*)",
      );
      if (generales && data.soloTextil) consulta = consulta.eq("categoria", "textil");
      return consulta
        .order("fecha", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("id")
        .range(a, b);
    });
    if (error) throw new Error(error.message);
    return {
      compras: (compras ?? []) as any[],
      generales,
      recibidas,
      cola,
      escaner,
      proformas,
    };
  });

/**
 * Lo que metió una proforma en el libro de stock, por variante (ya resuelta a
 * su destino si se fusionó): para enseñar la comparación talla a talla antes
 * de registrar su factura. Sin la migración de proformas, nada.
 */
export const entradasDeProforma = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ proforma_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<EntradaProforma[]> => {
    const { data: filas, error } = await llamarRpcConError<Record<string, unknown>[]>(
      context.supabase,
      "proforma_entradas",
      { _proforma_id: data.proforma_id },
    );
    if (faltaLaFuncion(error)) return [];
    if (error) throw new Error(error.message);
    return (filas ?? []).map((f) => ({
      stock_id: String(f.stock_id),
      unidades: Number(f.unidades ?? 0),
      valor: Number(f.valor ?? 0),
      coste_unitario: Number(f.coste_unitario ?? 0),
      devueltas: Number(f.devueltas ?? 0),
    }));
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
 * El fichero y, opcional, la categoría de la cola desde la que se sube: solo
 * «textil» (Textil › Compras). Sin ella, la categoría la propone la IA.
 */
const ficheroYCategoria = (d: unknown) => {
  const { fichero } = ficheroDe(d);
  const valor = (d as FormData).get("categoria");
  if (valor !== null && valor !== "" && valor !== "textil") {
    throw new Error("Categoría no admitida al subir: solo «textil».");
  }
  return { fichero, categoria: valor === "textil" ? ("textil" as const) : null };
};

/**
 * Sube una factura a la cola: guarda el fichero en compras/ronoca/<año>/,
 * crea la fila (para que se vea pase lo que pase), la lee con IA y la deja
 * pendiente de revisión o como error. Si el mismo fichero ya está subido, no
 * hace nada y lo dice.
 */
export const subirFacturaRecibida = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(ficheroYCategoria)
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
      categoria: data.categoria ?? "otros",
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
      data.categoria ? { categoria: data.categoria } : undefined,
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
      .select("estado, fichero_ruta, categoria")
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
      // Una de la cola de Textil sigue en Textil al releerla.
      fila.categoria === "textil" ? { categoria: "textil" } : undefined,
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
