import { toast } from "sonner";
import { errorParaPersonas, type ErrorLegible } from "@/dominio/errores";

/** El mensaje de cualquier cosa que se lance: un Error, un texto, un objeto con `message`. */
function mensajeDe(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e)
    return String((e as { message: unknown }).message);
  return "";
}

/** Un error, listo para enseñarlo a una persona (ver src/dominio/errores.ts). */
export function errorLegible(e: unknown, porDefecto?: string): ErrorLegible {
  return errorParaPersonas(mensajeDe(e), porDefecto);
}

/** Solo el texto, para pintarlo dentro de una pantalla. */
export function mensajeDeError(e: unknown, porDefecto?: string): string {
  return errorLegible(e, porDefecto).texto;
}

/**
 * El aviso de error de siempre (toast), en castellano llano. Si el mensaje
 * original era técnico, va debajo en pequeño, para quien tenga que mirarlo;
 * con `sinDetalle`, no (en el acceso, «Invalid login credentials» bajo la
 * traducción solo confunde).
 */
export function avisarError(
  e: unknown,
  porDefecto?: string,
  opciones: { sinDetalle?: boolean } = {},
) {
  const { texto, detalle } = errorLegible(e, porDefecto);
  toast.error(texto, detalle && !opciones.sinDetalle ? { description: detalle } : undefined);
}
