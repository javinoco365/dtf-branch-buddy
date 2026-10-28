/**
 * La etiqueta «1.er pedido» de la lista de pedidos.
 *
 * La base dice, para cada pedido, con cuántos pedidos anteriores de toda la
 * empresa coincide (primer_pedido_resumen, 20261103100000). Aquí se decide qué
 * se enseña. La regla, de Javier (28-10-2026):
 *
 * - No cuentan los pedidos cancelados, ni para tener etiqueta ni como
 *   anteriores (eso último lo hace la base).
 * - Si coincide de verdad con uno anterior (la misma ficha, el mismo email, el
 *   mismo teléfono, o el mismo nombre con el mismo NIF o dirección), ya era
 *   cliente: sin etiqueta.
 * - Si solo coincide el nombre, es dudoso: sale la etiqueta con aviso, y una
 *   persona decide si es cliente nuevo o no.
 * - Lo que decida una persona manda sobre la regla.
 * - Un pedido sin nombre, email, teléfono ni ficha no tiene con qué
 *   compararse: sin etiqueta, mejor que decir algo que no se sabe.
 *
 * Lógica pura: sin base de datos ni red.
 */

export type DecisionPrimerPedido = "nuevo" | "repite";

/** Lo que devuelve primer_pedido_resumen para un pedido. */
export type ResumenPrimerPedido = {
  tiene_datos: boolean;
  cancelado: boolean;
  /** Pedidos anteriores que coinciden de verdad. */
  fuertes: number;
  /** Pedidos anteriores que solo coinciden de nombre. */
  solo_nombre: number;
  decision: DecisionPrimerPedido | null;
};

export type EtiquetaPrimerPedido = {
  /** primero: es su primer pedido; dudoso: solo coincide el nombre con otros. */
  tipo: "primero" | "dudoso";
  /** Lo ha decidido una persona, no la regla. */
  decidido: boolean;
  /** Pedidos anteriores con el mismo nombre, para el aviso. */
  parecidos: number;
};

export function etiquetaPrimerPedido(
  r: ResumenPrimerPedido | null | undefined,
): EtiquetaPrimerPedido | null {
  if (!r || r.cancelado || !r.tiene_datos) return null;
  if (r.decision === "repite") return null;
  if (r.decision === "nuevo") {
    return { tipo: "primero", decidido: true, parecidos: r.solo_nombre };
  }
  if (r.fuertes > 0) return null;
  if (r.solo_nombre > 0) return { tipo: "dudoso", decidido: false, parecidos: r.solo_nombre };
  return { tipo: "primero", decidido: false, parecidos: 0 };
}

/** Por qué se parece un pedido anterior, como lo dice primer_pedido_parecidos. */
export type MotivoParecido = "ficha" | "email" | "telefono" | "nombre" | "nif" | "direccion";

const NOMBRE_MOTIVO: Record<MotivoParecido, string> = {
  ficha: "misma ficha",
  email: "mismo email",
  telefono: "mismo teléfono",
  nombre: "mismo nombre",
  nif: "mismo NIF",
  direccion: "misma dirección",
};

/** «mismo nombre y misma dirección». Los motivos desconocidos se ignoran. */
export function textoMotivos(motivos: readonly string[]): string {
  const partes = motivos
    .filter((m): m is MotivoParecido => m in NOMBRE_MOTIVO)
    .map((m) => NOMBRE_MOTIVO[m]);
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}
