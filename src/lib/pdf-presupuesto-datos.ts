/**
 * Lo que comparten los PDF de presupuestos de tienda y de textil, del lado del
 * servidor: leer la plantilla guardada y los datos fiscales de la sociedad, y
 * devolver el PDF al navegador.
 *
 * Todo con el cliente que se le pase: en las server functions, el de la sesión
 * del usuario (la RLS decide qué puede ver). Aquí no se usa la clave de
 * servicio.
 */

import { faltaLaTabla, tabla } from "./rpc";
import { lineasDireccion } from "@/dominio/direcciones";
import {
  normalizarPlantilla,
  type AmbitoPlantilla,
  type PlantillaPresupuesto,
} from "@/dominio/plantilla-presupuesto";

/** Un texto de la base, recortado; null si no queda nada. */
export const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** La web tal como la escribe la gente: dtfculture.com. */
export const webLegible = (url: unknown) =>
  texto(url)
    ?.replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "") ?? null;

/**
 * La plantilla del PDF de un ámbito, ya completa (`normalizarPlantilla`).
 *
 * Sin fila guardada, o sin la migración de plantillas aplicada, la de por
 * defecto de su ámbito: el modelo de la casa.
 */
export async function leerPlantillaPresupuesto(
  sb: unknown,
  ambito: AmbitoPlantilla,
  empresaId?: string | null,
): Promise<{ plantilla: PlantillaPresupuesto; logo_url: string | null; guardada: boolean }> {
  let consulta = tabla(sb, "plantillas_presupuesto")
    .select("config, logo_url")
    .eq("ambito", ambito.ambito);
  consulta =
    ambito.ambito === "tienda"
      ? consulta.eq("tienda_id", ambito.tiendaId)
      : consulta.is("tienda_id", null);
  if (ambito.ambito === "textil" && empresaId) consulta = consulta.eq("empresa_id", empresaId);
  const { data, error } = await consulta.limit(1).maybeSingle();
  if (error && !faltaLaTabla(error)) throw new Error(error.message);
  return {
    plantilla: normalizarPlantilla(data?.config, ambito.ambito),
    logo_url: texto(data?.logo_url),
    guardada: !!data,
  };
}

/** Los datos fiscales de la sociedad que emite: los mismos que llevan las facturas. */
export type EmisorEmpresa = {
  razon_social: string;
  cif: string;
  direccion: string[];
  email: string | null;
  telefono: string | null;
};

export async function leerEmisorEmpresa(sb: unknown, empresaId: string): Promise<EmisorEmpresa> {
  const { data: e } = await tabla(sb, "empresas")
    .select(
      "razon_social, cif, direccion, codigo_postal, ciudad, provincia, pais, email_fiscal, telefono",
    )
    .eq("id", empresaId)
    .maybeSingle();
  return {
    razon_social: texto(e?.razon_social) ?? "",
    cif: texto(e?.cif) ?? "",
    direccion: lineasDireccion({
      direccion: e?.direccion,
      codigo_postal: e?.codigo_postal,
      ciudad: e?.ciudad,
      provincia: e?.provincia,
      pais: e?.pais,
    }),
    email: texto(e?.email_fiscal),
    telefono: texto(e?.telefono),
  };
}

/** El PDF en base64, para devolverlo desde una server function. */
export async function pdfEnBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binario = "";
  // Por trozos: pasar un millón de bytes a String.fromCharCode de golpe
  // desborda la pila de argumentos.
  for (let i = 0; i < bytes.length; i += 8192) {
    binario += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binario);
}
