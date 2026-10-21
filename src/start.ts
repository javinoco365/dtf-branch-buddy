import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

/**
 * Tiempos de las server functions (fase 0 del plan de rendimiento,
 * docs/rendimiento/plan.md). Escribe una línea JSON por llamada en el registro
 * del servidor (`wrangler tail` o los registros del Worker): nombre, ms y si
 * acabó bien. No escribe nada en la base ni guarda datos de la petición.
 *
 * No es el middleware de `app.usuario_id` que pide el CLAUDE.md: es otro y no
 * lo sustituye.
 */
const medirServerFn = createMiddleware({ type: "function" }).server(
  async ({ next, serverFnMeta }) => {
    const inicio = Date.now();
    let ok = false;
    try {
      const resultado = await next();
      ok = true;
      return resultado;
    } finally {
      console.log(
        JSON.stringify({ medida: "serverFn", fn: serverFnMeta?.name, ms: Date.now() - inicio, ok }),
      );
    }
  },
);

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth, medirServerFn],
  requestMiddleware: [errorMiddleware],
}));
