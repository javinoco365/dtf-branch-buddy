/**
 * Qué documento fiscal toca a una venta: ticket (factura simplificada) o
 * factura completa.
 *
 * Lógica pura: no importa nada de `routes/`, de Supabase ni hace ninguna
 * llamada de red, y se prueba sin base de datos.
 *
 * ## La regla (RD 1619/2012, art. 4, y decisión de Javier, 18-11-2026)
 *
 * Primero, lo que obliga a factura completa, quepa o no en un ticket:
 *
 * | Caso                                    | Documento        |
 * | --------------------------------------- | ---------------- |
 * | Marcó «Quiero factura» en la web        | factura          |
 * | Lleva recargo de equivalencia (R.E)     | factura          |
 *
 * Tener NIF, NIE o CIF no obliga: un ticket vale mientras quepa en el límite
 * (si el cliente quiere factura, marca la casilla en la web). Después, el
 * límite:
 *
 * | Cliente       | Importe con IVA           | Documento                          |
 * | ------------- | ------------------------- | ---------------------------------- |
 * | Particular    | hasta 3.000 €             | ticket                             |
 * | Particular    | más de 3.000 €            | factura: hay que pedir los datos   |
 * | Profesional   | hasta 400 €               | ticket                             |
 * | Profesional   | más de 400 €              | factura: hay que pedir los datos   |
 * | Sin indicar   | hasta 400 €               | ticket                             |
 * | Sin indicar   | de 400 € a 3.000 €        | preguntar si es particular         |
 * | Sin indicar   | más de 3.000 €            | factura: hay que pedir los datos   |
 *
 * Por encima del límite, con nombre y NIF ya dados, factura sin preguntar.
 *
 * Los dos límites son de la empresa (`empresas.limite_simplificada` y
 * `limite_simplificada_particular`), no números escritos aquí: si cambia la
 * ley, se cambian en Configuración.
 *
 * Esto decide qué ofrecer en pantalla. Quien de verdad impide un ticket por
 * encima del límite es la base (`ticket_receptor()`), con la misma regla: la
 * pantalla puede equivocarse o saltarse, la base no.
 *
 * Siempre se puede emitir el otro documento a mano: `cabeEnTicket()` dice si
 * un ticket cabe.
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
export type ClienteDocumento = {
  nombre?: string | null;
  nif?: string | null;
  tipo_fiscal?: TipoFiscal | null;
  /** Marcó «Quiero factura» en la web: nunca ticket. */
  pide_factura?: boolean | null;
  /**
   * Está en recargo de equivalencia (la web se lo cobró): nunca ticket, una
   * factura simplificada no puede llevar el recargo.
   */
  recargo_equivalencia?: boolean | null;
};

/** Por qué toca factura completa. */
export type MotivoFactura = "pide_factura" | "recargo" | "limite";

export type DecisionDocumento =
  /** Factura completa, con los datos del cliente ya dados. */
  | { documento: "factura"; motivo?: MotivoFactura }
  /** Cabe en un ticket. */
  | { documento: "ticket"; limite: number }
  /**
   * Faltan los datos para la factura que toca: porque no cabe en un ticket o
   * porque el cliente pidió factura en la web (`motivo: "pide_factura"`) o
   * porque está en recargo de equivalencia (`motivo: "recargo"`).
   */
  | { documento: "pedir_datos"; limite: number; motivo?: "pide_factura" | "recargo" }
  /** Cabe en un ticket solo si el cliente es particular: hay que preguntarlo. */
  | { documento: "preguntar_tipo"; limite: number; limite_particular: number }
  /** Sin importe no hay nada que documentar. */
  | { documento: "sin_importe" };

/** Nombre y NIF: lo mínimo para una factura completa. */
export function tieneDatosFiscales(cliente: ClienteDocumento | null | undefined): boolean {
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
  cliente: ClienteDocumento | null | undefined,
  limites: LimitesTicket = LIMITES_TICKET,
): DecisionDocumento {
  if (centimos(total) <= 0) return { documento: "sin_importe" };

  const tipo = cliente?.tipo_fiscal ?? null;
  const conDatos = tieneDatosFiscales(cliente);
  // Recargo de equivalencia: el ticket no puede llevarlo, así que factura.
  if (cliente?.recargo_equivalencia) {
    return conDatos
      ? { documento: "factura", motivo: "recargo" }
      : { documento: "pedir_datos", limite: limiteTicket(tipo, limites), motivo: "recargo" };
  }
  // Pidió factura en la web: ni ticket ni preguntar, aunque quepa.
  if (cliente?.pide_factura) {
    return conDatos
      ? { documento: "factura", motivo: "pide_factura" }
      : { documento: "pedir_datos", limite: limiteTicket(tipo, limites), motivo: "pide_factura" };
  }
  // Tener NIF o NIE no obliga a factura: si cabe, ticket.
  if (cabeEnTicket(total, tipo, limites)) {
    return { documento: "ticket", limite: limiteTicket(tipo, limites) };
  }
  // Pasa del límite: con los datos ya dados, factura sin más.
  if (conDatos) return { documento: "factura", motivo: "limite" };

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
      if (d.motivo === "pide_factura")
        return "El cliente pidió factura en la web: factura completa.";
      if (d.motivo === "recargo") return "Lleva recargo de equivalencia: factura completa.";
      if (d.motivo === "limite") return "Pasa del límite del ticket: factura completa.";
      return "Factura completa.";
    case "ticket":
      return "Cabe en un ticket: no hacen falta datos del cliente.";
    case "pedir_datos":
      if (d.motivo === "recargo") {
        return "El cliente está en recargo de equivalencia: hace falta factura completa con nombre y NIF.";
      }
      if (d.motivo === "pide_factura") {
        return "El cliente pidió factura en la web: hace falta factura completa con nombre y NIF.";
      }
      return "Pasa del límite del ticket: hace falta factura completa con nombre y NIF del cliente.";
    case "preguntar_tipo":
      return "Solo cabe en un ticket si el cliente es particular. ¿Lo es?";
    case "sin_importe":
      return "Sin importe no hay nada que documentar.";
  }
}

// ---------------------------------------------------------------------------
// Pedidos: si ya tienen documento, si están cobrados, y cuáles van en bloque
// ---------------------------------------------------------------------------

/** Un documento fiscal de un pedido: lo justo para saber si sigue vigente. */
export type DocumentoPedido = {
  id: string;
  tipo: "ordinaria" | "rectificativa" | "simplificada";
  estado: string | null;
  rectifica_a_id: string | null;
};

/**
 * El documento que cuenta para el pedido: su factura o su ticket, mientras no
 * esté rectificado. Es la misma regla con la que la base se niega a emitir un
 * segundo documento para el mismo pedido.
 *
 * `rectificados` son los ids que alguna rectificativa corrige, por si esa
 * rectificativa no lleva el pedido y no está en `docs`.
 */
export function documentoVigente<T extends DocumentoPedido>(
  docs: readonly T[],
  rectificados: Iterable<string> = [],
): T | null {
  const corregidos = new Set<string>(rectificados);
  for (const d of docs) if (d.rectifica_a_id) corregidos.add(d.rectifica_a_id);
  return (
    docs.find(
      (d) =>
        (d.tipo === "ordinaria" || d.tipo === "simplificada") &&
        d.estado !== "borrador" &&
        d.estado !== "anulada" &&
        !corregidos.has(d.id),
    ) ?? null
  );
}

/**
 * El documento que se enseña como «el» del pedido. Es `documentoVigente`
 * más el canje: si una factura sustituye a un ticket y ella sigue valiendo,
 * cuenta la factura. Si esa factura se anula o se rectifica, vuelve a contar
 * el ticket, como hace la base.
 */
export function documentoDelPedido<T extends DocumentoPedido & { sustituye_a_id?: string | null }>(
  docs: readonly T[],
  rectificados: Iterable<string> = [],
): T | null {
  const corregidos = new Set<string>(rectificados);
  for (const d of docs) if (d.rectifica_a_id) corregidos.add(d.rectifica_a_id);
  const sustituidos = docs.flatMap((d) =>
    d.sustituye_a_id && d.estado !== "anulada" && d.estado !== "borrador" && !corregidos.has(d.id)
      ? [d.sustituye_a_id]
      : [],
  );
  return documentoVigente(docs, [...corregidos, ...sustituidos]);
}

/** Cobrado entero: lo cobrado llega al total del pedido, céntimo a céntimo. */
export function estaCobrado(total: number, cobrado: number): boolean {
  return centimos(total) > 0 && centimos(cobrado) >= centimos(total);
}

/** Un pedido cobrado y sin documento, candidato a ticket. */
export type PedidoSinDocumento = {
  id: string;
  numero: string;
  total: number;
  cliente: ClienteDocumento | null;
};

export type ClasificacionTickets<P extends PedidoSinDocumento> = {
  /** Caben en un ticket sin preguntar nada: se emiten en bloque. */
  tickets: P[];
  /** Tienen NIF: factura completa, una a una desde el pedido. */
  facturas: P[];
  /** Hay que preguntar si es particular o pedir datos: uno a uno. */
  revisar: { pedido: P; decision: DecisionDocumento }[];
};

/**
 * Qué pedidos se pueden despachar con un ticket en bloque y cuáles necesitan
 * a alguien delante. En bloque solo va lo que no admite duda: sin NIF y por
 * debajo del límite que corresponde.
 */
export function clasificarParaTickets<P extends PedidoSinDocumento>(
  pedidos: readonly P[],
  limites: LimitesTicket = LIMITES_TICKET,
): ClasificacionTickets<P> {
  const salida: ClasificacionTickets<P> = { tickets: [], facturas: [], revisar: [] };
  for (const p of pedidos) {
    const decision = decidirDocumento(p.total, p.cliente, limites);
    if (decision.documento === "ticket") salida.tickets.push(p);
    else if (decision.documento === "factura") salida.facturas.push(p);
    else if (decision.documento !== "sin_importe") salida.revisar.push({ pedido: p, decision });
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Un ticket después de emitido: canjeado, rectificado o vigente
// ---------------------------------------------------------------------------

/** Lo justo de cada documento para saber qué le ha pasado a un ticket. */
export type DocumentoRelacionado = {
  id: string;
  referencia: string;
  rectifica_a_id: string | null;
  sustituye_a_id: string | null;
};

export type SituacionTicket = {
  /** La factura por la que se canjeó, si se canjeó. */
  canjeado_por: string | null;
  /** La rectificativa que lo corrige, si la hay. */
  rectificado_por: string | null;
  /** Solo un ticket intacto se canjea o se anula; lo demás se hace sobre lo que lo sustituyó. */
  admite_cambios: boolean;
};

/**
 * Qué le ha pasado a un ticket, mirando los demás documentos. La base impide
 * además canjearlo dos veces o canjear uno rectificado; esto es para que la
 * pantalla no ofrezca lo que luego se va a rechazar.
 */
export function situacionTicket(
  ticketId: string,
  docs: readonly DocumentoRelacionado[],
): SituacionTicket {
  const canje = docs.find((d) => d.sustituye_a_id === ticketId);
  const rect = docs.find((d) => d.rectifica_a_id === ticketId);
  return {
    canjeado_por: canje?.referencia ?? null,
    rectificado_por: rect?.referencia ?? null,
    admite_cambios: !canje && !rect,
  };
}
