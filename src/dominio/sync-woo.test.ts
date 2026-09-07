import { describe, expect, it } from "vitest";
import {
  estadoPagoPorDevolucion,
  fechaMasAntigua,
  idsVistosWoo,
  pedidosDesaparecidos,
  totalReembolsado,
} from "./sync-woo";

describe("idsVistosWoo", () => {
  it("da el conjunto de ids que ha traído la página", () => {
    expect(idsVistosWoo([{ id: 432 }, { id: 430 }])).toEqual(new Set([432, 430]));
  });

  it("una página vacía da un conjunto vacío", () => {
    expect(idsVistosWoo([])).toEqual(new Set());
  });
});

describe("fechaMasAntigua", () => {
  it("coge la fecha mínima, sin fiarse del orden de la lista", () => {
    expect(
      fechaMasAntigua([
        { id: 1, date_created: "2026-09-05T10:00:00" },
        { id: 2, date_created: "2026-09-01T10:00:00" },
        { id: 3, date_created: "2026-09-03T10:00:00" },
      ]),
    ).toBe("2026-09-01T10:00:00");
  });

  it("ignora los pedidos sin fecha", () => {
    expect(fechaMasAntigua([{ id: 1, date_created: null }, { id: 2 }])).toBeNull();
  });

  it("una página vacía no tiene fecha más antigua", () => {
    expect(fechaMasAntigua([])).toBeNull();
  });
});

describe("pedidosDesaparecidos", () => {
  it("encuentra el pedido del CRM que Woo ya no trae", () => {
    // El caso que motiva la función: han borrado el 430 en WooCommerce.
    const crm = [
      { id: "a", woo_order_id: 432 },
      { id: "b", woo_order_id: 430 },
    ];
    const woo = [{ id: 432 }];
    expect(pedidosDesaparecidos(crm, woo)).toEqual([{ id: "b", woo_order_id: 430 }]);
  });

  it("no encuentra nada si todos siguen estando", () => {
    const crm = [{ id: "a", woo_order_id: 432 }];
    const woo = [{ id: 432 }, { id: 430 }];
    expect(pedidosDesaparecidos(crm, woo)).toEqual([]);
  });

  it("sin candidatos del CRM no hay nada que borrar", () => {
    expect(pedidosDesaparecidos([], [{ id: 432 }])).toEqual([]);
  });
});

describe("totalReembolsado", () => {
  it("suma los reembolsos, en positivo aunque Woo los guarde en negativo", () => {
    expect(totalReembolsado([{ total: "-3.96" }, { total: "-1.00" }])).toBeCloseTo(4.96);
  });

  it("sin reembolsos, cero", () => {
    expect(totalReembolsado([])).toBe(0);
    expect(totalReembolsado(null)).toBe(0);
    expect(totalReembolsado(undefined)).toBe(0);
  });

  it("ignora un reembolso sin importe numérico en vez de romper la suma", () => {
    expect(
      totalReembolsado([{ total: "-3.96" }, { total: null }, { total: "no es un número" }]),
    ).toBeCloseTo(3.96);
  });

  it("no se rompe si lo que llega no es un array", () => {
    expect(totalReembolsado("nada de esto")).toBe(0);
    expect(totalReembolsado({ total: "-5" })).toBe(0);
  });
});

describe("estadoPagoPorDevolucion", () => {
  it("marca reembolsado cuando lo devuelto cubre el pedido entero", () => {
    expect(estadoPagoPorDevolucion(60.5, 60.5)).toBe("reembolsado");
  });

  it("un céntimo de diferencia por redondeo no cuenta como parcial", () => {
    expect(estadoPagoPorDevolucion(60.5, 60.49)).toBe("reembolsado");
  });

  it("marca parcial cuando se ha devuelto una parte", () => {
    expect(estadoPagoPorDevolucion(100, 30)).toBe("parcial");
  });

  it("sin nada devuelto, no hay nada que cambiar", () => {
    expect(estadoPagoPorDevolucion(100, 0)).toBeNull();
  });
});
