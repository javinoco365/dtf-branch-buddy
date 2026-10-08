import { describe, expect, it } from "vitest";
import { clientesDormidos, resumenClientes, type VentaCliente } from "./clientela";
import { resumenIva, type DocumentoFiscal } from "./fiscal";
import { beneficioEstimado, cifrasGerencia, ventaDeTienda, type Venta } from "./gerencia";
import { margenPor, margenPorTramos } from "./margen";
import { tramosGrafica } from "./periodos";
import { sumarImportes } from "./sumatorios";
import {
  totalDormidos,
  totalEsperandoRespuesta,
  totalMargen,
  totalRankingClientes,
  totalTiposIva,
  totalTramosMargen,
} from "./sumatorios-gerencia-a";

const pedido = (
  cliente: string | null,
  fecha: string,
  total: number,
  extra: Partial<VentaCliente> = {},
): VentaCliente => ({
  ...ventaDeTienda({
    fecha_pedido: `${fecha}T10:00:00`,
    tienda_id: "t1",
    estado: "entregado",
    subtotal: total / 1.21,
    iva: total - total / 1.21,
    envio: 0,
    total,
    metros_total: 1,
    origen: "manual",
    cliente_id: cliente,
  }),
  cliente_nombre: cliente ? `Cliente ${cliente}` : null,
  ...extra,
});

const octubre = { desde: new Date(2026, 9, 1), hasta: new Date(2026, 9, 31, 23, 59, 59) };

describe("totalRankingClientes", () => {
  it("todo el ranking, sin los pedidos sin cliente ni los cancelados", () => {
    const r = resumenClientes(
      [
        pedido("a", "2026-03-10", 100), // recurrente
        pedido("a", "2026-10-02", 500),
        pedido("b", "2026-10-03", 300), // nuevo
        pedido("b", "2026-10-20", 100.1),
        pedido("c", "2026-10-05", 50),
        pedido(null, "2026-10-07", 70), // sin cliente: aparte
        pedido("e", "2026-10-08", 999, { estado: "cancelado" }),
      ],
      octubre,
    );
    const t = totalRankingClientes(r);
    expect(t).toEqual({ clientes: 3, pedidos: 4, vendido: 950.1 });
    // Cuadra con las tarjetas de arriba y con las filas.
    expect(t.clientes).toBe(r.activos);
    expect(t.vendido).toBeCloseTo(r.vendidoNuevos + r.vendidoRecurrentes, 6);
    expect(t.vendido).toBe(sumarImportes(r.ranking, (c) => c.vendido));
  });

  it("con devoluciones parciales cuadra con las tarjetas, aunque las filas redondeadas no", () => {
    // Dos nuevos de 6,667 € cada uno: las filas dicen 6,67 + 6,67 = 13,34 y
    // la tarjeta de nuevos, 13,33. El pie va con la tarjeta.
    const r = resumenClientes(
      [
        pedido("a", "2026-10-02", 10, { devuelto: 3.333 }),
        pedido("b", "2026-10-03", 10, { devuelto: 3.333 }),
      ],
      octubre,
    );
    expect(r.ranking.map((c) => c.vendido)).toEqual([6.67, 6.67]);
    expect(totalRankingClientes(r).vendido).toBe(r.vendidoNuevos);
    expect(totalRankingClientes(r).vendido).toBe(13.33);
  });
});

describe("totalDormidos", () => {
  it("suma todos los dormidos, no solo los que se enseñan", () => {
    const dormidos = clientesDormidos(
      [
        pedido("a", "2026-01-10", 100.1),
        pedido("a", "2026-02-10", 200.2),
        pedido("b", "2026-03-10", 50),
        pedido("c", "2026-10-01", 999), // pidió hace poco: no está dormido
      ],
      new Date(2026, 9, 8),
    );
    expect(totalDormidos(dormidos)).toEqual({ clientes: 2, pedidos: 3, vendido: 350.3 });
    expect(totalDormidos([])).toEqual({ clientes: 0, pedidos: 0, vendido: 0 });
  });
});

describe("totalEsperandoRespuesta", () => {
  it("en plazo más caducados", () => {
    expect(
      totalEsperandoRespuesta({
        vigentes: { n: 2, importe: 100.1 },
        caducados: { n: 1, importe: 50.2 },
      }),
    ).toEqual({ n: 3, importe: 150.3 });
  });
});

describe("totalTiposIva", () => {
  const redondeo = (n: number) => Math.round(n * 100) / 100;
  const doc = (
    id: string,
    base: number,
    extra: Partial<DocumentoFiscal> = {},
  ): DocumentoFiscal => ({
    id,
    tipo: "ordinaria",
    estado: "emitida",
    fecha: "2026-10-01",
    tienda_id: "t1",
    base,
    iva: redondeo(base * 0.21),
    total: redondeo(base * 1.21),
    desglose_iva: [{ tipo: 21, base, cuota: redondeo(base * 0.21) }],
    ...extra,
  });

  it("cuadra con el IVA repercutido cuando cada desglose suma su documento", () => {
    const iva = resumenIva([
      doc("a", 1000),
      doc("b", 100, {
        iva: 15.5,
        total: 115.5,
        desglose_iva: [
          { tipo: 21, base: 50, cuota: 10.5 },
          { tipo: 10, base: 50, cuota: 5 },
        ],
      }),
      doc("r", -200, { tipo: "rectificativa" }), // resta
      doc("s", 80, { desglose_iva: null }), // sin desglose: tipo 0
      doc("x", 500, { estado: "borrador" }), // no cuenta
    ]);
    const t = totalTiposIva(iva.porTipoIva);
    expect(t).toEqual({ base: 980, cuota: 200.3 });
    expect(t).toEqual({ base: iva.repercutido.base, cuota: iva.repercutido.iva });
  });

  it("si un desglose no suma su documento, el pie lo deja ver", () => {
    const iva = resumenIva([
      doc("a", 100, { desglose_iva: [{ tipo: 21, base: 90, cuota: 18.9 }] }),
    ]);
    expect(totalTiposIva(iva.porTipoIva)).toEqual({ base: 90, cuota: 18.9 });
    expect(iva.repercutido.base).toBe(100);
  });
});

describe("totalMargen y totalTramosMargen", () => {
  const dtf = (fecha: string, bruta: number, metros: number, tienda: string): Venta =>
    ventaDeTienda({
      fecha_pedido: `${fecha}T10:00:00`,
      tienda_id: tienda,
      estado: "entregado",
      subtotal: bruta,
      iva: bruta * 0.21,
      envio: 0,
      total: bruta * 1.21,
      metros_total: metros,
      coste_metro_snapshot: 2,
      origen: "manual",
      cliente_id: "c",
    });

  const ventas = [
    dtf("2026-10-01", 100, 10, "t1"), // margen 80: 80 %
    dtf("2026-10-02", 300, 135, "t2"), // margen 30: 10 %
    { ...dtf("2026-10-03", 999, 1, "t2"), estado: "cancelado" },
  ];

  it("es el total del periodo, el de las tarjetas, y el % es el del total", () => {
    const c = cifrasGerencia(ventas, 0);
    const filas = margenPor(ventas, (v) => v.tienda_id, new Map(), 0);
    const t = totalMargen(c);
    expect(t).toEqual({ bruta: 400, coste: 290, margen: 110, porcentaje: 27.5 });
    // Ni la suma (90 %) ni la media (45 %) de los de cada fila.
    expect(filas.map((f) => f.porcentaje)).toEqual([80, 10]);
    // Y es lo que suman las filas.
    expect(t.bruta).toBe(sumarImportes(filas, (f) => f.bruta));
    expect(t.coste).toBe(sumarImportes(filas, (f) => f.coste));
    expect(t.margen).toBe(sumarImportes(filas, (f) => f.margen));
  });

  it("sin ventas, el % queda vacío", () => {
    expect(totalMargen({ bruta: 0, coste: 0, margen: 0 }).porcentaje).toBeNull();
  });

  const gastos = [
    { id: "g", concepto: "Alquiler", importe_mensual: 100, desde: "2026-01-01", hasta: null },
  ];

  it("por tramos: los gastos del periodo, no la suma de los de cada día redondeados", () => {
    const hoy = new Date(2026, 10, 5); // octubre ya ha pasado entero
    const c = cifrasGerencia(ventas, 0);
    const filas = margenPorTramos(ventas, tramosGrafica(octubre).tramos, 0, gastos, hoy);
    const t = totalTramosMargen(c, gastos, octubre, hoy);
    expect(t).toMatchObject({ bruta: 400, margen: 110, gastos: 100, beneficio: 10 });
    // 100 € entre 31 días son 3,23 € al día: las filas suman 100,13 €.
    expect(sumarImportes(filas, (f) => f.gastos)).toBe(100.13);
    // El margen sí es el de las filas.
    expect(sumarImportes(filas, (f) => f.margen)).toBe(t.margen);
  });

  it("por tramos a mitad de periodo: los gastos hasta hoy, como el Resumen", () => {
    const hoy = new Date(2026, 9, 10, 12);
    const c = cifrasGerencia(ventas, 0);
    const t = totalTramosMargen(c, gastos, octubre, hoy);
    const resumen = beneficioEstimado(c.margen, gastos, octubre, hoy);
    expect(t.gastos).toBe(resumen.gastos);
    expect(t.beneficio).toBe(resumen.beneficio);
    expect(t.gastos).toBe(32.26); // 100 × 10 / 31
  });
});
