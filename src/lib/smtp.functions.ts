import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { llamarRpc, tabla } from "./rpc";

/** Solo un administrador toca el servidor de correo. */
async function exigirAdmin(supabaseAdmin: any, userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Solo un administrador puede configurar el correo");
}

async function empresaActiva(cliente: any): Promise<string> {
  const { data } = await tabla(cliente, "empresas")
    .select("id")
    .eq("activa", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!data?.id) throw new Error("No hay ninguna empresa activa configurada");
  return data.id as string;
}

export type EstadoSmtp = {
  ambito: "general" | "tienda";
  host: string;
  puerto: number;
  usuario: string;
  tiene_clave: boolean;
} | null;

/**
 * Qué hay configurado. NO devuelve la contraseña: solo si la hay.
 *
 * Con `tienda_id`, dice cuál se usaría para esa tienda y si es la suya propia
 * o la general. Sin él, solo mira la general.
 */
export const estadoSmtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ tienda_id: z.string().uuid().nullable().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const filas = await llamarRpc<EstadoSmtp[] | null>(context.supabase, "smtp_estado", {
      _tienda_id: data.tienda_id ?? null,
    });
    return { estado: filas?.[0] ?? null };
  });

const guardarSchema = z.object({
  tienda_id: z.string().uuid().nullable().optional(),
  host: z.string().min(1, "El host es obligatorio"),
  puerto: z.number().int().min(1).max(65535),
  usuario: z.string().min(1, "El usuario es obligatorio"),
  // Vacía significa «no la cambies». La pantalla nunca conoce la actual.
  clave: z.string().optional().default(""),
});

export const guardarSmtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => guardarSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    await exigirAdmin(supabaseAdmin, context.userId);

    await llamarRpc(supabaseAdmin, "smtp_guardar", {
      _empresa_id: await empresaActiva(supabaseAdmin),
      _tienda_id: data.tienda_id ?? null,
      _host: data.host,
      _puerto: data.puerto,
      _usuario: data.usuario,
      _clave: data.clave ?? "",
    });
    return { ok: true };
  });

/** Quita la configuración propia de una tienda: vuelve a usar la general. */
export const usarSmtpGeneral = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ tienda_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = adminComoUsuario(context.userId);
    await exigirAdmin(supabaseAdmin, context.userId);

    const borrada = await llamarRpc<boolean>(supabaseAdmin, "smtp_borrar_tienda", {
      _tienda_id: data.tienda_id,
    });
    return { borrada };
  });

/**
 * Manda un correo de prueba.
 *
 * Existe porque una configuración de SMTP mal puesta no da la cara: falla el
 * día que un cliente esperaba su aviso, y el fallo queda en un registro que
 * nadie mira. Esto lo dice ahora y con el motivo del proveedor.
 */
export const probarSmtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        tienda_id: z.string().uuid().nullable().optional(),
        destinatario: z.string().email("Hace falta un correo válido"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    const { enviarCorreo, textoAHtml } = await import("./correo.server");
    const { leerCredencialesSmtp } = await import("./smtp-credenciales");
    const supabaseAdmin = adminComoUsuario(context.userId);
    await exigirAdmin(supabaseAdmin, context.userId);

    const credenciales = data.tienda_id
      ? await leerCredencialesSmtp(supabaseAdmin, data.tienda_id)
      : null;

    // El remitente: el de la tienda si lo hay, y si no el propio destinatario,
    // que al menos está en un dominio que el proveedor conoce.
    let remitente = data.destinatario;
    if (data.tienda_id) {
      const { data: tienda } = await tabla(supabaseAdmin, "tiendas")
        .select("correo_remitente_nombre, correo_remitente_email")
        .eq("id", data.tienda_id)
        .maybeSingle();
      if (tienda?.correo_remitente_email) {
        remitente = tienda.correo_remitente_nombre
          ? `${tienda.correo_remitente_nombre} <${tienda.correo_remitente_email}>`
          : tienda.correo_remitente_email;
      }
    }

    const texto =
      "Esto es una prueba del servidor de correo del CRM.\n\n" +
      "Si lo estás leyendo, la configuración es correcta y los avisos de pedido " +
      "enviado llegarán a tus clientes.";

    const resultado = await enviarCorreo(
      {
        de: remitente,
        para: data.destinatario,
        asunto: "Prueba del servidor de correo · DTF Culture",
        texto,
        html: textoAHtml(texto),
      },
      credenciales,
    );

    return resultado.ok ? { ok: true as const } : { ok: false as const, error: resultado.error };
  });
