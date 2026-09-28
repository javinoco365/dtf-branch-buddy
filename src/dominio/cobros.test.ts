import { describe, expect, it } from "vitest";
import {
  TIENDA_TEXTIL,
  cobrosComoPedidos,
  desglosarCobro,
  destinoDelCobro,
  etiquetaMetodo,
  repartirCobro,
  resumenCobros,
} from "./cobros";
import { agruparPorRangos, agruparPorTienda, calcularKpis } from "./kpis";

describe("destinoDelCobro", () => {
  it("el efectivo va a caja", () => {
    expect(destinoDelCobro("efectivo")).toBe("caja");
  });

  it("la tarjeta y la transferencia van a facturación", () => {
    expect(destinoDelCobro("tarjeta")).toBe("facturacion");
    expect(destinoDelCobro("transferencia")).toBe("facturacion");
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

describe("cobrosComoPedidos", () => {
  const pedido = { iva: 21, total: 121 };

  it("el efectivo no cuenta como facturación: va a caja", () => {
    expect(
      cobrosComoPedidos([{ fecha: "2026-09-24", importe: 40, metodo: "efectivo", pedido }]),
    ).toEqual([]);
  });

  it("la tarjeta y la transferencia sí, con su base y su IVA", () => {
    const filas = cobrosComoPedidos([
      { fecha: "2026-09-24", importe: 60.5, metodo: "tarjeta", pedido },
      { fecha: "2026-09-25", importe: 60.5, metodo: "transferencia", pedido },
    ]);
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({
      tienda_id: TIENDA_TEXTIL.id,
      subtotal: 50,
      iva: 10.5,
      envio: 0,
      total: 60.5,
      metros_total: 0,
    });
  });

  it("encaja con el desglose por tienda de la Consolidada", () => {
    const filas = cobrosComoPedidos([
      { fecha: "2026-09-24", importe: 121, metodo: "tarjeta", pedido },
      { fecha: "2026-09-24", importe: 50, metodo: "efectivo", pedido },
    ]);
    const tiendas = [{ id: "t1", nombre: "DTF Culture" }, TIENDA_TEXTIL];
    const desglose = agruparPorTienda(filas, tiendas);
    const textil = desglose.find((f) => f.tienda_id === TIENDA_TEXTIL.id)!;
    expect(textil).toMatchObject({ pedidos: 1, bruta: 100, iva: 21, total: 121 });
    expect(calcularKpis(filas).total).toBe(121);
  });

  it("un cobro de un lunes cae en la semana de ese lunes, no en la anterior", () => {
    const filas = cobrosComoPedidos([
      { fecha: "2026-09-28", importe: 10, metodo: "tarjeta", pedido },
    ]);
    const [anterior, actual] = agruparPorRangos(filas, [
      { desde: new Date(2026, 8, 21, 0, 0, 0), hasta: new Date(2026, 8, 27, 23, 59, 59) },
      { desde: new Date(2026, 8, 28, 0, 0, 0), hasta: new Date(2026, 9, 4, 23, 59, 59) },
    ]);
    expect(anterior.total).toBe(0);
    expect(actual.total).toBe(10);
  });
});
