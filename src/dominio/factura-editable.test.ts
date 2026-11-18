import { describe, expect, it } from "vitest";
import {
  conRecargo,
  lineaAEditable,
  lineaVacia,
  lineasParaEmitir,
  numeroEscrito,
} from "./factura-editable";

describe("lineasParaEmitir", () => {
  it("convierte los números escritos con coma y miles", () => {
    const r = lineasParaEmitir([
      {
        descripcion: " Estampación chaquetones ",
        cantidad: "5",
        unidad: "ud",
        precio_unitario: "1.200,50",
        iva_rate: "21",
      },
    ]);
    expect(r).toEqual({
      ok: true,
      lineas: [
        {
          descripcion: "Estampación chaquetones",
          cantidad: 5,
          unidad: "ud",
          precio_unitario: 1200.5,
          iva_rate: 21,
        },
      ],
    });
  });

  it("ignora la línea añadida y dejada en blanco", () => {
    const r = lineasParaEmitir([
      { descripcion: "DTF", cantidad: "2,5", unidad: "m", precio_unitario: "7", iva_rate: "21" },
      lineaVacia(),
    ]);
    expect(r.ok && r.lineas).toHaveLength(1);
  });

  it("dice qué falta y en qué línea", () => {
    const r = lineasParaEmitir([
      { descripcion: "", cantidad: "1", unidad: "ud", precio_unitario: "10", iva_rate: "21" },
      { descripcion: "Envío", cantidad: "0", unidad: "ud", precio_unitario: "5", iva_rate: "150" },
    ]);
    expect(r).toEqual({
      ok: false,
      errores: [
        "Línea 1: falta la descripción",
        "Línea 2: la cantidad no es válida",
        "Línea 2: el IVA no es válido",
      ],
    });
  });

  it("sin ninguna línea no se emite", () => {
    expect(lineasParaEmitir([lineaVacia()])).toEqual({
      ok: false,
      errores: ["La factura necesita al menos una línea"],
    });
  });

  it("admite un descuento en negativo", () => {
    const r = lineasParaEmitir([
      {
        descripcion: "Descuento",
        cantidad: "1",
        unidad: "ud",
        precio_unitario: "-5",
        iva_rate: "21",
      },
    ]);
    expect(r.ok && r.lineas[0].precio_unitario).toBe(-5);
  });
});

describe("lineaAEditable", () => {
  it("pone coma decimal y la unidad por defecto", () => {
    expect(
      lineaAEditable({
        descripcion: "DTF",
        cantidad: 2.5,
        unidad: "",
        precio_unitario: 7,
        iva_rate: 21,
      }),
    ).toEqual({
      descripcion: "DTF",
      cantidad: "2,5",
      unidad: "ud",
      precio_unitario: "7",
      iva_rate: "21",
    });
  });
});

describe("conRecargo", () => {
  const linea = { descripcion: "DTF", cantidad: 1, unidad: "m", precio_unitario: 7, iva_rate: 21 };

  it("pone el recargo que va con el IVA de cada línea", () => {
    expect(
      conRecargo([linea, { ...linea, iva_rate: 10 }, { ...linea, iva_rate: 0 }], true),
    ).toEqual([
      { ...linea, recargo_rate: 5.2 },
      { ...linea, iva_rate: 10, recargo_rate: 1.4 },
      { ...linea, iva_rate: 0 },
    ]);
  });

  it("sin recargo, lo quita aunque la línea lo trajera", () => {
    expect(conRecargo([{ ...linea, recargo_rate: 5.2 }], false)).toEqual([linea]);
  });
});

describe("numeroEscrito", () => {
  it("la coma es el decimal: 40,767 m son cuarenta metros, no cuarenta mil", () => {
    expect(numeroEscrito("40,767")).toBe(40.767);
    expect(numeroEscrito("7,5")).toBe(7.5);
    expect(numeroEscrito("1.234,56")).toBe(1234.56);
    expect(numeroEscrito("-5,99")).toBe(-5.99);
    expect(numeroEscrito(" 12,50 € ")).toBe(12.5);
  });

  it("con solo puntos, miles si van de tres en tres; si no, decimal", () => {
    expect(numeroEscrito("1.200")).toBe(1200);
    expect(numeroEscrito("12.500.000")).toBe(12500000);
    expect(numeroEscrito("7.5")).toBe(7.5);
    expect(numeroEscrito("21")).toBe(21);
  });

  it("lo que no es un número, nulo", () => {
    for (const t of ["", "abc", "1,2,3", "1.2.3", "-"]) {
      expect([t, numeroEscrito(t)]).toEqual([t, null]);
    }
  });

  it("DCUL-130-2026: la línea del pedido vuelve tal cual tras pasar por el formulario", () => {
    const linea = {
      descripcion: "DTI por Metros",
      cantidad: 40.767,
      unidad: "m",
      precio_unitario: 7,
      iva_rate: 21,
    };
    const r = lineasParaEmitir([lineaAEditable(linea)]);
    expect(r).toEqual({ ok: true, lineas: [linea] });
  });
});
