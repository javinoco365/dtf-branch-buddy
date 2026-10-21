import { MutationCache, QueryClient, type QueryKey } from "@tanstack/react-query";

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
 *
 * Con eso detrás, lo leído vale 60 s (`staleTime`): volver a una pantalla o a
 * la pestaña del navegador antes de un minuto no vuelve a pedir nada. Lo que
 * cambien otros usuarios o el webhook de Woo se ve al pasar ese minuto, al
 * volver a la pestaña (`refetchOnWindowFocus`) o al montarse la pantalla.
 */

/** Lo leído vale un minuto; luego se vuelve a pedir al montarse o al volver a la pestaña. */
export const VIGENCIA = 60_000;
/** Datos de referencia que casi no cambian (tiendas, empresa, marcas, ajustes). */
export const VIGENCIA_REFERENCIA = 10 * 60_000;
/** Historia pesada (años de pedidos, el fiscal, el almacén). */
export const VIGENCIA_HISTORIA = 5 * 60_000;

/** Claves (primer elemento) de datos de referencia. */
export const CLAVES_REFERENCIA = [
  "tiendas",
  "tiendas-listado",
  "tiendas-sidebar",
  "tiendas-para-cliente",
  "empresa-global",
  "empresa_costes",
  "textil-marcas",
  "gerencia-ajustes",
  "caja-catalogos",
] as const;

/** Claves (primer elemento) de historia pesada. */
export const CLAVES_HISTORIA = [
  "gerencia-historial-clientes",
  "gerencia-fiscal",
  "almacen-movimientos",
] as const;

/**
 * Un reintento, y ninguno si el fallo no se arregla reintentando: sesión
 * caducada, permisos o un error de PostgREST. Los mensajes de las server
 * functions no llevan el código HTTP (lanzan `new Error(error.message)`), así
 * que se mira el texto; un «4\d\d» casaría con cualquier importe o número de
 * pedido que empiece por 4.
 */
export function reintentar(fallos: number, error: unknown): boolean {
  return fallos < 1 && !/Unauthorized|JWT|PGRST|permission denied/i.test(String(error));
}

/**
 * Para `placeholderData`: mientras llega el periodo nuevo, se siguen viendo los
 * datos del anterior, pero solo si lo demás de la clave no ha cambiado
 * (`mismoAlcance`): al cambiar de tienda no se enseñan los de la otra.
 * La pantalla tiene que avisar con `isPlaceholderData` («Actualizando…»),
 * atenuarlos y no dejar exportarlos ni actuar sobre ellos.
 */
export function delPeriodoAnterior<T>(mismoAlcance: (claveAnterior: QueryKey) => boolean) {
  return (anterior: T | undefined, consulta: { queryKey: QueryKey } | undefined) =>
    consulta && mismoAlcance(consulta.queryKey) ? anterior : undefined;
}

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
    defaultOptions: {
      queries: {
        staleTime: VIGENCIA,
        gcTime: 30 * 60_000,
        // Con staleTime: al volver a la pestaña solo se pide lo de más de 60 s.
        refetchOnWindowFocus: true,
        retry: reintentar,
      },
    },
    mutationCache: new MutationCache({
      onSettled: (_datos, _error, _variables, _resultado, mutacion) => {
        if (mutacion.meta?.invalida === false) return;
        // No se espera: la mutación no tiene que quedarse «guardando» hasta
        // que terminen todas las recargas.
        void invalidarTrasGuardar(queryClient);
      },
    }),
  });
  for (const clave of CLAVES_REFERENCIA) {
    queryClient.setQueryDefaults([clave], { staleTime: VIGENCIA_REFERENCIA });
  }
  for (const clave of CLAVES_HISTORIA) {
    queryClient.setQueryDefaults([clave], { staleTime: VIGENCIA_HISTORIA });
  }
  return queryClient;
}
