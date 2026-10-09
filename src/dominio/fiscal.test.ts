import { describe, expect, it } from "vitest";
import {
  ivaSoportado,
  resumenIva,
  vendidoSinDocumento,
  type DocumentoDePedido,
  type DocumentoFiscal,
} from "./fiscal";
import { ventaDeTienda, type Venta } from "./gerencia";
import { ticketsCanjeados } from "./sumatorios";

const doc = (
  tipo: DocumentoFiscal["tipo"],
  base: number,
  extra: Partial<DocumentoFiscal> = {},
): DocumentoFiscal => ({
  id: `${tipo}-${base}`,
  tipo,
  estado: "emitida",
  fecha: "2026-10-01",
  tienda_id: "t1",
  base,
  iva: base * 0.21,
  total: base * 1.21,
  desglose_iva: [{ tipo: 21, base, cuota: base * 0.21 }],
  ...extra,
});

describe("IVA repercutido", () => {
  it("suma facturas y tickets, resta rectificativas y deja fuera los borradores", () => {
    const r = resumenIva([
      doc("ordinaria", 1000),
      doc("simplificada", 100),
      doc("rectificativa", -200),
      doc("ordinaria", 500, { estado: "borrador" }),
      doc("ordinaria", 100, {
        id: "mixta",
        iva: 14,
        desglose_iva: [
          { tipo: 21, base: 50, cuota: 10.5 },
          { tipo: 10, base: 50, cuota: 5 },
        ],
      }),
    ]);
    expect(r.repercutido.documentos).toBe(4);
    expect(r.repercutido.base).toBe(1000);
    expect(r.borradores).toBe(1);
    expect(r.porTipoDocumento.find((x) => x.tipo === "rectificativa")?.cuenta.base).toBe(-200);
    expect(r.porTipoIva).toEqual([
      { tipo: 21, base: 950, cuota: 199.5 },
      { tipo: 10, base: 50, cuota: 5 },
    ]);
  });

  it("sin desglose guardado, el IVA va entero al tipo 0", () => {
    const r = resumenIva([doc("ordinaria", 100, { desglose_iva: null })]);
    expect(r.porTipoIva).toEqual([{ tipo: 0, base: 100, cuota: 21 }]);
  });
});

describe("IVA repercutido con tickets canjeados por factura", () => {
  // Un ticket de 100 € de base y la factura que lo canjea, por lo mismo.
  const ticket = doc("simplificada", 100, { id: "t1" });
  const factura = doc("ordinaria", 100, { id: "f1", sustituye_a_id: "t1" });
  const rectificativa = doc("rectificativa", -100, { id: "r1", rectifica_a_id: "f1" });

  it("el ticket canjeado no cuenta: su IVA lo cuenta la factura una sola vez", () => {
    const r = resumenIva([ticket, factura]);
    expect(r.repercutido).toEqual({ documentos: 1, base: 100, iva: 21, total: 121 });
    expect(r.canjeados).toBe(1);
    expect(r.porTipoDocumento.find((x) => x.tipo === "simplificada")?.cuenta.documentos).toBe(0);
    expect(r.porTipoDocumento.find((x) => x.tipo === "ordinaria")?.cuenta.iva).toBe(21);
    expect(r.porTipoIva).toEqual([{ tipo: 21, base: 100, cuota: 21 }]);
  });

  it("si la factura del canje no está en la lista, el ticket cuenta", () => {
    const r = resumenIva([ticket]);
    expect(r.repercutido.iva).toBe(21);
    expect(r.canjeados).toBe(0);
  });

  it("si una rectificativa corrige la factura del canje, el ticket vuelve a contar", () => {
    const r = resumenIva([ticket, factura, rectificativa]);
    // Ticket 21 + factura 21 − rectificativa 21: el IVA del ticket, una vez.
    expect(r.repercutido).toMatchObject({ documentos: 3, iva: 21 });
    expect(r.canjeados).toBe(0);
  });

  it("si la factura del canje está anulada, el ticket vuelve a contar", () => {
    const r = resumenIva([ticket, { ...factura, estado: "anulada" }]);
    expect(r.canjeados).toBe(0);
    expect(r.repercutido.documentos).toBe(2);
  });

  it("una factura de canje en borrador no canjea nada", () => {
    const r = resumenIva([ticket, { ...factura, estado: "borrador" }]);
    expect(r.repercutido).toMatchObject({ documentos: 1, iva: 21 });
    expect(r).toMatchObject({ borradores: 1, canjeados: 0 });
  });

  it("vale igual para el textil: la misma regla con sus documentos", () => {
    const r = resumenIva([
      { ...ticket, tienda_id: "textil-personalizado" },
      { ...factura, tienda_id: "textil-personalizado" },
    ]);
    expect(r.repercutido.iva).toBe(21);
    expect(r.canjeados).toBe(1);
  });

  it("con los canjes de una lista mayor, decide con esa lista y no con el trozo", () => {
    // La rectificativa de la factura cae fuera del trozo: el ticket cuenta.
    const todos = [ticket, factura, rectificativa];
    const r = resumenIva([ticket, factura], ticketsCanjeados(todos));
    expect(r.canjeados).toBe(0);
    expect(r.repercutido.iva).toBe(42);
  });
});

describe("IVA soportado", () => {
  it("solo cuentan las compras registradas", () => {
    expect(
      ivaSoportado([
        { estado: "registrada", base: 100, iva: 21, total: 121 },
        { estado: "borrador", base: 50, iva: 10.5, total: 60.5 },
      ]),
    ).toEqual({ documentos: 1, base: 100, iva: 21, total: 121, irpf: 0, sinRegistrar: 1 });
  });
});

describe("vendido sin factura", () => {
  const pedido = (id: string, total: number, estado = "entregado"): Venta => ({
    ...ventaDeTienda({
      fecha_pedido: "2026-10-01T10:00:00",
      tienda_id: "t1",
      estado,
      subtotal: total,
      iva: 0,
      envio: 0,
      total,
      metros_total: 0,
      cliente_id: null,
    }),
    id,
  });
  const d = (id: string, pedido_id: string | null, extra: Partial<DocumentoDePedido> = {}) =>
    ({
      id,
      tipo: "ordinaria",
      estado: "emitida",
      rectifica_a_id: null,
      pedido_id,
      ...extra,
    }) as DocumentoDePedido;

  it("sin documento, con borrador o con el suyo anulado cuentan; cancelados no", () => {
    const r = vendidoSinDocumento(
      [
        pedido("a", 100),
        pedido("b", 50),
        pedido("c", 30),
        pedido("d", 20),
        pedido("e", 9, "cancelado"),
      ],
      [
        d("fa", "a"),
        d("fc", "c", { estado: "borrador" }),
        d("fd", "d"),
        d("rd", null, { tipo: "rectificativa", rectifica_a_id: "fd" }),
      ],
    );
    // b sin nada, c solo borrador, d anulada: 50 + 30 + 20.
    expect(r).toEqual({ pedidos: 3, vendido: 100 });
  });
});
