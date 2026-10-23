/**
 * Cómo se ve el PDF de una factura o un ticket, del lado del servidor: los
 * colores y el logo de la plantilla del ámbito (la del presupuesto de la
 * tienda o de textil, editable en Ajustes) y el método de pago de la sociedad
 * (Ajustes > Empresa).
 *
 * Es solo la imagen. Las cifras, los datos fiscales y el cliente salen
 * siempre de lo que se congeló al emitir. Por eso un PDF se puede rehacer con
 * el diseño de hoy sin cambiar nada de la factura.
 */

import { faltaLaColumna, tabla } from "./rpc";
import { leerPlantillaPresupuesto, texto } from "./pdf-presupuesto-datos";
import { descargarLogo } from "./logo-descarga";
import type { AmbitoPlantilla } from "@/dominio/plantilla-presupuesto";
import type { FacturaPDFData } from "./pdf-factura";

export type EstiloFactura = Pick<FacturaPDFData, "colores" | "logo" | "metodo_pago">;

/** El texto de pago de la sociedad; null si no hay o falta la migración 20261102100000. */
async function metodoPago(sb: unknown): Promise<string | null> {
  const { data, error } = await tabla(sb, "empresas")
    .select("factura_metodo_pago")
    .eq("activa", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) {
    if (faltaLaColumna(error)) return null;
    throw new Error(error.message);
  }
  return texto(data?.factura_metodo_pago);
}

/**
 * El estilo de una factura del ámbito. `logoEmitido` es el que se congeló en
 * el emisor: se usa si la plantilla no tiene logo.
 */
export async function estiloFactura(
  sb: unknown,
  ambito: AmbitoPlantilla,
  logoEmitido: string | null | undefined,
  empresaId?: string | null,
): Promise<EstiloFactura> {
  const [{ plantilla, logo_url }, pago] = await Promise.all([
    leerPlantillaPresupuesto(sb, ambito, empresaId),
    metodoPago(sb),
  ]);
  return {
    colores: { principal: plantilla.colores.principal, acento: plantilla.colores.acento },
    logo: await descargarLogo(logo_url ?? logoEmitido),
    metodo_pago: pago,
  };
}
