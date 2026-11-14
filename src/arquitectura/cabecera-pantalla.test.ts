import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cada pantalla del panel pone su título con <CabeceraPantalla>, que saca el
 * nombre del menú (src/dominio/navegacion.ts). Un <h1> suelto vuelve a separar
 * el título de la pantalla del nombre del menú («Ajustes generales» frente a
 * «Ajustes») y a apretar los botones contra el título en el móvil.
 */
describe("las pantallas del panel usan CabeceraPantalla", () => {
  const RAIZ = join(__dirname, "..", "routes", "panel");

  /**
   * Los <h1> que no son el título de la pantalla, con su motivo. Se quitan
   * del texto antes de buscar.
   */
  const EXCEPCIONES: { fichero: string; patron: RegExp; motivo: string }[] = [
    {
      fichero: "tiendas/$tiendaId/ajustes.tsx",
      patron: /<h1>\{\{tienda_nombre\}\}<\/h1>/g,
      motivo: "Es el HTML de la plantilla de correo de la tienda, no la pantalla.",
    },
  ];

  function ficheros(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) return ficheros(p);
      return f.endsWith(".tsx") ? [p] : [];
    });
  }

  const todos = ficheros(RAIZ).map((p) => relative(RAIZ, p));

  it("encuentra las pantallas", () => {
    expect(todos.length).toBeGreaterThan(20);
  });

  it.each(todos)("%s no tiene un <h1> propio", (fichero) => {
    let texto = readFileSync(join(RAIZ, fichero), "utf8");
    for (const e of EXCEPCIONES.filter((x) => x.fichero === fichero)) {
      texto = texto.replace(e.patron, "");
    }
    const sueltos = texto.match(/<h1[\s>]/g) ?? [];
    expect(sueltos, "usa <CabeceraPantalla> en lugar de un <h1> propio").toHaveLength(0);
  });

  it("cada excepción sigue haciendo falta", () => {
    for (const e of EXCEPCIONES) {
      const texto = readFileSync(join(RAIZ, e.fichero), "utf8");
      expect(texto.match(e.patron), `${e.fichero}: ${e.motivo}`).not.toBeNull();
    }
  });
});
