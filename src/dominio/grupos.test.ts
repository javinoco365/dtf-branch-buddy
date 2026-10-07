import { describe, expect, it } from "vitest";
import { ventaDeTienda, type Venta } from "./gerencia";
import type { DocumentoDePedido, DocumentoFiscal } from "./fiscal";
import {
  facturadoSinPedido,
  pedidosDocumentados,
  pendienteDocumentar,
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
});
