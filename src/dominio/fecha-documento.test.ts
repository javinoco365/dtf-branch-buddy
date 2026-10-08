import { describe, expect, it } from "vitest";
import {
  diaEnEspana,
  diaLegible,
  esRechazoPorFecha,
  fechaDocumentoDePedido,
  fechaEmision,
  notasConFechaOperacion,
} from "./fecha-documento";

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

describe("fecha de emisión cuando la serie ya tiene un documento posterior", () => {
  it("si el pedido es anterior al último de la serie, sale con la del último y la del pedido como fecha de la operación", () => {
    expect(fechaEmision("2026-09-19", "2026-10-07")).toEqual({
      fecha: "2026-10-07",
      fechaOperacion: "2026-09-19",
    });
  });

  it("el mismo día o después, la del pedido tal cual", () => {
    expect(fechaEmision("2026-10-07", "2026-10-07")).toEqual({
      fecha: "2026-10-07",
      fechaOperacion: null,
    });
    expect(fechaEmision("2026-10-08", "2026-10-07").fechaOperacion).toBeNull();
    expect(fechaEmision("2026-09-19", null)).toEqual({ fecha: "2026-09-19", fechaOperacion: null });
  });

  it("la fecha de la operación va en las notas, al final y una sola vez", () => {
    expect(diaLegible("2026-09-19")).toBe("19/09/2026");
    expect(notasConFechaOperacion(null, "2026-09-19")).toBe("Fecha de la operación: 19/09/2026");
    expect(notasConFechaOperacion("Entregar el viernes", "2026-09-19")).toBe(
      "Entregar el viernes\nFecha de la operación: 19/09/2026",
    );
    const una = notasConFechaOperacion("Entregar el viernes", "2026-09-19");
    expect(notasConFechaOperacion(una, "2026-09-19")).toBe(una);
    expect(notasConFechaOperacion("  ", null)).toBeNull();
    expect(notasConFechaOperacion(" Hola ", null)).toBe("Hola");
  });
});
