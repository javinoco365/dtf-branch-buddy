import { describe, expect, it } from "vitest";
import {
  direccionCompleta,
  lineasDescuentoPedido,
  documentoDescuadrado,
  lineasDeDevoluciones,
  lineasDesdePedido,
  receptorDesdePedido,
  totalDevuelto,
} from "./factura-desde-pedido";
import { calcularTotales } from "./importes";

describe("receptorDesdePedido", () => {
  it("sin ficha, usa el NIF congelado en el pedido", () => {
    expect(
      receptorDesdePedido(null, { nombre: "Ana Ejemplo" }, null, null, " B21000000 ").nif,
    ).toBe("B21000000");
  });

  it("con ficha sin NIF, usa el del pedido", () => {
    expect(receptorDesdePedido({ nombre: "Ana", nif: "" }, null, null, null, "B21000000").nif).toBe(
      "B21000000",
    );
  });

  it("si la ficha tiene NIF, gana la ficha aunque el pedido traiga otro", () => {
    expect(
      receptorDesdePedido({ nombre: "Ana", nif: "B12345678" }, null, null, null, "B21000000").nif,
    ).toBe("B12345678");
  });

  it("usa la ficha de cliente entera cuando existe, NIF incluido", () => {
    expect(
      receptorDesdePedido(
        { nombre: "Martí & Hijos S.L.", nif: "B12345678", ciudad: "Sevilla" },
        { nombre: "Ana", empresa: "Otra cosa" },
        null,
        null,
      ),
    ).toEqual({
      nombre: "Martí & Hijos S.L.",
      nif: "B12345678",
      direccion: null,
      codigo_postal: null,
      ciudad: "Sevilla",
      provincia: null,
      pais: null,
      email: null,
    });
  });

  it("sin cliente vinculado, prefiere la empresa al nombre de quien compró", () => {
    // El caso B2B: la factura va a nombre de la empresa, no de quien rellenó
    // el formulario de compra.
    expect(
      receptorDesdePedido(
        null,
        { nombre: "Ana Ejemplo", empresa: "Martí & Hijos S.L." },
        null,
        null,
      ).nombre,
    ).toBe("Martí & Hijos S.L.");
  });

  it("sin empresa en la dirección, usa el nombre", () => {
    expect(receptorDesdePedido(null, { nombre: "Ana Ejemplo" }, null, null).nombre).toBe(
      "Ana Ejemplo",
    );
  });

  it("sin cliente ni dirección, cae en el nombre congelado del pedido", () => {
    expect(receptorDesdePedido(null, null, "Ana Ejemplo", "ana@example.com")).toEqual({
      nombre: "Ana Ejemplo",
      nif: null,
      direccion: null,
      codigo_postal: null,
      ciudad: null,
      provincia: null,
      pais: null,
      email: "ana@example.com",
    });
  });

  it("sin cliente vinculado, el NIF siempre es null: Woo nunca lo trae", () => {
    expect(
      receptorDesdePedido(null, { nombre: "Ana", direccion: "Calle Mayor 3" }, null, null).nif,
    ).toBeNull();
  });

  it("una ficha de cliente sin nombre de verdad no cuenta como cliente", () => {
    expect(
      receptorDesdePedido({ nombre: "   " }, { nombre: "Ana Ejemplo" }, null, null).nombre,
    ).toBe("Ana Ejemplo");
  });
});

describe("lineasDesdePedido", () => {
  it("recorta las líneas del pedido tal cual, con su tipo de IVA", () => {
    expect(
      lineasDesdePedido(
        [{ descripcion: "DTF 5m", cantidad: 5, unidad: "m", precio_unitario: 10, iva_rate: 21 }],
        0,
      ),
    ).toEqual([
      { descripcion: "DTF 5m", cantidad: 5, unidad: "m", precio_unitario: 10, iva_rate: 21 },
    ]);
  });

  it("una línea sin tipo de IVA cae al 21 %, no a 0", () => {
    // Pedidos de antes de que la columna iva_rate existiera.
    expect(
      lineasDesdePedido(
        [{ descripcion: "DTF", cantidad: 1, precio_unitario: 10, iva_rate: null }],
        0,
      )[0].iva_rate,
    ).toBe(21);
  });

  it("respeta un tipo reducido, no lo sube al general", () => {
    expect(
      lineasDesdePedido(
        [{ descripcion: "Producto al 10 %", cantidad: 1, precio_unitario: 10, iva_rate: 10 }],
        0,
      )[0].iva_rate,
    ).toBe(10);
  });

  it("sin unidad, cae en metros: es lo que factura DTF Culture normalmente", () => {
    expect(
      lineasDesdePedido([{ descripcion: "DTF", cantidad: 1, precio_unitario: 10 }], 0)[0].unidad,
    ).toBe("m");
  });

  it("añade el envío como línea aparte, al 21 %, solo si hay algo que cobrar", () => {
    const lineas = lineasDesdePedido(
      [{ descripcion: "DTF", cantidad: 1, precio_unitario: 10, iva_rate: 21 }],
      5.5,
    );
    expect(lineas).toHaveLength(2);
    expect(lineas[1]).toEqual({
      descripcion: "Gastos de envío",
      cantidad: 1,
      unidad: "ud",
      precio_unitario: 5.5,
      iva_rate: 21,
    });
  });

  it("sin gastos de envío, no añade ninguna línea de más", () => {
    expect(
      lineasDesdePedido([{ descripcion: "DTF", cantidad: 1, precio_unitario: 10 }], 0),
    ).toHaveLength(1);
    expect(
      lineasDesdePedido([{ descripcion: "DTF", cantidad: 1, precio_unitario: 10 }], -3),
    ).toHaveLength(1);
  });
});

describe("lineasDesdePedido con recargo de equivalencia", () => {
  const items = [
    { descripcion: "DTI por Metros", cantidad: 1, unidad: "m", precio_unitario: 7, iva_rate: 21 },
  ];

  it("DCUL-172-2026: impresión y envío llevan el 5,2 %, como lo cobró la web", () => {
    const lineas = lineasDesdePedido(items, 5.99, { recargo: true });
    expect(lineas.map((l) => [l.descripcion, l.recargo_rate])).toEqual([
      ["DTI por Metros", 5.2],
      ["Gastos de envío", 5.2],
    ]);
    const t = calcularTotales(lineas);
    expect(t.iva_total).toBe(2.73);
    expect(t.recargo_total).toBe(0.67);
    expect(t.total).toBe(16.39);
  });

  it("sin recargo, las líneas no lo llevan", () => {
    const lineas = lineasDesdePedido(items, 5.99);
    expect(lineas.every((l) => l.recargo_rate === undefined)).toBe(true);
  });

  it("una línea al 0 % no lleva recargo", () => {
    const lineas = lineasDesdePedido([{ ...items[0], iva_rate: 0 }], 0, { recargo: true });
    expect(lineas[0].recargo_rate).toBeUndefined();
  });

  it("lo devuelto también lleva el recargo y el total cuadra", () => {
    const lineas = lineasDesdePedido(items, 5.99, { recargo: true });
    const negativas = lineasDeDevoluciones(lineas, [{ importe: 8.83, woo_refund_id: 1 }]);
    expect(negativas[0].recargo_rate).toBe(5.2);
    const objetivo = Math.round((calcularTotales(lineas).total - 8.83) * 100) / 100;
    expect(
      Math.abs(calcularTotales([...lineas, ...negativas]).total - objetivo),
    ).toBeLessThanOrEqual(0.0100001);
  });
});

describe("lineasDeDevoluciones", () => {
  const conIva = (base: number) => [
    { descripcion: "Metro DTF", cantidad: 1, unidad: "m", precio_unitario: base, iva_rate: 21 },
  ];
  const total = (lineas: Parameters<typeof calcularTotales>[0]) => calcularTotales(lineas).total;

  it("DCUL-158: 15,72 € con 7,25 € devueltos sale por 8,47 € (base 7,00 €)", () => {
    const lineas = conIva(12.99);
    const negativas = lineasDeDevoluciones(lineas, [
      { importe: 7.25, woo_refund_id: 803, fecha: "2026-11-13T13:19:52Z" },
    ]);
    expect(negativas).toEqual([
      {
        descripcion: "Devolución del 13/11/2026",
        cantidad: 1,
        unidad: "ud",
        precio_unitario: -5.99,
        iva_rate: 21,
      },
    ]);
    const t = calcularTotales([...lineas, ...negativas]);
    expect(t.base_imponible).toBe(7);
    expect(t.total).toBe(8.47);
  });

  it("DCUL-132: 228,69 € con 101,64 € devueltos sale por 127,05 €, al céntimo", () => {
    const lineas = conIva(189);
    const negativas = lineasDeDevoluciones(lineas, [{ importe: "101.64", woo_refund_id: 749 }]);
    expect(total(lineas)).toBe(228.69);
    expect(total([...lineas, ...negativas])).toBe(127.05);
  });

  it("con importes que no salen redondos al pasar a base, queda como mucho a un céntimo", () => {
    for (const devuelto of [0.01, 0.07, 1.13, 3.33, 9.99, 33.33, 99.99]) {
      const lineas = conIva(123.45);
      const negativas = lineasDeDevoluciones(lineas, [{ importe: devuelto, woo_refund_id: 1 }]);
      const objetivo = Math.round((total(lineas) - devuelto) * 100) / 100;
      expect(Math.abs(total([...lineas, ...negativas]) - objetivo)).toBeLessThanOrEqual(0.0100001);
    }
  });

  it("si el total con IVA es alcanzable, cuadra exacto", () => {
    // 149,37 − 3,33 = 146,04 no lo da ninguna base al 21 %; 146,03 sí.
    const lineas = conIva(123.45);
    const negativas = lineasDeDevoluciones(lineas, [{ importe: 3.34, woo_refund_id: 1 }]);
    expect(total([...lineas, ...negativas])).toBe(146.03);
  });

  it("con dos tipos de IVA reparte la devolución y cuadra el total", () => {
    const lineas = [
      { descripcion: "Metro DTF", cantidad: 10, unidad: "m", precio_unitario: 7, iva_rate: 21 },
      { descripcion: "Libro", cantidad: 1, unidad: "ud", precio_unitario: 20, iva_rate: 4 },
    ];
    const negativas = lineasDeDevoluciones(lineas, [{ importe: 20, woo_refund_id: 5 }]);
    expect(negativas.map((l) => l.iva_rate)).toEqual([21, 4]);
    expect(negativas.every((l) => l.descripcion.startsWith("Devolución"))).toBe(true);
    expect(total([...lineas, ...negativas])).toBe(Math.round((total(lineas) - 20) * 100) / 100);
  });

  it("una rebaja lleva su motivo; una rebaja quitada (0 €) no genera línea", () => {
    const negativas = lineasDeDevoluciones(conIva(100), [
      { importe: 5.99, motivo: "Rebaja: recogió en el local", woo_refund_id: null },
      { importe: 0, motivo: "Rebaja quitada: error", woo_refund_id: null },
    ]);
    expect(negativas).toHaveLength(1);
    expect(negativas[0].descripcion).toBe("Rebaja: recogió en el local");
  });

  it("sin devoluciones no añade nada", () => {
    expect(lineasDeDevoluciones(conIva(10), [])).toEqual([]);
    expect(lineasDeDevoluciones(conIva(10), null)).toEqual([]);
  });

  it("totalDevuelto suma reembolsos y rebajas", () => {
    expect(totalDevuelto([{ importe: 7.25 }, { importe: "1.10" }, { importe: null }])).toBe(8.35);
  });
});

describe("documentoDescuadrado", () => {
  it("una factura de 228,69 € con 101,64 € devueltos después no cuadra", () => {
    expect(documentoDescuadrado(228.69, 228.69, 101.64)).toBe(true);
  });
  it("la factura nueva, ya con la devolución, cuadra (aunque sea a un céntimo)", () => {
    expect(documentoDescuadrado(127.05, 228.69, 101.64)).toBe(false);
    expect(documentoDescuadrado(127.06, 228.69, 101.64)).toBe(false);
  });
  it("sin devoluciones o sin documento, nada que corregir", () => {
    expect(documentoDescuadrado(100, 100, 0)).toBe(false);
    expect(documentoDescuadrado(null, 100, 5)).toBe(false);
  });
});

describe("lineasDescuentoPedido", () => {
  const linea = {
    descripcion: "DTI por Metros",
    cantidad: 40.767,
    unidad: "m",
    precio_unitario: 7,
    iva_rate: 21,
  };

  it("DCUL-130-2026: con el cupón, la factura suma lo que pagó el cliente (310,76 €)", () => {
    const descuento = lineasDescuentoPedido([linea], 256.83);
    expect(descuento).toEqual([
      {
        descripcion: "Descuento",
        cantidad: 1,
        unidad: "ud",
        precio_unitario: -28.54,
        iva_rate: 21,
      },
    ]);
    const t = calcularTotales([linea, ...descuento]);
    expect(t.base_imponible).toBe(256.83);
    expect(t.iva_total).toBe(53.93);
    expect(t.total).toBe(310.76);
  });

  it("sin descuento, o si la web cobró más que las líneas, nada", () => {
    expect(lineasDescuentoPedido([linea], 285.37)).toEqual([]);
    expect(lineasDescuentoPedido([linea], 300)).toEqual([]);
    expect(lineasDescuentoPedido([linea], null)).toEqual([]);
    expect(lineasDescuentoPedido([], 10)).toEqual([]);
  });

  it("con recargo de equivalencia, el descuento también lo lleva", () => {
    const conRe = { ...linea, cantidad: 10, recargo_rate: 5.2 };
    const d = lineasDescuentoPedido([conRe], 63);
    expect(d[0]).toMatchObject({ precio_unitario: -7, iva_rate: 21, recargo_rate: 5.2 });
  });
});

describe("direccionCompleta", () => {
  it("calle, código postal, ciudad y provincia, en una línea", () => {
    expect(
      direccionCompleta({
        direccion: "Avenida Monegros 40. Escalera 1. 4ºC",
        codigo_postal: "22004",
        ciudad: "Huesca",
        provincia: "HU",
        pais: "ES",
      }),
    ).toBe("Avenida Monegros 40. Escalera 1. 4ºC, 22004 Huesca (Huesca)");
  });

  it("el país solo si no es España; sin calle, lo demás", () => {
    expect(
      direccionCompleta({
        direccion: "Rua 1",
        codigo_postal: "1000",
        ciudad: "Lisboa",
        pais: "PT",
      }),
    ).toBe("Rua 1, 1000 Lisboa, PT");
    expect(direccionCompleta({ codigo_postal: "21450", ciudad: "Cartaya" })).toBe("21450 Cartaya");
    expect(direccionCompleta({})).toBeNull();
  });

  it("si la calle ya trae el código postal, no lo repite", () => {
    expect(
      direccionCompleta({
        direccion: "C/ Mayor 1, 21450 Cartaya",
        codigo_postal: "21450",
        ciudad: "Cartaya",
      }),
    ).toBe("C/ Mayor 1, 21450 Cartaya");
  });
});
