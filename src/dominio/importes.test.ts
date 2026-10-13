import { describe, expect, it } from "vitest";
import {
  calcularLinea,
  calcularMetros,
  calcularTotales,
  importeLineaSinIva,
  lineaImpresa,
  lineasImpresas,
  pieDocumentoEmitido,
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

  it("no da lo mismo sumar cuotas por línea que aplicar el tipo sobre la base", () => {
    // Esta es la razón por la que updatePedido estaba mal: calculaba el IVA
    // sumando la cuota de cada línea. Con siete líneas de 0,15 al 21%, cada
    // cuota redondea a 0,03 y la suma da 0,21; sobre la base agregada de 1,05
    // sale 0,22. Un céntimo por documento, en cada factura, para siempre.
    const lineas = Array.from({ length: 7 }, () => ({
      cantidad: 1,
      precio_unitario: 0.15,
      iva_rate: 21,
    }));

    const porLinea = lineas
      .map((l) => calcularLinea(l).cuota)
      .reduce((a, b) => redondear(a + b), 0);
    const t = calcularTotales(lineas);

    expect(porLinea).toBe(0.21);
    expect(t.iva_total).toBe(0.22);
    expect(t.iva_total).not.toBe(porLinea);
  });

  it("no crea una fila de desglose por un envío de cero", () => {
    const t = calcularTotales([{ cantidad: 1, precio_unitario: 10, iva_rate: 21 }], {
      envio: 0,
    });
    expect(t.desglose_iva).toHaveLength(1);
  });
});

describe("importeLineaSinIva", () => {
  it("es la base de la línea, sin IVA: 1 m × 7,00 € al 21 % son 7,00 €", () => {
    expect(importeLineaSinIva({ cantidad: 1, precio_unitario: 7, iva_rate: 21, subtotal: 7 })).toBe(
      7,
    );
    expect(
      importeLineaSinIva({ cantidad: 1, precio_unitario: 5.99, iva_rate: 21, subtotal: 5.99 }),
    ).toBe(5.99);
  });

  it("usa la base congelada y no vuelve a multiplicar cantidad por precio", () => {
    // 10 × 10 € con un 15 % de descuento: la base congelada es 85, no 100.
    expect(
      importeLineaSinIva({ cantidad: 10, precio_unitario: 10, iva_rate: 21, subtotal: 85 }),
    ).toBe(85);
  });

  it("respeta una base congelada de cero", () => {
    expect(
      importeLineaSinIva({ cantidad: 1, precio_unitario: 10, iva_rate: 21, subtotal: 0 }),
    ).toBe(0);
  });

  it("mantiene el signo de una línea en negativo", () => {
    expect(
      importeLineaSinIva({ cantidad: -1, precio_unitario: 7, iva_rate: 21, subtotal: -7 }),
    ).toBe(-7);
  });

  it("sin base congelada, la calcula como al emitir", () => {
    expect(importeLineaSinIva({ cantidad: 3.5, precio_unitario: 15, iva_rate: 21 })).toBe(52.5);
    expect(
      importeLineaSinIva({ cantidad: 1.005, precio_unitario: 1, iva_rate: 21, subtotal: null }),
    ).toBe(1.01);
    expect(
      importeLineaSinIva({
        cantidad: 2,
        precio_unitario: 10,
        iva_rate: 21,
        subtotal: Number.NaN,
      }),
    ).toBe(20);
  });
});

describe("lineaImpresa", () => {
  it("con todo congelado, lo imprime tal cual y no recalcula nada", () => {
    // Cuota guardada a propósito distinta de base × tipo: manda la guardada.
    expect(
      lineaImpresa({
        descripcion: "Camiseta",
        cantidad: 2,
        unidad: "m",
        precio_unitario: 5,
        iva_rate: 21,
        subtotal: 10,
        iva: 2.11,
        total: 12.11,
      }),
    ).toEqual({
      descripcion: "Camiseta",
      cantidad: 2,
      unidad: "m",
      precio_unitario: 5,
      iva_rate: 21,
      subtotal: 10,
      iva: 2.11,
      total: 12.11,
    });
  });

  it("sin cuota ni total (textil_factura_items), los saca de la base como factura_calcular", () => {
    // 3 × 8,25 = 24,75; 24,75 × 21 % = 5,1975 → 5,20; total 29,95.
    expect(
      lineaImpresa({
        descripcion: "Sudadera",
        cantidad: 3,
        precio_unitario: 8.25,
        iva_rate: 21,
        subtotal: 24.75,
      }),
    ).toMatchObject({ subtotal: 24.75, iva: 5.2, total: 29.95 });
  });

  it("redondea la cuota a la mitad hacia arriba", () => {
    // 12,50 × 21 % = 2,625 → 2,63: la mitad, hacia arriba.
    expect(lineaImpresa({ iva_rate: 21, subtotal: 12.5 })).toMatchObject({
      iva: 2.63,
      total: 15.13,
    });
  });

  it("la cuota sale de la base congelada, no de cantidad × precio", () => {
    // 10 × 10 € con un 15 % de descuento: base 85, cuota 17,85.
    expect(
      lineaImpresa({ cantidad: 10, precio_unitario: 10, iva_rate: 21, subtotal: 85 }),
    ).toMatchObject({ subtotal: 85, iva: 17.85, total: 102.85 });
  });

  it("una línea en negativo (rectificativa) mantiene el signo", () => {
    expect(
      lineaImpresa({ cantidad: -1, precio_unitario: 12.5, iva_rate: 21, subtotal: -12.5 }),
    ).toMatchObject({ subtotal: -12.5, iva: -2.63, total: -15.13 });
  });

  it("al 0 % no hay cuota", () => {
    expect(lineaImpresa({ iva_rate: 0, subtotal: 40 })).toMatchObject({ iva: 0, total: 40 });
  });

  it("acepta las cifras como texto, como devuelve numeric", () => {
    expect(
      lineaImpresa({
        cantidad: "2",
        precio_unitario: "7.50",
        iva_rate: "21",
        subtotal: "15",
        iva: "3.15",
        total: "18.15",
      }),
    ).toMatchObject({
      cantidad: 2,
      precio_unitario: 7.5,
      iva_rate: 21,
      subtotal: 15,
      iva: 3.15,
      total: 18.15,
    });
  });

  it("sin unidad, «ud»; con unidad, la suya", () => {
    expect(lineaImpresa({ subtotal: 1 }).unidad).toBe("ud");
    expect(lineaImpresa({ subtotal: 1, unidad: "  " }).unidad).toBe("ud");
    expect(lineaImpresa({ subtotal: 1, unidad: "m" }).unidad).toBe("m");
  });

  it("sin descripción, texto vacío y no «undefined»", () => {
    expect(lineaImpresa({ subtotal: 1 }).descripcion).toBe("");
  });

  it("sin base congelada, la calcula como al emitir", () => {
    expect(lineaImpresa({ cantidad: 3.5, precio_unitario: 15, iva_rate: 21 })).toMatchObject({
      subtotal: 52.5,
      iva: 11.03,
      total: 63.53,
    });
  });
});

describe("lineasImpresas", () => {
  const tabla = [
    { descripcion: "B", cantidad: 1, precio_unitario: 10, iva_rate: 21, subtotal: 10 },
    { descripcion: "A", cantidad: 2, precio_unitario: 5, iva_rate: 10, subtotal: 10 },
  ];

  it("con lineas_snapshot, imprime lo congelado: su unidad, su cuota y su orden", () => {
    const snapshot = [
      {
        descripcion: "A",
        cantidad: 2,
        unidad: "m",
        precio_unitario: 5,
        iva_rate: 10,
        subtotal: 10,
        iva: 1,
        total: 11,
      },
      {
        descripcion: "B",
        cantidad: 1,
        unidad: "ud",
        precio_unitario: 10,
        iva_rate: 21,
        subtotal: 10,
        iva: 2.1,
        total: 12.1,
      },
    ];
    const r = lineasImpresas(snapshot, tabla);
    expect(r.map((l) => l.descripcion)).toEqual(["A", "B"]);
    expect(r[0]).toMatchObject({ unidad: "m", iva: 1, total: 11 });
  });

  it("sin lineas_snapshot (emitidas antes del motor), las de la tabla, con la cuota calculada", () => {
    for (const snapshot of [null, undefined, [], "no es una lista"]) {
      const r = lineasImpresas(snapshot, tabla);
      expect(r.map((l) => [l.descripcion, l.unidad, l.iva, l.total])).toEqual([
        ["B", "ud", 2.1, 12.1],
        ["A", "ud", 1, 11],
      ]);
    }
  });

  it("descarta lo que no es una línea dentro del snapshot", () => {
    expect(lineasImpresas([null, 3, { descripcion: "A", subtotal: 4 }], tabla)).toHaveLength(1);
  });

  it("sin nada de nada, ninguna línea", () => {
    expect(lineasImpresas(null, null)).toEqual([]);
  });
});

describe("pieDocumentoEmitido", () => {
  it("base, una cuota por el único tipo y total, tal como se congelaron", () => {
    expect(
      pieDocumentoEmitido({
        base_imponible: 12.99,
        iva_total: 2.73,
        total: 15.72,
        desglose: [{ tipo: 21, base: 12.99, cuota: 2.73 }],
      }),
    ).toEqual({ base: 12.99, iva: [{ tipo: 21, cuota: 2.73 }], total: 15.72 });
  });

  it("una cuota por cada tipo, en el orden del desglose", () => {
    const pie = pieDocumentoEmitido({
      base_imponible: 16,
      iva_total: 2.37,
      total: 18.37,
      desglose: [
        { tipo: 21, base: 7, cuota: 1.47 },
        { tipo: 10, base: 9, cuota: 0.9 },
      ],
    });
    expect(pie.iva).toEqual([
      { tipo: 21, cuota: 1.47 },
      { tipo: 10, cuota: 0.9 },
    ]);
  });

  it("pone también el tipo del 0 %, con su cuota de cero", () => {
    const pie = pieDocumentoEmitido({
      base_imponible: 110,
      iva_total: 21,
      total: 131,
      desglose: [
        { tipo: 21, base: 100, cuota: 21 },
        { tipo: 0, base: 10, cuota: 0 },
      ],
    });
    expect(pie.iva).toEqual([
      { tipo: 21, cuota: 21 },
      { tipo: 0, cuota: 0 },
    ]);
  });

  it("no recalcula: la base y el total son los congelados aunque no cuadren", () => {
    // Si la base guardada no fuese la suma del desglose, se imprime la
    // guardada: el papel tiene que decir lo mismo que la base de datos.
    const pie = pieDocumentoEmitido({
      base_imponible: 12.98,
      iva_total: 2.73,
      total: 15.7,
      desglose: [{ tipo: 21, base: 12.99, cuota: 2.73 }],
    });
    expect(pie.base).toBe(12.98);
    expect(pie.total).toBe(15.7);
  });

  it("sin desglose, una sola cuota sin tipo con el IVA total", () => {
    const sinDesglose = { base_imponible: 100, iva_total: 21, total: 121 };
    const esperado = { base: 100, iva: [{ tipo: null, cuota: 21 }], total: 121 };
    expect(pieDocumentoEmitido(sinDesglose)).toEqual(esperado);
    expect(pieDocumentoEmitido({ ...sinDesglose, desglose: null })).toEqual(esperado);
    expect(pieDocumentoEmitido({ ...sinDesglose, desglose: [] })).toEqual(esperado);
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
