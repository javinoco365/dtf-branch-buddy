import process from "node:process";

import type { ConfigPublica } from "./config-publica";

// Server-only: el sufijo .server.ts impide que Vite lo meta en el bundle del
// navegador. Lee la configuración pública del entorno del servidor, donde SÍ
// está disponible en tiempo de ejecución, y la serializa como un <script> que
// se inyecta en cada respuesta HTML.
//
// En Cloudflare/Vercel el entorno se enlaza por petición: leer process.env en
// el ámbito del módulo devuelve undefined. Por eso la lectura va dentro de la
// función y no en una constante de nivel superior.

export function leerConfigPublicaDelEntorno(): Partial<ConfigPublica> {
  return {
    supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || undefined,
    supabasePublishableKey:
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      undefined,
  };
}

// JSON.stringify no escapa "</script>" ni U+2028/U+2029. Los valores son
// nuestros, pero un dato que cierre la etiqueta rompe la página entera, así
// que se escapa igualmente.
function serializarSeguro(valor: unknown): string {
  return JSON.stringify(valor)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function guionConfigPublica(): string | undefined {
  const config = leerConfigPublicaDelEntorno();
  if (!config.supabaseUrl || !config.supabasePublishableKey) return undefined;
  return `<script>window.__CONFIG_PUBLICA__=${serializarSeguro(config)}</script>`;
}
