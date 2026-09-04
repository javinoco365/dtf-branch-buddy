import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { renderizarPlantilla } from "@/dominio/plantillas";
import { eur } from "@/lib/format";
import { tabla } from "./rpc";

/** El cliente de servicio. Sin tipar de más: types.ts no conoce estas tablas. */
type SupabaseAdmin = {
  from: (t: string) => any;
};

export type ResultadoAviso =
  | { estado: "enviado"; destinatario: string }
  | { estado: "omitido"; motivo: string }
  | { estado: "fallido"; motivo: string };

/**
 * Manda el aviso de "pedido enviado" al cliente.
 *
 * NUNCA LANZA. Devuelve qué ha pasado.
 *
 * La razón es que esto se llama al cambiar el estado de un pedido, y un fallo
 * del servidor de correo no puede deshacer ese cambio ni presentarse como si
 * el pedido no se hubiera marcado. El estado es el dato; el aviso es una
 * consecuencia.
 *
 * Todo intento queda registrado en pedido_correos_enviados, también los
 * fallidos. Un aviso que no llega y del que nadie se entera es peor que no
 * tener avisos: el cliente cree que se le habría avisado.
 */
export async function avisarPedidoEnviado(
  supabaseAdmin: SupabaseAdmin,
  pedidoId: string,
): Promise<ResultadoAviso> {
  {
    const data = { pedido_id: pedidoId };

    const { data: pedido } = await supabaseAdmin
      .from("pedidos")
      .select("id, tienda_id, numero, cliente_nombre, cliente_email, total, metros_total")
      .eq("id", data.pedido_id)
      .maybeSingle();
    if (!pedido) return { estado: "fallido", motivo: "El pedido no existe" };

    if (!pedido.cliente_email) {
      return { estado: "omitido", motivo: "El pedido no tiene email del cliente" };
    }

    // Ya enviado: no se repite. El estado de un pedido puede ir y venir, el
    // aviso al cliente no.
    const { data: yaEnviado } = await tabla(supabaseAdmin, "pedido_correos_enviados")
      .select("id")
      .eq("pedido_id", pedido.id)
      .eq("clave", "pedido_enviado")
      .eq("estado", "enviado")
      .maybeSingle();
    if (yaEnviado) return { estado: "omitido", motivo: "El aviso ya se envió antes" };

    const { data: tienda } = await tabla(supabaseAdmin, "tiendas")
      .select("id, nombre, empresa_id, correo_remitente_nombre, correo_remitente_email")
      .eq("id", pedido.tienda_id)
      .maybeSingle();
    if (!tienda?.correo_remitente_email) {
      return { estado: "omitido", motivo: "La tienda no tiene remitente configurado" };
    }

    const { data: plantilla } = await tabla(supabaseAdmin, "tienda_plantillas_correo")
      // select("*"): nombrar columnas nuevas haría fallar la consulta entera
      // mientras la migración no esté aplicada, y el aviso dejaría de salir sin
      // decir por qué.
      .select("*")
      .eq("tienda_id", pedido.tienda_id)
      .eq("clave", "pedido_enviado")
      .maybeSingle();
    if (!plantilla) return { estado: "omitido", motivo: "La tienda no tiene plantilla" };
    if (!plantilla.activa) return { estado: "omitido", motivo: "El aviso está desactivado" };

    const { data: seguimiento } = await supabaseAdmin
      .from("enlaces_seguimiento")
      .select("transportista, codigo_seguimiento, url")
      .eq("pedido_id", pedido.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: empresa } = await tabla(supabaseAdmin, "empresas")
      .select("razon_social")
      .eq("id", tienda.empresa_id)
      .maybeSingle();

    const variables = {
      cliente_nombre: pedido.cliente_nombre,
      pedido_numero: pedido.numero,
      pedido_total: eur(Number(pedido.total ?? 0)),
      pedido_metros: String(pedido.metros_total ?? 0),
      tienda_nombre: tienda.nombre,
      empresa_nombre: empresa?.razon_social ?? "",
      transportista: seguimiento?.transportista ?? null,
      codigo_seguimiento: seguimiento?.codigo_seguimiento ?? null,
      seguimiento_url: seguimiento?.url ?? null,
    };

    const asunto = renderizarPlantilla(plantilla.asunto, variables).texto;

    const { enviarCorreo, textoAHtml, prepararHtml, htmlATexto } = await import("./correo.server");

    // En los dos formatos las variables se escapan al sustituirlas: el HTML lo
    // pone quien escribió la plantilla, nunca el dato de un cliente.
    let texto: string;
    let html: string;
    if (plantilla.formato === "html" && plantilla.cuerpo_html) {
      html = await prepararHtml(
        renderizarPlantilla(plantilla.cuerpo_html, variables, { escaparHtml: true }).texto,
      );
      // La parte de texto sale de la plantilla de texto si la hay; si no, del
      // propio HTML. Un correo sin parte de texto puntúa peor en los filtros.
      const plano = renderizarPlantilla(plantilla.cuerpo ?? "", variables).texto.trim();
      texto = plano || htmlATexto(html);
    } else {
      texto = renderizarPlantilla(plantilla.cuerpo, variables).texto;
      html = textoAHtml(
        renderizarPlantilla(plantilla.cuerpo, variables, { escaparHtml: true }).texto,
      );
    }

    const { leerCredencialesSmtp } = await import("./smtp-credenciales");
    const credenciales = await leerCredencialesSmtp(supabaseAdmin, pedido.tienda_id);
    const remitente = tienda.correo_remitente_nombre
      ? `${tienda.correo_remitente_nombre} <${tienda.correo_remitente_email}>`
      : tienda.correo_remitente_email;

    const resultado = await enviarCorreo(
      {
        de: remitente,
        para: pedido.cliente_email,
        asunto,
        texto,
        html,
      },
      credenciales,
    );

    await tabla(supabaseAdmin, "pedido_correos_enviados").insert({
      empresa_id: tienda.empresa_id,
      pedido_id: pedido.id,
      clave: "pedido_enviado",
      destinatario: pedido.cliente_email,
      asunto,
      estado: resultado.ok ? "enviado" : "fallido",
      error: resultado.ok ? null : resultado.error,
    });

    return resultado.ok
      ? { estado: "enviado", destinatario: pedido.cliente_email }
      : { estado: "fallido", motivo: resultado.error };
  }
}

/** La misma operación, disparada a mano desde la pantalla. */
export const enviarAvisoPedidoEnviado = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ pedido_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<ResultadoAviso> => {
    const { adminComoUsuario } = await import("@/integrations/supabase/client.server");
    return avisarPedidoEnviado(adminComoUsuario(context.userId), data.pedido_id);
  });
