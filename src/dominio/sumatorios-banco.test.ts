import { describe, expect, it } from "vitest";
import { porSocio } from "./caja";
import { totalesEnlaces, totalPuestoSocios } from "./sumatorios-banco";

describe("totalPuestoSocios", () => {
  it("suma lo puesto por cada socio, no los gastos que paga la empresa", () => {
    const socios = porSocio([
      { categoria: "gasto", importe: 80.1, socio_nombre: "Javi C" },
      { categoria: "gasto", importe: 20.2, socio_nombre: "Javi C" },
      { categoria: "gasto", importe: 45.75, socio_nombre: "Álvaro" },
      { categoria: "gasto", importe: 900 }, // la paga la empresa
      { categoria: "ingreso", importe: 300 },
    ]);
    expect(totalPuestoSocios(socios)).toEqual({ puesto: 146.05, apuntes: 3 });
  });

  it("sin socios, ceros", () => {
    expect(totalPuestoSocios([])).toEqual({ puesto: 0, apuntes: 0 });
  });
});

describe("totalesEnlaces", () => {
  const movs = new Map([
    ["m1", { importe: 121 }],
    ["m2", { importe: -60.5 }],
    ["m3", { importe: -39.5 }],
    ["m4", { importe: "10.10" }],
  ]);

  it("separa abonos y cargos y da el neto", () => {
    const t = totalesEnlaces(
      [
        { movimientos: ["m1"], diferencia: 0 },
        // Una factura recibida pagada en dos cargos.
        { movimientos: ["m2", "m3"], diferencia: 0 },
      ],
      movs,
    );
    expect(t).toEqual({
      n: 3,
      entradas: 121,
      salidas: 100,
      neto: 21,
      enlaces: 2,
      movimientos: 3,
      sinImporte: 0,
      diferencia: 0,
    });
  });

  it("un movimiento en dos enlaces se suma una sola vez", () => {
    const t = totalesEnlaces(
      [
        { movimientos: ["m1", "m4"], diferencia: 0 },
        { movimientos: ["m4"], diferencia: 0 },
      ],
      movs,
    );
    expect(t.movimientos).toBe(2);
    expect(t.entradas).toBe(131.1);
  });

  it("los movimientos que no han llegado se cuentan aparte y no suman", () => {
    const t = totalesEnlaces([{ movimientos: ["m1", "viejo"], diferencia: 0 }], movs);
    expect(t.movimientos).toBe(2);
    expect(t.sinImporte).toBe(1);
    expect(t.n).toBe(1);
    expect(t.neto).toBe(121);
  });

  it("suma la diferencia de cada enlace con su signo, al céntimo", () => {
    const t = totalesEnlaces(
      [
        { movimientos: ["m1"], diferencia: 0.1 },
        { movimientos: ["m2"], diferencia: "0.2" },
        { movimientos: ["m3"], diferencia: -0.05 },
        { movimientos: ["m4"], diferencia: null },
      ],
      movs,
    );
    expect(t.diferencia).toBe(0.25);
  });

  it("sin enlaces, ceros", () => {
    expect(totalesEnlaces([], movs)).toEqual({
      n: 0,
      entradas: 0,
      salidas: 0,
      neto: 0,
      enlaces: 0,
      movimientos: 0,
      sinImporte: 0,
      diferencia: 0,
    });
  });
});
