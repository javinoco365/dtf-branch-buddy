import { describe, expect, it } from "vitest";
import { embudoPresupuestos, presupuestosPendientes, type PresupuestoResumen } from "./comercial";

const p = (estado: string, total: number, extra: Partial<PresupuestoResumen> = {}) =>
  ({
    id: `${estado}-${total}`,
    numero: "P-1",
    fecha: "2026-10-01",
    estado,
    total,
    validez_dias: 30,
    cliente_nombre: "Cliente",
    tienda_id: "t1",
    ...extra,
  }) satisfies PresupuestoResumen;

describe("embudo de presupuestos", () => {
  it("enviados, aceptados (el facturado del textil también) y conversión", () => {
    const e = embudoPresupuestos([
      p("borrador", 50),
      p("enviado", 100),
      p("aceptado", 200, { fecha_pedido: "2026-10-04T09:00:00" }),
      p("facturado", 300, { fecha_pedido: "2026-10-02" }),
      p("rechazado", 400),
    ]);
    expect(e.creados).toEqual({ n: 5, importe: 1050 });
    expect(e.enviados).toEqual({ n: 4, importe: 1000 });
    expect(e.aceptados).toEqual({ n: 2, importe: 500 });
    expect(e.rechazados.n).toBe(1);
    expect(e.sinRespuesta).toEqual({ n: 1, importe: 100 });
    expect(e.conversion).toBe(50);
    expect(e.conversionImporte).toBe(50);
    // 3 días y 1 día: media de 2.
    expect(e.diasAPedido).toEqual({ media: 2, n: 2 });
  });

  it("sin enviados no hay conversión", () => {
    const e = embudoPresupuestos([p("borrador", 10)]);
    expect(e.conversion).toBeNull();
    expect(e.diasAPedido).toBeNull();
  });
});

describe("presupuestos pendientes a hoy", () => {
  it("separa los que siguen en plazo de los caducados", () => {
    const hoy = new Date(2026, 9, 7, 9);
    const r = presupuestosPendientes(
      [
        p("enviado", 100, { id: "a", fecha: "2026-10-01" }), // vale hasta el 31
        p("enviado", 300, { id: "b", fecha: "2026-09-20", validez_dias: 15 }), // hasta el 5: caducado
        p("enviado", 200, { id: "c", fecha: "2026-10-06", validez_dias: 1 }), // hasta hoy: vale
        p("aceptado", 999, { id: "d" }),
      ],
      hoy,
    );
    expect(r.vigentes).toEqual({ n: 2, importe: 300 });
    expect(r.caducados).toEqual({ n: 1, importe: 300 });
    expect(r.lista.map((x) => x.id)).toEqual(["c", "a"]);
    expect(r.lista[0]).toMatchObject({ validoHasta: "2026-10-07", diasRestantes: 0 });
  });
});
