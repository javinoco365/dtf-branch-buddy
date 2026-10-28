import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { exigeEscribir } from "./permisos-middleware";
import { tabla } from "./rpc";

/**
 * Guarda lo que decide una persona cuando la regla del primer pedido duda
 * (solo coincide el nombre): «nuevo» (es su primer pedido), «repite» (ya era
 * cliente) o null (que vuelva a mandar la regla).
 *
 * Con el cliente de quien lo pide: la escribe la política de UPDATE de cada
 * tabla, que exige nivel editor o admin, y la auditoría apunta el autor.
 */
export const decidirPrimerPedido = createServerFn({ method: "POST" })
  .middleware([exigeEscribir])
  .inputValidator((d) =>
    z
      .object({
        origen: z.enum(["tienda", "textil"]),
        id: z.string().uuid(),
        decision: z.enum(["nuevo", "repite"]).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: filas, error } = await tabla(
      context.supabase,
      data.origen === "tienda" ? "pedidos" : "textil_pedidos",
    )
      .update({ primer_pedido_decision: data.decision })
      .eq("id", data.id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!filas?.length) throw new Error("No se encontró el pedido o no se puede cambiar");
    return { ok: true };
  });
