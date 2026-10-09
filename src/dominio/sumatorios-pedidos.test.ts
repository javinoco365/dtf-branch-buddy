import { describe, expect, it } from "vitest";
import { describirDocumentos, describirPedidos, totalesCliente } from "./sumatorios-pedidos";

describe("describirPedidos", () => {
  it("singular, plural y los cancelados aparte solo si los hay", () => {
    expect(describirPedidos(1)).toBe("1 pedido");
    expect(describirPedidos(0)).toBe("0 pedidos");
    expect(describirPedidos(12, 0)).toBe("12 pedidos");
    expect(describirPedidos(12, 1)).toBe("12 pedidos · 1 cancelado aparte");
    expect(describirPedidos(3, 2)).toBe("3 pedidos · 2 cancelados aparte");
  });
});

describe("describirDocumentos", () => {
  it("lo que suma y lo que se queda fuera", () => {
    expect(describirDocumentos({ documentos: 1, borradores: 0, canjeados: 0 })).toBe("1 documento");
    expect(describirDocumentos({ documentos: 5, borradores: 1, canjeados: 2 })).toBe(
      "5 documentos · sin 1 borrador · sin 2 tickets canjeados",
    );
  });
});

describe("totalesCliente", () => {
  it("los pies del historial y la tarjeta «Total pedidos» dicen lo mismo", () => {
    const t = totalesCliente({
      pedidos: [
        { total: "100.10", estado: "entregado" },
        { total: 50, estado: "cancelado" },
      ],
      pedidosTextil: [
        { total: 0.2, estado: "pendiente" },
        { total: 30, estado: "cancelado" },
      ],
      facturas: [
        { id: "t1", estado: "pagada", total: 121 },
        { id: "f1", estado: "emitida", total: 121, sustituye_a_id: "t1" },
        { id: "b1", estado: "borrador", total: 999 },
      ],
      facturasTextil: [],
    });
    expect(t.tienda).toMatchObject({ pedidos: 1, cancelados: 1, total: 100.1 });
    expect(t.textil).toMatchObject({ pedidos: 1, cancelados: 1, total: 0.2 });
    // Sin los cancelados, y sin arrastrar la coma flotante (100,1 + 0,2).
    expect(t.totalPedidos).toBe(100.3);
    expect(t.facturas).toMatchObject({ documentos: 1, total: 121, borradores: 1, canjeados: 1 });
  });

  it("las facturas del textil suman en la misma tabla y con las mismas reglas", () => {
    const t = totalesCliente({
      pedidos: [],
      pedidosTextil: [],
      facturas: [{ id: "f1", estado: "emitida", base: 100, iva: 21, total: 121 }],
      facturasTextil: [
        // Un ticket canjeado por factura: solo cuenta la factura.
        { id: "tt1", estado: "emitida", base: 50, iva: 10.5, total: 60.5 },
        {
          id: "tf1",
          estado: "emitida",
          base: 50,
          iva: 10.5,
          total: "60.50",
          sustituye_a_id: "tt1",
        },
        // Una factura anulada por su rectificativa: suman cero.
        { id: "tf2", estado: "emitida", base: 10, iva: 2.1, total: 12.1 },
        { id: "tr2", estado: "emitida", base: -10, iva: -2.1, total: -12.1, rectifica_a_id: "tf2" },
        { id: "tb1", estado: "borrador", total: 999 },
      ],
    });
    expect(t.facturas).toEqual({
      documentos: 4,
      base: 150,
      iva: 31.5,
      total: 181.5,
      borradores: 1,
      canjeados: 1,
    });
    // Las facturas no cambian lo pedido.
    expect(t.totalPedidos).toBe(0);
  });

  it("sin historial, todo a cero", () => {
    const t = totalesCliente({ pedidos: [], pedidosTextil: [], facturas: [], facturasTextil: [] });
    expect(t.totalPedidos).toBe(0);
    expect(t.facturas.total).toBe(0);
  });
});
