import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { llamarRpc, tabla } from "./rpc";
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

/**
 * Importa el extracto del banco.
 *
 * Devuelve cuántas líneas traía y cuántas eran nuevas. Reimportar un periodo
 * solapado es lo normal —se descarga el día 20 y otra vez el 31—, así que las
 * repetidas no son un error: se cuentan y se ignoran.
 */
export const importarExtracto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    if (!(d instanceof FormData)) throw new Error("Falta el fichero");
    const fichero = d.get("fichero");
    if (!(fichero instanceof File)) throw new Error("Falta el fichero");
    return { fichero };
  })
  .handler(async ({ data, context }) => {
    const { leerExtracto } = await import("./extracto-banco.server");
    const bytes = new Uint8Array(await data.fichero.arrayBuffer());
    const filas = await leerExtracto(bytes, data.fichero.name);
    const empresa_id = await empresaActiva(context.supabase);

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
        })),
        { onConflict: "empresa_id,huella", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw new Error(error.message);

    const nuevas = metidas?.length ?? 0;
    return { leidas: filas.length, nuevas, repetidas: filas.length - nuevas };
  });

/** Los ingresos que todavía no se han casado con ninguna factura. */
export const listMovimientosBanco = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await tabla(context.supabase, "banco_movimientos")
      .select("*, conciliacion:banco_conciliaciones(id, factura_id, motivo, diferencia)")
      .order("fecha", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/**
 * Qué factura paga cada ingreso, según el CRM.
 *
 * El emparejamiento vive en `src/dominio/conciliacion.ts` y se prueba sin base
 * de datos. Aquí solo se le dan los dos lados.
 */
export const proponerConciliacion = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: movs, error: e1 } = await tabla(context.supabase, "banco_movimientos")
      .select("id, fecha, concepto, importe, banco_conciliaciones(id)")
      .gt("importe", 0)
      .order("fecha", { ascending: false })
      .limit(1000);
    if (e1) throw new Error(e1.message);

    const sinCasar: MovimientoBanco[] = (movs ?? [])
      .filter((m: any) => (m.banco_conciliaciones ?? []).length === 0)
      .map((m: any) => ({
        id: m.id,
        fecha: m.fecha,
        concepto: m.concepto ?? "",
        importe: Number(m.importe),
      }));

    const { data: facs, error: e2 } = await tabla(context.supabase, "facturas")
      .select(
        "id, serie, ejercicio, numero, fecha, total, cliente_nombre, banco_conciliaciones(id)",
      )
      .in("estado", ["emitida", "vencida"])
      .limit(2000);
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
