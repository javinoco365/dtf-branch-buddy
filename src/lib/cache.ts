import { MutationCache, QueryClient } from "@tanstack/react-query";

/**
 * Caché de datos del panel: qué se refresca después de guardar.
 *
 * Regla: después de CUALQUIER guardado, todo lo leído pasa a estar viejo.
 * Lo que está en pantalla se vuelve a pedir en el acto; lo demás, al volver a
 * montarse. Así ninguna pantalla enseña cifras de antes de guardar, aunque la
 * mutación no sepa qué claves afecta (hay ~23 que nadie invalidaba a mano).
 *
 * - `onSettled`, no `onSuccess`: hay guardados que escriben a medias y luego
 *   fallan (Facturar varios emite uno a uno; la sincronización de Woo va por
 *   tandas). Lo que sí se escribió también tiene que verse.
 * - `cancelRefetch: false`: muchas mutaciones invalidan además a mano en su
 *   propio `onSuccess`. Sin esto, la segunda recarga cancelaría la primera: el
 *   navegador la aborta, pero la server function (p. ej. `listPedidos` de un
 *   año) sigue ejecutándose entera en el Worker. Con `false` se une a la que ya
 *   está en marcha.
 * - Las mutaciones que no escriben nada (exportar, leer con IA, generar un PDF
 *   para descargar) llevan `meta: { invalida: false }` y no recargan nada.
 * - Los guardados que no van por `useMutation` llaman a `invalidarTrasGuardar`.
 */

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /** `false` en las mutaciones que no escriben: no recargan nada al acabar. */
      invalida?: false;
    };
  }
}

/** Todo lo leído pasa a viejo; lo que está en pantalla se recarga ya. */
export function invalidarTrasGuardar(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries(undefined, { cancelRefetch: false });
}

/** El `QueryClient` de la aplicación, con la invalidación central. */
export function crearQueryClient(): QueryClient {
  const queryClient: QueryClient = new QueryClient({
    mutationCache: new MutationCache({
      onSettled: (_datos, _error, _variables, _resultado, mutacion) => {
        if (mutacion.meta?.invalida === false) return;
        // No se espera: la mutación no tiene que quedarse «guardando» hasta
        // que terminen todas las recargas.
        void invalidarTrasGuardar(queryClient);
      },
    }),
  });
  return queryClient;
}
