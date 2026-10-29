import { describe, expect, it } from "vitest";
import {
  ampliarPlan,
  aprenderConceptos,
  claveConcepto,
  esBizum,
  esRemesaTarjeta,
  pagoConTarjeta,
  repartoUnico,
  type VentaCobrada,
} from "./propuestas-extra";
import type { Documento, Movimiento, Plan } from "./motor-conciliacion";

const vacio: Plan = { verdes: [], ambares: [], traspasos: [] };

const mov = (id: string, importe: number, concepto: string, fecha = "2026-10-06"): Movimiento => ({
  id,
  fecha,
  concepto,
  importe,
  cuenta_id: "c1",
});

const venta = (
  id: string,
  esperado: number,
  fecha: string,
  metodo: string | null = null,
  contraparte: string | null = null,
): VentaCobrada => ({
  tipo: "factura",
  id,
  fecha,
  esperado,
  contraparte,
  nif: null,
  referencia: `T2026/${id}`,
  metodo,
});

const compra = (id: string, esperado: number, nif: string, fecha = "2026-10-01"): Documento => ({
  tipo: "compra",
  id,
  fecha,
  esperado,
  contraparte: "Endesa Energía S.A.U.",
  nif,
  referencia: `F-${id}`,
});

describe("reconocer el concepto", () => {
  it("remesas de TPV y Bizum", () => {
    expect(esRemesaTarjeta("ABONO TPV REMESA 20/10")).toBe(true);
    expect(esRemesaTarjeta("LIQUIDACION TARJETA COMERCIO 123")).toBe(true);
    expect(esRemesaTarjeta("TRANSFERENCIA ANA")).toBe(false);
    expect(esBizum("BIZUM DE ANA LOPEZ")).toBe(true);
  });

  it("el método de pago: sin método, puede ser tarjeta", () => {
    expect(pagoConTarjeta("Pago con tarjeta (Redsys)")).toBe(true);
    expect(pagoConTarjeta("Transferencia bancaria directa")).toBe(false);
    expect(pagoConTarjeta(null)).toBe(true);
  });

  it("la clave del concepto quita números y muletillas", () => {
    expect(claveConcepto("RECIBO E-DISTRIBUCION 10/2026 REF 4471")).toBe("distribucion");
    expect(claveConcepto("ADEUDO SEPA ENDESA ENERGIA 0923")).toBe("endesa energia");
  });
});

describe("repartoUnico", () => {
  it("encuentra la única combinación que suma", () => {
    const v = [{ esperado: 10 }, { esperado: 25.5 }, { esperado: 7.25 }];
    expect(repartoUnico(v, 3275)).toEqual([{ esperado: 25.5 }, { esperado: 7.25 }]);
  });

  it("si hay dos combinaciones, no elige", () => {
    const v = [{ esperado: 10 }, { esperado: 10 }, { esperado: 5 }];
    expect(repartoUnico(v, 1500)).toBeNull();
  });

  it("si no suma, nada", () => {
    expect(repartoUnico([{ esperado: 10 }], 1500)).toBeNull();
  });
});

describe("ampliarPlan", () => {
  it("remesa de TPV: las ventas con tarjeta del día de antes", () => {
    const ventas = [
      venta("1", 20, "2026-10-05", "Pago con tarjeta (Redsys)"),
      venta("2", 30.5, "2026-10-05", "Pago con tarjeta (Redsys)"),
      venta("3", 99, "2026-10-05", "Transferencia bancaria directa"),
      venta("4", 12, "2026-10-01", null),
    ];
    const plan = ampliarPlan(vacio, [mov("m", 50.5, "ABONO TPV REMESA")], [], ventas, new Map());
    expect(plan.ambares).toHaveLength(1);
    expect(plan.ambares[0]).toMatchObject({ motivo: "remesa_tpv", estado: "revisar" });
    expect(plan.ambares[0].documentos.map((d) => d.id)).toEqual(["1", "2"]);
  });

  it("remesa de un fin de semana: varios días seguidos", () => {
    const ventas = [
      venta("v", 10, "2026-10-02"),
      venta("s", 15, "2026-10-03"),
      venta("d", 5, "2026-10-04"),
    ];
    const plan = ampliarPlan(
      vacio,
      [mov("m", 30, "REMESA TPV", "2026-10-05")],
      [],
      ventas,
      new Map(),
    );
    expect(plan.ambares[0].documentos.map((d) => d.id)).toEqual(["v", "s", "d"]);
  });

  it("Bizum: la venta que nombra al cliente, o la única del importe", () => {
    const ventas = [
      venta("a", 45.38, "2026-10-05", "Bizum", "Ana López Martín"),
      venta("b", 45.38, "2026-10-05", "Bizum", "Pedro Ruiz Gil"),
    ];
    const plan = ampliarPlan(
      vacio,
      [mov("m", 45.38, "BIZUM DE ANA LOPEZ MARTIN")],
      [],
      ventas,
      new Map(),
    );
    expect(plan.ambares[0]).toMatchObject({ motivo: "bizum", documentos: [{ id: "a" }] });
    const sinNombre = ampliarPlan(vacio, [mov("m", 45.38, "BIZUM")], [], ventas, new Map());
    expect(sinNombre.ambares).toEqual([]);
  });

  it("lo aprendido: el recibo de cada mes, aunque el banco lo nombre distinto", () => {
    const memoria = aprenderConceptos([
      {
        movimientos: [{ concepto: "RECIBO E-DISTRIBUCION 08/2026" }],
        documentos: [compra("ago", -61.2, "A81948077")],
      },
      {
        movimientos: [{ concepto: "RECIBO E-DISTRIBUCION 09/2026" }],
        documentos: [compra("sep", -58.1, "A81948077")],
      },
    ]);
    expect(memoria.get("distribucion")).toMatchObject({ veces: 2 });
    const plan = ampliarPlan(
      vacio,
      [mov("m", -63.4, "RECIBO E-DISTRIBUCION 10/2026")],
      [compra("oct", -63.4, "A81948077"), compra("otra", -63.4, "B00000000")],
      [],
      memoria,
    );
    expect(plan.verdes).toHaveLength(1);
    expect(plan.verdes[0]).toMatchObject({ motivo: "historial", documentos: [{ id: "oct" }] });
  });

  it("un concepto conciliado con dos proveedores distintos no se aprende", () => {
    const memoria = aprenderConceptos([
      { movimientos: [{ concepto: "PAGO VARIOS" }], documentos: [compra("1", -1, "A1")] },
      { movimientos: [{ concepto: "PAGO VARIOS" }], documentos: [compra("2", -1, "B2")] },
    ]);
    expect(memoria.has("varios")).toBe(false);
  });

  it("no toca lo que el motor ya propuso", () => {
    const plan: Plan = {
      verdes: [
        {
          movimientos: ["m"],
          documentos: [{ tipo: "factura", id: "1" }],
          estado: "conciliada",
          motivo: "contraparte",
          diferencia: 0,
        },
      ],
      ambares: [],
      traspasos: [],
    };
    const r = ampliarPlan(
      plan,
      [mov("m", 20, "TPV")],
      [],
      [venta("2", 20, "2026-10-05")],
      new Map(),
    );
    expect(r.ambares).toEqual([]);
    expect(r.verdes).toHaveLength(1);
  });
});
