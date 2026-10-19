import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Un módulo de src/ que se importa a la vez de forma normal
// (`import { x } from "@/lib/..."`) y con `await import("@/lib/...")` obliga a
// rolldown a sacar un auxiliar de espacio de nombres (`__exportAll`). Dos veces
// ese auxiliar acabó en una importación circular dentro del trozo de arranque
// del servidor y tiró producción entera con «This page didn't load» /
// «TypeError: __exportAll is not a function»: el 5 de septiembre de 2026 y el
// 16 de octubre de 2026 (`@/lib/logo-descarga`, PR #82).
//
// La compilación de desarrollo no lo detecta: compila bien y el fallo solo
// sale al arrancar el servidor. Esta prueba lo para antes. Si falla, convierte
// el `await import()` en una importación normal arriba del fichero, como se
// hizo con `logo-descarga` en textil.functions.ts.
//
// Las importaciones de solo tipos (`import type`, `import { type X }` y
// `import("x").Tipo`) se borran al compilar y no cuentan. Los paquetes de
// node_modules (jspdf, nodemailer...) solo cuentan si también se importan de
// forma normal en algún sitio de src/. Los ficheros *.test.ts no entran en la
// compilación y tampoco cuentan.

const RAIZ_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSIONES = [".ts", ".tsx"];

type Importaciones = { estaticas: Map<string, Set<string>>; dinamicas: Map<string, Set<string>> };

export type Conflicto = { modulo: string; estaticas: string[]; dinamicas: string[] };

function anadir(mapa: Map<string, Set<string>>, modulo: string, fichero: string) {
  if (!mapa.has(modulo)) mapa.set(modulo, new Set());
  mapa.get(modulo)!.add(fichero);
}

/**
 * Convierte un especificador en una clave única por módulo: ruta relativa a
 * src/ sin extensión para los de src/ (alias `@/` o ruta relativa) y el nombre
 * tal cual para los paquetes. Se conserva la consulta (`?inline`), porque para
 * Vite es otro módulo.
 */
export function claveDeModulo(
  especificador: string,
  fichero: string,
  existe: (ruta: string) => boolean,
) {
  const [ruta, ...consulta] = especificador.split("?");
  const sufijo = consulta.length ? `?${consulta.join("?")}` : "";
  let absoluta: string;
  if (ruta.startsWith("@/")) absoluta = path.join(RAIZ_SRC, ruta.slice(2));
  else if (ruta.startsWith(".")) absoluta = path.resolve(path.dirname(fichero), ruta);
  else return especificador;

  const candidatos = [
    absoluta,
    ...EXTENSIONES.map((e) => absoluta + e),
    ...EXTENSIONES.map((e) => path.join(absoluta, "index" + e)),
  ];
  const encontrado = candidatos.find(existe) ?? absoluta;
  const relativa = path.relative(RAIZ_SRC, encontrado).split(path.sep).join("/");
  return relativa.replace(/\.(ts|tsx)$/, "").replace(/\/index$/, "") + sufijo;
}

/** Una importación normal que se queda en el JavaScript (no es solo de tipos). */
function esEstaticaConValor(nodo: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isImportDeclaration(nodo)) {
    const clausula = nodo.importClause;
    if (!clausula) return true; // import "x": efecto secundario
    if (clausula.isTypeOnly) return false;
    if (clausula.name) return true;
    const enlaces = clausula.namedBindings;
    if (!enlaces || ts.isNamespaceImport(enlaces)) return true;
    // import { type A, type B } from "x" desaparece entero (verbatimModuleSyntax: false).
    return enlaces.elements.length === 0 || enlaces.elements.some((e) => !e.isTypeOnly);
  }
  if (nodo.isTypeOnly) return false;
  const exportados = nodo.exportClause;
  if (!exportados || ts.isNamespaceExport(exportados)) return true;
  return exportados.elements.length === 0 || exportados.elements.some((e) => !e.isTypeOnly);
}

/** Recoge las importaciones estáticas con valor y las dinámicas de un fichero. */
export function recogerImportaciones(
  ficheros: { ruta: string; codigo: string }[],
  existe: (ruta: string) => boolean,
): Importaciones {
  const estaticas = new Map<string, Set<string>>();
  const dinamicas = new Map<string, Set<string>>();

  for (const { ruta, codigo } of ficheros) {
    const fuente = ts.createSourceFile(
      ruta,
      codigo,
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TSX,
    );
    const relativa = path.relative(RAIZ_SRC, ruta).split(path.sep).join("/");
    const visitar = (nodo: ts.Node) => {
      if (
        (ts.isImportDeclaration(nodo) || ts.isExportDeclaration(nodo)) &&
        nodo.moduleSpecifier &&
        ts.isStringLiteral(nodo.moduleSpecifier) &&
        esEstaticaConValor(nodo)
      ) {
        anadir(estaticas, claveDeModulo(nodo.moduleSpecifier.text, ruta, existe), relativa);
      } else if (
        ts.isCallExpression(nodo) &&
        nodo.expression.kind === ts.SyntaxKind.ImportKeyword &&
        nodo.arguments[0] &&
        ts.isStringLiteralLike(nodo.arguments[0])
      ) {
        anadir(dinamicas, claveDeModulo(nodo.arguments[0].text, ruta, existe), relativa);
      }
      // import("x").Tipo es un ImportTypeNode, no una llamada: no entra.
      ts.forEachChild(nodo, visitar);
    };
    visitar(fuente);
  }
  return { estaticas, dinamicas };
}

export function buscarConflictos({ estaticas, dinamicas }: Importaciones): Conflicto[] {
  return [...dinamicas.keys()]
    .filter((modulo) => estaticas.has(modulo))
    .sort()
    .map((modulo) => ({
      modulo,
      estaticas: [...estaticas.get(modulo)!].sort(),
      dinamicas: [...dinamicas.get(modulo)!].sort(),
    }));
}

function listarFuentes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) return listarFuentes(ruta);
    // Las pruebas no entran en la compilación: su import() no cuenta.
    if (/\.test\.tsx?$/.test(e.name)) return [];
    return EXTENSIONES.includes(path.extname(e.name)) ? [ruta] : [];
  });
}

function existeEnDisco(ruta: string) {
  try {
    return statSync(ruta).isFile();
  } catch {
    return false;
  }
}

function describir(conflictos: Conflicto[]) {
  return conflictos
    .map(
      (c) =>
        `«${c.modulo}» se importa de las dos formas:\n` +
        `  normal en: ${c.estaticas.join(", ")}\n` +
        `  con import() en: ${c.dinamicas.join(", ")}`,
    )
    .join("\n");
}

describe("importaciones mixtas (estática y dinámica del mismo módulo)", () => {
  it("ningún módulo de src/ se importa a la vez de forma normal y con import()", () => {
    const ficheros = listarFuentes(RAIZ_SRC).map((ruta) => ({
      ruta,
      codigo: readFileSync(ruta, "utf8"),
    }));
    const conflictos = buscarConflictos(recogerImportaciones(ficheros, existeEnDisco));
    expect(conflictos, describir(conflictos)).toEqual([]);
  });

  describe("detector", () => {
    const enSrc = (r: string) => path.join(RAIZ_SRC, r);
    const existentes = new Set(
      [
        "lib/logo-descarga.ts",
        "lib/pdf-factura.ts",
        "lib/a.ts",
        "lib/b.ts",
        "dominio/tickets.ts",
      ].map(enSrc),
    );
    const existe = (r: string) => existentes.has(r);
    const conflictosDe = (ficheros: Record<string, string>) =>
      buscarConflictos(
        recogerImportaciones(
          Object.entries(ficheros).map(([r, codigo]) => ({ ruta: enSrc(r), codigo })),
          existe,
        ),
      );

    it("reproduce el caso de logo-descarga (16-10-2026)", () => {
      expect(
        conflictosDe({
          "lib/a.ts": `import { descargarLogo } from "@/lib/logo-descarga";`,
          "lib/textil.functions.ts": `async function f() { const { descargarLogo } = await import("@/lib/logo-descarga"); }`,
        }),
      ).toEqual([
        {
          modulo: "lib/logo-descarga",
          estaticas: ["lib/a.ts"],
          dinamicas: ["lib/textil.functions.ts"],
        },
      ]);
    });

    it("une el alias @/ con las rutas relativas", () => {
      expect(
        conflictosDe({
          "lib/a.ts": `import { x } from "./b";`,
          "routes/r.tsx": `const m = import("@/lib/b.ts");`,
        }).map((c) => c.modulo),
      ).toEqual(["lib/b"]);
    });

    it("cuenta los reexportes como importación normal", () => {
      expect(
        conflictosDe({
          "lib/a.ts": `export { x } from "./b";`,
          "lib/c.ts": `await import("./b");`,
        }).map((c) => c.modulo),
      ).toEqual(["lib/b"]);
    });

    it("ignora las importaciones de solo tipos", () => {
      expect(
        conflictosDe({
          "lib/a.ts": [
            `import type { FacturaPDFData } from "@/lib/pdf-factura";`,
            `import { type DecisionDocumento } from "@/dominio/tickets";`,
            `export type { X } from "./b";`,
          ].join("\n"),
          "lib/c.ts": [
            `await import("@/lib/pdf-factura");`,
            `await import("@/dominio/tickets");`,
            `await import("./b");`,
          ].join("\n"),
        }),
      ).toEqual([]);
    });

    it('no confunde import("x").Tipo ni los comentarios con una importación dinámica', () => {
      expect(
        conflictosDe({
          "lib/a.ts": `import { decidir } from "@/dominio/tickets";\nimport { y } from "./b";`,
          "lib/c.ts": [
            `type T = { d: import("@/dominio/tickets").DecisionDocumento };`,
            `// const { y } = await import("./b");`,
          ].join("\n"),
        }),
      ).toEqual([]);
    });

    it("ignora paquetes que solo se importan con import(), pero no los mixtos", () => {
      expect(
        conflictosDe({
          "lib/a.ts": `await import("jspdf");`,
          "lib/c.ts": `await import("nodemailer");`,
          "lib/d.ts": `import nodemailer from "nodemailer";`,
        }).map((c) => c.modulo),
      ).toEqual(["nodemailer"]);
    });
  });
});
