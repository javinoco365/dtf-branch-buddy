import { describe, expect, it } from "vitest";
import {
  CONCEPTOS,
  calcularCuenta,
  devolucionSinIva,
  pendienteDeCobro,
  pendienteDeFactura,
  totalFacturado,
  ventasDeLaLinea,
  ventasQueCuentan,
  type EntradaCuenta,
  type VentaCuenta,
} from "./cuenta";
import { cifrasGerencia } from "./gerencia";

/** Un pedido de tienda: 100 € de trabajo + 10 € de envío, IVA 21 %. */
const venta = (v: Partial<VentaCuenta> = {}): VentaCuenta => ({
  fecha_pedido: "2026-11-05T10:00:00.000Z",
  tienda_id: "t1",
  estado: "entregado",
  subtotal: 110,
  iva: 23.1,
  envio: 10,
  total: 133.1,
  metros_total: 5,
  coste_metro_snapshot: 4,
  canal: "manual",
  cliente_id: null,
  coste_envio_real: 10,
  con_envio: true,
  ...v,
});

const entrada = (e: Partial<EntradaCuenta> = {}): EntradaCuenta => ({
  ventas: [venta()],
  devoluciones: [],
  costeMetroActual: 4,
  costeEnvioDefecto: 6,
  estructura: { fijos: 30, compras: 5, amortizacion: 3, almacen: 2, conNominas: true },
  tipoIs: 25,
  ...e,
});

describe("el diccionario", () => {
  it("tiene claves únicas y textos cortos", () => {
    const claves = CONCEPTOS.map((c) => c.clave);
    expect(new Set(claves).size).toBe(claves.length);
    for (const c of CONCEPTOS) {
      expect(c.nombre.length).toBeLessThanOrEqual(30);
      expect(c.definicion.length).toBeLessThanOrEqual(120);
    }
  });
});

describe("qué ventas cuentan", () => {
  it("ni canceladas ni web sin pagar; un manual pendiente sí", () => {
    const v = [
      venta({ estado: "cancelado" }),
      venta({ canal: "web", estado: "pendiente" }),
      venta({ canal: "manual", estado: "pendiente" }),
      venta({ canal: "web", estado: "entregado" }),
    ];
    expect(ventasQueCuentan(v)).toHaveLength(2);
  });
});

describe("la cascada", () => {
  it("de las ventas con IVA al beneficio neto", () => {
    const c = calcularCuenta(entrada());
    expect(c.ventas_con_iva.valor).toBe(133.1);
    expect(c.iva.valor).toBe(23.1);
    expect(c.portes_cobrados.valor).toBe(10);
    expect(c.ventas.valor).toBe(100);
    expect(c.devoluciones.valor).toBe(0);
    expect(c.ventas_netas.valor).toBe(100);
    expect(c.coste_produccion.valor).toBe(20);
    expect(c.resultado_portes.valor).toBe(0);
    expect(c.margen_bruto.valor).toBe(80);
    expect(c.gastos_estructura.valor).toBe(40);
    expect(c.beneficio_antes_impuestos.valor).toBe(40);
    expect(c.sociedades).toMatchObject({ valor: 10, estimado: true });
    expect(c.beneficio_neto).toMatchObject({ valor: 30, estimado: true });
    expect(c.margenPct).toBe(80);
    expect(c.ticketMedio).toBe(100);
  });

  it("cuadra con el margen de Gerencia cuando el envío cuesta lo cobrado y no hay devoluciones", () => {
    const ventas = [venta(), venta({ metros_total: 2, coste_metro_snapshot: null, total: 60.5 })];
    const c = calcularCuenta(entrada({ ventas }));
    expect(c.margen_bruto.valor).toBe(cifrasGerencia(ventas, 4).margen);
  });

  it("el envío real cuenta: si la agencia cobra menos, se gana", () => {
    const c = calcularCuenta(entrada({ ventas: [venta({ coste_envio_real: 7 })] }));
    expect(c.resultado_portes.valor).toBe(3);
    expect(c.margen_bruto.valor).toBe(83);
  });

  it("sin coste de envío apuntado se estima y se dice", () => {
    const c = calcularCuenta(entrada({ ventas: [venta({ coste_envio_real: null })] }));
    expect(c.resultado_portes).toMatchObject({ valor: 4, estimado: true });
    expect(c.resultado_portes.nota).toMatch(/estimado en 1 pedido/);
    expect(c.margen_bruto.estimado).toBe(true);
  });

  it("las devoluciones restan el día del reembolso, sin IVA", () => {
    const pedido = { subtotal: 110, iva: 23.1, envio: 10, total: 133.1 };
    const d = { fecha: "2026-11-20", importe: 66.55, pedido };
    expect(devolucionSinIva(d)).toBeCloseTo(55, 6);
    const c = calcularCuenta(entrada({ devoluciones: [d] }));
    expect(c.devoluciones.valor).toBe(55);
    expect(c.ventas.valor).toBe(100);
    expect(c.ventas_netas.valor).toBe(45);
  });

  it("textil sin salida de almacén: coste estimado y dicho", () => {
    const textil = venta({
      canal: "textil",
      metros_total: 0,
      coste_textil: null,
      envio: 0,
      subtotal: 50,
      iva: 10.5,
      total: 60.5,
    });
    const c = calcularCuenta(entrada({ ventas: [textil] }));
    expect(c.coste_produccion).toMatchObject({ valor: 0, estimado: true });
    expect(c.coste_produccion.nota).toMatch(/1 pedido textil/);
  });

  it("con filtro de tienda o línea no hay gastos ni beneficio: no se inventa un reparto", () => {
    const c = calcularCuenta(entrada({ estructura: null }));
    expect(c.margen_bruto.valor).toBe(80);
    for (const k of [
      "gastos_estructura",
      "beneficio_antes_impuestos",
      "sociedades",
      "beneficio_neto",
    ] as const) {
      expect(c[k].valor).toBeNull();
      expect(c[k].falta).toMatch(/todas las tiendas/);
    }
  });

  it("sin nóminas, la estructura está incompleta y lo dice", () => {
    const c = calcularCuenta(
      entrada({
        estructura: { fijos: 30, compras: 0, amortizacion: 0, almacen: 0, conNominas: false },
      }),
    );
    expect(c.gastos_estructura).toMatchObject({ valor: 30, estimado: true });
    expect(c.beneficio_antes_impuestos.estimado).toBe(true);
  });

  it("sin tipo del impuesto, no hay neto", () => {
    const c = calcularCuenta(entrada({ tipoIs: null }));
    expect(c.beneficio_antes_impuestos.valor).toBe(40);
    expect(c.sociedades.valor).toBeNull();
    expect(c.beneficio_neto.valor).toBeNull();
  });

  it("con pérdidas no hay impuesto", () => {
    const c = calcularCuenta(
      entrada({
        estructura: { fijos: 200, compras: 0, amortizacion: 0, almacen: 0, conNominas: true },
      }),
    );
    expect(c.beneficio_antes_impuestos.valor).toBe(-120);
    expect(c.sociedades.valor).toBe(0);
    expect(c.beneficio_neto.valor).toBe(-120);
  });

  it("el impuesto sobre la base que se le dé (lo documentado)", () => {
    const c = calcularCuenta(entrada({ baseSociedades: 20 }));
    expect(c.sociedades.valor).toBe(5);
    expect(c.beneficio_neto.valor).toBe(35);
  });

  it("sin ventas, ni margen % ni ticket medio", () => {
    const c = calcularCuenta(entrada({ ventas: [] }));
    expect(c.margenPct).toBeNull();
    expect(c.ticketMedio).toBeNull();
    expect(c.pedidos).toBe(0);
  });

  it("el dinero que no se ha leído es nulo, nunca cero", () => {
    const c = calcularCuenta(entrada({ dinero: { cobrado: 50 } }));
    expect(c.cobrado.valor).toBe(50);
    expect(c.pendiente_cobro.valor).toBeNull();
    expect(c.pendiente_pago.falta).toBeTruthy();
  });

  it("las partes suman el todo (filas 1 a 9)", () => {
    const a = [venta(), venta({ coste_envio_real: 4 })];
    const b = [venta({ metros_total: 1, total: 50, subtotal: 41.32, iva: 8.68, envio: 0 })];
    const ca = calcularCuenta(entrada({ ventas: a }));
    const cb = calcularCuenta(entrada({ ventas: b }));
    const ct = calcularCuenta(entrada({ ventas: [...a, ...b] }));
    for (const k of [
      "ventas_con_iva",
      "iva",
      "portes_cobrados",
      "ventas",
      "ventas_netas",
      "coste_produccion",
      "resultado_portes",
      "margen_bruto",
    ] as const) {
      expect([k, ct[k].valor]).toEqual([k, (ca[k].valor ?? 0) + (cb[k].valor ?? 0)]);
    }
  });
});

describe("por línea", () => {
  it("un pedido mixto se parte: el UV va a su línea", () => {
    const mixto = venta({
      metros_total: 2,
      metros_uv: 1,
      coste_uv_snapshot: 15,
      bruta_uv: 30,
      iva_uv: 6.3,
    });
    const dtf = calcularCuenta(
      entrada({ ventas: ventasDeLaLinea([mixto], "dtf"), estructura: null }),
    );
    const uv = calcularCuenta(
      entrada({ ventas: ventasDeLaLinea([mixto], "uv"), estructura: null }),
    );
    const todo = calcularCuenta(entrada({ ventas: [mixto], estructura: null }));
    expect(uv.ventas.valor).toBe(30);
    expect(uv.coste_produccion.valor).toBe(15);
    expect((dtf.ventas.valor ?? 0) + (uv.ventas.valor ?? 0)).toBe(todo.ventas.valor);
    expect(uv.metrosUv).toBe(1);
    expect(dtf.metros).toBe(2);
  });
});

describe("pendiente de cobro", () => {
  it("total − cobrado − devuelto por pedido, sin bajar de cero ni contar cancelados", () => {
    expect(
      pendienteDeCobro([
        { estado: "entregado", total: 100, cobrado: 40 },
        { estado: "entregado", total: 100, cobrado: 130 },
        { estado: "entregado", total: 100, devuelto: 100, cobrado: 0 },
        { estado: "cancelado", total: 100, cobrado: 0 },
      ]),
    ).toBe(60);
  });
});

describe("pendiente de una factura", () => {
  it("resta lo cobrado de su pedido y no cuenta borradores", () => {
    expect(pendienteDeFactura({ estado: "emitida", total: 100, cobrado: 0 })).toBe(100);
    expect(pendienteDeFactura({ estado: "emitida", total: 100, cobrado: 40 })).toBe(60);
    expect(pendienteDeFactura({ estado: "vencida", total: 100, cobrado: 150 })).toBe(0);
    expect(pendienteDeFactura({ estado: "borrador", total: 100, cobrado: 0 })).toBe(0);
  });
});

describe("lo facturado", () => {
  it("un ticket canjeado cuenta una vez; sin borradores ni anuladas", () => {
    expect(
      totalFacturado([
        { id: "t", total: 100, estado: "emitida" },
        { id: "f", total: 100, estado: "emitida", sustituye_a_id: "t" },
        { id: "b", total: 50, estado: "borrador" },
        { id: "a", total: 70, estado: "anulada" },
        { id: "r", total: -20, estado: "emitida" },
      ]),
    ).toBe(80);
  });

  it("si la factura del canje se anula, vuelve a contar el ticket", () => {
    expect(
      totalFacturado([
        { id: "t", total: 100, estado: "emitida" },
        { id: "f", total: 100, estado: "anulada", sustituye_a_id: "t" },
      ]),
    ).toBe(100);
  });
});
