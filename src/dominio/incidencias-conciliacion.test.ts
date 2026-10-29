import { describe, expect, it } from "vitest";
import {
  DIAS_SIN_BANCO,
  incidenciasConciliacion,
  MAX_DOCUMENTOS,
  movimientosRepetidos,
  type DatosIncidencias,
} from "./incidencias-conciliacion";

const mov = (id: string, importe: number, fecha = "2026-10-01", concepto = "X", cuenta = "c1") => ({
  id,
  fecha,
  concepto,
  importe,
  cuenta_id: cuenta,
});

const datos = (p: Partial<DatosIncidencias> = {}): DatosIncidencias => ({
  hoy: "2026-10-29",
  movimientos: [],
  plan: { verdes: [], ambares: [], traspasos: [] },
  documentos: [],
  porRevisar: 0,
  diferencias: [],
  recibos: [],
  extractos: [],
  ...p,
});

const tipos = (d: DatosIncidencias) => incidenciasConciliacion(d).map((i) => i.tipo);

describe("incidenciasConciliacion", () => {
  it("sin nada pendiente, no hay nada que resolver", () => {
    expect(incidenciasConciliacion(datos())).toEqual([]);
  });

  it("un extracto con saldos que no cuadra dice cuánto falta; sin saldos, nada", () => {
    const extracto = {
      id: "e1",
      fichero: "bbva.xlsx",
      desde: "2026-09-01",
      hasta: "2026-09-30",
      saldo_inicial: 1000,
      saldo_final: 1200,
      suma_movimientos: 150,
      cuadra: false,
    };
    const [i] = incidenciasConciliacion(datos({ extractos: [extracto] }));
    expect(i).toMatchObject({ tipo: "extracto", gravedad: "error", diferencia: 50 });
    expect(
      incidenciasConciliacion(datos({ extractos: [{ ...extracto, saldo_inicial: null }] })),
    ).toEqual([]);
  });

  it("movimientos iguales en la misma cuenta y día", () => {
    const movs = [
      mov("a", -30, "2026-10-01", "SEUR ENVIOS"),
      mov("b", -30, "2026-10-01", "Seur  envíos"),
      mov("c", -30, "2026-10-01", "SEUR ENVIOS", "c2"),
    ];
    expect(movimientosRepetidos(movs).map((g) => g.map((m) => m.id))).toEqual([["a", "b"]]);
  });

  it("cobros y pagos sin factura, agrupados, solo pasados unos días y sin propuesta", () => {
    const movs = [
      mov("cobro", 50, "2026-10-01"),
      mov("pago", -20, "2026-10-01", "LUZ"),
      mov("reciente", -10, "2026-10-28", "AYER"),
      mov("propuesto", -15, "2026-10-01", "SEUR"),
    ];
    const plan = {
      verdes: [
        {
          movimientos: ["propuesto"],
          documentos: [],
          estado: "conciliada" as const,
          motivo: "contraparte" as const,
          diferencia: 0,
        },
      ],
      ambares: [],
      traspasos: [],
    };
    const lista = incidenciasConciliacion(datos({ movimientos: movs, plan }));
    const pagos = lista.find((i) => i.tipo === "pagos_sin_factura")!;
    expect(pagos.ref.movimientos).toEqual(["pago"]);
    expect(pagos.importe).toBe(-20);
    expect(lista.find((i) => i.tipo === "cobros_sin_factura")!.n).toBe(1);
  });

  it("un enlace cobrado en parte dice lo que falta; uno que sobra, que difiere", () => {
    const doc = {
      tipo: "factura" as const,
      id: "f1",
      fecha: "2026-10-01",
      esperado: 300,
      contraparte: "Cliente",
      nif: null,
      referencia: "2026/0001",
    };
    const lista = incidenciasConciliacion(
      datos({
        diferencias: [
          { grupo: "g1", diferencia: -100, movimientos: [mov("m", 200)], documentos: [doc] },
          { grupo: "g2", diferencia: 2.5, movimientos: [mov("n", 302.5)], documentos: [doc] },
        ],
      }),
    );
    expect(lista.find((i) => i.ref.grupo === "g1")).toMatchObject({
      tipo: "parcial",
      diferencia: 100,
    });
    expect(lista.find((i) => i.ref.grupo === "g2")).toMatchObject({
      tipo: "diferencia",
      diferencia: 2.5,
    });
  });

  it("facturas sin movimiento pasado el plazo, las más antiguas y como mucho unas cuantas", () => {
    const doc = (id: string, dias: number) => ({
      tipo: "factura" as const,
      id,
      fecha: new Date(Date.parse("2026-10-29") - dias * 86_400_000).toISOString().slice(0, 10),
      esperado: 10,
      contraparte: null,
      nif: null,
      referencia: null,
    });
    expect(tipos(datos({ documentos: [doc("nueva", DIAS_SIN_BANCO - 1)] }))).toEqual([]);
    const muchas = Array.from({ length: MAX_DOCUMENTOS + 3 }, (_, i) =>
      doc(`d${i}`, DIAS_SIN_BANCO + 1 + i),
    );
    const lista = incidenciasConciliacion(datos({ documentos: muchas }));
    expect(lista.filter((i) => i.tipo === "documento_sin_banco")).toHaveLength(MAX_DOCUMENTOS);
    expect(lista.find((i) => i.tipo === "documentos_sin_banco_mas")!.n).toBe(3);
  });

  it("los errores van antes que los avisos", () => {
    const lista = tipos(
      datos({
        porRevisar: 2,
        recibos: [{ id: "r", fecha: "2026-10-05", importe: 828.71, diferencia: 5, cuenta: "T" }],
      }),
    );
    expect(lista).toEqual(["recibo_tarjeta", "por_revisar"]);
  });
});
