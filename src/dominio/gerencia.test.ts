import { describe, expect, it } from "vitest";
import {
  AJUSTES_POR_DEFECTO,
  aplicarAjustesVentas,
  avanceObjetivo,
  beneficioEstimado,
  gastosFijosDelRango,
  objetivoDelRango,
  parteTranscurrida,
  type GastoFijo,
  type Objetivo,
  antiguedadPendientes,
  avisosGerencia,
  canalDelCobro,
  cobradoPorTramos,
  cifrasGerencia,
  desglose,
  diasMediosCobro,
  filtrarCobrosGerencia,
  filtrarPendientesGerencia,
  filtrarVentas,
  porDiaSemana,
  resumenBanco,
  ventaDeTextil,
  ventaDeTienda,
  webSinPagar,
  type Venta,
} from "./gerencia";
import { TIENDA_TEXTIL } from "./cobros";
import { redondear } from "./importes";
import type { PedidoPendiente } from "./pendientes";
import type { CobroConsolidado } from "./facturacion";

const tienda = (p: Partial<Venta> = {}): Venta =>
  ventaDeTienda({
    fecha_pedido: "2026-10-05T10:00:00.000Z",
    tienda_id: "t1",
    estado: "entregado",
    subtotal: 100,
    iva: 21,
    envio: 0,
    total: 121,
    metros_total: 10,
    origen: "woocommerce",
    cliente_id: "c1",
    ...p,
  });

const textil = (total = 60.5) =>
  ventaDeTextil({
    fecha: "2026-10-03",
    estado: "pendiente",
    subtotal: 50,
    iva: 10.5,
    envio: 0,
    total,
    cliente_id: "c2",
  });

describe("ventas de tienda y textil en una forma", () => {
  it("el canal sale del origen; el textil va con su propia «tienda» y sin metros", () => {
    expect(tienda().canal).toBe("web");
    expect(tienda({ origen: "manual" }).canal).toBe("manual");
    const t = textil();
    expect(t.canal).toBe("textil");
    expect(t.tienda_id).toBe(TIENDA_TEXTIL.id);
    expect(t.metros_total).toBe(0);
    expect(t.fecha_pedido).toBe("2026-10-03T12:00:00");
  });

  it("filtra por tienda y por canal", () => {
    const ventas = [tienda(), tienda({ origen: "manual", tienda_id: "t2" }), textil()];
    expect(filtrarVentas(ventas, { tienda: "todas", canal: "todos" })).toHaveLength(3);
    expect(filtrarVentas(ventas, { tienda: "t2", canal: "todos" })).toHaveLength(1);
    expect(filtrarVentas(ventas, { tienda: "todas", canal: "textil" })).toHaveLength(1);
    expect(filtrarVentas(ventas, { tienda: "t1", canal: "manual" })).toHaveLength(0);
  });
});

describe("cifrasGerencia", () => {
  it("suma tiendas y textil; el coste y el € por metro solo con lo que lleva metros", () => {
    const c = cifrasGerencia(
      [tienda({ coste_metro_snapshot: 1.5 }), textil()],
      9, // coste de hoy: no se usa, los dos tienen coste congelado o no tienen metros
    );
    expect(c.total).toBe(181.5);
    expect(c.bruta).toBe(150);
    expect(c.coste).toBe(15);
    expect(c.margen).toBe(135);
    expect(c.euroMetro).toBe(10);
  });

  it("la bruta va sin el envío cobrado, y el coste sin el de la agencia: el margen no cambia", () => {
    // 100 € de base con 10 € de envío dentro, 10 m a 1,5 €/m.
    const c = cifrasGerencia(
      [tienda({ subtotal: 100, envio: 10, iva: 21, total: 121, coste_metro_snapshot: 1.5 })],
      0,
    );
    expect(c.base).toBe(100);
    expect(c.envios).toBe(10);
    expect(c.bruta).toBe(90);
    expect(c.costeEnvios).toBe(10);
    expect(c.coste).toBe(15);
    // Igual que antes: 100 − 15 de producción − 10 de agencia.
    expect(c.margen).toBe(75);
    // El metro, sin el envío: 90 ÷ 10.
    expect(c.euroMetro).toBe(9);
  });

  it("sin metros, el € por metro es cero, no infinito", () => {
    expect(cifrasGerencia([textil()], 1).euroMetro).toBe(0);
  });
});

describe("desglose", () => {
  it("agrupa, ordena de más a menos y calcula el peso de cada uno", () => {
    const filas = desglose(
      [tienda(), tienda(), textil()],
      (v) => v.canal,
      new Map([
        ["web", "Web"],
        ["textil", "Textil"],
      ]),
      ["web", "manual", "textil"],
    );
    expect(filas.map((f) => f.clave)).toEqual(["web", "textil", "manual"]);
    expect(filas[0].vendido).toBe(242);
    expect(filas[0].peso).toBe(80);
    expect(filas[2]).toMatchObject({ nombre: "manual", pedidos: 0, vendido: 0, peso: 0 });
  });
});

describe("porDiaSemana", () => {
  it("de lunes a domingo, con los días sin ventas a cero", () => {
    // 5 de octubre de 2026, lunes; 3 de octubre, sábado.
    const dias = porDiaSemana([tienda(), textil()]);
    expect(dias.map((d) => d.dia)[0]).toBe("Lunes");
    expect(dias[0].vendido).toBe(121);
    expect(dias[5].vendido).toBe(60.5);
    expect(dias[2].vendido).toBe(0);
  });
});

const pendiente = (fecha: string, importe: number, p: Partial<PedidoPendiente> = {}) =>
  ({
    tipo: "tienda",
    id: fecha,
    tienda_id: "t1",
    numero: "N",
    fecha,
    cliente_id: null,
    cliente_nombre: null,
    origen: "manual",
    estado: "pendiente",
    total: importe,
    cobrado: 0,
    pendiente: importe,
    ultimo_cobro: null,
    ...p,
  }) as PedidoPendiente;

describe("antiguedadPendientes", () => {
  const hoy = new Date(2026, 9, 5);

  it("reparte lo que se debe en tramos por días desde el pedido", () => {
    const t = antiguedadPendientes(
      [
        pendiente("2026-10-01", 10),
        pendiente("2026-09-05", 20), // 30 días: aún en el primer tramo
        pendiente("2026-09-04", 30), // 31 días
        pendiente("2026-07-01", 40),
      ],
      hoy,
    );
    expect(t.map((x) => [x.clave, x.pedidos, x.pendiente])).toEqual([
      ["0-30", 2, 30],
      ["31-60", 1, 30],
      ["60+", 1, 40],
    ]);
  });

  it("los filtros de Gerencia valen también para lo pendiente", () => {
    const lista = [
      pendiente("2026-10-01", 10),
      pendiente("2026-10-01", 20, { origen: "woocommerce" }),
      pendiente("2026-10-01", 30, { tipo: "textil", tienda_id: null, origen: "textil" }),
    ];
    expect(filtrarPendientesGerencia(lista, { tienda: "todas", canal: "web" })).toHaveLength(1);
    expect(
      filtrarPendientesGerencia(lista, { tienda: TIENDA_TEXTIL.id, canal: "todos" }),
    ).toHaveLength(1);
  });
});

const cobro = (p: Partial<CobroConsolidado>) =>
  ({
    id: "x",
    fecha: "",
    fecha_cobro: "2026-10-10",
    fecha_pedido: "2026-10-01",
    tienda_id: "t1",
    pedido_id: "p",
    pedido_numero: "N",
    cliente: null,
    metodo: "transferencia",
    origen: "pedido",
    importe: 100,
    propina: 0,
    base: 0,
    iva: 0,
    envio: 0,
    metros: 0,
    ...p,
  }) as CobroConsolidado;

describe("diasMediosCobro", () => {
  it("pesa cada cobro por su importe", () => {
    // 900 € a 9 días y 100 € a 0 días: (900·9 + 100·0) / 1000 = 8,1
    const d = diasMediosCobro([
      cobro({ importe: 900 }),
      cobro({ importe: 100, fecha_cobro: "2026-10-01" }),
    ]);
    expect(d).toBe(8.1);
  });

  it("un cobro de un pedido sin fecha no cuenta, pero no rompe la media", () => {
    expect(diasMediosCobro([cobro({ importe: 100 }), cobro({ fecha_pedido: "" })])).toBe(9);
  });

  it("sin cobros no hay media", () => {
    expect(diasMediosCobro([])).toBeNull();
  });
});

describe("canal de los cobros", () => {
  it("web por el método, textil por la tienda, el resto manual", () => {
    expect(canalDelCobro(cobro({ metodo: "web" }))).toBe("web");
    expect(canalDelCobro(cobro({ tienda_id: TIENDA_TEXTIL.id }))).toBe("textil");
    expect(canalDelCobro(cobro({}))).toBe("manual");
    expect(
      filtrarCobrosGerencia([cobro({ metodo: "web" }), cobro({})], {
        tienda: "todas",
        canal: "web",
      }),
    ).toHaveLength(1);
  });
});

describe("resumenBanco", () => {
  it("separa entradas y salidas, y las entradas casadas de las que no", () => {
    const r = resumenBanco([
      { fecha: "2026-10-01", importe: 100, conciliado: true },
      { fecha: "2026-10-02", importe: "50.5", conciliado: false },
      { fecha: "2026-10-03", importe: -30, conciliado: false },
    ]);
    expect(r).toEqual({
      entradas: 150.5,
      salidas: 30,
      neto: 120.5,
      conciliadas: 100,
      sinConciliar: 50.5,
      movimientosSinConciliar: 1,
    });
  });
});

describe("avisos", () => {
  const tramos = antiguedadPendientes([pendiente("2026-07-01", 40)], new Date(2026, 9, 5));

  it("deuda de más de 60 días, caída de ventas, web sin pagar y banco sin casar", () => {
    const a = avisosGerencia({
      tramos,
      variacionVendido: -25,
      webSinPagar: { pedidos: 2, importe: 80, cuentan: true },
      banco: resumenBanco([{ fecha: "2026-10-01", importe: 10, conciliado: false }]),
    });
    expect(a.map((x) => x.tipo)).toEqual([
      "deuda_antigua",
      "caida_ventas",
      "web_sin_pagar",
      "banco_sin_casar",
    ]);
    expect(a[1]).toMatchObject({ porcentaje: 25 });
  });

  it("una caída pequeña, o una subida, no avisa", () => {
    const a = avisosGerencia({
      tramos: [],
      variacionVendido: -10,
      webSinPagar: { pedidos: 0, importe: 0, cuentan: true },
      banco: null,
    });
    expect(a).toEqual([]);
  });

  it("cuenta como web sin pagar solo lo web en estado pendiente", () => {
    expect(
      webSinPagar([
        tienda({ estado: "pendiente" }),
        tienda(),
        tienda({ origen: "manual", estado: "pendiente" }),
      ]),
    ).toEqual({ pedidos: 1, importe: 121 });
  });
});

describe("cobradoPorTramos", () => {
  it("reparte lo cobrado, sin propinas, en los tramos de la gráfica", () => {
    const tramos = [
      { desde: new Date(2026, 9, 1), hasta: new Date(2026, 9, 1, 23, 59) },
      { desde: new Date(2026, 9, 2), hasta: new Date(2026, 9, 2, 23, 59) },
    ];
    const r = cobradoPorTramos(
      [
        cobro({ fecha: "2026-10-01T12:00:00", importe: 50, propina: 5 }),
        cobro({ fecha: "2026-10-01T18:00:00", importe: 25 }),
      ],
      tramos,
    );
    expect(r).toEqual([75, 0]);
  });
});

describe("gastos fijos prorrateados", () => {
  const d = (a: number, m: number, dia: number, h = 0, mi = 0) => new Date(a, m - 1, dia, h, mi);
  const octubre = { desde: d(2026, 10, 1), hasta: d(2026, 10, 31, 23, 59) };
  const alquiler: GastoFijo = {
    id: "1",
    concepto: "Alquiler",
    importe_mensual: 800,
    desde: "2026-01-01",
    hasta: null,
  };

  it("un mes entero, el importe del mes", () => {
    expect(gastosFijosDelRango([alquiler], octubre)).toBe(800);
  });

  it("una quincena de un mes de 30 días, la mitad", () => {
    const r = { desde: d(2026, 9, 1), hasta: d(2026, 9, 15, 23, 59) };
    expect(gastosFijosDelRango([alquiler], r)).toBe(400);
  });

  it("solo los días en que el gasto está vigente", () => {
    // Del 1 al 10 de octubre: 10 de 31 días.
    const baja: GastoFijo = { ...alquiler, hasta: "2026-10-10" };
    expect(gastosFijosDelRango([baja], octubre)).toBe(258.06);
    // Empieza el 21: 11 de 31 días.
    const alta: GastoFijo = { ...alquiler, desde: "2026-10-21" };
    expect(gastosFijosDelRango([alta], octubre)).toBe(283.87);
  });

  it("un trimestre suma sus tres meses; un gasto que no toca el rango no suma", () => {
    const t = { desde: d(2026, 10, 1), hasta: d(2026, 12, 31, 23, 59) };
    const viejo: GastoFijo = { ...alquiler, id: "2", desde: "2025-01-01", hasta: "2025-12-31" };
    expect(gastosFijosDelRango([alquiler, viejo], t)).toBe(2400);
  });
});

describe("objetivos prorrateados", () => {
  const d = (a: number, m: number, dia: number, h = 0, mi = 0) => new Date(a, m - 1, dia, h, mi);
  const objetivos: Objetivo[] = [
    { id: "a", desde: "2026-01-01", metros: 1000, vendido: 8000 },
    { id: "b", desde: "2026-10-01", metros: 2000, vendido: null },
  ];

  it("cada mes con el objetivo que le toca", () => {
    const sep = objetivoDelRango(objetivos, {
      desde: d(2026, 9, 1),
      hasta: d(2026, 9, 30, 23, 59),
    });
    expect(sep).toEqual({ metros: 1000, vendido: 8000 });
    const oct = objetivoDelRango(objetivos, {
      desde: d(2026, 10, 1),
      hasta: d(2026, 10, 31, 23, 59),
    });
    // Desde octubre no hay objetivo de ventas: el nuevo objetivo no lo tiene.
    expect(oct).toEqual({ metros: 2000, vendido: null });
  });

  it("antes del primer objetivo no hay objetivo", () => {
    const r = objetivoDelRango(objetivos, { desde: d(2025, 6, 1), hasta: d(2025, 6, 30) });
    expect(r).toEqual({ metros: null, vendido: null });
  });

  it("un rango que cruza el cambio suma la parte de cada uno", () => {
    // Del 16 al 30 de septiembre (15 de 30 días) y del 1 al 15 de octubre (15 de 31).
    const r = objetivoDelRango(objetivos, {
      desde: d(2026, 9, 16),
      hasta: d(2026, 10, 15, 23, 59),
    });
    expect(r.metros).toBe(redondear(500 + (2000 * 15) / 31, 2));
  });

  it("qué parte del periodo ha pasado", () => {
    const oct = { desde: d(2026, 10, 1), hasta: d(2026, 10, 31, 23, 59) };
    expect(parteTranscurrida(oct, d(2026, 10, 5, 10))).toBeCloseTo(5 / 31);
    expect(parteTranscurrida(oct, d(2026, 11, 2))).toBe(1);
    expect(parteTranscurrida(oct, d(2026, 9, 20))).toBe(0);
  });
});

describe("pedidos web sin pagar según el ajuste", () => {
  it("cuentan por defecto; si se apaga, se quitan solo los web pendientes", () => {
    const ventas = [
      tienda({ estado: "pendiente" }),
      tienda(),
      tienda({ origen: "manual", estado: "pendiente" }),
    ];
    expect(aplicarAjustesVentas(ventas, AJUSTES_POR_DEFECTO)).toHaveLength(3);
    expect(aplicarAjustesVentas(ventas, { web_sin_pagar_cuenta: false })).toHaveLength(2);
  });
});

describe("avance contra objetivo", () => {
  it("porcentaje conseguido y diferencia con el ritmo que toca", () => {
    // A un tercio del mes, con 4.000 € de un objetivo de 15.000 €.
    expect(avanceObjetivo(4000, 15000, 1 / 3)).toEqual({
      porcentaje: 26.7,
      esperado: 5000,
      diferencia: -1000,
    });
    // Periodo terminado: lo esperado es el objetivo entero.
    expect(avanceObjetivo(16000, 15000, 1)).toMatchObject({ esperado: 15000, diferencia: 1000 });
  });

  it("sin objetivo no hay avance", () => {
    expect(avanceObjetivo(100, 0, 0.5)).toBeNull();
  });
});

describe("beneficio estimado", () => {
  it("margen menos los gastos fijos del rango", () => {
    const gastos = [
      { id: "a", concepto: "Alquiler", importe_mensual: 800, desde: "2026-01-01", hasta: null },
    ];
    const quincena = { desde: new Date(2026, 8, 1), hasta: new Date(2026, 8, 15, 23, 59) };
    expect(beneficioEstimado(1000, gastos, quincena)).toEqual({
      gastos: 400,
      beneficio: 600,
      hastaHoy: false,
    });
    expect(beneficioEstimado(100, gastos, quincena).beneficio).toBe(-300);
  });

  it("en un periodo en curso, los gastos solo hasta hoy", () => {
    const gastos = [
      { id: "a", concepto: "Alquiler", importe_mensual: 900, desde: "2026-01-01", hasta: null },
    ];
    const septiembre = { desde: new Date(2026, 8, 1), hasta: new Date(2026, 8, 30, 23, 59) };
    // El 10 de septiembre van 10 de 30 días: 300 €.
    expect(beneficioEstimado(1000, gastos, septiembre, new Date(2026, 8, 10, 9))).toEqual({
      gastos: 300,
      beneficio: 700,
      hastaHoy: true,
    });
    // Un periodo que aún no ha empezado no tiene gastos.
    expect(beneficioEstimado(0, gastos, septiembre, new Date(2026, 7, 20)).gastos).toBe(0);
  });
});
