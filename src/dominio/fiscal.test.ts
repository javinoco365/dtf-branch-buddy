import { describe, expect, it } from "vitest";
import {
  ivaSoportado,
  resumenIva,
  vendidoSinDocumento,
  type DocumentoDePedido,
  type DocumentoFiscal,
} from "./fiscal";
import { ventaDeTienda, type Venta } from "./gerencia";

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
  // Un ticket de 1.000 € de base y la factura que lo canjea, el mismo día.
  const ticket = doc("simplificada", 1000, { id: "t1", fecha: "2026-02-10" });
  const factura = doc("ordinaria", 1000, {
    id: "f1",
    fecha: "2026-02-10",
    sustituye_a_id: "t1",
  });
  // La rectificativa que anula la factura del canje, en el trimestre siguiente.
  const rectificativa = doc("rectificativa", -1000, {
    id: "r1",
    fecha: "2026-04-02",
    rectifica_a_id: "f1",
  });

  it("canje sin anular: el IVA de la venta cuenta una vez", () => {
    const r = resumenIva([ticket, factura]);
    // Ticket 210 + factura 210 − el ticket que sustituye 210.
    expect(r.repercutido).toEqual({ documentos: 2, base: 1000, iva: 210, total: 1210 });
    expect(r.canjes).toEqual({ canjes: 1, anulados: 0, base: -1000, iva: -210, total: -1210 });
    // Cada documento, por su tipo, con lo suyo; el canje va aparte.
    expect(r.porTipoDocumento.find((x) => x.tipo === "simplificada")?.cuenta.iva).toBe(210);
    expect(r.porTipoDocumento.find((x) => x.tipo === "ordinaria")?.cuenta.iva).toBe(210);
    expect(r.porTipoIva).toEqual([{ tipo: 21, base: 1000, cuota: 210 }]);
  });

  it("canje sin anular en dos periodos: el ticket en el suyo, la factura no suma en el suyo", () => {
    const tarde = { ...factura, fecha: "2026-04-03" };
    expect(resumenIva([ticket]).repercutido.iva).toBe(210);
    // El periodo de la factura conoce el ticket como referencia: 210 − 210.
    expect(resumenIva([tarde], [ticket]).repercutido.iva).toBe(0);
  });

  it("el ejemplo: ticket y canje el 10-02-2026, rectificativa el 02-04-2026", () => {
    // Primer trimestre: ticket y factura, que lo sustituye.
    expect(resumenIva([ticket, factura]).repercutido.iva).toBe(210);
    // Segundo: la rectificativa (−210) y el ticket que vuelve (+210).
    const t2 = resumenIva([rectificativa], [ticket, factura]);
    expect(t2.repercutido.iva).toBe(0);
    expect(t2.canjes).toMatchObject({ canjes: 0, anulados: 1, iva: 210 });
    // Los dos trimestres juntos: el IVA del ticket, una vez.
    expect(resumenIva([ticket, factura, rectificativa]).repercutido.iva).toBe(210);
  });

  it("una factura de canje en borrador no canjea nada", () => {
    const r = resumenIva([ticket, { ...factura, estado: "borrador" }]);
    expect(r.repercutido).toMatchObject({ documentos: 1, iva: 210 });
    expect(r.borradores).toBe(1);
    expect(r.canjes).toMatchObject({ canjes: 0, anulados: 0, iva: 0 });
  });

  it("vale igual para el textil: la misma regla con sus documentos", () => {
    const textil = { tienda_id: "textil-personalizado" };
    const r = resumenIva([
      { ...ticket, ...textil },
      { ...factura, ...textil },
    ]);
    expect(r.repercutido.iva).toBe(210);
    expect(
      resumenIva(
        [{ ...rectificativa, ...textil }],
        [
          { ...ticket, ...textil },
          { ...factura, ...textil },
        ],
      ).repercutido.iva,
    ).toBe(0);
  });

  it("por tienda, cada una cuenta lo suyo y juntas dan lo de la empresa", () => {
    // Una factura de canje de otra tienda que la del ticket: las dos se leen.
    const deB = { ...ticket, tienda_id: "b" };
    const deA = { ...factura, tienda_id: "a" };
    const leidos = [deB, deA];
    expect(resumenIva([deA], leidos).repercutido.iva).toBe(0);
    expect(resumenIva([deB], leidos).repercutido.iva).toBe(210);
    expect(resumenIva(leidos).repercutido.iva).toBe(210);
  });

  it("las referencias no cuentan por sí mismas", () => {
    expect(resumenIva([], [ticket, factura, rectificativa]).repercutido).toEqual({
      documentos: 0,
      base: 0,
      iva: 0,
      total: 0,
    });
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
