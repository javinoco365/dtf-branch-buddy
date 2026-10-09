import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { faltaLaColumna, llamarRpc, tabla } from "./rpc";
import { leerTodas } from "./paginar";
import { referenciaFactura } from "./format";
import {
  esperadoDe,
  planConciliacion,
  type Documento,
  type Movimiento,
  type TipoDocumento,
} from "@/dominio/motor-conciliacion";

/**
 * Conciliación con el motor: movimientos de todas las cuentas contra facturas
 * recibidas (cargos) y emitidas de tienda y de textil (abonos).
 *
 * Las reglas viven en `src/dominio/motor-conciliacion.ts`. Aquí se leen los
 * dos lados, se pasa el plan a la pantalla y se escribe solo por las
 * funciones de la base (banco_enlazar y compañía), que vuelven a comprobarlo
 * todo con las filas bloqueadas. Sin la migración 20261017100000,
 * `disponible` es falso y la pantalla sigue con la conciliación de antes.
 */

export type DocumentoConciliable = Documento & {
  /** Para pintar: «Recibida», «Factura» o «Textil». */
  clase: string;
};

export type EnlaceGuardado = {
  grupo: string;
  estado: "conciliada" | "revisar";
  motivo: string;
  diferencia: number;
  movimientos: string[];
  documentos: { tipo: TipoDocumento; id: string }[];
};

export type MovimientoConciliable = Movimiento & {
  traspaso_con: string | null;
  grupo: string | null;
};

/** Si quedaron movimientos o documentos fuera de la ventana de LIMITE_CONCILIACION. */
export type Recortado = { movimientos: boolean; documentos: boolean };

/**
 * La conciliación mira lo más reciente: los 2000 movimientos más recientes y
 * los 2000 documentos más recientes de cada clase (recibidas, facturas y
 * textil). Es a propósito: el motor compara cada movimiento libre con cada
 * documento libre, y los movimientos entre sí para los traspasos; con toda la
 * historia, la pantalla tardaría cada vez más. Lo ya enlazado sí se lee
 * entero.
 *
 * Antes se pedía con limit(), pero Supabase corta en 1000 filas sin avisar
 * (ver paginar.ts): de cada cosa llegaban como mucho 1000, también de los
 * enlaces. Ahora se lee por páginas hasta el límite de verdad, y si queda algo
 * fuera, la pantalla lo dice (`recortado`).
 */
const LIMITE_CONCILIACION = 2000;

type Pagina<T> = { data: T[] | null; error: { code?: string; message: string } | null };

/**
 * Las LIMITE_CONCILIACION primeras filas de una consulta ordenada, por
 * páginas, y si había más. Pide una de más para saberlo.
 */
async function recientes<T>(consulta: (desde: number, hasta: number) => PromiseLike<Pagina<T>>) {
  const r = await leerTodas<T>((desde, hasta) =>
    consulta(desde, Math.min(hasta, LIMITE_CONCILIACION)),
  );
  return {
    data: r.data.slice(0, LIMITE_CONCILIACION),
    error: r.error,
    recortado: r.data.length > LIMITE_CONCILIACION,
  };
}

async function leer(supabase: unknown) {
  const movs = await recientes<any>((a, b) =>
    tabla(supabase, "banco_movimientos")
      .select("id, fecha, concepto, importe, cuenta_id, traspaso_con")
      .order("fecha", { ascending: false })
      .order("id")
      .range(a, b),
  );
  if (faltaLaColumna(movs.error)) return null;
  if (movs.error) throw new Error(movs.error.message);

  // Todos los enlaces, no solo los de lo reciente: un documento de la ventana
  // pagado con un movimiento más antiguo tiene que salir como enlazado, o el
  // motor lo volvería a proponer.
  const enl = await leerTodas<any>((a, b) =>
    tabla(supabase, "banco_conciliaciones")
      .select(
        "movimiento_id, factura_id, compra_id, textil_factura_id, estado, grupo, motivo, diferencia",
      )
      .order("id")
      .range(a, b),
  );
  if (faltaLaColumna(enl.error)) return null;
  if (enl.error) throw new Error(enl.error.message);

  const [compras, facturas, textil] = await Promise.all([
    recientes<any>((a, b) =>
      tabla(supabase, "textil_compras")
        .select("id, fecha, proveedor, nif_proveedor, numero, liquido")
        .eq("estado", "registrada")
        .is("borrada_en", null)
        .order("fecha", { ascending: false })
        .order("id")
        .range(a, b),
    ),
    recientes<any>((a, b) =>
      tabla(supabase, "facturas")
        .select("id, serie, ejercicio, numero, fecha, total, cliente_nombre, cliente_nif, estado")
        .in("estado", ["emitida", "vencida", "pagada"])
        .order("fecha", { ascending: false })
        .order("id")
        .range(a, b),
    ),
    recientes<any>((a, b) =>
      tabla(supabase, "textil_facturas")
        .select("id, serie, numero, fecha, total, cliente_nombre, cliente_nif, estado")
        .not("estado", "in", "(borrador,anulada)")
        .order("fecha", { ascending: false })
        .order("id")
        .range(a, b),
    ),
  ]);
  for (const r of [compras, facturas, textil]) if (r.error) throw new Error(r.error.message);

  const documentos: (DocumentoConciliable & { pagada: boolean })[] = [
    ...(compras.data ?? []).map((c: any) => ({
      tipo: "compra" as const,
      id: c.id,
      fecha: c.fecha,
      esperado: esperadoDe("compra", Number(c.liquido ?? 0)),
      contraparte: c.proveedor,
      nif: c.nif_proveedor,
      referencia: c.numero,
      clase: "Recibida",
      pagada: false,
    })),
    ...(facturas.data ?? []).map((f: any) => ({
      tipo: "factura" as const,
      id: f.id,
      fecha: f.fecha,
      esperado: esperadoDe("factura", Number(f.total)),
      contraparte: f.cliente_nombre,
      nif: f.cliente_nif,
      referencia: referenciaFactura(f.serie, f.ejercicio, f.numero),
      clase: "Factura",
      // Ya cobrada por otra vía: no se propone, pero se pinta si está enlazada.
      pagada: f.estado === "pagada",
    })),
    ...(textil.data ?? []).map((f: any) => ({
      tipo: "textil" as const,
      id: f.id,
      fecha: f.fecha,
      esperado: esperadoDe("textil", Number(f.total)),
      contraparte: f.cliente_nombre,
      nif: f.cliente_nif,
      referencia: `${f.serie ?? ""}${f.numero}`,
      clase: "Textil",
      pagada: false,
    })),
  ];

  const porGrupo = new Map<string, EnlaceGuardado>();
  const enlazados = new Set<string>();
  for (const e of enl.data ?? []) {
    const doc = e.compra_id
      ? { tipo: "compra" as const, id: e.compra_id }
      : e.textil_factura_id
        ? { tipo: "textil" as const, id: e.textil_factura_id }
        : { tipo: "factura" as const, id: e.factura_id };
    enlazados.add(`${doc.tipo}:${doc.id}`);
    const g: EnlaceGuardado = porGrupo.get(e.grupo) ?? {
      grupo: e.grupo,
      estado: e.estado,
      motivo: e.motivo,
      diferencia: Number(e.diferencia),
      movimientos: [],
      documentos: [],
    };
    if (!g.movimientos.includes(e.movimiento_id)) g.movimientos.push(e.movimiento_id);
    if (!g.documentos.some((d) => d.tipo === doc.tipo && d.id === doc.id)) g.documentos.push(doc);
    porGrupo.set(e.grupo, g);
  }
  const grupoDe = new Map<string, string>();
  for (const g of porGrupo.values()) for (const m of g.movimientos) grupoDe.set(m, g.grupo);

  const movimientos: MovimientoConciliable[] = (movs.data ?? []).map((m: any) => ({
    id: m.id,
    fecha: m.fecha,
    concepto: m.concepto ?? "",
    importe: Number(m.importe),
    cuenta_id: m.cuenta_id,
    traspaso_con: m.traspaso_con,
    grupo: grupoDe.get(m.id) ?? null,
  }));

  const movsLibres = movimientos.filter((m) => !m.grupo && !m.traspaso_con);
  const docsLibres = documentos.filter((d) => !d.pagada && !enlazados.has(`${d.tipo}:${d.id}`));
  const recortado: Recortado = {
    movimientos: movs.recortado,
    documentos: [compras, facturas, textil].some((r) => r.recortado),
  };
  return {
    movimientos,
    documentos,
    enlaces: [...porGrupo.values()],
    movsLibres,
    docsLibres,
    recortado,
  };
}

/** Movimientos, documentos, lo ya enlazado y el plan del motor. No escribe nada. */
export const verConciliacion = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const datos = await leer(context.supabase);
    if (!datos) return { disponible: false as const };
    return {
      disponible: true as const,
      movimientos: datos.movimientos,
      documentos: datos.documentos,
      enlaces: datos.enlaces,
      libres: datos.docsLibres.map((d) => `${d.tipo}:${d.id}`),
      plan: planConciliacion(datos.movsLibres, datos.docsLibres),
      recortado: datos.recortado,
      limite: LIMITE_CONCILIACION,
    };
  });

/**
 * Aplica el plan: los verdes quedan conciliados, los ámbar en «revisar» (no
 * tocan nada hasta que alguien los confirma) y los traspasos marcados. El
 * plan se vuelve a calcular aquí con los datos de ahora, no se fía del que
 * vio la pantalla. Si uno falla (otra pestaña acaba de enlazarlo), se sigue
 * con los demás y se dice cuál.
 */
export const aplicarPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const datos = await leer(context.supabase);
    if (!datos) throw new Error("Falta aplicar la migración del motor de conciliación.");
    const plan = planConciliacion(datos.movsLibres, datos.docsLibres);
    const hechos = { verdes: 0, ambares: 0, traspasos: 0, errores: [] as string[] };
    for (const e of [...plan.verdes, ...plan.ambares]) {
      try {
        await llamarRpc(context.supabase, "banco_enlazar", {
          _movimientos: e.movimientos,
          _documentos: e.documentos,
          _estado: e.estado,
          _motivo: e.motivo,
        });
        if (e.estado === "conciliada") hechos.verdes++;
        else hechos.ambares++;
      } catch (err) {
        hechos.errores.push(err instanceof Error ? err.message : String(err));
      }
    }
    for (const t of plan.traspasos) {
      try {
        await llamarRpc(context.supabase, "banco_marcar_traspaso", { _a: t.a, _b: t.b });
        hechos.traspasos++;
      } catch (err) {
        hechos.errores.push(err instanceof Error ? err.message : String(err));
      }
    }
    return hechos;
  });

const documentoSchema = z.object({
  tipo: z.enum(["compra", "factura", "textil"]),
  id: z.string().uuid(),
});

/** Enlazar a mano: una persona lo ha mirado, así que queda conciliado. */
export const enlazarManual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        movimientos: z.array(z.string().uuid()).min(1),
        documentos: z.array(documentoSchema).min(1),
      })
      .refine((x) => x.movimientos.length === 1 || x.documentos.length === 1, {
        message: "Varios movimientos contra varias facturas: hazlo por partes.",
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const grupo = await llamarRpc<string>(context.supabase, "banco_enlazar", {
      _movimientos: data.movimientos,
      _documentos: data.documentos,
      _estado: "conciliada",
      _motivo: "manual",
    });
    return { grupo };
  });

const grupoSchema = (d: unknown) => z.object({ grupo: z.string().uuid() }).parse(d);

export const confirmarEnlace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(grupoSchema)
  .handler(async ({ data, context }) => ({
    ok: await llamarRpc<boolean>(context.supabase, "banco_confirmar", { _grupo: data.grupo }),
  }));

export const deshacerEnlace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(grupoSchema)
  .handler(async ({ data, context }) => ({
    filas: await llamarRpc<number>(context.supabase, "banco_desenlazar", { _grupo: data.grupo }),
  }));

export const desmarcarTraspaso = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ movimiento_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => ({
    ok: await llamarRpc<boolean>(context.supabase, "banco_desmarcar_traspaso", {
      _movimiento_id: data.movimiento_id,
    }),
  }));
