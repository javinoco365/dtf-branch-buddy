import { describe, expect, it } from "vitest";
import {
  CONCEPTOS,
  FILAS_DINERO,
  FILAS_RESULTADOS,
  FILTRO_CUENTA_TODO,
  calcularCuenta,
  cobradoDelPeriodo,
  conEstructura,
  costeMetroDeEmpresa,
  devolucionSinIva,
  devolucionesDeLaLinea,
  devolucionesDelFiltro,
  devolucionesQueCuentan,
  estructuraDelPeriodo,
  mesesDelRango,
  pctIva,
  pendienteDeCobro,
  pendienteDeCobroHoy,
  separarCuenta,
  sobreVentasNetas,
  variacionCifra,
  ventasDeLaLinea,
  ventasDelFiltro,
  ventasQueCuentan,
  type EntradaCuenta,
  type VentaCuenta,
} from "./cuenta";
import { cifrasGerencia, type GastoFijo } from "./gerencia";
import type { PedidoPendiente } from "./pendientes";
import type { CobroConsolidado } from "./facturacion";

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

describe("devoluciones", () => {
  const pedido = { subtotal: 110, iva: 23.1, envio: 10, total: 133.1 };

  it("la de un pedido cancelado no resta: ese pedido no es venta", () => {
    const d = { fecha: "2026-11-20", importe: 66.55, pedido: { ...pedido, estado: "cancelado" } };
    expect(devolucionesQueCuentan([d])).toHaveLength(0);
    expect(calcularCuenta(entrada({ devoluciones: [d] })).devoluciones.valor).toBe(0);
  });

  it("la de un pedido mixto se reparte por línea en la proporción de su total", () => {
    const mixto = { ...pedido, metros_total: 2, metros_uv: 1, bruta_uv: 30, iva_uv: 6.3 };
    const d = { fecha: "2026-11-20", importe: 133.1, pedido: mixto, tienda_id: "t1" };
    const [uv] = devolucionesDeLaLinea([d], "uv");
    const [dtf] = devolucionesDeLaLinea([d], "dtf");
    expect(Number(uv.importe)).toBeCloseTo(36.3, 6);
    expect(Number(dtf.importe)).toBeCloseTo(96.8, 6);
    // Sin IVA, las dos partes suman la devolución entera.
    expect(devolucionSinIva(uv) + devolucionSinIva(dtf)).toBeCloseTo(devolucionSinIva(d), 6);
  });

  it("la de un pedido sin UV no va a la línea UV", () => {
    const d = { fecha: "2026-11-20", importe: 10, pedido: { ...pedido, metros_total: 3 } };
    expect(devolucionesDeLaLinea([d], "uv")).toHaveLength(0);
    expect(devolucionesDeLaLinea([d], "dtf")).toHaveLength(1);
  });
});

describe("filtros", () => {
  const textil = venta({ canal: "textil", tienda_id: "textil-personalizado", metros_total: 0 });
  const sinIva = { subtotal: 1, iva: 0, envio: 0, total: 1 };

  it("el textil solo sale en «Todo»", () => {
    expect(ventasDeLaLinea([venta(), textil], "dtf")).toHaveLength(1);
    expect(ventasDeLaLinea([venta(), textil], "todo")).toHaveLength(2);
  });

  it("por tienda, las ventas y las devoluciones de esa tienda", () => {
    const v = [venta(), venta({ tienda_id: "t2" }), textil];
    expect(ventasDelFiltro(v, { tienda: "t2", linea: "todo" })).toHaveLength(1);
    expect(ventasDelFiltro(v, { tienda: "textil-personalizado", linea: "todo" })).toHaveLength(1);
    expect(ventasDelFiltro(v, FILTRO_CUENTA_TODO)).toHaveLength(3);
    const d = [
      { fecha: "2026-11-02", importe: 5, tienda_id: "t1", pedido: sinIva },
      { fecha: "2026-11-02", importe: 5, tienda_id: "t2", pedido: sinIva },
    ];
    expect(devolucionesDelFiltro(d, { tienda: "t1", linea: "todo" })).toHaveLength(1);
  });

  it("solo sin filtros hay estructura", () => {
    expect(conEstructura(FILTRO_CUENTA_TODO)).toBe(true);
    expect(conEstructura({ tienda: "t1", linea: "todo" })).toBe(false);
    expect(conEstructura({ tienda: "todas", linea: "uv" })).toBe(false);
  });
});

describe("estructura del periodo", () => {
  const gasto = (g: Partial<GastoFijo>): GastoFijo => ({
    id: "g",
    concepto: "Alquiler",
    importe_mensual: 300,
    desde: "2026-01-01",
    hasta: null,
    ...g,
  });
  const noviembre = { desde: new Date(2026, 10, 1), hasta: new Date(2026, 10, 30, 23, 59, 59) };

  it("los gastos fijos del periodo y el almacén; sin nóminas, lo dice", () => {
    const e = estructuraDelPeriodo([gasto({})], noviembre, 7);
    expect(e.fijos).toBe(300);
    expect(e.compras).toBe(0);
    expect(e.almacen).toBe(7);
    expect(e.conNominas).toBe(false);
  });

  it("con una nómina dada de alta, está completa", () => {
    const e = estructuraDelPeriodo([gasto({ tipo: "nomina" })], noviembre, 0);
    expect(e.conNominas).toBe(true);
  });
});

describe("dinero", () => {
  const pendiente = (p: Partial<PedidoPendiente>): PedidoPendiente => ({
    tipo: "tienda",
    id: "p",
    tienda_id: "t1",
    numero: "1",
    fecha: "2026-11-01",
    cliente_id: null,
    cliente_nombre: null,
    origen: "manual",
    estado: "entregado",
    total: 100,
    cobrado: 0,
    pendiente: 100,
    ultimo_cobro: null,
    ...p,
  });

  it("lo pendiente de cobro no cuenta la web sin pagar", () => {
    const lista = [
      pendiente({}),
      pendiente({ id: "w", origen: "woocommerce", estado: "pendiente", pendiente: 40 }),
      pendiente({ id: "x", tipo: "textil", tienda_id: null, origen: "textil", pendiente: 20 }),
    ];
    expect(pendienteDeCobroHoy(lista, FILTRO_CUENTA_TODO)).toBe(120);
    expect(pendienteDeCobroHoy(lista, { tienda: "textil-personalizado", linea: "todo" })).toBe(20);
    expect(pendienteDeCobroHoy(lista, { tienda: "t1", linea: "dtf" })).toBe(100);
  });

  it("lo cobrado, por tienda y por línea", () => {
    const cobro = (c: Partial<CobroConsolidado>) =>
      ({
        importe: 10,
        tienda_id: "t1",
        pedido_id: "a",
        propina: 0,
        base: 0,
        iva: 0,
        envio: 0,
        metros: 0,
        ...c,
      }) as CobroConsolidado;
    const cobros = [
      cobro({}),
      cobro({ pedido_id: "u", importe: 5 }),
      cobro({ tienda_id: "textil-personalizado", importe: 7 }),
    ];
    expect(cobradoDelPeriodo(cobros, FILTRO_CUENTA_TODO)).toBe(22);
    expect(cobradoDelPeriodo(cobros, { tienda: "t1", linea: "uv" }, new Set(["u"]))).toBe(5);
    expect(cobradoDelPeriodo(cobros, { tienda: "todas", linea: "dtf" }, new Set(["u"]))).toBe(10);
  });
});

describe("separar en columnas", () => {
  it("por tienda: una columna por tienda con ventas, sin estructura, y suman el todo", () => {
    const v = [venta(), venta({ tienda_id: "t2", coste_envio_real: 4 })];
    const cols = separarCuenta(entrada({ ventas: v }), "tienda", {
      tiendas: [
        { id: "t1", nombre: "Uno" },
        { id: "t2", nombre: "Dos" },
        { id: "t3", nombre: "Sin ventas" },
      ],
    });
    expect(cols.map((c) => c.titulo)).toEqual(["Uno", "Dos"]);
    expect(cols[0].cuenta.gastos_estructura.valor).toBeNull();
    const todo = calcularCuenta(entrada({ ventas: v }));
    const suma =
      (cols[0].cuenta.margen_bruto.valor ?? 0) + (cols[1].cuenta.margen_bruto.valor ?? 0);
    expect(suma).toBe(todo.margen_bruto.valor);
  });

  it("por línea: DTF, DTF UV y el textil aparte", () => {
    const textil = venta({ canal: "textil", tienda_id: "textil-personalizado", metros_total: 0 });
    const cols = separarCuenta(entrada({ ventas: [venta(), textil] }), "linea");
    expect(cols.map((c) => c.clave)).toEqual(["dtf", "uv", "textil"]);
    expect(cols[2].cuenta.pedidos).toBe(1);
  });

  it("por mes: cada venta y cada devolución en su mes, con la estructura de cada mes", () => {
    const v = [venta({ fecha_pedido: "2026-10-05T10:00:00.000Z" }), venta()];
    const d = [
      {
        fecha: "2026-11-03",
        importe: 13.31,
        pedido: { subtotal: 110, iva: 23.1, envio: 10, total: 133.1 },
      },
    ];
    const cols = separarCuenta(entrada({ ventas: v, devoluciones: d }), "mes", {
      rango: { desde: new Date(2026, 9, 1), hasta: new Date(2026, 10, 30, 23, 59, 59) },
      estructuraDe: () => ({
        fijos: 10,
        compras: 0,
        amortizacion: 0,
        almacen: 0,
        conNominas: true,
      }),
    });
    expect(cols).toHaveLength(2);
    expect(cols[0].cuenta.pedidos).toBe(1);
    expect(cols[0].cuenta.devoluciones.valor).toBe(0);
    expect(cols[1].cuenta.devoluciones.valor).toBe(11);
    expect(cols[1].cuenta.gastos_estructura.valor).toBe(10);
  });

  it("por mes, sin estructura en la entrada (un filtro), los meses tampoco la tienen", () => {
    const cols = separarCuenta(entrada({ estructura: null }), "mes", {
      rango: { desde: new Date(2026, 10, 1), hasta: new Date(2026, 10, 30) },
      estructuraDe: () => ({
        fijos: 10,
        compras: 0,
        amortizacion: 0,
        almacen: 0,
        conNominas: true,
      }),
    });
    expect(cols[0].cuenta.gastos_estructura.valor).toBeNull();
  });

  it("los meses de un rango, recortados", () => {
    const m = mesesDelRango({ desde: new Date(2026, 9, 15), hasta: new Date(2026, 10, 5) });
    expect(m).toHaveLength(2);
    expect(m[0].desde.getDate()).toBe(15);
    expect(m[1].hasta.getDate()).toBe(5);
  });
});

describe("para pintar", () => {
  it("variación y % sobre ventas netas, nulas si falta algo", () => {
    expect(variacionCifra({ valor: 110 }, { valor: 100 })).toBe(10);
    expect(variacionCifra({ valor: null }, { valor: 100 })).toBeNull();
    expect(variacionCifra({ valor: 1 }, undefined)).toBeNull();
    expect(sobreVentasNetas({ valor: 25 }, { valor: 100 })).toBe(25);
    expect(sobreVentasNetas({ valor: 25 }, { valor: 0 })).toBeNull();
  });

  it("el IVA sobre la base y el coste por metro de la empresa", () => {
    expect(pctIva(21, 100)).toBe(21);
    expect(pctIva(0, 0)).toBeNull();
    expect(
      costeMetroDeEmpresa({
        coste_consumibles_metro: "1.5",
        coste_packaging_metro: 0.25,
        coste_electricidad_metro: null,
      }),
    ).toBe(1.75);
    expect(costeMetroDeEmpresa(null)).toBe(0);
  });

  it("las filas: la cascada y el dinero, en su orden", () => {
    expect(FILAS_RESULTADOS[0].clave).toBe("ventas_con_iva");
    expect(FILAS_RESULTADOS.at(-1)?.clave).toBe("beneficio_neto");
    expect(FILAS_DINERO.map((c) => c.clave)).toEqual([
      "cobrado",
      "pendiente_cobro",
      "pendiente_pago",
    ]);
  });
});
