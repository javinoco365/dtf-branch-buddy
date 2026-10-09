import { describe, expect, it } from "vitest";
import {
  diaDelPedido,
  momentoDelPedido,
  ordenarPedidos,
  pedidoEnDias,
  pedidoEnRango,
  tramoDeConsulta,
} from "./dia-pedido";
import { fechaDocumentoDePedido } from "./fecha-documento";

// Un pedido web guarda la hora de la web como si fuera UTC; uno del CRM, el
// instante de verdad.
const web = (fecha_pedido: string) => ({ fecha_pedido, origen: "woocommerce" });
const crm = (fecha_pedido: string) => ({ fecha_pedido, origen: "manual" });

describe("diaDelPedido", () => {
  it("un pedido web de las 23:15 es de su día, no del siguiente", () => {
    expect(diaDelPedido(web("2026-10-07T23:15:00+00:00"))).toBe("2026-10-07");
    expect(diaDelPedido(web("2026-10-31T23:59:00+00:00"))).toBe("2026-10-31");
  });

  it("un pedido del CRM es del día en hora de España", () => {
    // 22:30 UTC del 7 de octubre son las 00:30 del 8 en Madrid.
    expect(diaDelPedido(crm("2026-10-07T22:30:00+00:00"))).toBe("2026-10-08");
    expect(diaDelPedido(crm("2026-10-07T21:30:00+00:00"))).toBe("2026-10-07");
    // Sin origen, como uno del CRM.
    expect(diaDelPedido({ fecha_pedido: "2026-01-15T23:30:00Z" })).toBe("2026-01-16");
  });

  it("es el mismo día con el que sale su ticket o su factura", () => {
    for (const p of [
      web("2026-10-07T23:15:00+00:00"),
      web("2026-10-07T00:05:00+00:00"),
      crm("2026-10-07T22:30:00+00:00"),
      crm("2026-12-31T23:30:00+00:00"),
    ]) {
      expect(diaDelPedido(p)).toBe(
        fechaDocumentoDePedido(p.fecha_pedido, { horaDeLaWeb: p.origen === "woocommerce" }),
      );
    }
  });
});

describe("una hora sin zona", () => {
  it("es una hora del reloj de España: su día es el de la cadena, en cualquier navegador", () => {
    // Así fecha Gerencia los pedidos textil (a mediodía de su día).
    expect(diaDelPedido({ fecha_pedido: "2026-10-03T12:00:00" })).toBe("2026-10-03");
    expect(diaDelPedido({ fecha_pedido: "2026-10-03T23:59:59.000", origen: "manual" })).toBe(
      "2026-10-03",
    );
    expect(diaDelPedido({ fecha_pedido: "2026-10-03T00:00" })).toBe("2026-10-03");
  });

  it("su momento es la hora tal cual", () => {
    expect(momentoDelPedido({ fecha_pedido: "2026-10-03T12:00:00" })).toBe("2026-10-03T12:00:00");
    expect(momentoDelPedido({ fecha_pedido: "2026-10-03T08:30" })).toBe("2026-10-03T08:30:00");
    expect(momentoDelPedido({ fecha_pedido: "2026-10-03T08:30:15.250" })).toBe(
      "2026-10-03T08:30:15",
    );
  });
});

describe("momentoDelPedido", () => {
  it("la hora del reloj de España, sea cual sea el origen", () => {
    expect(momentoDelPedido(web("2026-10-07T23:15:00+00:00"))).toBe("2026-10-07T23:15:00");
    // Horario de verano: UTC+2.
    expect(momentoDelPedido(crm("2026-10-07T08:00:00+00:00"))).toBe("2026-10-07T10:00:00");
    expect(momentoDelPedido(crm("2026-10-07T22:30:00+00:00"))).toBe("2026-10-08T00:30:00");
    // Invierno: UTC+1.
    expect(momentoDelPedido(crm("2026-01-15T23:30:00Z"))).toBe("2026-01-16T00:30:00");
  });

  it("su día es siempre el día del pedido", () => {
    for (const p of [
      web("2026-10-07T23:15:00+00:00"),
      crm("2026-10-07T22:30:00+00:00"),
      crm("2026-03-29T01:30:00Z"),
      { fecha_pedido: "2026-10-07", origen: null },
    ]) {
      expect(momentoDelPedido(p).slice(0, 10)).toBe(diaDelPedido(p));
    }
  });

  it("un pedido con solo el día va a las 00:00", () => {
    expect(momentoDelPedido({ fecha_pedido: "2026-10-07" })).toBe("2026-10-07T00:00:00");
  });
});

describe("ordenarPedidos", () => {
  it("ordena por la hora de España, no por lo guardado", () => {
    // El web de las 9:00 se guardó como 09:00Z; el del CRM de las 10:00, como
    // 08:00Z. Por lo guardado, el web parecería posterior.
    const a = { id: "web-9", ...web("2026-10-07T09:00:00+00:00") };
    const b = { id: "crm-10", ...crm("2026-10-07T08:00:00+00:00") };
    expect(ordenarPedidos([a, b], "reciente").map((p) => p.id)).toEqual(["crm-10", "web-9"]);
    expect(ordenarPedidos([b, a], "antiguo").map((p) => p.id)).toEqual(["web-9", "crm-10"]);
  });

  it("los que coinciden se quedan como venían y la lista original no cambia", () => {
    const lista = [
      { id: "1", ...web("2026-10-07T10:00:00+00:00") },
      { id: "2", ...web("2026-10-07T10:00:00+00:00") },
    ];
    expect(ordenarPedidos(lista, "reciente").map((p) => p.id)).toEqual(["1", "2"]);
    expect(ordenarPedidos(lista, "antiguo").map((p) => p.id)).toEqual(["1", "2"]);
    expect(lista.map((p) => p.id)).toEqual(["1", "2"]);
  });
});

describe("periodo de días", () => {
  it("la consulta pide un día más por cada lado", () => {
    expect(tramoDeConsulta("2026-10-01", "2026-10-31")).toEqual({
      desde: "2026-09-30T00:00:00Z",
      hasta: "2026-11-02T00:00:00Z",
    });
    expect(tramoDeConsulta("2027-01-01", "2027-01-01")).toEqual({
      desde: "2026-12-31T00:00:00Z",
      hasta: "2027-01-03T00:00:00Z",
    });
  });

  it("no acepta instantes: el periodo son días", () => {
    expect(() => tramoDeConsulta("2026-09-30T22:00:00.000Z", "2026-10-31")).toThrow();
  });

  it("los pedidos del borde caen en su día", () => {
    const [desde, hasta] = ["2026-10-01", "2026-10-31"];
    // Web de las 23:15 del último día: dentro (con la consulta en hora de
    // Madrid se quedaba fuera).
    expect(pedidoEnDias(web("2026-10-31T23:15:00+00:00"), desde, hasta)).toBe(true);
    // Web de las 23:30 del día anterior al periodo: fuera.
    expect(pedidoEnDias(web("2026-09-30T23:30:00+00:00"), desde, hasta)).toBe(false);
    // CRM de las 00:30 del primer día (22:30 UTC del anterior): dentro.
    expect(pedidoEnDias(crm("2026-09-30T22:30:00+00:00"), desde, hasta)).toBe(true);
    // CRM de las 00:30 del día siguiente al periodo: fuera.
    expect(pedidoEnDias(crm("2026-10-31T23:30:00+00:00"), desde, hasta)).toBe(false);
  });

  it("en un rango del selector, por los días del rango en la hora del navegador", () => {
    const octubre = { desde: new Date(2026, 9, 1), hasta: new Date(2026, 9, 31, 23, 59, 59, 999) };
    expect(pedidoEnRango(web("2026-10-31T23:15:00+00:00"), octubre)).toBe(true);
    expect(pedidoEnRango(crm("2026-09-30T22:30:00+00:00"), octubre)).toBe(true);
    expect(pedidoEnRango(crm("2026-10-31T23:30:00+00:00"), octubre)).toBe(false);
    expect(pedidoEnRango(web("2026-09-30T23:30:00+00:00"), octubre)).toBe(false);
    // Un rango vacío (el de las pantallas que no comparan) no tiene nada,
    // aunque sea de un solo día.
    const vacio = { desde: new Date(2026, 9, 7, 23, 59, 59), hasta: new Date(2026, 9, 7) };
    expect(pedidoEnRango(web("2026-10-07T12:00:00+00:00"), vacio)).toBe(false);
  });

  it("todo pedido de esos días está dentro del tramo de la consulta", () => {
    const tramo = tramoDeConsulta("2026-10-01", "2026-10-31");
    for (const p of [
      web("2026-10-01T00:00:00+00:00"),
      web("2026-10-31T23:59:59+00:00"),
      crm("2026-09-30T22:00:00+00:00"),
      crm("2026-10-31T22:59:59+00:00"),
    ]) {
      expect(pedidoEnDias(p, "2026-10-01", "2026-10-31")).toBe(true);
      const t = new Date(p.fecha_pedido).getTime();
      expect(t).toBeGreaterThanOrEqual(new Date(tramo.desde).getTime());
      expect(t).toBeLessThan(new Date(tramo.hasta).getTime());
    }
  });
});
