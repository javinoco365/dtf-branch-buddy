// Ajustes > Usuarios: alta, nivel, acceso a tiendas y activar/desactivar.
//
// Todo es de administrador (exigeAdmin). Las reglas (solo admin, nadie se
// desactiva a sí mismo, siempre queda un admin activo) se comprueban aquí con
// src/dominio/permisos.ts para dar un error claro, y otra vez en la base:
// usuario_fijar_nivel() y el trigger user_roles_queda_un_admin
// (20261031200100). Las escrituras van con adminComoUsuario o por
// usuario_fijar_nivel() con _usuario_id, así que quedan en la auditoría con
// el nombre de quien las hace.
//
// Desactivar no borra: pone activo = false en user_roles (auditado; la base
// deja de dejarle escribir al momento) y banea la cuenta en Supabase Auth
// (no puede volver a entrar). Su rastro en la auditoría se conserva.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  avisoSinTiendas,
  esNivel,
  impedimentoAlta,
  impedimentoCambioUsuario,
  NIVELES,
  type Nivel,
  type UsuarioConNivel,
} from "@/dominio/permisos";
import { exigeAdmin } from "./permisos-middleware";
import { llamarRpc, tabla } from "./rpc";

const nivelZ = z.enum(NIVELES as unknown as [Nivel, ...Nivel[]]);

/** Lo bastante largo para no caducar nunca: un ban «para siempre». */
const BAN_INDEFINIDO = "876000h";

export type UsuarioListado = {
  id: string;
  email: string;
  nombre: string;
  nivel: Nivel | null;
  activo: boolean;
  tienda_ids: string[];
  creado: string | null;
  ultimo_acceso: string | null;
  /** Invitado por enlace y aún sin entrar. */
  pendiente: boolean;
};

type ClienteServicio = ReturnType<
  (typeof import("@/integrations/supabase/client.server"))["adminComoUsuario"]
>;

/** Los niveles de todos, para aplicar las reglas antes de cambiar nada. */
async function nivelesActuales(sb: unknown): Promise<UsuarioConNivel[]> {
  const { data, error } = await tabla(sb, "user_roles").select("user_id, role, activo");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { user_id: string; role: string; activo: boolean | null }[]).map((r) => ({
    id: r.user_id,
    nivel: esNivel(r.role) ? r.role : null,
    activo: r.activo !== false,
  }));
}

/** Con el usuario de destino aunque aún no tenga fila en user_roles. */
function conObjetivo(lista: UsuarioConNivel[], id: string): UsuarioConNivel[] {
  return lista.some((u) => u.id === id) ? lista : [...lista, { id, nivel: null, activo: true }];
}

async function fijarNivel(
  sb: ClienteServicio,
  actorId: string,
  objetivoId: string,
  nivel: Nivel,
  activo: boolean,
) {
  await llamarRpc(sb, "usuario_fijar_nivel", {
    _usuario_id: actorId,
    _objetivo: objetivoId,
    _nivel: nivel,
    _activo: activo,
  });
}

/** Deja a un usuario con acceso exactamente a estas tiendas. */
async function fijarTiendas(sb: ClienteServicio, userId: string, tiendaIds: string[]) {
  const { data, error } = await tabla(sb, "tienda_usuarios")
    .select("tienda_id")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const actuales = new Set(((data ?? []) as { tienda_id: string }[]).map((r) => r.tienda_id));
  const nuevas = new Set(tiendaIds);
  const anadir = [...nuevas].filter((t) => !actuales.has(t));
  const quitar = [...actuales].filter((t) => !nuevas.has(t));
  if (anadir.length) {
    const { error: e } = await tabla(sb, "tienda_usuarios").insert(
      anadir.map((tienda_id) => ({ tienda_id, user_id: userId })),
    );
    if (e) throw new Error(e.message);
  }
  if (quitar.length) {
    // Quitar el acceso a una tienda: la fila de acceso, no datos de negocio.
    const { error: e } = await tabla(sb, "tienda_usuarios")
      .delete()
      .eq("user_id", userId)
      .in("tienda_id", quitar);
    if (e) throw new Error(e.message);
  }
}

export const listarUsuarios = createServerFn({ method: "GET" })
  .middleware([exigeAdmin])
  .handler(async (): Promise<UsuarioListado[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const usuarios: {
      id: string;
      email?: string;
      created_at?: string;
      last_sign_in_at?: string | null;
      invited_at?: string | null;
      user_metadata?: Record<string, unknown>;
    }[] = [];
    // Hoy son tres; se pagina igual para no cortar en silencio.
    for (let pagina = 1; pagina <= 20; pagina++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({
        page: pagina,
        perPage: 200,
      });
      if (error) throw new Error(error.message);
      usuarios.push(...data.users);
      if (data.users.length < 200) break;
    }

    const [niveles, perfiles, accesos] = await Promise.all([
      nivelesActuales(supabaseAdmin),
      tabla(supabaseAdmin, "profiles").select("id, full_name"),
      tabla(supabaseAdmin, "tienda_usuarios").select("user_id, tienda_id"),
    ]);
    if (perfiles.error) throw new Error(perfiles.error.message);
    if (accesos.error) throw new Error(accesos.error.message);

    const nivelDe = new Map(niveles.map((n) => [n.id, n]));
    const nombreDe = new Map(
      ((perfiles.data ?? []) as { id: string; full_name: string | null }[]).map((p) => [
        p.id,
        p.full_name,
      ]),
    );
    const tiendasDe = new Map<string, string[]>();
    for (const a of (accesos.data ?? []) as { user_id: string; tienda_id: string }[]) {
      tiendasDe.set(a.user_id, [...(tiendasDe.get(a.user_id) ?? []), a.tienda_id]);
    }

    return usuarios.map((u) => {
      const n = nivelDe.get(u.id);
      const email = u.email ?? "";
      const meta = u.user_metadata?.full_name;
      return {
        id: u.id,
        email,
        nombre: nombreDe.get(u.id) || (typeof meta === "string" && meta) || email,
        nivel: n?.nivel ?? null,
        activo: n ? n.activo : true,
        tienda_ids: tiendasDe.get(u.id) ?? [],
        creado: u.created_at ?? null,
        ultimo_acceso: u.last_sign_in_at ?? null,
        pendiente: !!u.invited_at && !u.last_sign_in_at,
      };
    });
  });

export const crearUsuario = createServerFn({ method: "POST" })
  .middleware([exigeAdmin])
  .inputValidator((d) =>
    z
      .object({
        email: z.string().trim().toLowerCase().email("El correo no es válido"),
        nombre: z.string().trim().min(1, "Falta el nombre"),
        nivel: nivelZ,
        modo: z.enum(["contrasena", "enlace"]),
        password: z.string().default(""),
        tienda_ids: z.array(z.string().uuid()).default([]),
        /** window.location.origin: a dónde lleva el enlace de invitación. */
        origen: z.string().url().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const problema = impedimentoAlta({
      email: data.email,
      nombre: data.nombre,
      password: data.password,
      modo: data.modo,
    });
    if (problema) throw new Error(problema);

    const { supabaseAdmin, adminComoUsuario } =
      await import("@/integrations/supabase/client.server");
    const sb = adminComoUsuario(context.userId);

    let userId: string;
    let enlace: string | null = null;
    if (data.modo === "contrasena") {
      const { data: u, error } = await supabaseAdmin.auth.admin.createUser({
        email: data.email,
        password: data.password,
        email_confirm: true,
        user_metadata: { full_name: data.nombre },
      });
      if (error || !u.user) throw new Error(error?.message ?? "No se pudo crear el usuario");
      userId = u.user.id;
    } else {
      if (!data.origen) throw new Error("Falta la dirección del CRM para el enlace");
      const { data: l, error } = await supabaseAdmin.auth.admin.generateLink({
        type: "invite",
        email: data.email,
        options: { data: { full_name: data.nombre }, redirectTo: `${data.origen}/clave` },
      });
      if (error || !l.user) throw new Error(error?.message ?? "No se pudo crear la invitación");
      userId = l.user.id;
      enlace = l.properties.action_link;
    }

    // El usuario ya existe en Auth. Si lo siguiente falla, existe sin nivel:
    // no puede escribir nada (la base deniega por defecto) y se le da nivel
    // desde la lista.
    try {
      await fijarNivel(sb, context.userId, userId, data.nivel, true);
      await fijarTiendas(sb, userId, data.tienda_ids);
    } catch (e) {
      throw new Error(
        `El usuario se ha creado, pero no se le ha podido dar nivel o tiendas: ${(e as Error).message}. Corrígelo desde la lista.`,
      );
    }
    return { ok: true, user_id: userId, enlace };
  });

export const cambiarNivelUsuario = createServerFn({ method: "POST" })
  .middleware([exigeAdmin])
  .inputValidator((d) => z.object({ user_id: z.string().uuid(), nivel: nivelZ }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const sb = adminComoUsuario(context.userId);
    const lista = conObjetivo(await nivelesActuales(sb), data.user_id);
    const problema = impedimentoCambioUsuario(lista, context.userId, data.user_id, {
      nivel: data.nivel,
    });
    if (problema) throw new Error(problema);
    const activo = lista.find((u) => u.id === data.user_id)?.activo ?? true;
    await fijarNivel(sb, context.userId, data.user_id, data.nivel, activo);

    // Quien se dio de alta como admin no tiene tiendas: al bajarlo a editor o
    // visor vería las pantallas vacías. Se avisa en la respuesta.
    const { count, error } = await tabla(sb, "tienda_usuarios")
      .select("tienda_id", { count: "exact", head: true })
      .eq("user_id", data.user_id);
    const aviso = error ? null : avisoSinTiendas(data.nivel, count ?? 0);
    return { ok: true, aviso };
  });

export const cambiarActivoUsuario = createServerFn({ method: "POST" })
  .middleware([exigeAdmin])
  .inputValidator((d) => z.object({ user_id: z.string().uuid(), activo: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, adminComoUsuario } =
      await import("@/integrations/supabase/client.server");
    const sb = adminComoUsuario(context.userId);
    const lista = conObjetivo(await nivelesActuales(sb), data.user_id);
    const problema = impedimentoCambioUsuario(lista, context.userId, data.user_id, {
      activo: data.activo,
    });
    if (problema) throw new Error(problema);
    // Sin nivel todavía (alta a medias): se activa o desactiva como visor.
    const nivel = lista.find((u) => u.id === data.user_id)?.nivel ?? "visor";

    // Primero la base (auditada; deja de escribir al instante) y después el
    // acceso en Supabase Auth.
    await fijarNivel(sb, context.userId, data.user_id, nivel, data.activo);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      ban_duration: data.activo ? "none" : BAN_INDEFINIDO,
    });
    if (error) {
      throw new Error(
        data.activo
          ? `Reactivado en el CRM, pero Supabase no le ha quitado el bloqueo de acceso: ${error.message}`
          : `Ya no puede cambiar nada, pero Supabase no ha bloqueado su acceso: ${error.message}`,
      );
    }
    return { ok: true };
  });

export const cambiarTiendasUsuario = createServerFn({ method: "POST" })
  .middleware([exigeAdmin])
  .inputValidator((d) =>
    z.object({ user_id: z.string().uuid(), tienda_ids: z.array(z.string().uuid()) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    await fijarTiendas(adminComoUsuario(context.userId), data.user_id, data.tienda_ids);
    return { ok: true };
  });

/** Un enlace para que el usuario ponga (o cambie) su contraseña. */
export const enlaceContrasena = createServerFn({ method: "POST" })
  .middleware([exigeAdmin])
  .inputValidator((d) =>
    z.object({ email: z.string().trim().email(), origen: z.string().url() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: l, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: data.email,
      options: { redirectTo: `${data.origen}/clave` },
    });
    if (error) throw new Error(error.message);
    return { enlace: l.properties.action_link };
  });
