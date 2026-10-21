import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FUENTE_DEL_CAMPO,
  FUENTES_DE_PESTANA,
  type PestanaGerencia,
} from "@/dominio/gerencia-datos";

// Cada pestaña de Gerencia pide solo las lecturas de FUENTES_DE_PESTANA: lo
// demás llega vacío. Si una pestaña empieza a leer un campo de DatosGerencia
// cuya lectura no pide, enseñaría un cero o una lista vacía en vez de la
// cifra. Esta prueba lee el código de cada pestaña y lo impide: añade la
// lectura a FUENTES_DE_PESTANA o no leas el campo.

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

const FICHERO: Record<PestanaGerencia, string> = {
  resumen: "components/gerencia/Resumen.tsx",
  ventas: "components/gerencia/Ventas.tsx",
  tesoreria: "components/gerencia/Tesoreria.tsx",
  clientes: "components/gerencia/Clientes.tsx",
  comercial: "components/gerencia/Comercial.tsx",
  produccion: "components/gerencia/Produccion.tsx",
  margen: "components/gerencia/Margen.tsx",
  resultados: "components/gerencia/Resultados.tsx",
  fiscal: "components/gerencia/Fiscal.tsx",
  textil: "components/gerencia/Textil.tsx",
};

/** Los campos de `d` (los datos de Gerencia) que lee un fichero. */
function camposLeidos(codigo: string): Set<string> {
  return new Set([...codigo.matchAll(/\bd\.([A-Za-z_]\w*)/g)].map((m) => m[1]));
}

describe("las pestañas de Gerencia solo leen lo que piden", () => {
  for (const [pestana, fichero] of Object.entries(FICHERO) as [PestanaGerencia, string][]) {
    it(pestana, () => {
      const codigo = leer(fichero);
      const leidos = camposLeidos(codigo);
      expect(leidos.size, "no se ha encontrado ningún d.campo").toBeGreaterThan(0);
      for (const campo of leidos) {
        expect(campo in FUENTE_DEL_CAMPO, `${fichero}: d.${campo} no es de DatosGerencia`).toBe(
          true,
        );
        const fuente = FUENTE_DEL_CAMPO[campo as keyof typeof FUENTE_DEL_CAMPO];
        if (fuente === null) continue;
        expect(
          FUENTES_DE_PESTANA[pestana],
          `${fichero} lee d.${campo}, que sale de «${fuente}», y la pestaña no lo pide`,
        ).toContain(fuente);
      }
      // `d` solo se pasa a componentes del mismo fichero (que esta prueba ya
      // lee) o a las funciones de destinos.ts (comprobadas abajo).
      for (const m of codigo.matchAll(/<(\w+)[^>]*\bd=\{d\}/g)) {
        expect(codigo, `${fichero}: <${m[1]} d={d}> no está en el fichero`).toMatch(
          new RegExp(`function ${m[1]}\\b`),
        );
      }
    });
  }

  it("destinos.ts solo lee campos que no dependen de ninguna lectura", () => {
    for (const campo of camposLeidos(leer("components/gerencia/destinos.ts"))) {
      expect(FUENTE_DEL_CAMPO[campo as keyof typeof FUENTE_DEL_CAMPO], `d.${campo}`).toBeNull();
    }
  });
});
