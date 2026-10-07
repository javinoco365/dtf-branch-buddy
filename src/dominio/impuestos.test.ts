import { describe, expect, it } from "vitest";
import { gastosFijosDelRango, type GastoFijo } from "./gerencia";
import {
  calendarioTrimestre,
  cargosDelRango,
  cuentaResultados,
  impuestosDeCargos,
  impuestosPorTrimestre,
  trimestresDelRango,
  pagoFraccionado,
  plazoTrimestre,
  trimestreDe,
} from "./impuestos";

const d = (a: number, m: number, dia: number, h = 0) => new Date(a, m - 1, dia, h);
const q4 = { desde: d(2026, 10, 1), hasta: new Date(2026, 11, 31, 23, 59, 59) };

const alquiler: GastoFijo = {
  id: "a",
  concepto: "Alquiler nave",
  importe_mensual: 1000,
  desde: "2026-10-01",
  hasta: null,
  periodicidad: "mensual",
  tipo: "alquiler",
  iva_pct: 21,
  irpf_pct: 19,
};

describe("el ejemplo del alquiler", () => {
  it("1.000 de base: se pagan 1.020 al casero, 190 a Hacienda, 210 de IVA se recuperan", () => {
    const [c] = cargosDelRango([alquiler], { desde: d(2026, 10, 1), hasta: d(2026, 10, 31) });
    expect(c).toMatchObject({ base: 1000, iva: 210, irpf: 190, aPagar: 1020, fecha: "2026-10-01" });
    // El coste del mes es la base.
    expect(
      gastosFijosDelRango([alquiler], { desde: d(2026, 10, 1), hasta: d(2026, 10, 31, 23) }),
    ).toBe(1000);
  });
});

describe("cargos según la periodicidad", () => {
  it("mensual, trimestral, anual y puntual", () => {
    const g = (periodicidad: GastoFijo["periodicidad"], desde: string): GastoFijo => ({
      ...alquiler,
      id: periodicidad ?? "m",
      periodicidad,
      desde,
      tipo: "otros",
      irpf_pct: 0,
    });
    const c = cargosDelRango(
      [
        g("mensual", "2026-08-31"),
        g("trimestral", "2026-07-15"),
        g("anual", "2026-11-02"),
        g("puntual", "2026-12-24"),
      ],
      q4,
    );
    expect(c.filter((x) => x.gasto_id === "mensual").map((x) => x.fecha)).toEqual([
      "2026-10-31",
      "2026-11-30",
      "2026-12-31",
    ]);
    expect(c.filter((x) => x.gasto_id === "trimestral").map((x) => x.fecha)).toEqual([
      "2026-10-15",
    ]);
    expect(c.filter((x) => x.gasto_id === "anual").map((x) => x.fecha)).toEqual(["2026-11-02"]);
    expect(c.filter((x) => x.gasto_id === "puntual").map((x) => x.fecha)).toEqual(["2026-12-24"]);
  });

  it("no se cobra después de la baja", () => {
    const c = cargosDelRango([{ ...alquiler, hasta: "2026-11-15" }], q4);
    expect(c.map((x) => x.fecha)).toEqual(["2026-10-01", "2026-11-01"]);
  });

  it("el coste se reparte: un trimestral entre tres meses, un anual entre doce", () => {
    const oct = { desde: d(2026, 10, 1), hasta: d(2026, 10, 31, 23) };
    const trimestral = { ...alquiler, periodicidad: "trimestral" as const, importe_mensual: 300 };
    const anual = { ...alquiler, periodicidad: "anual" as const, importe_mensual: 1200 };
    const puntual = {
      ...alquiler,
      periodicidad: "puntual" as const,
      importe_mensual: 50,
      desde: "2026-10-10",
    };
    expect(gastosFijosDelRango([trimestral], oct)).toBe(100);
    expect(gastosFijosDelRango([anual], oct)).toBe(100);
    expect(gastosFijosDelRango([puntual], oct)).toBe(50);
    expect(gastosFijosDelRango([puntual], { desde: d(2026, 11, 1), hasta: d(2026, 11, 30) })).toBe(
      0,
    );
  });
});

describe("impuestos de los gastos", () => {
  it("el IRPF del alquiler va al 115; el de profesionales y nóminas, al 111", () => {
    const gestoria: GastoFijo = {
      ...alquiler,
      id: "g",
      tipo: "profesional",
      importe_mensual: 100,
      irpf_pct: 15,
    };
    const i = impuestosDeCargos(cargosDelRango([alquiler, gestoria], q4));
    expect(i).toEqual({ base: 3300, ivaSoportado: 693, irpf111: 45, irpf115: 570, aPagar: 3378 });
  });

  it("un gasto sin justificante no lleva IVA ni retención: se paga la base", () => {
    const enMano: GastoFijo = { ...alquiler, id: "m", con_justificante: false };
    const i = impuestosDeCargos(cargosDelRango([enMano], q4));
    expect(i).toEqual({ base: 3000, ivaSoportado: 0, irpf111: 0, irpf115: 0, aPagar: 3000 });
  });
});

describe("calendario fiscal", () => {
  it("trimestres y plazos", () => {
    const t = trimestreDe(d(2026, 11, 5));
    expect(t.numero).toBe(4);
    expect(plazoTrimestre(t, "303")).toEqual(d(2027, 1, 30));
    expect(plazoTrimestre(t, "115")).toEqual(d(2027, 1, 20));
    expect(plazoTrimestre(trimestreDe(d(2026, 2, 1)), "303")).toEqual(d(2026, 4, 20));
  });

  it("sin modelo 200 presentado no hay 202; con él, 18 % de la cuota", () => {
    expect(pagoFraccionado(null)).toBe(0);
    expect(pagoFraccionado(1000)).toBe(180);
  });

  it("el cuarto trimestre lleva 303, 111, 115 y los 202 de octubre y diciembre", () => {
    const l = calendarioTrimestre({
      trimestre: trimestreDe(d(2026, 11, 5)),
      ivaRepercutido: 2100,
      ivaSoportado: 693,
      irpf111: 45,
      irpf115: 570,
      cuotaIsAnterior: 1000,
    });
    expect(l.map((x) => [x.modelo, x.importe])).toEqual([
      ["303", 1407],
      ["111", 45],
      ["115", 570],
      ["202", 180],
      ["202", 180],
    ]);
    // El primero no tiene ningún 202.
    expect(
      calendarioTrimestre({
        trimestre: trimestreDe(d(2026, 2, 1)),
        ivaRepercutido: 0,
        ivaSoportado: 100,
        irpf111: 0,
        irpf115: 0,
        cuotaIsAnterior: 1000,
      }).map((x) => [x.modelo, x.importe]),
    ).toEqual([
      ["303", -100],
      ["111", 0],
      ["115", 0],
    ]);
  });
});

describe("cuenta de resultados", () => {
  it("de las ventas al beneficio neto, con Sociedades al 15 %", () => {
    expect(
      cuentaResultados({ ingresos: 10000, costesVariables: 3000, costesFijos: 2000, tipoIs: 15 }),
    ).toEqual({
      ingresos: 10000,
      costesVariables: 3000,
      margen: 7000,
      costesFijos: 2000,
      bai: 5000,
      impuestoSociedades: 750,
      beneficioNeto: 4250,
    });
  });

  it("con pérdidas no hay Sociedades", () => {
    const r = cuentaResultados({
      ingresos: 100,
      costesVariables: 50,
      costesFijos: 200,
      tipoIs: 15,
    });
    expect(r).toMatchObject({ bai: -150, impuestoSociedades: 0, beneficioNeto: -150 });
  });
});

describe("impuestos por trimestre", () => {
  it("los trimestres que toca un rango", () => {
    const t = trimestresDelRango({ desde: d(2026, 2, 15), hasta: d(2026, 7, 1) });
    expect(t.map((x) => x.numero)).toEqual([1, 2, 3]);
  });

  it("IVA de facturas, compras y gastos, y retenciones, por trimestre", () => {
    const [q] = impuestosPorTrimestre({
      rango: { desde: d(2026, 10, 1), hasta: d(2026, 10, 31) },
      documentos: [
        {
          id: "f",
          tipo: "ordinaria",
          estado: "emitida",
          fecha: "2026-11-03",
          tienda_id: "t",
          base: 10000,
          iva: 2100,
          total: 12100,
        },
        {
          id: "b",
          tipo: "ordinaria",
          estado: "borrador",
          fecha: "2026-11-03",
          tienda_id: "t",
          base: 999,
          iva: 999,
          total: 999,
        },
        {
          id: "x",
          tipo: "ordinaria",
          estado: "emitida",
          fecha: "2026-09-30",
          tienda_id: "t",
          base: 1,
          iva: 1,
          total: 1,
        },
      ],
      compras: [
        { estado: "registrada", base: 1000, iva: 210, total: 1210, fecha: "2026-12-01" },
        { estado: "borrador", base: 1000, iva: 210, total: 1210, fecha: "2026-12-01" },
      ],
      gastos: [alquiler],
      cuotaIsAnterior: null,
    });
    // Repercutido 2.100; soportado 210 de compras + 630 de tres alquileres.
    expect(q).toMatchObject({ ivaRepercutido: 2100, ivaSoportado: 840, irpf111: 0, irpf115: 570 });
    expect(q.lineas.map((l) => [l.modelo, l.importe])).toEqual([
      ["303", 1260],
      ["111", 0],
      ["115", 570],
    ]);
    expect(q.aPagar).toBe(1830);
  });
});
