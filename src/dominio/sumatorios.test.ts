import { describe, expect, it } from "vitest";
import {
  sumarCantidades,
  sumarImportes,
  totalesConSigno,
  totalesDocumentos,
  totalesPedidos,
} from "./sumatorios";

describe("sumas sueltas", () => {
  it("importes al céntimo, aunque lleguen como texto o vacíos", () => {
    expect(sumarImportes([{ v: "0.1" }, { v: 0.2 }, { v: null }, { v: "x" }], (f) => f.v)).toBe(
      0.3,
    );
    expect(sumarImportes([], () => 1)).toBe(0);
  });

  it("metros y cantidades a tres decimales", () => {
    expect(sumarCantidades([{ m: 1.0005 }, { m: 2.0004 }], (f) => f.m)).toBe(3.001);
  });
});

describe("totalesPedidos", () => {
  it("los cancelados no suman y se cuentan aparte", () => {
    const t = totalesPedidos([
      { total: 100, estado: "entregado", cobros: [{ importe: 100 }] },
      { total: 50, estado: "pendiente", cobros: [{ importe: 20 }] },
      { total: 80, estado: "cancelado", cobros: [{ importe: 80 }] },
    ]);
    expect(t).toEqual({ pedidos: 2, cancelados: 1, total: 150, cobrado: 120, pendiente: 30 });
  });

  it("lo cobrado de más no resta del pendiente de los demás", () => {
    const t = totalesPedidos([
      { total: 100, cobros: [{ importe: 120 }] },
      { total: 50, cobros: [] },
    ]);
    expect(t.pendiente).toBe(50);
    expect(t.cobrado).toBe(120);
  });

  it("también con la marca de cancelado en vez del estado", () => {
    expect(totalesPedidos([{ total: 10, cancelado: true }]).cancelados).toBe(1);
  });
});

describe("totalesDocumentos", () => {
  it("los borradores no suman; las rectificativas restan", () => {
    const t = totalesDocumentos([
      { id: "f1", estado: "anulada", base: 100, iva: 21, total: 121 },
      { id: "r1", estado: "emitida", base: -100, iva: -21, total: -121 },
      { id: "f2", estado: "emitida", base: 50, iva: 10.5, total: 60.5 },
      { id: "b1", estado: "borrador", base: 999, iva: 0, total: 999 },
    ]);
    expect(t).toEqual({
      documentos: 3,
      base: 50,
      iva: 10.5,
      total: 60.5,
      borradores: 1,
      canjeados: 0,
    });
  });

  it("en un canje cuenta la factura, no el ticket", () => {
    const t = totalesDocumentos([
      { id: "t1", estado: "emitida", total: 121 },
      { id: "f1", estado: "emitida", total: 121, sustituye_a_id: "t1" },
    ]);
    expect(t).toMatchObject({ documentos: 1, total: 121, canjeados: 1 });
  });

  it("si la factura del canje no está en la lista, el ticket suma", () => {
    expect(totalesDocumentos([{ id: "t1", total: 121 }]).total).toBe(121);
  });

  it("si la factura del canje se anuló, el ticket vuelve a contar", () => {
    const t = totalesDocumentos([
      { id: "t1", estado: "emitida", total: 121 },
      { id: "f1", estado: "anulada", total: 121, sustituye_a_id: "t1" },
      { id: "r1", estado: "emitida", total: -121 },
    ]);
    expect(t).toMatchObject({ documentos: 3, total: 121, canjeados: 0 });
  });
});

describe("totalesConSigno", () => {
  it("entradas, salidas y neto", () => {
    expect(
      totalesConSigno([{ i: 100 }, { i: -30.5 }, { i: "-0.5" }, { i: 0 }], (f) => f.i),
    ).toEqual({ n: 4, entradas: 100, salidas: 31, neto: 69 });
  });
});
