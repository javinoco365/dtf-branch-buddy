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
import { resolverIdentidad, type AmbitoPlantilla } from "@/dominio/plantilla-presupuesto";
import type { FacturaPDFData, LogoPDF } from "./pdf-factura";

export type EstiloFactura = Pick<
  FacturaPDFData,
  "colores" | "logo" | "metodo_pago" | "nombre_comercial"
>;

/** El nombre, el logo y el color de la tienda o de la marca textil. */
export type IdentidadFactura = {
  nombre: string | null;
  logo_url: string | null;
  color: string | null;
};

/**
 * El logo de la casa de cada ámbito, para cuando ni la plantilla ni la tienda
 * o la marca tienen uno que se pueda incrustar (vacío, SVG, caído): DTF
 * Culture en las tiendas y DTI Culture en textil. Van dentro del paquete del
 * servidor y se cargan la primera vez que hacen falta.
 */
async function logoDeLaCasa(ambito: AmbitoPlantilla["ambito"]): Promise<LogoPDF> {
  const { default: dataUrl } =
    ambito === "textil"
      ? await import("@/assets/logos/dti-culture.png?inline")
      : await import("@/assets/logos/dtf-culture.png?inline");
  return { dataUrl, formato: "PNG" };
}

/**
 * La cuenta que dio Javier el 23-10-2026: la que pone la migración 20261102100000.
 * Mientras la migración no esté aplicada, las facturas salen con ella igual.
 */
const METODO_PAGO_SIN_MIGRACION = "Transferencia bancaria ES83 0182 0451 4102 0168 9316";

/**
 * El texto de pago de la sociedad (Ajustes > Empresa); null si se ha dejado
 * vacío. Sin la columna (falta la migración 20261102100000), la cuenta de la
 * sociedad.
 */
async function metodoPago(sb: unknown): Promise<string | null> {
  const { data, error } = await tabla(sb, "empresas")
    .select("factura_metodo_pago")
    .eq("activa", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) {
    if (faltaLaColumna(error)) return METODO_PAGO_SIN_MIGRACION;
    throw new Error(error.message);
  }
  return texto(data?.factura_metodo_pago);
}

/**
 * El estilo de una factura del ámbito. El logo y el nombre comercial se
 * resuelven como en el presupuesto (`resolverIdentidad`): los de la plantilla
 * y, si no tiene, los de la tienda o la marca (`base`); si ninguno se puede
 * incrustar, el de la casa.
 */
export async function estiloFactura(
  sb: unknown,
  ambito: AmbitoPlantilla,
  base: IdentidadFactura,
  empresaId?: string | null,
): Promise<EstiloFactura> {
  const [{ plantilla, logo_url }, pago] = await Promise.all([
    leerPlantillaPresupuesto(sb, ambito, empresaId),
    metodoPago(sb),
  ]);
  const identidad = resolverIdentidad(plantilla, logo_url, base);
  return {
    colores: { principal: plantilla.colores.principal, acento: plantilla.colores.acento },
    // Si la plantilla dice que no lleve logo, no lleva, tampoco el de la casa.
    logo: plantilla.cabecera.logo.mostrar
      ? ((await descargarLogo(identidad.logo_url)) ?? (await logoDeLaCasa(ambito.ambito)))
      : null,
    nombre_comercial: identidad.nombre_comercial || null,
    metodo_pago: pago,
  };
}

/** Lo que la vista previa de una factura enseña de la sociedad y propone de pago. */
export type EmisorVistaPrevia = {
  emisor: { nombre: string; cif: string; direccion: string };
  /** El de Ajustes > Empresa: el que sale si no se cambia. */
  metodo_pago: string | null;
};

/**
 * Los datos de la sociedad para la vista previa de «Emitir factura». Son los
 * que emitir_factura() congelará como emisor (salen del mismo sitio,
 * empresas): aquí solo se enseñan, no se editan.
 */
export async function emisorParaVistaPrevia(sb: unknown): Promise<EmisorVistaPrevia> {
  const [{ data: empresa }, pago] = await Promise.all([
    tabla(sb, "empresas")
      .select("razon_social, cif, direccion, codigo_postal, ciudad, provincia, pais")
      .eq("activa", true)
      .order("created_at")
      .limit(1)
      .maybeSingle(),
    metodoPago(sb),
  ]);
  const direccion = [
    empresa?.direccion,
    [empresa?.codigo_postal, empresa?.ciudad].filter(Boolean).join(" "),
    empresa?.provincia,
    empresa?.pais,
  ]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .join(", ");
  return {
    emisor: {
      nombre: (empresa?.razon_social as string | null) ?? "",
      cif: (empresa?.cif as string | null) ?? "",
      direccion,
    },
    metodo_pago: pago,
  };
}
