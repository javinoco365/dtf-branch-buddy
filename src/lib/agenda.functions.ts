// Agenda: leer y escribir tareas y categorías (migración 20261116100000).
//
// Todo va con la sesión del usuario (`context.supabase`): las tablas tienen
// RLS por operación con el nivel, así que la base decide quién escribe y el
// autor de la auditoría sale del JWT. No hace falta la clave de servicio.
// Las reglas (validar, fechas de Madrid, enlace según la categoría) están en
// src/dominio/agenda.ts; la base vuelve a comprobar lo importante en el trigger
// agenda_tarea_preparar.
//
// `socio` es la PERSONA que hace el cambio (la de «¿Quién eres?»), no la
// cuenta: la base la apunta en el historial de la tarea.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  enlaceSegunCategoria,
  esPrioridad,
  momentosDe,
  nombreCategoriaRepetido,
  validarTarea,
  type BorradorTarea,
  type CategoriaAgenda,
  type EstadoTarea,
  type Tarea,
} from "@/dominio/agenda";
import { exigeEscribir } from "./permisos-middleware";
import { exigirFilas } from "./acceso";
import { faltaLaTabla, tabla } from "./rpc";

const MIGRACION = "20261116100000_agenda";
const uuid = z.string().uuid();

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

type FilaTarea = {
  id: string;
  titulo: string;
  notas: string | null;
  categoria_id: string;
  prioridad: string;
  todo_el_dia: boolean;
  inicio: string;
  fin: string | null;
  de_socio_id: string;
  para_socio_id: string;
  pedido_id: string | null;
  cliente_id: string | null;
  enlace_texto: string | null;
  estado: string;
  hecha_en: string | null;
  vista_en: string | null;
};

const COLUMNAS_TAREA =
  "id, titulo, notas, categoria_id, prioridad, todo_el_dia, inicio, fin, de_socio_id, " +
  "para_socio_id, pedido_id, cliente_id, enlace_texto, estado, hecha_en, vista_en";

function deFila(f: FilaTarea): Tarea {
  return {
    id: f.id,
    titulo: f.titulo,
    notas: f.notas,
    categoriaId: f.categoria_id,
    prioridad: esPrioridad(f.prioridad) ? f.prioridad : "normal",
    todoElDia: f.todo_el_dia,
    inicio: f.inicio,
    fin: f.fin,
    deSocioId: f.de_socio_id,
    paraSocioId: f.para_socio_id,
    pedidoId: f.pedido_id,
    clienteId: f.cliente_id,
    enlaceTexto: f.enlace_texto,
    estado: (["pendiente", "hecha", "cancelada"].includes(f.estado)
      ? f.estado
      : "pendiente") as EstadoTarea,
    hechaEn: f.hecha_en,
    vistaEn: f.vista_en,
  };
}

function deFilaCategoria(c: {
  id: string;
  nombre: string;
  enlace: string | null;
  icono: string | null;
  activa: boolean;
  orden: number;
}): CategoriaAgenda {
  return {
    id: c.id,
    nombre: c.nombre,
    enlace: c.enlace === "pedido" || c.enlace === "cliente" ? c.enlace : null,
    icono: c.icono,
    activa: c.activa,
    orden: c.orden,
  };
}

export type PersonaAgenda = { id: string; nombre: string; activo: boolean };

export type DatosAgenda = {
  tareas: Tarea[];
  categorias: CategoriaAgenda[];
  /** Todos los socios, también los desactivados (pueden tener tareas antiguas). */
  personas: PersonaAgenda[];
  falta_migracion: boolean;
};

/** Todo lo que necesita la Agenda: tareas, categorías y personas. */
export const leerAgenda = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DatosAgenda> => {
    const sb = context.supabase;
    const [tareas, categorias, socios] = await Promise.all([
      tabla(sb, "agenda_tareas").select(COLUMNAS_TAREA).order("inicio").limit(5000),
      tabla(sb, "agenda_categorias")
        .select("id, nombre, enlace, icono, activa, orden")
        .order("orden"),
      tabla(sb, "caja_socios").select("id, nombre, activo, orden").order("orden").order("nombre"),
    ]);
    if (socios.error) throw new Error(socios.error.message);
    const personas = ((socios.data ?? []) as { id: string; nombre: string; activo: boolean }[]).map(
      (s) => ({ id: s.id, nombre: s.nombre, activo: s.activo !== false }),
    );
    if (faltaLaTabla(tareas.error) || faltaLaTabla(categorias.error)) {
      return { tareas: [], categorias: [], personas, falta_migracion: true };
    }
    if (tareas.error) throw new Error(tareas.error.message);
    if (categorias.error) throw new Error(categorias.error.message);
    return {
      tareas: ((tareas.data ?? []) as FilaTarea[]).map(deFila),
      categorias: (categorias.data ?? []).map(deFilaCategoria),
      personas,
      falta_migracion: false,
    };
  });

export type LineaHistorial = {
  id: number;
  accion: "creada" | "editada" | "pasada" | "hecha" | "reabierta" | "cancelada";
  socioId: string | null;
  paraAntes: string | null;
  paraDespues: string | null;
  cuando: string;
};

/** Quién hizo qué con una tarea, de lo más reciente a lo más antiguo. */
export const historialTarea = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }): Promise<LineaHistorial[]> => {
    const { data: filas, error } = await tabla(context.supabase, "agenda_tarea_historial")
      .select("id, accion, socio_id, para_antes, para_despues, created_at")
      .eq("tarea_id", data.id)
      .order("id", { ascending: false });
    if (error) throw new Error(error.message);
    return (
      (filas ?? []) as {
        id: number;
        accion: LineaHistorial["accion"];
        socio_id: string | null;
        para_antes: string | null;
        para_despues: string | null;
        created_at: string;
      }[]
    ).map((h) => ({
      id: h.id,
      accion: h.accion,
      socioId: h.socio_id,
      paraAntes: h.para_antes,
      paraDespues: h.para_despues,
      cuando: h.created_at,
    }));
  });

export type ResultadoEnlace = { id: string; texto: string };

/** Para enlazar una tarea: pedidos por número, clientes por nombre. Solo los que existen. */
export const buscarEnlaceAgenda = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ tipo: z.enum(["pedido", "cliente"]), texto: z.string().trim().max(80) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<ResultadoEnlace[]> => {
    // Sin comodines ni separadores de PostgREST en lo que escribe el usuario.
    const q = data.texto.replace(/[%_,()*\\]/g, " ").trim();
    if (data.tipo === "pedido") {
      let consulta = tabla(context.supabase, "pedidos")
        .select("id, numero, clientes(nombre)")
        .order("fecha_pedido", { ascending: false })
        .limit(8);
      if (q) consulta = consulta.ilike("numero", `%${q}%`);
      const { data: filas, error } = await consulta;
      if (error) throw new Error(error.message);
      return (
        (filas ?? []) as { id: string; numero: string; clientes: { nombre: string } | null }[]
      ).map((p) => ({
        id: p.id,
        texto: `Pedido ${p.numero}${p.clientes?.nombre ? ` · ${p.clientes.nombre}` : ""}`,
      }));
    }
    let consulta = tabla(context.supabase, "clientes")
      .select("id, nombre")
      .order("nombre")
      .limit(8);
    if (q) consulta = consulta.ilike("nombre", `%${q}%`);
    const { data: filas, error } = await consulta;
    if (error) throw new Error(error.message);
    return ((filas ?? []) as { id: string; nombre: string }[]).map((c) => ({
      id: c.id,
      texto: c.nombre,
    }));
  });

// ---------------------------------------------------------------------------
// Tareas
// ---------------------------------------------------------------------------

const borradorZ = z.object({
  titulo: z.string().max(400),
  notas: z.string().max(4000).default(""),
  categoriaId: z.string(),
  prioridad: z.enum(["urgente", "alta", "normal", "baja"]),
  todoElDia: z.boolean(),
  dia: z.string(),
  horaInicio: z.string().default(""),
  horaFin: z.string().default(""),
  deSocioId: z.string(),
  paraSocioId: z.string(),
  pedidoId: uuid.nullable().default(null),
  clienteId: uuid.nullable().default(null),
});

async function leerCategoria(sb: unknown, id: string): Promise<CategoriaAgenda | null> {
  if (!uuid.safeParse(id).success) return null;
  const { data, error } = await tabla(sb, "agenda_categorias")
    .select("id, nombre, enlace, icono, activa, orden")
    .eq("id", id)
    .maybeSingle();
  if (faltaLaTabla(error)) throw new Error(`Falta aplicar la migración ${MIGRACION} en la base`);
  if (error) throw new Error(error.message);
  return data ? deFilaCategoria(data) : null;
}

/** Valida con las reglas de la Agenda y devuelve las columnas que se guardan. */
async function columnasDe(sb: unknown, b: BorradorTarea) {
  const categoria = await leerCategoria(sb, b.categoriaId);
  const errores = validarTarea(b, categoria);
  const primero = Object.values(errores)[0];
  if (primero || !categoria) throw new Error(primero ?? "Elige una categoría.");
  const { inicio, fin } = momentosDe(b);
  const enlace = enlaceSegunCategoria(b, categoria);
  return {
    titulo: b.titulo.trim(),
    notas: b.notas.trim() || null,
    categoria_id: categoria.id,
    prioridad: b.prioridad,
    todo_el_dia: b.todoElDia,
    inicio,
    fin,
    pedido_id: enlace.pedidoId,
    cliente_id: enlace.clienteId,
  };
}

/** Crea una tarea. «De» y «Para» son personas (socios), no cuentas. */
export const crearTarea = createServerFn({ method: "POST" })
  .middleware([exigeEscribir])
  .inputValidator((d) => borradorZ.parse(d))
  .handler(async ({ data, context }) => {
    const columnas = await columnasDe(context.supabase, data);
    const { data: filas, error } = await tabla(context.supabase, "agenda_tareas")
      .insert({
        ...columnas,
        de_socio_id: data.deSocioId,
        para_socio_id: data.paraSocioId,
        cambio_socio_id: data.deSocioId,
      })
      .select("id");
    if (error) throw new Error(error.message);
    exigirFilas(filas, "la tarea");
    return { id: (filas as { id: string }[])[0]!.id };
  });

/** Cambia el contenido de una tarea (no su destinatario: eso es pasarTarea). */
export const editarTarea = createServerFn({ method: "POST" })
  .middleware([exigeEscribir])
  .inputValidator((d) =>
    z
      .object({
        id: uuid,
        socio: uuid,
        borrador: borradorZ.omit({ deSocioId: true, paraSocioId: true }),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // De y Para no se cambian aquí, pero validarTarea los pide: van rellenos.
    const columnas = await columnasDe(context.supabase, {
      ...data.borrador,
      deSocioId: data.socio,
      paraSocioId: data.socio,
    });
    const { data: filas, error } = await tabla(context.supabase, "agenda_tareas")
      .update({ ...columnas, cambio_socio_id: data.socio })
      .eq("id", data.id)
      .select("id");
    if (error) throw new Error(error.message);
    exigirFilas(filas, "la tarea");
    return { ok: true };
  });

/** Realizada, otra vez pendiente o cancelada. Las tareas no se borran. */
export const cambiarEstadoTarea = createServerFn({ method: "POST" })
  .middleware([exigeEscribir])
  .inputValidator((d) =>
    z
      .object({ id: uuid, socio: uuid, estado: z.enum(["pendiente", "hecha", "cancelada"]) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: filas, error } = await tabla(context.supabase, "agenda_tareas")
      .update({ estado: data.estado, cambio_socio_id: data.socio })
      .eq("id", data.id)
      .select("id");
    if (error) throw new Error(error.message);
    exigirFilas(filas, "la tarea");
    return { ok: true };
  });

/** Se la pasa a otra persona: a esa le saldrá como nueva. */
export const pasarTarea = createServerFn({ method: "POST" })
  .middleware([exigeEscribir])
  .inputValidator((d) => z.object({ id: uuid, socio: uuid, para: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: filas, error } = await tabla(context.supabase, "agenda_tareas")
      .update({ para_socio_id: data.para, cambio_socio_id: data.socio })
      .eq("id", data.id)
      .eq("estado", "pendiente")
      .select("id");
    if (error) throw new Error(error.message);
    exigirFilas(filas, "la tarea pendiente");
    return { ok: true };
  });

/**
 * Su destinatario la ha abierto: deja de salir como nueva. Si quien la abre no
 * puede escribir (visor), no pasa nada: seguirá saliendo como nueva.
 */
export const marcarTareaVista = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid, socio: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await tabla(context.supabase, "agenda_tareas")
      .update({ vista_en: new Date().toISOString() })
      .eq("id", data.id)
      .eq("para_socio_id", data.socio)
      .is("vista_en", null);
    return { ok: !error };
  });

// ---------------------------------------------------------------------------
// Categorías (Ajustes)
// ---------------------------------------------------------------------------

async function categoriasActuales(sb: unknown): Promise<CategoriaAgenda[]> {
  const { data, error } = await tabla(sb, "agenda_categorias")
    .select("id, nombre, enlace, icono, activa, orden")
    .order("orden");
  if (faltaLaTabla(error)) throw new Error(`Falta aplicar la migración ${MIGRACION} en la base`);
  if (error) throw new Error(error.message);
  return (data ?? []).map(deFilaCategoria);
}

const nombreZ = z.string().trim().min(1, "Escribe el nombre.").max(40, "Como mucho 40 caracteres.");

export const crearCategoriaAgenda = createServerFn({ method: "POST" })
  .middleware([exigeEscribir])
  .inputValidator((d) =>
    z.object({ nombre: nombreZ, enlace: z.enum(["pedido", "cliente"]).nullable() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const actuales = await categoriasActuales(context.supabase);
    if (nombreCategoriaRepetido(data.nombre, actuales)) {
      throw new Error(`Ya hay una categoría «${data.nombre}». Elige otro nombre.`);
    }
    const orden = Math.max(0, ...actuales.map((c) => c.orden)) + 10;
    const { data: filas, error } = await tabla(context.supabase, "agenda_categorias")
      .insert({
        nombre: data.nombre,
        enlace: data.enlace,
        icono: data.enlace === "pedido" ? "package" : data.enlace === "cliente" ? "user" : "tag",
        orden,
      })
      .select("id");
    if (error) throw new Error(error.message);
    exigirFilas(filas, "la categoría");
    return { id: (filas as { id: string }[])[0]!.id };
  });

/** Renombrar, activar o desactivar. Una categoría no se borra. */
export const editarCategoriaAgenda = createServerFn({ method: "POST" })
  .middleware([exigeEscribir])
  .inputValidator((d) =>
    z.object({ id: uuid, nombre: nombreZ.optional(), activa: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const cambios: Record<string, unknown> = {};
    if (data.nombre !== undefined) {
      const actuales = await categoriasActuales(context.supabase);
      if (nombreCategoriaRepetido(data.nombre, actuales, data.id)) {
        throw new Error(`Ya hay una categoría «${data.nombre}». Elige otro nombre.`);
      }
      cambios.nombre = data.nombre;
    }
    if (data.activa !== undefined) cambios.activa = data.activa;
    if (Object.keys(cambios).length === 0) return { ok: true };
    const { data: filas, error } = await tabla(context.supabase, "agenda_categorias")
      .update(cambios)
      .eq("id", data.id)
      .select("id");
    if (error) throw new Error(error.message);
    exigirFilas(filas, "la categoría");
    return { ok: true };
  });

/** El orden en que salen al crear una tarea: el de la lista que llega. */
export const ordenarCategoriasAgenda = createServerFn({ method: "POST" })
  .middleware([exigeEscribir])
  .inputValidator((d) => z.object({ ids: z.array(uuid).min(1).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    for (const [i, id] of data.ids.entries()) {
      const { error } = await tabla(context.supabase, "agenda_categorias")
        .update({ orden: (i + 1) * 10 })
        .eq("id", id);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
