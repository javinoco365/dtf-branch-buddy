/**
 * Qué factura o ticket se puede borrar.
 *
 * Solo la última de su serie y ejercicio (y los borradores, que no tienen
 * número). Al borrarla, su número lo coge la siguiente, así que la
 * numeración sigue siendo correlativa y sin huecos. Decisión de Javier del
 * 7-10-2026. La base lo comprueba otra vez (factura_borrar_ultima); esto solo
 * decide si se enseña el botón y qué se dice.
 *
 * El contador es de la empresa y lo comparten tienda y textil: la última de
 * la serie puede ser de la otra pantalla.
 */

export type ContadorSerie = { serie: string; ejercicio: number; ultimo_numero: number };

export type DocumentoNumerado = {
  estado: string | null;
  serie: string | null;
  ejercicio: number | null;
  numero: number | null;
};

const clave = (serie: string | null, ejercicio: number | null) => `${serie ?? ""}|${ejercicio}`;

export function contadoresPorSerie(contadores: readonly ContadorSerie[]): Map<string, number> {
  return new Map(contadores.map((c) => [clave(c.serie, c.ejercicio), Number(c.ultimo_numero)]));
}

/** null si se puede borrar; si no, por qué. */
export function impedimentoBorrado(
  doc: DocumentoNumerado,
  contadores: Map<string, number>,
  referencia: string,
): string | null {
  if (doc.estado === "borrador") return null;
  if (doc.numero == null || doc.ejercicio == null) {
    return `${referencia} no tiene número de serie: no se puede borrar.`;
  }
  const ultimo = contadores.get(clave(doc.serie, doc.ejercicio));
  if (ultimo === undefined || ultimo !== doc.numero) {
    return (
      `Solo se puede borrar la última de la serie, y ${referencia} no lo es. ` +
      "Para corregirla, anúlala con una rectificativa."
    );
  }
  return null;
}
