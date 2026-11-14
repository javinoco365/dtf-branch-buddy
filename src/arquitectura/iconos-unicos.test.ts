import { describe, expect, it } from "vitest";
import { ICONO } from "@/components/iconos";

/**
 * Mismo concepto, mismo icono; y al revés: dos cifras distintas no comparten
 * icono. Antes `Wallet` era a la vez Cobros pendientes, Cobrado y Caja.
 */
describe("el mapa de iconos de las cifras", () => {
  it("no repite icono entre conceptos distintos", () => {
    const porIcono = new Map<unknown, string[]>();
    for (const [concepto, icono] of Object.entries(ICONO)) {
      porIcono.set(icono, [...(porIcono.get(icono) ?? []), concepto]);
    }
    const repetidos = [...porIcono.values()].filter((c) => c.length > 1);
    expect(repetidos).toEqual([]);
  });
});
