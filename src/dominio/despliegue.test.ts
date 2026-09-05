import { describe, expect, it } from "vitest";
import { decidirRecarga, esErrorDeVersionVieja, ESPERA_ENTRE_RECARGAS_MS } from "./despliegue";

describe("esErrorDeVersionVieja", () => {
  it("reconoce el error real que tumbó el panel", () => {
    // Copiado de la consola de Javier el 5 de septiembre de 2026.
    expect(
      esErrorDeVersionVieja(
        new TypeError(
          "Failed to fetch dynamically imported module: https://panel.ronocadesarrollos.com/assets/route-BYXMqSa_.js",
        ),
      ),
    ).toBe(true);
  });

  it("reconoce la forma de cada navegador", () => {
    const casos = [
      "Failed to fetch dynamically imported module: /assets/route-x.js",
      "error loading dynamically imported module: /assets/route-x.js",
      "Importing a module script failed.",
      "Unable to preload CSS for /assets/route-x.css",
    ];
    for (const caso of casos) {
      expect(esErrorDeVersionVieja(new Error(caso)), caso).toBe(true);
    }
  });

  it("reconoce el error por su nombre aunque el mensaje no diga nada", () => {
    const e = new Error("Loading chunk 42 failed.");
    e.name = "ChunkLoadError";
    expect(esErrorDeVersionVieja(e)).toBe(true);
  });

  it("NO confunde una llamada de red caída con un despliegue", () => {
    // Este es el que importa: Supabase sin cobertura dice «Failed to fetch».
    // Recargar ahí no arregla nada y le borra al usuario lo que tuviera
    // escrito.
    expect(esErrorDeVersionVieja(new TypeError("Failed to fetch"))).toBe(false);
    expect(
      esErrorDeVersionVieja(new TypeError("NetworkError when attempting to fetch resource.")),
    ).toBe(false);
    expect(esErrorDeVersionVieja(new Error("Load failed"))).toBe(false);
  });

  it("no se traga errores normales de la aplicación", () => {
    expect(esErrorDeVersionVieja(new Error("Falta configuración de Supabase"))).toBe(false);
    expect(esErrorDeVersionVieja(new Error("El importe tiene que ser mayor que cero"))).toBe(false);
  });

  it("acepta un texto suelto y un objeto parecido a un error", () => {
    expect(esErrorDeVersionVieja("Failed to fetch dynamically imported module: /a.js")).toBe(true);
    expect(esErrorDeVersionVieja({ message: "Importing a module script failed." })).toBe(true);
    expect(esErrorDeVersionVieja({ name: "ChunkLoadError" })).toBe(true);
  });

  it("no se rompe con lo que no es un error", () => {
    expect(esErrorDeVersionVieja(null)).toBe(false);
    expect(esErrorDeVersionVieja(undefined)).toBe(false);
    expect(esErrorDeVersionVieja(0)).toBe(false);
    expect(esErrorDeVersionVieja({})).toBe(false);
    expect(esErrorDeVersionVieja([])).toBe(false);
  });
});

describe("decidirRecarga", () => {
  const error = new TypeError("Failed to fetch dynamically imported module: /assets/route-x.js");

  it("recarga la primera vez", () => {
    expect(decidirRecarga({ error, ahora: 1_000, ultimoIntento: null })).toEqual({
      recargar: true,
      motivo: "recarga",
    });
  });

  it("no recarga dos veces seguidas: sería un bucle infinito", () => {
    // Si el trozo falta de verdad, recargar no lo trae. Sin este freno la
    // página se quedaría recargándose sola para siempre.
    expect(decidirRecarga({ error, ahora: 5_000, ultimoIntento: 1_000 })).toEqual({
      recargar: false,
      motivo: "ya-se-intento",
    });
  });

  it("vuelve a permitirlo pasada la espera: ya es otro despliegue", () => {
    expect(
      decidirRecarga({ error, ahora: 1_000 + ESPERA_ENTRE_RECARGAS_MS, ultimoIntento: 1_000 }),
    ).toEqual({ recargar: true, motivo: "recarga" });
  });

  it("no recarga por un error que no es de versión, aunque no haya intentos", () => {
    expect(
      decidirRecarga({ error: new Error("Failed to fetch"), ahora: 1_000, ultimoIntento: null }),
    ).toEqual({ recargar: false, motivo: "no-es-de-version" });
  });

  it("una marca de tiempo imposible no bloquea la recarga", () => {
    // Un reloj mal puesto dejaría el freno echado para siempre.
    for (const basura of [Number.NaN, Number.POSITIVE_INFINITY, 9_999_999]) {
      expect(
        decidirRecarga({ error, ahora: 1_000, ultimoIntento: basura }).recargar,
        `${basura}`,
      ).toBe(true);
    }
  });
});
