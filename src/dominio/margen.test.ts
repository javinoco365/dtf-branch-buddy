import { describe, expect, it } from "vitest";
import { cifrasGerencia, ventaDeTextil, ventaDeTienda, type Venta } from "./gerencia";
import {
  margenPor,
  margenPorLinea,
  margenPorMetro,
  margenPorMetroUv,
  margenPorTramos,
} from "./margen";

const dtf = (fecha: string, bruta: number, metros: number, coste = 2): Venta =>
  ventaDeTienda({
    fecha_pedido: `${fecha}T10:00:00`,
    tienda_id: "t1",
    estado: "entregado",
    subtotal: bruta,
    iva: bruta * 0.21,
    envio: 0,
    total: bruta * 1.21,
    metros_total: metros,
    coste_metro_snapshot: coste,
    origen: "manual",
    cliente_id: "c",
  });

const textil = (fecha: string, bruta: number, coste: number | null): Venta =>
  ventaDeTextil({
    id: `x-${fecha}-${bruta}`,
    fecha,
    estado: "entregado",
    subtotal: bruta,
    iva: bruta * 0.21,
    envio: 0,
    total: bruta * 1.21,
    cliente_id: "c",
    coste,
  });

describe("margen con el coste del textil", () => {
  it("el textil resta lo que costó la ropa; sin salida de almacén, va sin coste y se cuenta", () => {
    const c = cifrasGerencia(
      [dtf("2026-10-01", 100, 10), textil("2026-10-02", 200, 80), textil("2026-10-03", 50, null)],
      5,
    );
    expect(c.costeDtf).toBe(20);
    expect(c.costeTextil).toBe(80);
    expect(c.coste).toBe(100);
    expect(c.margen).toBe(250);
    expect(c.textilSinCoste).toBe(1);
  });

  it("un textil cancelado no suma coste", () => {
    const v = { ...textil("2026-10-02", 200, 80), estado: "cancelado" };
    expect(cifrasGerencia([v], 0).costeTextil).toBe(0);
  });
});

describe("margen por grupo, por tramo y por metro", () => {
  const ventas = [
    dtf("2026-10-01", 100, 10),
    dtf("2026-10-02", 50, 5),
    textil("2026-10-03", 200, 150),
  ];

  it("agrupa por canal, de más a menos margen", () => {
    const f = margenPor(ventas, (v) => v.canal, new Map([["manual", "Manual"]]), 0);
    expect(f.map((x) => x.clave)).toEqual(["manual", "textil"]);
    expect(f[0]).toMatchObject({
      nombre: "Manual",
      bruta: 150,
      coste: 30,
      margen: 120,
      porcentaje: 80,
    });
    expect(f[1]).toMatchObject({ margen: 50, porcentaje: 25 });
  });

  it("por tramos hasta hoy, con los gastos fijos solo hasta hoy", () => {
    const tramos = [
      { etiqueta: "1", desde: new Date(2026, 9, 1), hasta: new Date(2026, 9, 1, 23, 59, 59) },
      { etiqueta: "2", desde: new Date(2026, 9, 2), hasta: new Date(2026, 9, 2, 23, 59, 59) },
      { etiqueta: "9", desde: new Date(2026, 9, 9), hasta: new Date(2026, 9, 9, 23, 59, 59) },
    ];
    const gastos = [
      { id: "g", concepto: "Alquiler", importe_mensual: 310, desde: "2026-01-01", hasta: null },
    ];
    const t = margenPorTramos(ventas, tramos, 0, gastos, new Date(2026, 9, 5, 12));
    expect(t[0]).toMatchObject({ margen: 80, gastos: 10, beneficio: 70 });
    expect(t[1]).toMatchObject({ margen: 40, gastos: 10, beneficio: 30 });
    // El día 9 todavía no ha llegado: no sale.
    expect(t).toHaveLength(2);
  });

  it("cada venta en el tramo del día de su pedido", () => {
    // Un web de las 23:15 del 1 de octubre (hora de la web guardada como UTC)
    // es del 1, no del 2.
    const web = {
      ...dtf("2026-10-01", 100, 10),
      fecha_pedido: "2026-10-01T23:15:00+00:00",
      origen: "woocommerce",
    };
    const tramos = [
      { etiqueta: "1", desde: new Date(2026, 9, 1), hasta: new Date(2026, 9, 1, 23, 59, 59) },
      { etiqueta: "2", desde: new Date(2026, 9, 2), hasta: new Date(2026, 9, 2, 23, 59, 59) },
    ];
    const t = margenPorTramos([web], tramos, 0, [], new Date(2026, 9, 5, 12));
    expect(t.map((x) => x.bruta)).toEqual([100, 0]);
  });

  it("precio, coste y margen del metro", () => {
    expect(margenPorMetro(ventas, 0)).toEqual({ precio: 10, coste: 2, margen: 8 });
    expect(margenPorMetro([textil("2026-10-03", 200, 1)], 0)).toBeNull();
  });
});

describe("margen por línea (DTF y DTF UV)", () => {
  // DCUL-143: 7 m de UV a 16 €/m; y un mixto: 4 m de DTF (40 €) + 2 m de UV a 17,50 €/m.
  const soloUv: Venta = {
    ...dtf("2026-11-10", 112, 0),
    metros_uv: 7,
    coste_uv_snapshot: 15,
    bruta_uv: 112,
    iva_uv: 23.52,
  };
  const mixto: Venta = {
    ...dtf("2026-11-11", 75, 4),
    metros_uv: 2,
    coste_uv_snapshot: 15,
    bruta_uv: 35,
    iva_uv: 7.35,
  };
  const ventas = [soloUv, mixto, textil("2026-11-11", 50, 20)];

  it("cada línea con su coste; suman el margen de «Todo»", () => {
    const filas = margenPorLinea(ventas, 2);
    const de = (c: string) => filas.find((f) => f.clave === c)!;
    expect(de("dtf")).toMatchObject({ bruta: 40, coste: 8, margen: 32 });
    expect(de("uv")).toMatchObject({ bruta: 147, coste: 135, margen: 12 });
    expect(de("textil")).toMatchObject({ bruta: 50, coste: 20, margen: 30 });
    const todo = cifrasGerencia(ventas, 2);
    expect(filas.reduce((s, f) => s + f.margen, 0)).toBeCloseTo(todo.margen, 2);
  });

  it("el metro de DTF, sin lo del UV del mixto; el de UV, con lo que cobra la subcontrata", () => {
    expect(margenPorMetro(ventas, 2)).toEqual({ precio: 10, coste: 2, margen: 8 });
    // 147 € / 9 m = 16,33; coste 15; quedan 1,33 €/m.
    expect(margenPorMetroUv(ventas, 2)).toEqual({ precio: 16.33, coste: 15, margen: 1.33 });
    expect(margenPorMetroUv([dtf("2026-11-11", 10, 1)], 2)).toBeNull();
  });
});
