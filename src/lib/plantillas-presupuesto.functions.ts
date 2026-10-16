import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PlantillaPresupuesto } from "@/dominio/plantilla-presupuesto";

/**
 * Las plantillas del PDF de presupuestos: una por tienda y una para el textil.
 * Ver 20261026100000_plantillas_presupuesto.sql.
 */

/** Un ámbito en el editor: la tienda (o el textil) con su plantilla. */
export type AmbitoEditable = {
  /** «tienda:<id>» o «textil» (claveAmbito). */
  clave: string;
  /** Lo que se lee en el selector: el nombre de la tienda, o «Textil personalizado». */
  etiqueta: string;
  plantilla: PlantillaPresupuesto;
  /** El logo propio de la plantilla, si tiene. */
  logo_url: string | null;
  /** Si hay una plantilla guardada; si no, es la de por defecto. */
  guardada: boolean;
  /** Lo de la tienda o de la marca, que sale si la plantilla no lo cambia. */
  base: { nombre: string | null; logo_url: string | null; color: string | null };
};

/** Las tiendas que ve el usuario y el textil, cada uno con su plantilla. */
export const listarPlantillasPresupuesto = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ disponible: boolean; ambitos: AmbitoEditable[] }> => {
    throw new Error("Pendiente");
  });

/** Guarda la plantilla de un ámbito (solo administradores: lo decide la RLS). */
export const guardarPlantillaPresupuesto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clave: z.string().min(1),
        config: z.unknown(),
        logo_url: z.string().url().nullable(),
      })
      .parse(d),
  )
  .handler(async (): Promise<{ ok: true }> => {
    throw new Error("Pendiente");
  });
