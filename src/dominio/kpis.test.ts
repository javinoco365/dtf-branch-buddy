import { describe, expect, it } from "vitest";
import {
  agruparPorDia,
  agruparPorRangos,
  agruparPorTienda,
  calcularKpis,
  KPIS_VACIOS,
  topPorMetros,
  variacion,
  type PedidoResumen,
} from "./kpis";

function pedido(p: Partial<PedidoResumen> = {}): PedidoResumen {
  return {
    fecha_pedido: "2026-09-02T10:00:00.000Z",
    tienda_id: "t1",
    estado: "entregado",
    subtotal: 100,
    iva: 21,
    envio: 5,
    total: 126,
    metros_total: 10,
    ...p,
  };
}

describe("calcularKpis", () => {
  it("devuelve ceros sin pedidos, no marcadores", () => {
    expect(calcularKpis([])).toEqual(KPIS_VACIOS);
  });

  it("suma solo los pedidos no cancelados y cuenta los cancelados aparte", () => {
    const k = calcularKpis([
      pedido(),
      pedido({ subtotal: 50, iva: 10.5, envio: 0, total: 60.5, metros_total: 5 }),
      pedido({ estado: "cancelado", subtotal: 999, total: 999, metros_total: 99 }),
    ]);
    expect(k.pedidos).toBe(2);
    expect(k.bruta).toBe(150);
    expect(k.iva).toBe(31.5);
    expect(k.envios).toBe(5);
    expect(k.total).toBe(186.5);
    expect(k.metros).toBe(15);
    expect(k.cancelados).toBe(1);
  });

  it("calcula el ticket medio sobre los pedidos que facturan", () => {
    const k = calcularKpis([
      pedido({ total: 100 }),
      pedido({ total: 50 }),
      pedido({ estado: "cancelado", total: 1000 }),
    ]);
    expect(k.ticket).toBe(75);
  });

  it("no divide entre cero cuando todos los pedidos están cancelados", () => {
    const k = calcularKpis([pedido({ estado: "cancelado" })]);
    expect(k.ticket).toBe(0);
    expect(k.cancelados).toBe(1);
  });

  it("normaliza los numeric que Postgres entrega como cadena", () => {
    const k = calcularKpis([
      pedido({ subtotal: "52.50", iva: "11.03", total: "63.53", metros_total: "3.500" }),
    ]);
    expect(k.bruta).toBe(52.5);
    expect(k.iva).toBe(11.03);
    expect(k.total).toBe(63.53);
    expect(k.metros).toBe(3.5);
  });

  it("trata los nulos como cero en lugar de propagar NaN", () => {
    const k = calcularKpis([pedido({ subtotal: null, iva: null, envio: null, total: null })]);
    expect(k.bruta).toBe(0);
    expect(k.total).toBe(0);
  });
});

describe("variacion", () => {
  it("calcula el porcentaje frente al periodo anterior", () => {
    expect(variacion(150, 100)).toBe(50);
    expect(variacion(50, 100)).toBe(-50);
    expect(variacion(100, 100)).toBe(0);
  });

  it("devuelve null cuando no hay periodo anterior con el que comparar", () => {
    // La versión anterior devolvía 100 aquí, un número inventado que la
    // pantalla presentaba como si fuera una subida real.
    expect(variacion(500, 0)).toBeNull();
    expect(variacion(0, 0)).toBeNull();
  });

  it("redondea a un decimal, que es lo que se pinta", () => {
    expect(variacion(107, 93)).toBe(15.1);
  });
});

describe("agruparPorDia", () => {
  const dias = [new Date(2026, 8, 1), new Date(2026, 8, 2), new Date(2026, 8, 3)];

  it("deja a cero los días sin ventas en vez de omitirlos", () => {
    const r = agruparPorDia([pedido({ fecha_pedido: "2026-09-02T10:00:00", total: 126 })], dias);
    expect(r).toHaveLength(3);
    expect(r[0].total).toBe(0);
    expect(r[1].total).toBe(126);
    expect(r[2].total).toBe(0);
  });

  it("acumula varios pedidos del mismo día", () => {
    const r = agruparPorDia(
      [
        pedido({ fecha_pedido: "2026-09-02T09:00:00", total: 100 }),
        pedido({ fecha_pedido: "2026-09-02T20:00:00", total: 50 }),
      ],
      dias,
    );
    expect(r[1].total).toBe(150);
  });

  it("no cuenta los cancelados", () => {
    const r = agruparPorDia(
      [pedido({ fecha_pedido: "2026-09-02T09:00:00", total: 100, estado: "cancelado" })],
      dias,
    );
    expect(r[1].total).toBe(0);
  });
});

describe("agruparPorRangos", () => {
  const semanas = [
    { desde: new Date(2026, 7, 24), hasta: new Date(2026, 7, 30, 23, 59, 59) },
    { desde: new Date(2026, 7, 31), hasta: new Date(2026, 8, 6, 23, 59, 59) },
  ];

  it("reparte los pedidos en su rango", () => {
    const r = agruparPorRangos(
      [
        pedido({ fecha_pedido: "2026-08-25T12:00:00", total: 100 }),
        pedido({ fecha_pedido: "2026-09-02T12:00:00", total: 250 }),
        pedido({ fecha_pedido: "2026-09-03T12:00:00", total: 50 }),
      ],
      semanas,
    );
    expect(r[0].total).toBe(100);
    expect(r[1].total).toBe(300);
  });

  it("deja a cero los rangos sin ventas", () => {
    const r = agruparPorRangos([pedido({ fecha_pedido: "2026-09-02T12:00:00" })], semanas);
    expect(r[0].total).toBe(0);
  });

  it("descarta los pedidos que caen fuera de todos los rangos", () => {
    const r = agruparPorRangos(
      [pedido({ fecha_pedido: "2026-06-01T12:00:00", total: 999 })],
      semanas,
    );
    expect(r.every((x) => x.total === 0)).toBe(true);
  });

  it("no cuenta los cancelados", () => {
    const r = agruparPorRangos(
      [pedido({ fecha_pedido: "2026-09-02T12:00:00", total: 500, estado: "cancelado" })],
      semanas,
    );
    expect(r[1].total).toBe(0);
  });
});

describe("agruparPorTienda", () => {
  const tiendas = [
    { id: "t1", nombre: "DTF Culture" },
    { id: "t2", nombre: "DTF Textil" },
  ];

  it("ordena de mayor a menor facturación", () => {
    const filas = agruparPorTienda(
      [
        pedido({ tienda_id: "t1", total: 100 }),
        pedido({ tienda_id: "t2", total: 300 }),
        pedido({ tienda_id: "t2", total: 200 }),
      ],
      tiendas,
    );
    expect(filas.map((f) => f.nombre)).toEqual(["DTF Textil", "DTF Culture"]);
    expect(filas[0].total).toBe(500);
    expect(filas[1].total).toBe(100);
  });

  it("mantiene con ceros las tiendas que no vendieron nada", () => {
    // Que una tienda no haya facturado es información: ocultarla la esconde.
    const filas = agruparPorTienda([pedido({ tienda_id: "t1" })], tiendas);
    expect(filas).toHaveLength(2);
    const vacia = filas.find((f) => f.tienda_id === "t2");
    expect(vacia?.total).toBe(0);
    expect(vacia?.pedidos).toBe(0);
  });

  it("ignora pedidos de tiendas que no están en la lista", () => {
    const filas = agruparPorTienda([pedido({ tienda_id: "desconocida", total: 999 })], tiendas);
    expect(filas.every((f) => f.total === 0)).toBe(true);
  });
});

describe("topPorMetros", () => {
  it("agrupa por descripción y ordena por metros", () => {
    expect(
      topPorMetros([
        { descripcion: "DTF Premium 60cm", cantidad: 3, unidad: "m" },
        { descripcion: "DTF Glitter", cantidad: 10, unidad: "m" },
        { descripcion: "DTF Premium 60cm", cantidad: 4, unidad: "m" },
      ]),
    ).toEqual([
      { producto: "DTF Glitter", metros: 10 },
      { producto: "DTF Premium 60cm", metros: 7 },
    ]);
  });

  it("descarta las líneas que no se miden en metros", () => {
    expect(
      topPorMetros([
        { descripcion: "Portes", cantidad: 1, unidad: "ud" },
        { descripcion: "DTF Premium", cantidad: 2, unidad: "m" },
      ]),
    ).toEqual([{ producto: "DTF Premium", metros: 2 }]);
  });

  it("agrupa bajo una etiqueta explícita las líneas sin descripción", () => {
    expect(topPorMetros([{ descripcion: "  ", cantidad: 5, unidad: "m" }])).toEqual([
      { producto: "Sin descripción", metros: 5 },
    ]);
  });

  it("respeta el límite", () => {
    const lineas = Array.from({ length: 10 }, (_, i) => ({
      descripcion: `P${i}`,
      cantidad: i + 1,
      unidad: "m",
    }));
    expect(topPorMetros(lineas, 3)).toHaveLength(3);
  });
});
