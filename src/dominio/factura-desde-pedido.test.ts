import { describe, expect, it } from "vitest";
import { lineasDesdePedido, receptorDesdePedido } from "./factura-desde-pedido";

describe("receptorDesdePedido", () => {
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
