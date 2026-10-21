import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Configuración de pruebas separada a propósito.
//
// vite.config.ts usa @lovable.dev/vite-tanstack-config, que monta TanStack
// Start, Nitro y varios plugins de editor. Nada de eso hace falta para probar
// lógica pura, y cargarlo aquí ataría las pruebas a la infraestructura de
// Lovable. Vitest da precedencia a este fichero sobre vite.config.ts, así que
// las pruebas corren en un entorno de Node limpio.
//
// Aquí solo se prueba src/dominio/: funciones puras, sin DOM y sin base de
// datos. Si una prueba necesita un navegador o una conexión a Supabase, es que
// la lógica está en el sitio equivocado.
//
// La otra excepción es src/arquitectura/: pruebas que leen el código fuente de
// src/ (sin ejecutarlo) para frenar fallos de compilación que solo se ven al
// arrancar el servidor de producción.
//
// Y src/lib/paginar.test.ts: el ayudante de lecturas en paralelo es
// infraestructura de E/S (no negocio, por eso no está en src/dominio/), pero es
// puro y se prueba igual, sin red ni base de datos.
//
// Y src/lib/cache.test.ts: la invalidación central de React Query tras
// guardar, con consultas de mentira (sin red ni React).

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: [
      "src/dominio/**/*.test.ts",
      "src/arquitectura/**/*.test.ts",
      "src/lib/paginar.test.ts",
      "src/lib/pedidos-lista.test.ts",
      "src/lib/cache.test.ts",
    ],
    reporters: "dot",
  },
});
