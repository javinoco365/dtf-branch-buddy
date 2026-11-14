import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Un error de lectura se enseña con <ErrorCarga> (src/components/ErrorCarga.tsx):
 * dice qué no se cargó, por qué en castellano llano, y deja reintentar. Hecho
 * a mano, cada pantalla lo decía a su manera, a veces sin botón de reintentar
 * y a veces en inglés. Este test falla si vuelve a aparecer a mano.
 */
describe("los errores de carga van con ErrorCarga", () => {
  const SRC = join(__dirname, "..");
  const CARPETAS = ["routes", "components"];
  /** Los que sí pueden decirlo: el propio componente. */
  const PERMITIDOS = new Set(["components/ErrorCarga.tsx"]);
  const A_MANO = /No se han? podido (?:cargar|leer)/;

  function ficheros(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) return ficheros(p);
      return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
    });
  }

  const todos = CARPETAS.flatMap((c) => ficheros(join(SRC, c))).map((p) => relative(SRC, p));

  it("encuentra los ficheros", () => {
    expect(todos.length).toBeGreaterThan(100);
  });

  it("ninguna pantalla ni componente escribe a mano «No se ha(n) podido cargar/leer»", () => {
    const conTexto = todos.filter(
      (f) => !PERMITIDOS.has(f) && A_MANO.test(readFileSync(join(SRC, f), "utf8")),
    );
    expect(conTexto, "usa <ErrorCarga> (src/components/ErrorCarga.tsx)").toEqual([]);
  });
});
