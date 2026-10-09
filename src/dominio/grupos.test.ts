import { describe, expect, it } from "vitest";
import { ventaDeTienda, type Venta } from "./gerencia";
import type { DocumentoDePedido, DocumentoFiscal } from "./fiscal";
import {
  facturadoSinPedido,
  gastosDelGrupo,
  gastosFijosPorGrupo,
  pedidosDocumentados,
  pendienteDocumentar,
  resultadosPorGrupo,
  ventasDelGrupo,
} from "./grupos";

const pedido = (id: string, total: number, extra: Partial<Venta> = {}): Venta => ({
  ...ventaDeTienda({
    fecha_pedido: "2026-10-01T10:00:00",
    tienda_id: extra.tienda_id ?? "t1",
    estado: "entregado",
    subtotal: total,
    iva: 0,
    envio: 0,
    total,
    metros_total: 1,
    cliente_id: null,
  }),
  id,
  ...extra,
});

const doc = (id: string, pedido_id: string | null, extra: Partial<DocumentoDePedido> = {}) =>
  ({
    id,
    tipo: "ordinaria",
    estado: "emitida",
    rectifica_a_id: null,
    pedido_id,
    ...extra,
  }) as DocumentoDePedido;

describe("A y B salen de los documentos, no de una marca a mano", () => {
  const docs = [
    doc("fa", "a"), // factura
    doc("tb", "b", { tipo: "simplificada" }), // ticket
    doc("fc", "c", { estado: "borrador" }), // borrador: no cuenta
    doc("fd", "d"),
    doc("rd", null, { tipo: "rectificativa", rectifica_a_id: "fd" }), // anula la de d
  ];
  const ventas = [
    pedido("a", 100),
    pedido("b", 50),
    pedido("c", 30),
    pedido("d", 20),
    pedido("e", 10),
  ];
  const documentados = pedidosDocumentados(docs);

  it("documentados: con factura o ticket vigente", () => {
    expect([...documentados].sort()).toEqual(["a", "b"]);
  });

  it("A + B = total, sin contar nada dos veces", () => {
    const a = ventasDelGrupo(ventas, documentados, "a").map((v) => v.id);
    const b = ventasDelGrupo(ventas, documentados, "b").map((v) => v.id);
    expect(a).toEqual(["a", "b"]);
    expect(b).toEqual(["c", "d", "e"]);
    expect(ventasDelGrupo(ventas, documentados, "total")).toHaveLength(5);
  });

  it("lo pendiente de documentar, por tienda; los cancelados no cuentan", () => {
    const p = pendienteDocumentar(
      [
        ...ventas,
        pedido("x", 999, { estado: "cancelado" }),
        pedido("t", 5, { tienda_id: "textil" }),
      ],
      documentados,
    );
    expect(p.pedidos).toBe(4);
    expect(p.vendido).toBe(65);
    expect(p.porTienda).toEqual([
      { tienda_id: "t1", pedidos: 3, vendido: 60 },
      { tienda_id: "textil", pedidos: 1, vendido: 5 },
    ]);
  });
});

describe("facturado sin pedido", () => {
  const f = (id: string, base: number, extra: Partial<DocumentoFiscal> = {}): DocumentoFiscal => ({
    id,
    tipo: "ordinaria",
    estado: "emitida",
    fecha: "2026-10-01",
    tienda_id: "t1",
    base,
    iva: 0,
    total: base,
    ...extra,
  });

  it("las facturas manuales cuentan en A; las de pedidos ya están en las ventas", () => {
    expect(
      facturadoSinPedido([
        f("m1", 200),
        f("p1", 100, { pedido_id: "p" }),
        f("b", 50, { estado: "borrador" }),
        f("r1", -200, { tipo: "rectificativa", rectifica_a_id: "m1" }),
        f("r2", -100, { tipo: "rectificativa", rectifica_a_id: "p1" }),
        f("m2", 30),
      ]),
    ).toBe(30);
  });

  describe("un ticket sin pedido canjeado por factura cuenta una vez", () => {
    // La factura del canje hereda el pedido del ticket: aquí, ninguno.
    const ticket = f("t", 100, { tipo: "simplificada", fecha: "2026-02-10" });
    const canje = f("c", 100, { fecha: "2026-02-10", sustituye_a_id: "t" });
    const anulacion = f("r", -100, {
      tipo: "rectificativa",
      fecha: "2026-04-02",
      rectifica_a_id: "c",
    });

    it("canje sin anular: 100, no 200", () => {
      expect(facturadoSinPedido([ticket, canje])).toBe(100);
      // En dos periodos: el ticket en el suyo; la factura no suma en el suyo.
      expect(facturadoSinPedido([ticket])).toBe(100);
      expect(facturadoSinPedido([{ ...canje, fecha: "2026-04-03" }], [ticket])).toBe(0);
    });

    it("la rectificativa que anula el canje deja el ticket: 0 en su periodo, 100 en total", () => {
      expect(facturadoSinPedido([anulacion], [ticket, canje])).toBe(0);
      expect(facturadoSinPedido([ticket, canje, anulacion])).toBe(100);
    });

    it("si el ticket es de un pedido, su venta ya está en las ventas: aquí nada", () => {
      const deP = { pedido_id: "p" };
      expect(
        facturadoSinPedido([
          { ...ticket, ...deP },
          { ...canje, ...deP },
        ]),
      ).toBe(0);
      expect(
        facturadoSinPedido(
          [{ ...anulacion }],
          [
            { ...ticket, ...deP },
            { ...canje, ...deP },
          ],
        ),
      ).toBe(0);
    });

    it("lo mismo en el textil", () => {
      const textil = (x: DocumentoFiscal) => ({ ...x, tienda_id: "textil-personalizado" });
      expect(facturadoSinPedido([ticket, canje, anulacion].map(textil))).toBe(100);
    });
  });
});

describe("cuenta de resultados en tres columnas", () => {
  it("Sociedades solo en A; cada grupo con sus gastos; el total suma A y B", () => {
    const ventas = [pedido("a", 1000), pedido("b", 200)];
    const r = resultadosPorGrupo({
      ventas,
      documentados: new Set(["a"]),
      costeActual: 0,
      facturadoSinPedido: 100,
      costesFijos: { a: 300, b: 50 },
      tipoIs: 15,
    });
    // A: 1000 + 100 sin pedido − 300 fijos = 800; Sociedades 120.
    expect(r.a).toMatchObject({
      ingresos: 1100,
      costesFijos: 300,
      bai: 800,
      sociedades: 120,
      neto: 680,
    });
    // B: 200 − 50 de gastos sin justificante, sin impuesto.
    expect(r.b).toMatchObject({
      ingresos: 200,
      costesFijos: 50,
      bai: 150,
      sociedades: 0,
      neto: 150,
    });
    expect(r.total).toMatchObject({
      ingresos: 1300,
      costesFijos: 350,
      bai: 950,
      sociedades: 120,
      neto: 830,
    });
  });

  it("en la cuenta de resultados el envío cobrado es ingreso y lo de la agencia, gasto", () => {
    const r = resultadosPorGrupo({
      ventas: [pedido("a", 110, { envio: 10 })],
      documentados: new Set(["a"]),
      costeActual: 0,
      facturadoSinPedido: 0,
      costesFijos: { a: 0, b: 0 },
      tipoIs: 0,
    });
    // Ingresos con el envío; el envío vuelve a salir como gasto: el margen, sin él.
    expect(r.a).toMatchObject({ ingresos: 110, envios: 10, margen: 100 });
  });

  it("un gasto sin justificante no rebaja Sociedades", () => {
    const base = {
      ventas: [pedido("a", 1000)],
      documentados: new Set(["a"]),
      costeActual: 0,
      facturadoSinPedido: 0,
      tipoIs: 15,
    };
    const conJ = resultadosPorGrupo({ ...base, costesFijos: { a: 200, b: 0 } });
    const sinJ = resultadosPorGrupo({ ...base, costesFijos: { a: 0, b: 200 } });
    expect(conJ.a.sociedades).toBe(120);
    expect(sinJ.a.sociedades).toBe(150);
    // El neto del negocio es peor sin justificante: paga más impuesto.
    expect(sinJ.total.neto).toBeLessThan(conJ.total.neto);
  });
});

describe("gastos por grupo", () => {
  const gastos = [
    { id: "1", con_justificante: true },
    { id: "2", con_justificante: false },
    { id: "3" },
    { id: "4", con_justificante: null },
  ];
  it("A con justificante (o sin marcar), B sin él, total todos", () => {
    expect(gastosDelGrupo(gastos, "a").map((g) => g.id)).toEqual(["1", "3", "4"]);
    expect(gastosDelGrupo(gastos, "b").map((g) => g.id)).toEqual(["2"]);
    expect(gastosDelGrupo(gastos, "total")).toHaveLength(4);
  });

  it("los gastos fijos del mes, separados", () => {
    const g = (id: string, importe: number, con_justificante?: boolean) => ({
      id,
      concepto: id,
      importe_mensual: importe,
      desde: "2026-01-01",
      hasta: null,
      con_justificante,
    });
    const octubre = { desde: new Date(2026, 9, 1), hasta: new Date(2026, 9, 31, 23, 59, 59) };
    expect(gastosFijosPorGrupo([g("alquiler", 800), g("ayuda", 200, false)], octubre)).toEqual({
      a: 800,
      b: 200,
      total: 1000,
      compras: 0,
      amortizacion: 0,
      hastaHoy: false,
    });
  });
});
