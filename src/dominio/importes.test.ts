import { describe, expect, it } from "vitest";
import {
  calcularLinea,
  calcularMetros,
  calcularTotales,
  redondear,
  type LineaBruta,
} from "./importes";

describe("redondear", () => {
  it("redondea a la mitad hacia arriba, no como toFixed", () => {
    // Estos son los casos que toFixed resuelve mal por la representación
    // binaria: (2.675).toFixed(2) devuelve "2.67".
    expect(redondear(2.675)).toBe(2.68);
    expect(redondear(1.005)).toBe(1.01);
    expect(redondear(1.015)).toBe(1.02);
    expect(redondear(8.165)).toBe(8.17);
  });

  it("redondea los negativos alejándose del cero", () => {
    expect(redondear(-2.675)).toBe(-2.68);
    expect(redondear(-1.005)).toBe(-1.01);
  });

  it("no inventa céntimos en valores ya exactos", () => {
    expect(redondear(10)).toBe(10);
    expect(redondear(0)).toBe(0);
    expect(redondear(15.5)).toBe(15.5);
  });

  it("admite otras precisiones", () => {
    expect(redondear(3.4567, 3)).toBe(3.457);
    expect(redondear(3.4564, 3)).toBe(3.456);
  });

  it("devuelve cero ante valores no finitos", () => {
    expect(redondear(Number.NaN)).toBe(0);
    expect(redondear(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("calcularLinea", () => {
  it("calcula base, cuota y total de una línea de DTF por metros", () => {
    const l = calcularLinea({ cantidad: 3.5, precio_unitario: 15, iva_rate: 21 });
    expect(l.base).toBe(52.5);
    expect(l.cuota).toBe(11.03);
    expect(l.total).toBe(63.53);
  });

  it("aplica el descuento antes del IVA", () => {
    const l = calcularLinea({
      cantidad: 10,
      precio_unitario: 10,
      iva_rate: 21,
      descuento_pct: 15,
    });
    expect(l.base).toBe(85);
    expect(l.cuota).toBe(17.85);
    expect(l.total).toBe(102.85);
  });

  it("trata el tipo cero sin cuota", () => {
    const l = calcularLinea({ cantidad: 2, precio_unitario: 30, iva_rate: 0 });
    expect(l.base).toBe(60);
    expect(l.cuota).toBe(0);
    expect(l.total).toBe(60);
  });

  it("tolera campos vacíos sin devolver NaN", () => {
    const l = calcularLinea({
      cantidad: Number.NaN,
      precio_unitario: 10,
      iva_rate: 21,
    });
    expect(l.base).toBe(0);
    expect(l.total).toBe(0);
  });
});

describe("calcularTotales", () => {
  it("calcula la cuota sobre la base agregada, no sumando cuotas de línea", () => {
    // Tres líneas de 0,10 € al 21%.
    const lineas: LineaBruta[] = [
      { cantidad: 1, precio_unitario: 0.1, iva_rate: 21 },
      { cantidad: 1, precio_unitario: 0.1, iva_rate: 21 },
      { cantidad: 1, precio_unitario: 0.1, iva_rate: 21 },
    ];
    // Cuota por línea: redondear(0,021) = 0,02 cada una → 0,06 sumando líneas.
    // Cuota correcta sobre la base agregada 0,30: 0,063 → 0,06. Coinciden aquí,
    // pero el desglose que se remite es siempre el agregado.
    const t = calcularTotales(lineas);
    expect(t.base_imponible).toBe(0.3);
    expect(t.desglose_iva).toEqual([{ tipo: 21, base: 0.3, cuota: 0.06 }]);
    expect(t.iva_total).toBe(0.06);
    expect(t.total).toBe(0.36);
  });

  it("demuestra el descuadre que producía sumar cuotas de línea", () => {
    // Siete líneas de 0,15 €. Cuota de línea: redondear(0,0315) = 0,03.
    // Sumando líneas: 7 × 0,03 = 0,21.
    // Sobre la base agregada 1,05: 0,2205 → 0,22. Un céntimo de diferencia.
    const lineas: LineaBruta[] = Array.from({ length: 7 }, () => ({
      cantidad: 1,
      precio_unitario: 0.15,
      iva_rate: 21,
    }));

    const sumandoCuotasDeLinea = redondear(
      lineas.map(calcularLinea).reduce((s, l) => s + l.cuota, 0),
    );
    const t = calcularTotales(lineas);

    expect(sumandoCuotasDeLinea).toBe(0.21);
    expect(t.iva_total).toBe(0.22);
    expect(t.base_imponible).toBe(1.05);
  });

  it("separa el desglose por tipo impositivo, de mayor a menor", () => {
    const t = calcularTotales([
      { cantidad: 1, precio_unitario: 100, iva_rate: 21 },
      { cantidad: 1, precio_unitario: 50, iva_rate: 10 },
      { cantidad: 1, precio_unitario: 20, iva_rate: 4 },
    ]);
    expect(t.desglose_iva).toEqual([
      { tipo: 21, base: 100, cuota: 21 },
      { tipo: 10, base: 50, cuota: 5 },
      { tipo: 4, base: 20, cuota: 0.8 },
    ]);
    expect(t.base_imponible).toBe(170);
    expect(t.iva_total).toBe(26.8);
    expect(t.total).toBe(196.8);
  });

  it("agrupa varias líneas del mismo tipo en una sola fila del desglose", () => {
    const t = calcularTotales([
      { cantidad: 2, precio_unitario: 10, iva_rate: 21 },
      { cantidad: 3, precio_unitario: 10, iva_rate: 21 },
    ]);
    expect(t.desglose_iva).toHaveLength(1);
    expect(t.desglose_iva[0]).toEqual({ tipo: 21, base: 50, cuota: 10.5 });
  });

  it("mete el envío en la base imponible al tipo general por defecto", () => {
    const t = calcularTotales([{ cantidad: 3.5, precio_unitario: 15, iva_rate: 21 }], {
      envio: 4.9,
    });
    expect(t.base_imponible).toBe(57.4);
    expect(t.desglose_iva).toEqual([{ tipo: 21, base: 57.4, cuota: 12.05 }]);
    expect(t.total).toBe(69.45);
  });

  it("admite un tipo distinto para el envío", () => {
    const t = calcularTotales([{ cantidad: 1, precio_unitario: 100, iva_rate: 21 }], {
      envio: 10,
      iva_envio: 10,
    });
    expect(t.desglose_iva).toEqual([
      { tipo: 21, base: 100, cuota: 21 },
      { tipo: 10, base: 10, cuota: 1 },
    ]);
    expect(t.total).toBe(132);
  });

  it("devuelve ceros con un documento sin líneas", () => {
    const t = calcularTotales([]);
    expect(t).toEqual({
      base_imponible: 0,
      desglose_iva: [],
      iva_total: 0,
      total: 0,
    });
  });

  it("no crea una fila de desglose por un envío de cero", () => {
    const t = calcularTotales([{ cantidad: 1, precio_unitario: 10, iva_rate: 21 }], {
      envio: 0,
    });
    expect(t.desglose_iva).toHaveLength(1);
  });
});

describe("calcularMetros", () => {
  it("suma solo las líneas medidas en metros", () => {
    expect(
      calcularMetros([
        { cantidad: 3.5, unidad: "m" },
        { cantidad: 2.25, unidad: "m" },
        { cantidad: 1, unidad: "ud" },
      ]),
    ).toBe(5.75);
  });

  it("supone metros cuando la unidad no está definida", () => {
    expect(calcularMetros([{ cantidad: 4, unidad: null }, { cantidad: 1 }])).toBe(5);
  });

  it("conserva tres decimales, que es la precisión de la columna", () => {
    expect(calcularMetros([{ cantidad: 0.3333, unidad: "m" }])).toBe(0.333);
  });
});
