/**
 * Emitir tickets o facturas de muchos pedidos, por tandas.
 *
 * Todos de una vez se pasarían del tiempo de una función, así que se mandan
 * de pocos en pocos, del más antiguo al más reciente. El servidor responde
 * por cada tanda qué ha emitido y qué ha saltado y por qué.
 *
 * Si una tanda falla entera (la red, el tiempo de la función), no se sabe qué
 * ha pasado con sus pedidos: alguno puede haberse emitido sin que llegara la
 * respuesta, y entonces tiene su ticket pero no su PDF. Ni ellos ni los de las
 * tandas siguientes se pueden dar por emitidos ni olvidar: se listan como
 * omitidos, para revisarlos, y la emisión se para.
 *
 * Lógica pura: quien emite se le pasa, y se prueba sin servidor.
 */

export type Emitido = { pedido: string; referencia: string; id: string };
export type Omitido = { pedido: string; motivo: string };
export type ResultadoEmision = { emitidos: Emitido[]; omitidos: Omitido[] };

/** Por qué sale en omitidos un pedido de una tanda que no respondió. */
export const MOTIVO_SIN_RESPUESTA = "no se pudo emitir: revísalo";

export type CorteEmision = {
  /** Los pedidos de la tanda que falló y de las siguientes. */
  pedidos: number;
  /** El error de la tanda que falló. */
  motivo: string;
  /** Falló la primera: no se ha emitido nada que se sepa. */
  enLaPrimera: boolean;
};

export type ResultadoTandas = ResultadoEmision & {
  /** Nulo si respondieron todas las tandas. */
  corte: CorteEmision | null;
};

/**
 * Emite los pedidos de `tam` en `tam`, en el orden en que vienen. `alAvanzar`
 * recibe cuántos van respondidos después de cada tanda. Si una tanda falla,
 * sus pedidos y los de detrás van a omitidos con MOTIVO_SIN_RESPUESTA y no se
 * manda ninguna más.
 */
export async function emitirPorTandas(
  pedidos: readonly { id: string; numero: string }[],
  tam: number,
  emitir: (ids: string[]) => Promise<ResultadoEmision>,
  alAvanzar?: (hechos: number) => void,
): Promise<ResultadoTandas> {
  const r: ResultadoTandas = { emitidos: [], omitidos: [], corte: null };
  const paso = Math.max(1, Math.floor(tam));
  for (let i = 0; i < pedidos.length; i += paso) {
    const tanda = pedidos.slice(i, i + paso);
    try {
      const t = await emitir(tanda.map((p) => p.id));
      r.emitidos.push(...t.emitidos);
      r.omitidos.push(...t.omitidos);
      alAvanzar?.(i + tanda.length);
    } catch (e) {
      const quedan = pedidos.slice(i);
      r.omitidos.push(...quedan.map((p) => ({ pedido: p.numero, motivo: MOTIVO_SIN_RESPUESTA })));
      r.corte = {
        pedidos: quedan.length,
        motivo: (e as Error | undefined)?.message || "el servidor no ha respondido",
        enLaPrimera: i === 0,
      };
      break;
    }
  }
  return r;
}
