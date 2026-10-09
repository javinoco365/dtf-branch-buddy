/**
 * Los enlaces de la conciliación, juntos por grupo, a partir de las filas de
 * `banco_conciliaciones` (cada fila, un movimiento con un documento).
 *
 * Es lo mismo que devuelve `banco_enlaces()` en la base (migración
 * 20261025100000), con las mismas reglas, para cuando esa función todavía no
 * existe y el historial se lee de las tablas:
 *
 *   - Una fila cuyo movimiento no se ve (RLS) no cuenta, ni su documento.
 *   - El grupo está «por revisar» si alguna de sus filas lo está.
 *   - El motivo y la diferencia, los menores del grupo (todas las filas de un
 *     grupo llevan los mismos: se crean juntas).
 *   - La fecha del enlace es la de su último movimiento, y ordena el
 *     historial: los más recientes primero y, a igual fecha, por grupo.
 *   - Movimientos y documentos sin repetir, por fecha.
 *
 * Lógica pura: sin base de datos, sin pantallas.
 */

export type EstadoEnlace = "conciliada" | "revisar";

type ConFecha = { id: string; fecha: string };

/** Una fila de banco_conciliaciones con su movimiento y su documento. */
export type FilaConciliacion<M extends ConFecha, D extends ConFecha & { tipo: string }> = {
  grupo: string;
  estado: EstadoEnlace;
  motivo: string;
  diferencia: number;
  /** Nulo si quien lee no lo ve. */
  movimiento: M | null;
  /** Nulo si quien lee no lo ve. */
  documento: D | null;
};

export type EnlaceAgrupado<M, D> = {
  grupo: string;
  estado: EstadoEnlace;
  motivo: string;
  diferencia: number;
  /** La del último movimiento del enlace. */
  fecha: string;
  movimientos: M[];
  documentos: D[];
};

/** Como compara Postgres fechas «AAAA-MM-DD» y UUID en minúsculas: carácter a carácter. */
const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const porFecha = (a: ConFecha, b: ConFecha) => comparar(a.fecha, b.fecha) || comparar(a.id, b.id);

/** Las filas, un enlace por grupo, en el orden del historial. */
export function agruparEnlaces<M extends ConFecha, D extends ConFecha & { tipo: string }>(
  filas: readonly FilaConciliacion<M, D>[],
): EnlaceAgrupado<M, D>[] {
  const grupos = new Map<
    string,
    EnlaceAgrupado<M, D> & { movs: Map<string, M>; docs: Map<string, D> }
  >();
  for (const f of filas) {
    if (!f.movimiento) continue;
    const g = grupos.get(f.grupo);
    if (!g) {
      grupos.set(f.grupo, {
        grupo: f.grupo,
        estado: f.estado,
        motivo: f.motivo,
        diferencia: f.diferencia,
        fecha: f.movimiento.fecha,
        movimientos: [],
        documentos: [],
        movs: new Map([[f.movimiento.id, f.movimiento]]),
        docs: new Map(f.documento ? [[`${f.documento.tipo}:${f.documento.id}`, f.documento]] : []),
      });
      continue;
    }
    if (f.estado === "revisar") g.estado = "revisar";
    if (f.motivo < g.motivo) g.motivo = f.motivo;
    if (f.diferencia < g.diferencia) g.diferencia = f.diferencia;
    if (f.movimiento.fecha > g.fecha) g.fecha = f.movimiento.fecha;
    g.movs.set(f.movimiento.id, f.movimiento);
    if (f.documento) g.docs.set(`${f.documento.tipo}:${f.documento.id}`, f.documento);
  }
  return ordenarEnlaces(
    [...grupos.values()].map(({ movs, docs, ...e }) => ({
      ...e,
      movimientos: [...movs.values()].sort(porFecha),
      documentos: [...docs.values()].sort(porFecha),
    })),
  );
}

/** Los más recientes primero (por la fecha de su último movimiento) y, a igual fecha, por grupo. */
export function ordenarEnlaces<E extends { fecha: string; grupo: string }>(
  enlaces: readonly E[],
): E[] {
  return [...enlaces].sort((a, b) => comparar(b.fecha, a.fecha) || comparar(a.grupo, b.grupo));
}

/**
 * Cuántos enlaces hay por revisar y cuántos conciliados. Vale con filas sueltas
 * de banco_conciliaciones o con enlaces ya agrupados: cuenta grupos, y un
 * grupo está por revisar si alguna de sus filas lo está.
 */
export function contarEnlaces(filas: readonly { grupo: string; estado: EstadoEnlace }[]): {
  revisar: number;
  conciliados: number;
} {
  const grupos = new Map<string, EstadoEnlace>();
  for (const f of filas) {
    if (f.estado === "revisar" || !grupos.has(f.grupo)) grupos.set(f.grupo, f.estado);
  }
  const revisar = [...grupos.values()].filter((e) => e === "revisar").length;
  return { revisar, conciliados: grupos.size - revisar };
}
