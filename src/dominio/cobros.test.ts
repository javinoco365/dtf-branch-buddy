import { describe, expect, it } from "vitest";
import {
  desglosarCobro,
  etiquetaMetodo,
  pasaPorCaja,
  repartirCobro,
  resumenCobros,
} from "./cobros";

describe("pasaPorCaja", () => {
  it("solo el efectivo entra en caja", () => {
    expect(pasaPorCaja("efectivo")).toBe(true);
    expect(pasaPorCaja("tarjeta")).toBe(false);
    expect(pasaPorCaja("transferencia")).toBe(false);
    expect(pasaPorCaja("web")).toBe(false);
  });
});

describe("etiquetaMetodo", () => {
  it("también los que no se eligen a mano", () => {
    expect(etiquetaMetodo("web")).toBe("Web");
    expect(etiquetaMetodo("sin_especificar")).toBe("Sin especificar");
    expect(etiquetaMetodo("tarjeta")).toBe("Tarjeta");
  });
});

describe("repartirCobro", () => {
  it("lo que cabe en lo pendiente va entero al pedido", () => {
    expect(repartirCobro(30, 40)).toEqual({ importe: 30, propina: 0 });
    expect(repartirCobro(40, 40)).toEqual({ importe: 40, propina: 0 });
  });

  it("lo que sobra es propina", () => {
    expect(repartirCobro(35, 30)).toEqual({ importe: 30, propina: 5 });
  });

  it("con el pedido ya cobrado, todo es propina", () => {
    expect(repartirCobro(2, 0)).toEqual({ importe: 0, propina: 2 });
  });

  it("un pedido cobrado de más no deja una propina mayor que lo recibido", () => {
    expect(repartirCobro(5, -20)).toEqual({ importe: 0, propina: 5 });
  });

  it("sin error de coma flotante", () => {
    expect(repartirCobro(0.3, 0.1)).toEqual({ importe: 0.1, propina: 0.2 });
  });
});

describe("resumenCobros", () => {
  it("sin cobros, todo pendiente", () => {
    expect(resumenCobros(100, [])).toEqual({ cobrado: 0, pendiente: 100, estado: "pendiente" });
  });

  it("pagan el textil y falta la personalización: parcial", () => {
    expect(resumenCobros(100, [{ importe: 60 }])).toEqual({
      cobrado: 60,
      pendiente: 40,
      estado: "parcial",
    });
  });

  it("varios cobros que llegan al total: cobrado", () => {
    expect(resumenCobros("100.00", [{ importe: "40.00" }, { importe: 60 }])).toEqual({
      cobrado: 100,
      pendiente: 0,
      estado: "cobrado",
    });
  });

  it("no arrastra el error de coma flotante: 0,1 + 0,2 de 0,3 es cobrado", () => {
    expect(resumenCobros(0.3, [{ importe: 0.1 }, { importe: 0.2 }]).estado).toBe("cobrado");
  });

  it("si el total bajó por debajo de lo cobrado, lo dice en vez de esconderlo", () => {
    expect(resumenCobros(80, [{ importe: 100 }])).toEqual({
      cobrado: 100,
      pendiente: -20,
      estado: "excedido",
    });
  });

  it("un pedido de total cero sin cobros no queda pendiente", () => {
    expect(resumenCobros(0, []).estado).toBe("cobrado");
  });
});

describe("desglosarCobro", () => {
  it("reparte el cobro en la proporción del pedido y base + IVA es lo cobrado", () => {
    // Pedido de 121 € con 21 € de IVA; se cobran 60,50 €.
    const d = desglosarCobro(60.5, { iva: 21, total: 121 });
    expect(d).toEqual({ base: 50, iva: 10.5 });
    expect(d.base + d.iva).toBe(60.5);
  });

  it("con un reparto que no sale redondo, la base absorbe el céntimo", () => {
    const d = desglosarCobro(33.33, { iva: 17.36, total: 100 });
    expect(d.iva).toBe(5.79);
    expect(d.base).toBe(27.54);
    expect(Math.round((d.base + d.iva) * 100)).toBe(3333);
  });

  it("un pedido sin IVA lo deja todo en la base", () => {
    expect(desglosarCobro(50, { iva: 0, total: 50 })).toEqual({ base: 50, iva: 0 });
  });

  it("un pedido de total cero no divide por cero", () => {
    expect(desglosarCobro(10, { iva: 0, total: 0 })).toEqual({ base: 10, iva: 0 });
  });

  it("sin el pedido no se inventa un IVA: todo a la base", () => {
    expect(desglosarCobro(10, null)).toEqual({ base: 10, iva: 0 });
  });
});
