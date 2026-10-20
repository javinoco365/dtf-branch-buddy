import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { crearQueryClient } from "@/lib/cache";

export const getRouter = () => {
  // Con la invalidación central tras guardar: ver src/lib/cache.ts.
  const queryClient = crearQueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Precarga el código de la ruta al pasar el ratón (o enfocar) un enlace,
    // así el clic no espera a descargar el trozo. Va después de quitar
    // getUser() del beforeLoad de /panel: con él, cada hover haría un viaje a
    // Supabase Auth. `defaultPreloadStaleTime: 0` se queda: los datos los
    // lleva React Query, no hay `loader` que cachear aquí.
    defaultPreload: "intent",
    defaultPreloadDelay: 50,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
