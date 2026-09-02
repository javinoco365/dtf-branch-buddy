import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Bootstrap: si no existe ningún admin, crea uno con email/password.
// Es seguro porque solo funciona cuando 0 admins existen en el sistema.
export const bootstrapPrimerAdmin = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        email: z.string().email(),
        password: z.string().min(8),
        full_name: z.string().min(1),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin, adminComoUsuario } =
      await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("user_roles")
      .select("*", { count: "exact", head: true })
      .eq("role", "admin");
    if ((count ?? 0) > 0) {
      throw new Error("Ya existe un administrador. Pide una invitación.");
    }
    const { data: u, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (error || !u.user) throw new Error(error?.message ?? "No se pudo crear el usuario");
    const { error: rErr } = await adminComoUsuario(u.user.id)
      .from("user_roles")
      .insert({ user_id: u.user.id, role: "admin" });
    if (rErr) throw new Error(rErr.message);
    return { ok: true };
  });

export const adminExiste = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { count } = await supabaseAdmin
    .from("user_roles")
    .select("*", { count: "exact", head: true })
    .eq("role", "admin");
  return { existe: (count ?? 0) > 0 };
});

export const comprobarAdminActual = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();

    return { isAdmin: !!data };
  });

// Solo admins: crear usuario invitado y asignarlo a tiendas
export const crearUsuarioInvitado = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        email: z.string().email(),
        password: z.string().min(8),
        full_name: z.string().min(1),
        admin: z.boolean().default(false),
        tienda_ids: z.array(z.string().uuid()).default([]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    const { data: rolCheck } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!rolCheck) throw new Error("Solo administradores pueden crear usuarios");

    const { data: u, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (error || !u.user) throw new Error(error?.message ?? "No se pudo crear el usuario");

    if (data.admin) {
      await supabaseAdmin.from("user_roles").insert({ user_id: u.user.id, role: "admin" });
    }
    if (data.tienda_ids.length > 0) {
      await supabaseAdmin
        .from("tienda_usuarios")
        .insert(data.tienda_ids.map((t) => ({ tienda_id: t, user_id: u.user!.id })));
    }
    return { ok: true, user_id: u.user.id };
  });

// Solo admins: guardar/actualizar credenciales WooCommerce de una tienda
export const guardarCredencialesWoo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        tienda_id: z.string().uuid(),
        consumer_key: z.string().min(1),
        consumer_secret: z.string().min(1),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    const { data: rolCheck } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!rolCheck) throw new Error("Solo administradores");
    const { error } = await supabaseAdmin.from("tienda_credenciales").upsert({
      tienda_id: data.tienda_id,
      consumer_key: data.consumer_key,
      consumer_secret: data.consumer_secret,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const tieneCredencialesWoo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ tienda_id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("tienda_credenciales")
      .select("tienda_id")
      .eq("tienda_id", data.tienda_id)
      .maybeSingle();
    return { tiene: !!row };
  });

function mask(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 8) return "•".repeat(value.length);
  return `${value.slice(0, 5)}${"•".repeat(4)}${value.slice(-4)}`;
}

// Solo admins: devuelve credenciales WooCommerce enmascaradas (sin valores en claro)
export const credencialesWooMascaradas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ tienda_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rolCheck } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!rolCheck) throw new Error("Solo administradores");
    const { data: row } = await supabaseAdmin
      .from("tienda_credenciales")
      .select("consumer_key, consumer_secret, updated_at")
      .eq("tienda_id", data.tienda_id)
      .maybeSingle();
    if (!row) return { tiene: false, ck_mask: null, cs_mask: null, updated_at: null };
    return {
      tiene: true,
      ck_mask: mask(row.consumer_key),
      cs_mask: mask(row.consumer_secret),
      updated_at: row.updated_at,
    };
  });
