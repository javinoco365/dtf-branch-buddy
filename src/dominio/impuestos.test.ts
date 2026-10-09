import { describe, expect, it } from "vitest";
import { gastosFijosDelRango, type GastoFijo } from "./gerencia";
import {
  calendarioTrimestre,
  cargosDelRango,
  compensar303,
  cuentaResultados,
  impuestosDeCargos,
  impuestosPorTrimestre,
  inicioCompensacion,
  inicioHistorial303,
  trimestresDelRango,
  pagoFraccionado,
  plazoTrimestre,
  trimestreDe,
} from "./impuestos";
import { resumenIva, type CompraResumen, type DocumentoFiscal } from "./fiscal";

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
      primeraVenta: "2026-09-30",
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

  describe("canjes de ticket por factura, cada paso en su fecha", () => {
    const doc = (
      id: string,
      tipo: "ordinaria" | "simplificada" | "rectificativa",
      fecha: string,
      base: number,
      extra: Partial<DocumentoFiscal> = {},
    ): DocumentoFiscal => ({
      id,
      tipo,
      estado: "emitida",
      fecha,
      tienda_id: "t",
      base,
      iva: base * 0.21,
      total: base * 1.21,
      ...extra,
    });
    const primerSemestre = { desde: d(2026, 1, 1), hasta: new Date(2026, 5, 30, 23, 59, 59) };
    const repercutido = (documentos: DocumentoFiscal[]) =>
      impuestosPorTrimestre({
        rango: primerSemestre,
        documentos,
        compras: [],
        gastos: [],
        cuotaIsAnterior: null,
        primeraVenta: "2026-01-01",
      }).map((t) => t.ivaRepercutido);

    const ticket = doc("t1", "simplificada", "2026-02-10", 1000);
    const canje = doc("f1", "ordinaria", "2026-02-10", 1000, { sustituye_a_id: "t1" });
    const anulacion = doc("r1", "rectificativa", "2026-04-02", -1000, { rectifica_a_id: "f1" });

    it("canje sin anular: 210 en el primer trimestre, no 420", () => {
      expect(repercutido([ticket, canje])).toEqual([210, 0]);
      // Con la factura en el trimestre siguiente: el ticket en el suyo y la
      // factura, que lo sustituye, no suma en el suyo.
      expect(repercutido([ticket, { ...canje, fecha: "2026-04-03" }])).toEqual([210, 0]);
    });

    it("el ejemplo: la rectificativa que anula el canje en el segundo trimestre deja T1 = 210 y T2 = 0", () => {
      expect(repercutido([ticket, canje, anulacion])).toEqual([210, 0]);
    });

    it("lo mismo en el textil", () => {
      const textil = (x: DocumentoFiscal) => ({ ...x, tienda_id: "textil-personalizado" });
      expect(repercutido([ticket, canje, anulacion].map(textil))).toEqual([210, 0]);
    });

    it("Fiscal y Resultados dan lo mismo en cualquier periodo", () => {
      const todos = [
        ticket,
        canje,
        anulacion,
        // Otro canje sin anular, con el ticket en marzo y la factura en mayo.
        doc("t2", "simplificada", "2026-03-20", 500),
        doc("f2", "ordinaria", "2026-05-04", 500, { sustituye_a_id: "t2" }),
        doc("v", "ordinaria", "2026-06-01", 100),
      ];
      const porId = new Map(todos.map((x) => [x.id, x]));
      // Fiscal lee los del periodo y, por id, el ticket de cada canje y la
      // factura (y su ticket) de cada rectificativa.
      const fiscal = (desde: string, hasta: string) => {
        const delPeriodo = todos.filter((x) => x.fecha >= desde && x.fecha <= hasta);
        const referencias: DocumentoFiscal[] = [];
        let ultimos = delPeriodo;
        while (ultimos.length) {
          const nuevos = ultimos
            .flatMap((x) => [x.sustituye_a_id, x.rectifica_a_id])
            .flatMap((id) => (id && porId.has(id) ? [porId.get(id)!] : []))
            .filter((x) => !delPeriodo.includes(x) && !referencias.includes(x));
          referencias.push(...nuevos);
          ultimos = nuevos;
        }
        return resumenIva(delPeriodo, referencias).repercutido.iva;
      };
      const [t1, t2] = repercutido(todos);
      expect(fiscal("2026-01-01", "2026-03-31")).toBe(t1);
      expect(fiscal("2026-04-01", "2026-06-30")).toBe(t2);
      expect(t1).toBe(315);
      expect(t2).toBe(21);
      // Y un periodo cualquiera es la suma de sus partes.
      expect(fiscal("2026-01-01", "2026-06-30")).toBe(t1 + t2);
      expect(fiscal("2026-02-01", "2026-04-30")).toBe(
        fiscal("2026-02-01", "2026-02-28") +
          fiscal("2026-03-01", "2026-03-31") +
          fiscal("2026-04-01", "2026-04-30"),
      );
    });
  });
});

describe("compensación del 303", () => {
  const q = (anio: number, numero: 1 | 2 | 3 | 4) => ({ anio, numero });
  const compensar = (...r: [ReturnType<typeof q>, number][]) =>
    compensar303(r.map(([trimestre, resultado]) => ({ trimestre, resultado })));

  it("T1 −300, T2 +500: el segundo paga 200", () => {
    const [t1, t2] = compensar([q(2026, 1), -300], [q(2026, 2), 500]);
    expect(t1).toEqual({
      resultado: -300,
      compensado: 0,
      aIngresar: 0,
      pendiente: 300,
      trimestresPendientes: 1,
      pendienteDesde: { anio: 2026, numero: 1 },
    });
    expect(t2).toEqual({
      resultado: 500,
      compensado: 300,
      aIngresar: 200,
      pendiente: 0,
      trimestresPendientes: 0,
      pendienteDesde: null,
    });
  });

  it("T1 −300, T2 +100, T3 +400: el segundo no paga y quedan 200; el tercero paga 200", () => {
    const [, t2, t3] = compensar([q(2026, 1), -300], [q(2026, 2), 100], [q(2026, 3), 400]);
    expect(t2).toMatchObject({ compensado: 100, aIngresar: 0, pendiente: 200 });
    expect(t3).toMatchObject({ compensado: 200, aIngresar: 200, pendiente: 0 });
  });

  it("se arrastra al año siguiente", () => {
    const [, t] = compensar([q(2026, 4), -300], [q(2027, 1), 100]);
    expect(t).toMatchObject({ compensado: 100, aIngresar: 0, pendiente: 200 });
  });

  it("varios negativos se acumulan y se gasta primero el más antiguo", () => {
    const [, t2, t3] = compensar([q(2026, 1), -100], [q(2026, 2), -50], [q(2026, 3), 120.5]);
    expect(t2).toMatchObject({ aIngresar: 0, pendiente: 150, trimestresPendientes: 2 });
    expect(t3).toMatchObject({
      compensado: 120.5,
      aIngresar: 0,
      pendiente: 29.5,
      trimestresPendientes: 1,
      // Lo que queda es del segundo: el del primero ya se gastó.
      pendienteDesde: { anio: 2026, numero: 2 },
    });
  });

  it("lo pendiente caduca a los cuatro años", () => {
    const [, a, b] = compensar([q(2026, 1), -100], [q(2030, 1), 50], [q(2030, 2), 50]);
    // El primero de 2030 aún está en plazo; el segundo, no.
    expect(a).toMatchObject({ compensado: 50, aIngresar: 0, pendiente: 50 });
    expect(b).toMatchObject({ compensado: 0, aIngresar: 50, pendiente: 0 });
  });

  it("un trimestre a cero no compensa ni deja nada", () => {
    const [, t] = compensar([q(2026, 1), -10], [q(2026, 2), 0]);
    expect(t).toMatchObject({ compensado: 0, aIngresar: 0, pendiente: 10 });
  });
});

describe("impuestos por trimestre con el 303 compensado", () => {
  const venta = (fecha: string, iva: number): DocumentoFiscal => ({
    id: `v-${fecha}`,
    tipo: "ordinaria",
    estado: "emitida",
    fecha,
    tienda_id: "t",
    base: iva / 0.21,
    iva,
    total: iva / 0.21 + iva,
  });
  // Una compra con IVA y una retención de profesional, que va al 111.
  const compra = (fecha: string, iva: number, irpf = 0): CompraResumen => ({
    id: `c-${fecha}`,
    estado: "registrada",
    fecha,
    base: iva / 0.21,
    iva,
    irpf,
    total: iva / 0.21 + iva - irpf,
  });
  const anio2026 = { desde: d(2026, 1, 1), hasta: new Date(2026, 11, 31, 23, 59, 59) };
  const segundo = { desde: d(2026, 4, 1), hasta: new Date(2026, 5, 30, 23, 59, 59) };
  const linea303 = (t: { lineas: { modelo: string; importe: number }[] }) =>
    t.lineas.find((l) => l.modelo === "303")?.importe;

  it("T1 −300, T2 +100, T3 +400: lo negativo se descuenta de los siguientes", () => {
    const t = impuestosPorTrimestre({
      rango: anio2026,
      documentos: [venta("2026-05-10", 100), venta("2026-08-10", 400)],
      compras: [compra("2026-02-10", 300, 50)],
      gastos: [],
      cuotaIsAnterior: null,
      // El CRM ya vendía en el primer trimestre (en otro periodo de lectura).
      primeraVenta: "2026-01-15",
    });
    expect(t.map(linea303)).toEqual([-300, 0, 200, 0]);
    expect(t.map((x) => x.compensacion.pendiente)).toEqual([300, 200, 0, 0]);
    // El 111 del primero no se compensa con el IVA: se paga.
    expect(t[0].lineas.find((l) => l.modelo === "111")?.importe).toBe(50);
    expect(t.map((x) => x.aPagar)).toEqual([50, 0, 200, 0]);
  });

  it("lo de antes del rango cuenta si se pasan sus datos", () => {
    const datos = {
      documentos: [venta("2026-05-10", 500)],
      compras: [compra("2026-02-10", 300)],
      gastos: [],
      cuotaIsAnterior: null,
      primeraVenta: "2025-06-01",
    };
    const conHistoria = impuestosPorTrimestre({
      ...datos,
      rango: segundo,
      datosDesde: inicioCompensacion(segundo),
    });
    // Solo sale el trimestre del rango, ya compensado: 500 − 300.
    expect(conHistoria).toHaveLength(1);
    expect(conHistoria[0].trimestre.numero).toBe(2);
    expect(linea303(conHistoria[0])).toBe(200);
    expect(conHistoria[0].compensacion).toMatchObject({ resultado: 500, compensado: 300 });
    expect(conHistoria[0].aPagar).toBe(200);

    // Sin decir desde cuándo hay datos, no se arrastra nada de fuera del rango.
    expect(linea303(impuestosPorTrimestre({ ...datos, rango: segundo })[0])).toBe(500);
    // Un trimestre a medias no se arrastra: no se sabe lo que falta.
    expect(
      linea303(impuestosPorTrimestre({ ...datos, rango: segundo, datosDesde: d(2026, 2, 15) })[0]),
    ).toBe(500);
  });

  it("los datos se leen desde cuatro años antes del primer trimestre del rango", () => {
    expect(inicioCompensacion({ desde: d(2026, 11, 5) })).toEqual(d(2022, 10, 1));
    expect(inicioCompensacion({ desde: d(2026, 1, 1) })).toEqual(d(2022, 1, 1));
  });
});

describe("el 303 solo se compensa desde la primera venta del CRM", () => {
  // El ejemplo: alquiler de 1.000 € al mes con IVA desde el 1-1-2025 y una
  // sola venta, con 2.000 € de IVA, el 5-10-2026.
  const local: GastoFijo = { ...alquiler, desde: "2025-01-01" };
  const venta: DocumentoFiscal = {
    id: "v",
    tipo: "ordinaria",
    estado: "emitida",
    fecha: "2026-10-05",
    tienda_id: "t",
    base: 9523.81,
    iva: 2000,
    total: 11523.81,
  };
  const anio2026 = { desde: d(2026, 1, 1), hasta: new Date(2026, 11, 31, 23, 59, 59) };
  const linea303 = (t: { lineas: { modelo: string; importe: number }[] }) =>
    t.lineas.find((l) => l.modelo === "303")?.importe;
  const calcular = (
    primeraVenta: string | null,
    rango: { desde: Date; hasta: Date } = q4,
    documentos: DocumentoFiscal[] = [venta],
  ) =>
    impuestosPorTrimestre({
      rango,
      documentos,
      compras: [],
      gastos: [local],
      cuotaIsAnterior: null,
      datosDesde: inicioCompensacion(rango),
      primeraVenta,
    });

  it("el alquiler de antes de la primera venta no se compensa: el 303 del cuarto es 1.370", () => {
    const [t] = calcular("2026-10-05");
    // 2.000 de IVA − 630 de tres alquileres; nada de antes.
    expect(t.compensacion).toMatchObject({
      resultado: 1370,
      compensado: 0,
      aIngresar: 1370,
      pendiente: 0,
      pendienteDesde: null,
    });
    expect(linea303(t)).toBe(1370);
    // A Hacienda este trimestre: 1.370 del 303 y 570 de retenciones del alquiler (115).
    expect(t.aPagar).toBe(1940);
    expect(t.sinVentas).toBe(false);
  });

  it("con ventas en el CRM desde 2025, lo soportado desde entonces sí se compensa", () => {
    const [t] = calcular("2025-01-01");
    // Siete trimestres de 630 a compensar: 4.410 − 1.370 = 3.040.
    expect(t.compensacion).toMatchObject({
      resultado: 1370,
      compensado: 1370,
      aIngresar: 0,
      pendiente: 3040,
    });
    expect(t.aPagar).toBe(570);
  });

  it("los trimestres de antes de la primera venta salen sin 303 y no dejan nada a compensar", () => {
    const anio = calcular("2026-10-05", anio2026);
    expect(anio.map((t) => t.sinVentas)).toEqual([true, true, true, false]);
    expect(anio.map(linea303)).toEqual([0, 0, 0, 1370]);
    expect(anio.map((t) => t.compensacion.pendiente)).toEqual([0, 0, 0, 0]);
    // El 115 del alquiler sí se paga cada trimestre.
    expect(anio.map((t) => t.aPagar)).toEqual([570, 570, 570, 1940]);
  });

  it("sin ninguna venta documentada no se calcula ningún 303", () => {
    const anio = calcular(null, anio2026, []);
    expect(anio.every((t) => t.sinVentas)).toBe(true);
    expect(anio.map(linea303)).toEqual([0, 0, 0, 0]);
    expect(anio.map((t) => t.aPagar)).toEqual([570, 570, 570, 570]);
  });

  it("desde qué trimestre se compensa, y por qué", () => {
    const datosDesde = inicioCompensacion(q4);
    expect(inicioHistorial303({ rango: q4, datosDesde, primeraVenta: null })).toBeNull();
    expect(inicioHistorial303({ rango: q4, datosDesde, primeraVenta: "2026-10-05" })).toMatchObject(
      { trimestre: { anio: 2026, numero: 4 }, motivo: "primera_venta" },
    );
    // Una primera venta de hace más de cuatro años: lo de antes ya habría caducado.
    expect(inicioHistorial303({ rango: q4, datosDesde, primeraVenta: "2020-03-01" })).toMatchObject(
      { trimestre: { anio: 2022, numero: 4 }, motivo: "datos" },
    );
    // Sin datos de antes del rango, desde el primer trimestre del rango.
    expect(inicioHistorial303({ rango: q4, primeraVenta: "2020-03-01" })).toMatchObject({
      trimestre: { anio: 2026, numero: 4 },
      motivo: "datos",
    });
  });
});
