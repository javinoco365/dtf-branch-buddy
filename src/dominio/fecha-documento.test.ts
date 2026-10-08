import { describe, expect, it } from "vitest";
import { diaEnEspana, fechaDocumentoDePedido } from "./fecha-documento";

describe("fecha del documento de un pedido", () => {
  it("un día se queda como está (pedidos textil)", () => {
    expect(fechaDocumentoDePedido("2026-10-07")).toBe("2026-10-07");
  });

  it("un instante se pasa a día en hora de España, no en UTC", () => {
    // 22:30 UTC del 7 de octubre (horario de verano) son las 00:30 del 8 en Madrid.
    expect(fechaDocumentoDePedido("2026-10-07T22:30:00Z")).toBe("2026-10-08");
    expect(fechaDocumentoDePedido("2026-10-07T21:30:00+00:00")).toBe("2026-10-07");
    // En invierno, UTC+1: las 23:30 UTC del 15 de enero son las 00:30 del 16.
    expect(fechaDocumentoDePedido("2026-01-15T23:30:00Z")).toBe("2026-01-16");
  });

  it("sin fecha o con basura, el día de hoy en España", () => {
    const hoy = new Date("2026-10-08T10:00:00Z");
    expect(fechaDocumentoDePedido(null, hoy)).toBe("2026-10-08");
    expect(fechaDocumentoDePedido("", hoy)).toBe("2026-10-08");
    expect(fechaDocumentoDePedido("no es una fecha", hoy)).toBe("2026-10-08");
  });

  it("diaEnEspana", () => {
    expect(diaEnEspana(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });
});
