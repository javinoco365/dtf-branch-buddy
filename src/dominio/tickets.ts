/**
 * Qué documento fiscal toca a una venta: ticket (factura simplificada) o
 * factura completa.
 *
 * Lógica pura: no importa nada de `routes/`, de Supabase ni hace ninguna
 * llamada de red, y se prueba sin base de datos.
 *
 * ## La regla (RD 1619/2012, art. 4)
 *
 * | Cliente       | Importe con IVA           | Documento                          |
 * | ------------- | ------------------------- | ---------------------------------- |
 * | Con NIF       | cualquiera                | factura completa                   |
 * | Particular    | hasta 3.000 €             | ticket                             |
 * | Particular    | más de 3.000 €            | factura: hay que pedir los datos   |
 * | Profesional   | hasta 400 €               | ticket                             |
 * | Profesional   | más de 400 €              | factura: hay que pedir los datos   |
 * | Sin indicar   | hasta 400 €               | ticket                             |
 * | Sin indicar   | de 400 € a 3.000 €        | preguntar si es particular         |
 * | Sin indicar   | más de 3.000 €            | factura: hay que pedir los datos   |
 *
 * Los dos límites son de la empresa (`empresas.limite_simplificada` y
 * `limite_simplificada_particular`), no números escritos aquí: si cambia la
 * ley, se cambian en Configuración.
 *
 * Esto decide qué ofrecer en pantalla. Quien de verdad impide un ticket por
 * encima del límite es la base (`ticket_receptor()`), con la misma regla: la
 * pantalla puede equivocarse o saltarse, la base no.
 *
 * ## Por qué con NIF va factura aunque quepa en un ticket
 *
 * Si el cliente ha dado sus datos fiscales es porque los quiere en el
 * documento, y la factura completa siempre vale. Un profesional que quiera
 * ticket de todas formas puede pedirlo: `cabeEnTicket()` dice si se puede.
 */

import { normalizarNif } from "./clientes";
import { redondear } from "./importes";

export type TipoFiscal = "particular" | "profesional";

export const TIPOS_FISCALES: readonly TipoFiscal[] = ["particular", "profesional"];

export function esTipoFiscal(v: unknown): v is TipoFiscal {
  return v === "particular" || v === "profesional";
}

export function etiquetaTipoFiscal(tipo: TipoFiscal | null | undefined): string {
  if (tipo === "particular") return "Particular";
  if (tipo === "profesional") return "Profesional o empresa";
  return "Sin indicar";
}

/** Importes máximos de un ticket, IVA incluido. */
export type LimitesTicket = {
  /** Profesionales, o cuando no se sabe quién es el cliente. */
  general: number;
  /** Particulares: venta al por menor. */
  particular: number;
};

/** Los de la ley hoy. Solo para cuando la empresa no dice otra cosa. */
export const LIMITES_TICKET: LimitesTicket = { general: 400, particular: 3000 };

/** Lo que se sabe del cliente al emitir. Todo opcional: puede no saberse nada. */
export type ClienteFiscal = {
  nombre?: string | null;
  nif?: string | null;
  tipo_fiscal?: TipoFiscal | null;
};

export type DecisionDocumento =
  /** Hay datos fiscales: factura completa. */
  | { documento: "factura" }
  /** Cabe en un ticket. */
  | { documento: "ticket"; limite: number }
  /** No cabe en un ticket y faltan los datos para la factura. */
  | { documento: "pedir_datos"; limite: number }
  /** Cabe en un ticket solo si el cliente es particular: hay que preguntarlo. */
  | { documento: "preguntar_tipo"; limite: number; limite_particular: number }
  /** Sin importe no hay nada que documentar. */
  | { documento: "sin_importe" };

/** Nombre y NIF: lo mínimo para una factura completa. */
export function tieneDatosFiscales(cliente: ClienteFiscal | null | undefined): boolean {
  return (cliente?.nombre ?? "").trim() !== "" && normalizarNif(cliente?.nif) !== "";
}

/** El límite que se aplica al cliente. Sin indicar cuenta como profesional: es el seguro. */
export function limiteTicket(
  tipo: TipoFiscal | null | undefined,
  limites: LimitesTicket = LIMITES_TICKET,
): number {
  return tipo === "particular" ? limites.particular : limites.general;
}

/** En céntimos enteros: comparar euros en coma flotante da sorpresas en el límite exacto. */
function centimos(euros: number): number {
  return Math.round(redondear(euros) * 100);
}

/** Si un ticket de este importe se puede emitir a este cliente. */
export function cabeEnTicket(
  total: number,
  tipo: TipoFiscal | null | undefined,
  limites: LimitesTicket = LIMITES_TICKET,
): boolean {
  return centimos(total) > 0 && centimos(total) <= centimos(limiteTicket(tipo, limites));
}

/** Qué documento toca. Ver la tabla del principio. */
export function decidirDocumento(
  total: number,
  cliente: ClienteFiscal | null | undefined,
  limites: LimitesTicket = LIMITES_TICKET,
): DecisionDocumento {
  if (centimos(total) <= 0) return { documento: "sin_importe" };
  if (tieneDatosFiscales(cliente)) return { documento: "factura" };

  const tipo = cliente?.tipo_fiscal ?? null;
  if (cabeEnTicket(total, tipo, limites)) {
    return { documento: "ticket", limite: limiteTicket(tipo, limites) };
  }

  // Sin saber quién es: si como particular cabría, se pregunta antes de pedir
  // datos que un particular no tiene por qué dar.
  if (tipo === null && cabeEnTicket(total, "particular", limites)) {
    return {
      documento: "preguntar_tipo",
      limite: limites.general,
      limite_particular: limites.particular,
    };
  }

  return { documento: "pedir_datos", limite: limiteTicket(tipo, limites) };
}

/** Lo que se enseña en el botón o en el aviso. Los importes los pone quien pinta. */
export function explicarDecision(d: DecisionDocumento): string {
  switch (d.documento) {
    case "factura":
      return "El cliente tiene NIF: factura completa.";
    case "ticket":
      return "Cabe en un ticket: no hacen falta datos del cliente.";
    case "pedir_datos":
      return "Pasa del límite del ticket: hace falta factura completa con nombre y NIF del cliente.";
    case "preguntar_tipo":
      return "Solo cabe en un ticket si el cliente es particular. ¿Lo es?";
    case "sin_importe":
      return "Sin importe no hay nada que documentar.";
  }
}
