import { describe, expect, it } from "vitest";
import {
  costeAlmacenPeriodo,
  cuentaAlmacen,
  fechaEfectiva,
  valorAFecha,
  valorMovimiento,
  type MovimientoAlmacen,
} from "./cuenta-almacen";

const mov = (
  fecha: string,
  motivo: MovimientoAlmacen["motivo"],
  cantidad: number,
  coste: number,
  extra: Partial<MovimientoAlmacen> = {},
): MovimientoAlmacen => ({ fecha, motivo, cantidad, coste_unitario: coste, ...extra });

describe("fechaEfectiva y valorMovimiento", () => {
  it("la fecha si la hay; si no, el día de created_at en Madrid", () => {
    expect(fechaEfectiva({ fecha: "2026-10-05", created_at: "2026-11-30T10:00:00Z" })).toBe(
      "2026-10-05",
    );
    // 23:30 UTC del 31 de octubre son las 00:30 del 1 de noviembre en Madrid (CET).
    expect(fechaEfectiva({ fecha: null, created_at: "2026-10-31T23:30:00Z" })).toBe("2026-11-01");
    // En verano (CEST, UTC+2) también.
    expect(fechaEfectiva({ created_at: "2026-07-31T22:30:00Z" })).toBe("2026-08-01");
    expect(fechaEfectiva({})).toBe("");
    expect(fechaEfectiva({ created_at: "basura" })).toBe("");
  });

  it("valor = redondear(cantidad × coste, 2), con signo, aunque venga como texto", () => {
    expect(valorMovimiento({ cantidad: 3, coste_unitario: 3.33333333 })).toBe(10);
    expect(valorMovimiento({ cantidad: "-2", coste_unitario: "4.005" })).toBe(-8.01);
    expect(valorMovimiento({ cantidad: "x", coste_unitario: 2 })).toBe(0);
  });
});

describe("cuentaAlmacen", () => {
  const movs: MovimientoAlmacen[] = [
    // Antes del periodo.
    mov("2026-09-15", "inicial", 10, 4),
    mov("2026-09-20", "compra", 5, 6, { compra_id: "c0" }),
    // En el periodo: los siete motivos.
    mov("2026-10-01", "compra", 6, 10.5, { compra_id: "c1" }),
    mov("2026-10-02", "inicial", 2, 3),
    mov("2026-10-03", "venta", -4, 5, { textil_pedido_id: "P1" }),
    mov("2026-10-04", "devolucion_cliente", 1, 5, { textil_pedido_id: "P1" }),
    mov("2026-10-05", "merma", -2, 4),
    mov("2026-10-06", "devolucion_proveedor", -1, 5),
    mov("2026-10-07", "ajuste_inventario", 1, 3),
    mov("2026-10-08", "ajuste_inventario", -1, 2),
    // Después del periodo: no cuenta.
    mov("2026-11-02", "compra", 100, 1, { compra_id: "c2" }),
  ];

  it("partidas, identidad y descuadre 0 con los siete motivos", () => {
    const c = cuentaAlmacen(movs, "2026-10-01", "2026-10-31");
    expect(c.inicial).toEqual({ unidades: 15, valor: 70 });
    expect(c.compras).toEqual({ unidades: 6, valor: 63 });
    expect(c.altas).toEqual({ unidades: 2, valor: 6 });
    expect(c.ventas).toEqual({ unidades: 4, valor: 20 });
    expect(c.devolucionesCliente).toEqual({ unidades: 1, valor: 5 });
    expect(c.mermas).toEqual({ unidades: 2, valor: 8 });
    expect(c.devolucionesProveedor).toEqual({ unidades: 1, valor: 5 });
    expect(c.ajustes).toEqual({ unidades: 0, valor: 1 });
    expect(c.final).toEqual({ unidades: 17, valor: 112 });
    expect(c.descuadre).toEqual({ unidades: 0, valor: 0 });
    // Pérdidas: merma 8 + dev. proveedor 5 − ajustes 1 = 12 (la venta y la
    // devolución con pedido ya cuestan por pedido).
    expect(c.perdidas).toBe(12);
    // I10: compras + altas − Δ almacén = coste de lo vendido con pedido + pérdidas.
    const vendidoConPedido = 20 - 5;
    expect(63 + 6 - (c.final.valor - c.inicial.valor)).toBe(vendidoConPedido + c.perdidas);
  });

  it("inicial es todo lo anterior a desde", () => {
    const c = cuentaAlmacen(movs, "2026-10-04", "2026-10-04");
    expect(c.inicial.valor).toBe(70 + 63 + 6 - 20);
    expect(c.devolucionesCliente.valor).toBe(5);
    expect(c.compras.valor).toBe(0);
  });

  it("un movimiento sin fecha con created_at 2026-10-31T23:30Z cuenta el 1 de noviembre", () => {
    const m = [
      {
        motivo: "compra" as const,
        cantidad: 1,
        coste_unitario: 7,
        created_at: "2026-10-31T23:30:00Z",
      },
    ];
    expect(cuentaAlmacen(m, "2026-10-01", "2026-10-31").final.valor).toBe(0);
    expect(cuentaAlmacen(m, "2026-11-01", "2026-11-30").compras.valor).toBe(7);
  });

  it("pérdidas: merma 2 a 4 € (+8), dev. proveedor 1 a 5 € (+5), ajuste +1 a 3 € (−3) = 10", () => {
    const m = [
      mov("2026-10-05", "merma", -2, 4),
      mov("2026-10-06", "devolucion_proveedor", -1, 5),
      mov("2026-10-07", "ajuste_inventario", 1, 3),
    ];
    expect(costeAlmacenPeriodo(m, "2026-10-01", "2026-10-31")).toBe(10);
  });

  it("una devolución de cliente sin pedido resta; con pedido no cuenta", () => {
    expect(
      costeAlmacenPeriodo(
        [mov("2026-10-05", "devolucion_cliente", 1, 2)],
        "2026-10-01",
        "2026-10-31",
      ),
    ).toBe(-2);
    expect(
      costeAlmacenPeriodo(
        [mov("2026-10-05", "devolucion_cliente", 1, 2, { textil_pedido_id: "P" })],
        "2026-10-01",
        "2026-10-31",
      ),
    ).toBe(0);
  });

  it("una venta sin pedido cuesta en pérdidas; compras y altas nunca", () => {
    const m = [
      mov("2026-10-05", "venta", -1, 6),
      mov("2026-10-05", "compra", 3, 2),
      mov("2026-10-05", "inicial", 3, 2),
    ];
    expect(costeAlmacenPeriodo(m, "2026-10-01", "2026-10-31")).toBe(6);
  });

  it("sin movimientos, todo a cero", () => {
    const c = cuentaAlmacen([], "2026-10-01", "2026-10-31");
    expect(c.final).toEqual({ unidades: 0, valor: 0 });
    expect(c.perdidas).toBe(0);
    expect(c.descuadre).toEqual({ unidades: 0, valor: 0 });
  });

  it("muchos movimientos con céntimos: la identidad sigue exacta", () => {
    const m: MovimientoAlmacen[] = [];
    for (let i = 0; i < 300; i++) {
      const dia = String((i % 28) + 1).padStart(2, "0");
      const motivo = (
        ["compra", "venta", "merma", "ajuste_inventario", "devolucion_cliente"] as const
      )[i % 5];
      const signo = motivo === "venta" || motivo === "merma" ? -1 : 1;
      m.push(
        mov(
          `2026-${i < 150 ? "09" : "10"}-${dia}`,
          motivo,
          signo * ((i % 7) + 1),
          1 + (i % 13) / 7,
        ),
      );
    }
    const c = cuentaAlmacen(m, "2026-10-01", "2026-10-31");
    expect(c.descuadre).toEqual({ unidades: 0, valor: 0 });
  });
});

describe("valorAFecha", () => {
  it("coincide con el final de la cuenta que termina ese día", () => {
    const movs = [
      mov("2026-09-01", "inicial", 10, 2.5),
      mov("2026-10-10", "venta", -3, 2.5, { textil_pedido_id: "P" }),
      {
        motivo: "compra" as const,
        cantidad: 4,
        coste_unitario: 3.1,
        created_at: "2026-10-31T23:30:00Z",
      },
    ];
    for (const dia of ["2026-08-31", "2026-09-01", "2026-10-10", "2026-10-31", "2026-11-01"]) {
      expect(valorAFecha(movs, dia)).toEqual(cuentaAlmacen(movs, "2026-10-01", dia).final);
    }
    expect(valorAFecha(movs, "2026-10-31")).toEqual({ unidades: 7, valor: 17.5 });
    expect(valorAFecha(movs, "2026-11-01")).toEqual({ unidades: 11, valor: 29.9 });
  });
});

describe("ajuste_coste y regularización", () => {
  it("valorMovimiento de un ajuste_coste es su importe_ajuste", () => {
    expect(
      valorMovimiento({
        motivo: "ajuste_coste",
        cantidad: 0,
        coste_unitario: 0,
        importe_ajuste: "2.505",
      }),
    ).toBe(2.51);
    expect(
      valorMovimiento({
        motivo: "ajuste_coste",
        cantidad: 0,
        coste_unitario: 0,
        importe_ajuste: -3,
      }),
    ).toBe(-3);
    expect(valorMovimiento({ motivo: "ajuste_coste", cantidad: 0, coste_unitario: 5 })).toBe(0);
  });

  const movs: MovimientoAlmacen[] = [
    mov("2026-09-01", "compra", 10, 5, { compra_id: "p" }),
    mov("2026-10-02", "venta", -8, 5, { textil_pedido_id: "t1" }),
    mov("2026-10-05", "compra", 2, 6, { compra_id: "f" }),
    mov("2026-10-05", "ajuste_coste", 0, 0, { compra_id: "f", importe_ajuste: 2 }),
    mov("2026-10-05", "devolucion_proveedor", -1, 5.5, { compra_id: "f", regularizacion: true }),
    mov("2026-10-06", "devolucion_proveedor", -1, 5.5),
  ];

  it("el ajuste va a compras y no a pérdidas; la salida de regularización, a compras en negativo", () => {
    const c = cuentaAlmacen(movs, "2026-10-01", "2026-10-31");
    expect(c.compras).toEqual({ unidades: 1, valor: 8.5 });
    expect(c.devolucionesProveedor).toEqual({ unidades: 1, valor: 5.5 });
    // Solo la devolución sin marca es pérdida.
    expect(c.perdidas).toBe(5.5);
    expect(costeAlmacenPeriodo(movs, "2026-10-01", "2026-10-31")).toBe(5.5);
    expect(c.descuadre).toEqual({ unidades: 0, valor: 0 });
    expect(c.final.valor).toBe(
      Math.round(
        (c.inicial.valor + c.compras.valor - c.ventas.valor - c.devolucionesProveedor.valor) * 100,
      ) / 100,
    );
  });

  it("una devolucion_proveedor sin la marca sigue como hoy", () => {
    const c = cuentaAlmacen(
      [mov("2026-10-06", "devolucion_proveedor", -2, 4, { compra_id: "f" })],
      "2026-10-01",
      "2026-10-31",
    );
    expect(c.compras).toEqual({ unidades: 0, valor: 0 });
    expect(c.devolucionesProveedor).toEqual({ unidades: 2, valor: 8 });
    expect(c.perdidas).toBe(8);
  });
});
