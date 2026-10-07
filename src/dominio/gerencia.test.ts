import { describe, expect, it } from "vitest";
import {
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
      webSinPagar: { pedidos: 2, importe: 80 },
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
      webSinPagar: { pedidos: 0, importe: 0 },
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
