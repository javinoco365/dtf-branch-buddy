import { describe, expect, it } from "vitest";
import { diaEnEspana, esRechazoPorFecha, fechaDocumentoDePedido } from "./fecha-documento";

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

  it("un pedido de WooCommerce: la hora es la de la web, guardada como si fuera UTC", () => {
    // Pedido de las 23:30 del 7 en la web: no pasa al día 8.
    expect(fechaDocumentoDePedido("2026-10-07T23:30:00+00:00", { horaDeLaWeb: true })).toBe(
      "2026-10-07",
    );
    expect(fechaDocumentoDePedido("2026-10-07T00:10:00+00:00", { horaDeLaWeb: true })).toBe(
      "2026-10-07",
    );
  });

  it("sin fecha o con basura, el día de hoy en España", () => {
    const hoy = new Date("2026-10-08T10:00:00Z");
    expect(fechaDocumentoDePedido(null, { hoy })).toBe("2026-10-08");
    expect(fechaDocumentoDePedido("", { hoy })).toBe("2026-10-08");
    expect(fechaDocumentoDePedido("no es una fecha", { hoy })).toBe("2026-10-08");
  });

  it("reconoce el rechazo de la base por fecha anterior a la última de la serie", () => {
    expect(
      esRechazoPorFecha(
        "No se puede emitir con fecha 01/10/2026 : la última factura de la serie es del 07/10/2026.",
      ),
    ).toBe(true);
    expect(esRechazoPorFecha("Este pedido ya tiene documento")).toBe(false);
  });

  it("diaEnEspana", () => {
    expect(diaEnEspana(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });
});
