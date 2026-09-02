// Configuración pública de Supabase (URL y clave publicable). No es secreta:
// viaja al navegador por diseño y la RLS es quien protege los datos.
//
// Se lee en tres pasos, y ese orden importa:
//
//   1. import.meta.env.VITE_*  — inyectado por Vite EN TIEMPO DE COMPILACIÓN.
//      Si la variable no existía cuando se construyó el bundle, aquí no hay
//      nada y no lo habrá nunca por mucho que se cambie el entorno después.
//   2. globalThis.__CONFIG_PUBLICA__ — inyectado por el servidor en cada
//      respuesta HTML (ver src/server.ts). Es la vía que funciona aunque el
//      bundle se construyera sin variables, y la que permite cambiar la clave
//      sin reconstruir.
//   3. process.env.* — solo existe en el servidor.
//
// El fallo que motivó esto: Vercel congela las variables en el momento de
// construir. Un despliegue anterior a definirlas se queda sin ellas para
// siempre y el navegador reventaba en el beforeLoad de /panel.

export type ConfigPublica = {
  supabaseUrl: string;
  supabasePublishableKey: string;
};

declare global {
  var __CONFIG_PUBLICA__: Partial<ConfigPublica> | undefined;
}

function deEntornoServidor(nombre: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  return process.env[nombre] || undefined;
}

export function leerConfigPublica(): ConfigPublica {
  const inyectada = globalThis.__CONFIG_PUBLICA__;

  const supabaseUrl =
    import.meta.env.VITE_SUPABASE_URL ||
    inyectada?.supabaseUrl ||
    deEntornoServidor("SUPABASE_URL");

  const supabasePublishableKey =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    inyectada?.supabasePublishableKey ||
    deEntornoServidor("SUPABASE_PUBLISHABLE_KEY");

  if (!supabaseUrl || !supabasePublishableKey) {
    const faltan = [
      ...(!supabaseUrl ? ["SUPABASE_URL"] : []),
      ...(!supabasePublishableKey ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
    ];
    throw new Error(
      `Falta configuración de Supabase: ${faltan.join(", ")}. ` +
        `Defínelas en el entorno del despliegue (sin prefijo para el servidor, ` +
        `con prefijo VITE_ para el navegador) y vuelve a desplegar.`,
    );
  }

  return { supabaseUrl, supabasePublishableKey };
}
