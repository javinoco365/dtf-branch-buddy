import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Una factura o un ticket no se escriben desde el navegador: el rol
// authenticated perdió INSERT/UPDATE/DELETE sobre facturas en
// 20260902130000_motor_facturacion.sql. Todo va por el servidor y las
// funciones de la base (emitir_factura, factura_cambiar_estado_cobro…).
// El botón «Cobrado» de Cobros pendientes lo hacía así y no funcionaba nunca
// (arreglado el 6-11-2026).

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function ficheros(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const r = path.join(dir, n);
    if (statSync(r).isDirectory()) return ficheros(r);
    return r.endsWith(".tsx") ? [r] : [];
  });
}

const ESCRITURA =
  /(?:from|tabla\([^,]+,)\s*\(?\s*["'](?:textil_)?facturas["']\s*\)[\s\S]{0,40}?\.(?:update|insert|upsert|delete)\(/;

describe("facturas sin escritura desde el navegador", () => {
  it("ninguna pantalla hace update/insert/upsert/delete sobre facturas", () => {
    const mal = ficheros(SRC).filter((f) => ESCRITURA.test(readFileSync(f, "utf8")));
    expect(mal.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it("la expresión detecta el caso que había", () => {
    expect(
      ESCRITURA.test(`await supabase.from("facturas").update({ estado: "pagada" }).eq("id", id);`),
    ).toBe(true);
    expect(ESCRITURA.test(`supabase.from("facturas").select("id")`)).toBe(false);
  });
});
