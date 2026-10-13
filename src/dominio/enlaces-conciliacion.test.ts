import { describe, expect, it } from "vitest";
import {
  agruparEnlaces,
  contarEnlaces,
  ordenarEnlaces,
  type FilaConciliacion,
} from "./enlaces-conciliacion";

type M = { id: string; fecha: string; importe: number };
type D = { tipo: string; id: string; fecha: string; importe: number };

const mov = (id: string, fecha: string, importe = 100): M => ({ id, fecha, importe });
const doc = (id: string, fecha: string, tipo = "factura", importe = 100): D => ({
  tipo,
  id,
  fecha,
  importe,
});

function fila(
  grupo: string,
  movimiento: M | null,
  documento: D | null,
  extra: Partial<FilaConciliacion<M, D>> = {},
): FilaConciliacion<M, D> {
  return {
    grupo,
    estado: "conciliada",
    motivo: "contraparte",
    diferencia: 0,
    movimiento,
    documento,
    ...extra,
  };
}

describe("agruparEnlaces", () => {
  it("una fila por grupo: un cargo que paga dos recibidas es un enlace con un movimiento y dos documentos", () => {
    const m = mov("m1", "2035-03-12", -90.75);
    const [e, ...resto] = agruparEnlaces([
      fila("g1", m, doc("c2", "2035-03-02", "compra", 30.25), {
        estado: "revisar",
        motivo: "suma_documentos",
      }),
      fila("g1", m, doc("c1", "2035-03-01", "compra", 60.5), {
        estado: "revisar",
        motivo: "suma_documentos",
      }),
    ]);
    expect(resto).toHaveLength(0);
    expect(e.movimientos).toEqual([m]);
    expect(e.documentos.map((d) => d.id)).toEqual(["c1", "c2"]);
    expect(e.estado).toBe("revisar");
    expect(e.fecha).toBe("2035-03-12");
  });

  it("una factura pagada en dos movimientos: el documento una vez y la fecha la del último movimiento", () => {
    const d = doc("f1", "2035-03-01");
    const [e] = agruparEnlaces([
      fila("g1", mov("m2", "2035-03-20", 50), d),
      fila("g1", mov("m1", "2035-03-10", 50), d),
    ]);
    expect(e.documentos).toEqual([d]);
    expect(e.movimientos.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(e.fecha).toBe("2035-03-20");
  });

  it("si alguna fila sigue «por revisar», el grupo entero lo está; motivo y diferencia, los menores", () => {
    const [e] = agruparEnlaces([
      fila("g1", mov("m1", "2035-03-10"), doc("f1", "2035-03-01"), {
        motivo: "suma_movimientos",
        diferencia: 0.01,
      }),
      fila("g1", mov("m2", "2035-03-11"), doc("f1", "2035-03-01"), {
        estado: "revisar",
        motivo: "importe_fecha",
        diferencia: -0.01,
      }),
    ]);
    expect(e.estado).toBe("revisar");
    expect(e.motivo).toBe("importe_fecha");
    expect(e.diferencia).toBe(-0.01);
  });

  it("una fila cuyo movimiento no se ve no cuenta, ni su documento (como banco_enlaces)", () => {
    expect(agruparEnlaces([fila("g1", null, doc("f1", "2035-03-01"))])).toEqual([]);
  });

  it("un documento que no se ve deja el enlace con sus movimientos y sin él", () => {
    const [e] = agruparEnlaces([fila("g1", mov("m1", "2035-03-10"), null)]);
    expect(e.movimientos).toHaveLength(1);
    expect(e.documentos).toEqual([]);
  });

  it("los ids se comparan con su tipo: una recibida y una factura no se pisan", () => {
    const [e] = agruparEnlaces([
      fila("g1", mov("m1", "2035-03-10"), doc("x", "2035-03-01", "compra")),
      fila("g1", mov("m1", "2035-03-10"), doc("x", "2035-03-01", "factura")),
    ]);
    expect(e.documentos).toHaveLength(2);
  });

  it("los más recientes primero y, a igual fecha, por grupo", () => {
    const enlaces = agruparEnlaces([
      fila("b", mov("m1", "2035-03-10"), doc("f1", "2035-03-01")),
      fila("c", mov("m2", "2035-04-01"), doc("f2", "2035-03-01")),
      fila("a", mov("m3", "2035-03-10"), doc("f3", "2035-03-01")),
    ]);
    expect(enlaces.map((e) => e.grupo)).toEqual(["c", "a", "b"]);
  });
});

describe("ordenarEnlaces", () => {
  it("no cambia la lista que recibe", () => {
    const lista = [
      { grupo: "a", fecha: "2035-01-01" },
      { grupo: "b", fecha: "2035-02-01" },
    ];
    expect(ordenarEnlaces(lista).map((e) => e.grupo)).toEqual(["b", "a"]);
    expect(lista[0].grupo).toBe("a");
  });
});

describe("contarEnlaces", () => {
  it("cuenta grupos, no filas: un grupo de dos filas es un enlace", () => {
    expect(
      contarEnlaces([
        { grupo: "a", estado: "conciliada" },
        { grupo: "a", estado: "conciliada" },
        { grupo: "b", estado: "conciliada" },
        { grupo: "c", estado: "revisar" },
      ]),
    ).toEqual({ revisar: 1, conciliados: 2 });
  });

  it("un grupo con alguna fila por revisar está por revisar, venga antes o después", () => {
    expect(
      contarEnlaces([
        { grupo: "a", estado: "conciliada" },
        { grupo: "a", estado: "revisar" },
        { grupo: "b", estado: "revisar" },
        { grupo: "b", estado: "conciliada" },
      ]),
    ).toEqual({ revisar: 2, conciliados: 0 });
  });

  it("sin enlaces, cero y cero", () => {
    expect(contarEnlaces([])).toEqual({ revisar: 0, conciliados: 0 });
  });
});
