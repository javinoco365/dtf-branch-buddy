import "./lib/error-capture";

import { guionConfigPublica } from "./lib/config-publica.server";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const APERTURA_HEAD = /<head[^>]*>/i;
// Si en 64 KB no ha aparecido <head>, no es una página que nos interese tocar.
const LIMITE_BUSQUEDA = 64 * 1024;

// Inyecta la configuración pública de Supabase en el HTML, justo detrás de
// <head>, para que esté disponible antes de que cargue el bundle del cliente.
//
// El bundle solo tiene las variables VITE_* que existían al compilar. Vercel
// las congela al construir: un despliegue hecho antes de definirlas se queda
// sin ellas para siempre. Inyectándolas por respuesta, el navegador las recibe
// del entorno del servidor en tiempo de ejecución y basta con redesplegar.
//
// Se hace en streaming: se retienen chunks solo hasta encontrar <head>, no se
// bufferiza la respuesta entera.
function inyectarConfigPublica(response: Response): Response {
  if (!response.body) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;

  const guion = guionConfigPublica();
  if (!guion) return response;

  const decodificador = new TextDecoder();
  const codificador = new TextEncoder();
  let pendiente = "";
  let inyectado = false;

  const transformador = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (inyectado) {
        controller.enqueue(chunk);
        return;
      }

      pendiente += decodificador.decode(chunk, { stream: true });
      const coincidencia = APERTURA_HEAD.exec(pendiente);

      if (coincidencia) {
        const corte = coincidencia.index + coincidencia[0].length;
        inyectado = true;
        controller.enqueue(
          codificador.encode(pendiente.slice(0, corte) + guion + pendiente.slice(corte)),
        );
        pendiente = "";
        return;
      }

      if (pendiente.length > LIMITE_BUSQUEDA) {
        inyectado = true;
        controller.enqueue(codificador.encode(pendiente));
        pendiente = "";
      }
    },
    flush(controller) {
      pendiente += decodificador.decode();
      if (pendiente) controller.enqueue(codificador.encode(pendiente));
    },
  });

  const cabeceras = new Headers(response.headers);
  // La longitud cambia: dejarla puesta trunca la respuesta.
  cabeceras.delete("content-length");

  return new Response(response.body.pipeThrough(transformador), {
    status: response.status,
    statusText: response.statusText,
    headers: cabeceras,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return inyectarConfigPublica(await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
