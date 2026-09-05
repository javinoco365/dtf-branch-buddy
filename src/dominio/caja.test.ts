import { describe, expect, it } from "vitest";
import { porConcepto, porSocio, totalesCaja, type ApunteCaja } from "./caja";

const LIBRO: ApunteCaja[] = [
  { categoria: "ingreso", importe: 120.5, concepto_nombre: "Camisetas" },
  { categoria: "ingreso", importe: 340, concepto_nombre: "Metros" },
  { categoria: "ingreso", importe: 15.25, concepto_nombre: "Camisetas" },
  { categoria: "gasto", importe: 80, concepto_nombre: "Materiales", socio_nombre: "Javi C" },
  { categoria: "gasto", importe: 45.75, concepto_nombre: "Arreglos", socio_nombre: "Álvaro" },
  { categoria: "gasto", importe: 20, concepto_nombre: "Materiales", socio_nombre: "Javi C" },
  { categoria: "gasto", importe: 900, concepto_nombre: "Nómina" }, // la paga la empresa
];

describe("totalesCaja", () => {
  it("suma cada categoría por su lado y resta para el saldo", () => {
    expect(totalesCaja(LIBRO)).toEqual({
      ingresos: 475.75,
      gastos: 1045.75,
      saldo: -570,
      apuntes: 7,
    });
  });

  it("un libro vacío da ceros, no NaN", () => {
    expect(totalesCaja([])).toEqual({ ingresos: 0, gastos: 0, saldo: 0, apuntes: 0 });
  });

  it("no arrastra el error binario de la suma", () => {
    // 0.1 + 0.2 da 0.30000000000000004 en coma flotante. Diez apuntes de 0.10
    // tienen que dar 1,00 € exacto, no 0,9999999999999999.
    const centimos: ApunteCaja[] = Array.from({ length: 10 }, () => ({
      categoria: "ingreso" as const,
      importe: 0.1,
    }));
    expect(totalesCaja(centimos).ingresos).toBe(1);
  });

  it("ignora los importes que no son números positivos", () => {
    // La base impide guardarlos, pero si alguna vez llegara uno, restarlo
    // además de contarlo como gasto lo descontaría dos veces.
    const sucio = [
      { categoria: "gasto" as const, importe: -50 },
      { categoria: "ingreso" as const, importe: Number.NaN },
      { categoria: "ingreso" as const, importe: 100 },
    ];
    expect(totalesCaja(sucio)).toEqual({ ingresos: 100, gastos: 0, saldo: 100, apuntes: 3 });
  });
});

describe("porSocio", () => {
  it("suma lo que ha puesto cada uno, de más a menos", () => {
    expect(porSocio(LIBRO)).toEqual([
      { socio: "Javi C", puesto: 100, apuntes: 2 },
      { socio: "Álvaro", puesto: 45.75, apuntes: 1 },
    ]);
  });

  it("no cuenta los gastos que no puso nadie", () => {
    // La nómina de 900 € la paga la empresa, no un socio: no puede aparecer
    // como dinero que alguien ha puesto.
    expect(porSocio(LIBRO).some((s) => s.puesto === 900)).toBe(false);
  });

  it("los ingresos no cuentan aunque traigan socio", () => {
    // La base no lo permite, pero el cálculo tampoco debe depender de ello.
    expect(porSocio([{ categoria: "ingreso", importe: 50, socio_nombre: "Javi N" }])).toEqual([]);
  });

  it("un nombre en blanco no crea un socio fantasma", () => {
    expect(porSocio([{ categoria: "gasto", importe: 50, socio_nombre: "   " }])).toEqual([]);
  });
});

describe("porConcepto", () => {
  it("agrupa por concepto y categoría", () => {
    expect(porConcepto(LIBRO)).toEqual([
      { concepto: "Nómina", categoria: "gasto", total: 900, apuntes: 1 },
      { concepto: "Materiales", categoria: "gasto", total: 100, apuntes: 2 },
      { concepto: "Arreglos", categoria: "gasto", total: 45.75, apuntes: 1 },
      { concepto: "Metros", categoria: "ingreso", total: 340, apuntes: 1 },
      { concepto: "Camisetas", categoria: "ingreso", total: 135.75, apuntes: 2 },
    ]);
  });

  it("no mezcla un mismo nombre usado en las dos categorías", () => {
    const traspasos: ApunteCaja[] = [
      { categoria: "ingreso", importe: 100, concepto_nombre: "Traspaso" },
      { categoria: "gasto", importe: 40, concepto_nombre: "Traspaso" },
    ];
    expect(porConcepto(traspasos)).toEqual([
      { concepto: "Traspaso", categoria: "gasto", total: 40, apuntes: 1 },
      { concepto: "Traspaso", categoria: "ingreso", total: 100, apuntes: 1 },
    ]);
  });

  it("un apunte sin concepto no desaparece de los totales", () => {
    expect(porConcepto([{ categoria: "gasto", importe: 10 }])).toEqual([
      { concepto: "Sin concepto", categoria: "gasto", total: 10, apuntes: 1 },
    ]);
  });
});
