import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { faltaLaTabla, llamarRpc, tabla } from "./rpc";
import { leerTodas, trozos } from "./paginar";
import { cuadreExtracto, huellaMovimiento, normalizarIban } from "@/dominio/extractos";
import { emparejar, type FacturaPendiente, type MovimientoBanco } from "@/dominio/conciliacion";
import { referenciaFactura } from "./format";

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

const opcionesSchema = z.object({
  orden_fecha: z.enum(["dma", "mda", "amd"]).optional(),
  decimal: z.enum([",", "."]).optional(),
});

/** Fichero, cuenta, opciones de formato y saldos escritos a mano, del formulario. */
const formularioExtracto = (d: unknown) => {
  if (!(d instanceof FormData)) throw new Error("Falta el fichero");
  const fichero = d.get("fichero");
  if (!(fichero instanceof File)) throw new Error("Falta el fichero");
  const texto = (k: string) => {
    const v = d.get(k);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  const numero = (k: string) => {
    const v = texto(k);
    if (v === null) return null;
    const n = Number(v.replace(",", "."));
    if (!Number.isFinite(n)) throw new Error(`${k.replace("_", " ")} no es un número`);
    return n;
  };
  return {
    fichero,
    cuenta_id: texto("cuenta_id") ? z.string().uuid().parse(texto("cuenta_id")) : null,
    opciones: opcionesSchema.parse(JSON.parse(texto("opciones") ?? "{}")),
    saldo_inicial: numero("saldo_inicial"),
    saldo_final: numero("saldo_final"),
  };
};

/**
 * Lee el extracto y dice qué ha entendido, sin guardar nada: formato
 * detectado (y lo que no se pudo saber), movimientos, periodo, saldos y si
 * cuadra.
 */
export const analizarExtracto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(formularioExtracto)
  .handler(async ({ data }) => {
    const { leerExtracto } = await import("./extracto-banco.server");
    const e = await leerExtracto(
      new Uint8Array(await data.fichero.arrayBuffer()),
      data.fichero.name,
      data.opciones,
    );
    const saldoInicial = e.saldo_inicial ?? data.saldo_inicial;
    const saldoFinal = e.saldo_final ?? data.saldo_final;
    const cuadre = cuadreExtracto(saldoInicial, saldoFinal, e.movimientos);
    return {
      formato: e.formato,
      movimientos: e.movimientos.length,
      muestra: e.movimientos.slice(0, 5),
      desde: e.desde,
      hasta: e.hasta,
      saldos_del_fichero: e.saldo_inicial !== null && e.saldo_final !== null,
      saldo_inicial: saldoInicial,
      saldo_final: saldoFinal,
      ...cuadre,
      avisos: e.avisos,
    };
  });

/**
 * Importa el extracto del banco en una cuenta: guarda el extracto (con su
 * formato, saldos y si cuadra) y sus movimientos.
 *
 * Reimportar un periodo solapado es lo normal —se descarga el día 20 y otra
 * vez el 31—, así que los movimientos repetidos no son un error: se cuentan
 * y se ignoran. Sin la migración de cuentas (20261016100000), sin cuenta y
 * sin extracto, como antes.
 */
export const importarExtracto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(formularioExtracto)
  .handler(async ({ data, context }) => {
    const { leerExtracto } = await import("./extracto-banco.server");
    const e = await leerExtracto(
      new Uint8Array(await data.fichero.arrayBuffer()),
      data.fichero.name,
      data.opciones,
    );
    if (e.formato.ambiguo.length > 0) {
      throw new Error(
        `No se puede saber ${e.formato.ambiguo
          .map((a) => (a === "orden_fecha" ? "el orden de la fecha" : "el separador decimal"))
          .join(" ni ")} mirando el fichero: elígelo antes de importar.`,
      );
    }
    const empresa_id = await empresaActiva(context.supabase);
    const cuenta = data.cuenta_id ?? "";
    const filas = e.movimientos.map((m) => ({ ...m, huella: huellaMovimiento(cuenta, m) }));

    let extracto_id: string | null = null;
    let nuevas = filas.length;
    if (data.cuenta_id) {
      // Cuántas ya estaban, para guardarlo en el extracto (que no se edita).
      let repetidas = 0;
      for (const trozo of trozos(filas.map((f) => f.huella))) {
        const r = await tabla(context.supabase, "banco_movimientos")
          .select("huella")
          .eq("empresa_id", empresa_id)
          .in("huella", trozo);
        if (r.error) throw new Error(r.error.message);
        repetidas += (r.data ?? []).length;
      }
      nuevas = filas.length - repetidas;
      const saldoInicial = e.saldo_inicial ?? data.saldo_inicial;
      const saldoFinal = e.saldo_final ?? data.saldo_final;
      const { data: ext, error } = await tabla(context.supabase, "banco_extractos")
        .insert({
          empresa_id,
          cuenta_id: data.cuenta_id,
          fichero: data.fichero.name,
          formato: e.formato,
          desde: e.desde,
          hasta: e.hasta,
          saldo_inicial: saldoInicial,
          saldo_final: saldoFinal,
          suma_movimientos: cuadreExtracto(saldoInicial, saldoFinal, e.movimientos).suma,
          movimientos: filas.length,
          nuevos: nuevas,
        })
        .select("id, cuadra")
        .single();
      if (error) throw new Error(error.message);
      extracto_id = ext.id as string;
    }

    // onConflict + ignoreDuplicates: la huella hace el trabajo, y una sola
    // llamada evita un ida y vuelta por línea.
    const { data: metidas, error } = await tabla(context.supabase, "banco_movimientos")
      .upsert(
        filas.map((f) => ({
          empresa_id,
          fecha: f.fecha,
          concepto: f.concepto,
          importe: f.importe,
          huella: f.huella,
          origen: data.fichero.name,
          ...(data.cuenta_id ? { cuenta_id: data.cuenta_id, extracto_id, saldo: f.saldo } : {}),
        })),
        { onConflict: "empresa_id,huella", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw new Error(error.message);

    const metidasN = metidas?.length ?? 0;
    return { leidas: filas.length, nuevas: metidasN, repetidas: filas.length - metidasN };
  });

// ---------------------------------------------------------------------------
// Cuentas
// ---------------------------------------------------------------------------

/** Las cuentas y los últimos extractos. Sin la migración, `disponible` es falso. */
export const listCuentas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await tabla(context.supabase, "banco_cuentas")
      .select("id, banco, alias, iban, activa")
      .order("created_at");
    if (faltaLaTabla(c.error)) return { disponible: false, cuentas: [], extractos: [] };
    if (c.error) throw new Error(c.error.message);
    const e = await tabla(context.supabase, "banco_extractos")
      .select(
        "id, cuenta_id, fichero, formato, desde, hasta, saldo_inicial, saldo_final, suma_movimientos, movimientos, nuevos, cuadra, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(20);
    if (e.error) throw new Error(e.error.message);
    return { disponible: true, cuentas: c.data ?? [], extractos: e.data ?? [] };
  });

export const guardarCuenta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        banco: z.string().trim().min(1, "Pon el banco"),
        alias: z.string().trim().min(1, "Pon un alias"),
        iban: z.string().trim().nullable(),
        activa: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const iban = data.iban ? normalizarIban(data.iban) : null;
    if (data.iban && !iban) throw new Error("El IBAN no es válido: revisa los dígitos.");
    const fila = { banco: data.banco, alias: data.alias, iban, activa: data.activa ?? true };
    if (data.id) {
      const { error } = await tabla(context.supabase, "banco_cuentas")
        .update(fila)
        .eq("id", data.id);
      if (error) throw new Error(error.code === "23505" ? "Esa cuenta ya existe." : error.message);
      return { id: data.id };
    }
    const empresa_id = await empresaActiva(context.supabase);
    const { data: creada, error } = await tabla(context.supabase, "banco_cuentas")
      .insert({ ...fila, empresa_id })
      .select("id")
      .single();
    if (error) throw new Error(error.code === "23505" ? "Esa cuenta ya existe." : error.message);
    return { id: creada.id as string };
  });

/** Los ingresos que todavía no se han casado con ninguna factura. */
export const listMovimientosBanco = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Por páginas: Supabase corta en 1000 filas sin avisar (ver paginar.ts).
    const { data, error } = await leerTodas<any>((a, b) =>
      tabla(context.supabase, "banco_movimientos")
        .select("*, conciliacion:banco_conciliaciones(id, factura_id, motivo, diferencia)")
        .order("fecha", { ascending: false })
        .order("id")
        .range(a, b),
    );
    if (error) throw new Error(error.message);
    return data;
  });

/**
 * Qué factura paga cada ingreso, según el CRM.
 *
 * El emparejamiento vive en `src/dominio/conciliacion.ts` y se prueba sin base
 * de datos. Aquí solo se le dan los dos lados: todos los ingresos y todas las
 * facturas por cobrar, por páginas, porque Supabase corta en 1000 filas sin
 * avisar (ver paginar.ts). Antes se pedían 1000 ingresos y 2000 facturas, sin
 * orden, y llegaban 1000 cualesquiera: una factura vieja sin cobrar podía no
 * salir nunca.
 */
export const proponerConciliacion = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: movs, error: e1 } = await leerTodas<any>((a, b) =>
      tabla(context.supabase, "banco_movimientos")
        .select("id, fecha, concepto, importe, banco_conciliaciones(id)")
        .gt("importe", 0)
        .order("fecha", { ascending: false })
        .order("id")
        .range(a, b),
    );
    if (e1) throw new Error(e1.message);

    const sinCasar: MovimientoBanco[] = (movs ?? [])
      .filter((m: any) => (m.banco_conciliaciones ?? []).length === 0)
      .map((m: any) => ({
        id: m.id,
        fecha: m.fecha,
        concepto: m.concepto ?? "",
        importe: Number(m.importe),
      }));

    const { data: facs, error: e2 } = await leerTodas<any>((a, b) =>
      tabla(context.supabase, "facturas")
        .select(
          "id, serie, ejercicio, numero, fecha, total, cliente_nombre, banco_conciliaciones(id)",
        )
        .in("estado", ["emitida", "vencida"])
        .order("fecha", { ascending: false })
        .order("id")
        .range(a, b),
    );
    if (e2) throw new Error(e2.message);

    const pendientes: FacturaPendiente[] = (facs ?? [])
      .filter((f: any) => (f.banco_conciliaciones ?? []).length === 0)
      .map((f: any) => ({
        id: f.id,
        referencia: referenciaFactura(f.serie, f.ejercicio, f.numero),
        fecha: f.fecha,
        total: Number(f.total),
        cliente_nombre: f.cliente_nombre ?? null,
      }));

    return { propuestas: emparejar(sinCasar, pendientes), movimientos: sinCasar, pendientes };
  });

export const conciliar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        movimiento_id: z.string().uuid(),
        factura_id: z.string().uuid(),
        motivo: z.enum(["referencia", "cliente_e_importe", "importe", "manual"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const id = await llamarRpc<string>(context.supabase, "banco_conciliar", {
      _usuario_id: context.userId,
      _movimiento_id: data.movimiento_id,
      _factura_id: data.factura_id,
      _motivo: data.motivo,
    });
    return { id };
  });

export const desconciliar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ movimiento_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const ok = await llamarRpc<boolean>(context.supabase, "banco_desconciliar", {
      _usuario_id: context.userId,
      _movimiento_id: data.movimiento_id,
    });
    return { ok };
  });
