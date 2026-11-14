import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// «Hoy» en un formulario es el día en España, no en UTC.
//
// `new Date().toISOString().slice(0, 10)` da el día en UTC: entre las 00:00 y
// las 02:00 (01:00 en invierno) de España sale AYER. Un cobro, un gasto de
// caja o una factura apuntados a esa hora caían en el día anterior, y el 1 de
// enero, en el ejercicio anterior. Se usa `diaEnEspana(new Date())`
// (src/dominio/fecha-documento.ts). Arreglado el 14-11-2026 en siete
// formularios.
//
// Solo mira pantallas y componentes: en el servidor y en el dominio hay usos
// que sí son UTC a propósito (ventanas de días, días de la web).

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function ficheros(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const r = path.join(dir, n);
    if (statSync(r).isDirectory()) return ficheros(r);
    return /\.tsx?$/.test(r) && !/\.test\.tsx?$/.test(r) ? [r] : [];
  });
}

const HOY_EN_UTC =
  /new\s+Date\(\s*\)\s*\.toISOString\(\)\s*\.(?:slice|substring|substr)\(\s*0\s*,\s*10\s*\)|new\s+Date\(\s*\)\s*\.toISOString\(\)\s*\.split\(\s*["']T["']\s*\)/;

describe("hoy en hora de España", () => {
  it("ninguna pantalla ni componente toma «hoy» del día en UTC", () => {
    const mal = ["routes", "components"]
      .flatMap((d) => ficheros(path.join(SRC, d)))
      .filter((f) => HOY_EN_UTC.test(readFileSync(f, "utf8")));
    expect(mal.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it("la expresión detecta las formas que había", () => {
    expect(HOY_EN_UTC.test(`setFecha(new Date().toISOString().slice(0, 10));`)).toBe(true);
    expect(HOY_EN_UTC.test(`const hoy = new Date().toISOString().split("T")[0];`)).toBe(true);
    expect(HOY_EN_UTC.test(`setFecha(diaEnEspana(new Date()));`)).toBe(false);
    expect(HOY_EN_UTC.test(`fecha.toISOString().slice(0, 10)`)).toBe(false);
  });
});
