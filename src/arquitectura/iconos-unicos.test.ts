import { describe, expect, it } from "vitest";
import { ICONO, ICONOS_PANTALLA } from "@/components/iconos";

/**
 * Mismo concepto, mismo icono; y al revés: dos cifras distintas no comparten
 * icono. Antes `Wallet` era a la vez Cobros pendientes, Cobrado y Caja.
 */
function repetidos(mapa: Record<string, unknown>): string[][] {
  const porIcono = new Map<unknown, string[]>();
  for (const [concepto, icono] of Object.entries(mapa)) {
    porIcono.set(icono, [...(porIcono.get(icono) ?? []), concepto]);
  }
  return [...porIcono.values()].filter((c) => c.length > 1);
}

describe("el mapa de iconos de las cifras", () => {
  it("no repite icono entre conceptos distintos", () => {
    expect(repetidos(ICONO)).toEqual([]);
  });
});

describe("el mapa de iconos de las pantallas", () => {
  it("no repite icono entre pantallas distintas (Clientes y Usuarios, por ejemplo)", () => {
    expect(repetidos(ICONOS_PANTALLA)).toEqual([]);
  });
});
