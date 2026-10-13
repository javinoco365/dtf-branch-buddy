import { describe, expect, it } from "vitest";
import { cargoDeFactura, comprasAbsorbidas, gastosFijosDelRango, type GastoFijo } from "./gerencia";
import { cargosDelRango, impuestosPorTrimestre } from "./impuestos";
import { gastosFijosPorGrupo } from "./grupos";
import type { CompraResumen } from "./fiscal";
import {
  calcularCompra,
  cambiarLineaCompra,
  categoriaCompra,
  comparacionCompras,
  comprasQueCuentan,
  costeUnitarioDeImporte,
  descuadreLiquido,
  importeLineaCompra,
  importesDeCompra,
  lineaCompraNueva,
  TIPO_IVA_GENERAL,
  TIPOS_IVA,
  tipoIrpfProbable,
  tipoProbable,
  comprasParaComparar,
  gastosConCompras,
  mesesDeAmortizacion,
} from "./compras";

const d = (a: number, m: number, dia: number) => new Date(a, m - 1, dia);
const fin = (a: number, m: number, dia: number) => new Date(a, m - 1, dia, 23, 59, 59);

const alquiler: GastoFijo = {
  id: "alq",
  concepto: "Alquiler",
  importe_mensual: 1000,
  desde: "2026-01-01",
  hasta: null,
  periodicidad: "mensual",
  tipo: "alquiler",
  iva_pct: 21,
  irpf_pct: 19,
};

const compra = (id: string, extra: Partial<CompraResumen>): CompraResumen => ({
  id,
  estado: "registrada",
  fecha: "2026-03-10",
  base: 100,
  iva: 21,
  irpf: 0,
  total: 121,
  categoria: "otros",
  gasto_id: null,
  ...extra,
});

describe("categorías", () => {
  it("sin categoría es textil; desconocida, textil", () => {
    expect(categoriaCompra(null).trato).toBe("stock");
    expect(categoriaCompra("consumibles").trato).toBe("comparar");
    expect(categoriaCompra("maquinaria").amortizacion).toBe(12);
  });
  it("12 % al año son 100 meses; 25 %, 48", () => {
    expect(mesesDeAmortizacion(12)).toBe(100);
    expect(mesesDeAmortizacion(25)).toBe(48);
  });
});

describe("factura enlazada a un gasto fijo", () => {
  it("cada factura cae en el cargo de su mes", () => {
    expect(cargoDeFactura(alquiler, "2026-01-31")).toBe(0);
    expect(cargoDeFactura(alquiler, "2026-03-01")).toBe(2);
    expect(cargoDeFactura(alquiler, "2025-12-31")).toBeNull();
    const trimestral = { ...alquiler, periodicidad: "trimestral" as const };
    expect(cargoDeFactura(trimestral, "2026-03-31")).toBe(0);
    expect(cargoDeFactura(trimestral, "2026-04-02")).toBe(1);
    expect(cargoDeFactura({ ...alquiler, hasta: "2026-02-28" }, "2026-03-05")).toBeNull();
  });

  it("marzo cuesta lo de la factura; los demás meses, la estimación", () => {
    const [g] = gastosConCompras(
      [alquiler],
      [compra("f", { base: 1100, iva: 231, irpf: 209, total: 1122, gasto_id: "alq" })],
    );
    expect(gastosFijosDelRango([g], { desde: d(2026, 3, 1), hasta: fin(2026, 3, 31) })).toBe(1100);
    expect(gastosFijosDelRango([g], { desde: d(2026, 4, 1), hasta: fin(2026, 4, 30) })).toBe(1000);
    // Y sus impuestos son los de la factura.
    const [c] = cargosDelRango([g], { desde: d(2026, 3, 1), hasta: d(2026, 3, 31) });
    expect(c).toMatchObject({ base: 1100, iva: 231, irpf: 209, aPagar: 1122 });
  });

  it("su IVA no se cuenta dos veces en el 303", () => {
    const compras = [compra("f", { base: 1000, iva: 210, irpf: 190, gasto_id: "alq" })];
    const gastos = gastosConCompras([alquiler], compras);
    expect(comprasAbsorbidas(gastos)).toEqual(new Set(["f"]));
    const [q1] = impuestosPorTrimestre({
      rango: { desde: d(2026, 1, 1), hasta: fin(2026, 3, 31) },
      documentos: [],
      compras,
      gastos,
      cuotaIsAnterior: null,
      primeraVenta: null,
    });
    // Tres alquileres de 210 de IVA y 190 de retención: la factura es uno de ellos.
    expect(q1).toMatchObject({ ivaSoportado: 630, irpf115: 570, irpf111: 0 });
  });

  it("una factura fuera de las fechas del gasto cuenta como compra suelta", () => {
    const gastos = gastosConCompras(
      [{ ...alquiler, desde: "2026-06-01" }],
      [compra("f", { fecha: "2026-03-10", gasto_id: "alq" })],
    );
    expect(gastos.map((g) => g.id)).toEqual(["alq", "compra:f"]);
  });
});

describe("compras que cuestan como un gasto", () => {
  const compras = [
    compra("pub", { categoria: "publicidad", base: 300 }),
    compra("tinta", { categoria: "consumibles", base: 500 }),
    compra("ropa", { categoria: "textil", base: 800 }),
    compra("seur", { categoria: "envios", base: 40 }),
    compra("maq", { categoria: "maquinaria", base: 12000, fecha: "2026-01-01" }),
    compra("b", { categoria: "publicidad", estado: "borrador", base: 999 }),
  ];
  const gastos = gastosConCompras([], compras);

  it("la publicidad cuesta el día de la factura; la tinta, la ropa y la mensajería no", () => {
    const marzo = gastosFijosPorGrupo(gastos, { desde: d(2026, 3, 1), hasta: fin(2026, 3, 31) });
    expect(marzo.compras).toBe(300);
    expect(marzo.a).toBe(0);
  });

  it("una máquina de 12.000 € al 12 % son 120 € al mes durante 100 meses", () => {
    const marzo = gastosFijosPorGrupo(gastos, { desde: d(2026, 3, 1), hasta: fin(2026, 3, 31) });
    expect(marzo.amortizacion).toBe(120);
    const anio = gastosFijosPorGrupo(gastos, { desde: d(2026, 1, 1), hasta: fin(2026, 12, 31) });
    expect(anio.amortizacion).toBe(1440);
    // Al final queda amortizada entera, ni un euro más.
    const todo = gastosFijosPorGrupo(gastos, { desde: d(2026, 1, 1), hasta: fin(2036, 12, 31) });
    expect(todo.amortizacion).toBe(12000);
  });

  it("lo comprado de tinta y mensajería, para comparar con lo de los pedidos", () => {
    expect(comprasParaComparar(compras, { desde: d(2026, 3, 1), hasta: fin(2026, 3, 31) })).toEqual(
      { consumibles: 500, envios: 40 },
    );
  });

  it("la comparación dice cuánto se compra de más", () => {
    const [tinta, envios] = comparacionCompras(
      { consumibles: 500, envios: 40 },
      { produccion: 420, envios: 55.5 },
    );
    expect(tinta).toEqual({
      concepto: "Consumibles DTF",
      comprado: 500,
      estimado: 420,
      diferencia: 80,
    });
    expect(envios.diferencia).toBe(-15.5);
  });

  it("las compras no llevan IVA ni retención como gasto: van con la compra", () => {
    const [q1] = impuestosPorTrimestre({
      rango: { desde: d(2026, 1, 1), hasta: fin(2026, 3, 31) },
      documentos: [],
      compras: [...compras, compra("abog", { categoria: "servicios", irpf: 15 })],
      gastos,
      cuotaIsAnterior: null,
      primeraVenta: null,
    });
    // IVA de las 6 registradas (21 cada una) y la retención del abogado al 111.
    expect(q1).toMatchObject({ ivaSoportado: 126, irpf111: 15 });
  });
});

describe("importes de una factura recibida", () => {
  it("los mismos redondeos que la base", () => {
    expect(calcularCompra({ base: 33.33, tipo_iva: 0.21, tipo_irpf: 0 })).toEqual({
      cuotaIva: 7,
      cuotaIrpf: 0,
      total: 40.33,
      liquido: 40.33,
    });
    expect(calcularCompra({ base: 0.05, tipo_iva: 0.21, tipo_irpf: 0 }).cuotaIva).toBe(0.01);
    expect(calcularCompra({ base: 12.5, tipo_iva: 0.21, tipo_irpf: 0.15 })).toEqual({
      cuotaIva: 2.63,
      cuotaIrpf: 1.88,
      total: 15.13,
      liquido: 13.25,
    });
    // El alquiler: se paga el líquido, no el total.
    expect(calcularCompra({ base: 1000, tipo_iva: 0.21, tipo_irpf: 0.19 })).toEqual({
      cuotaIva: 210,
      cuotaIrpf: 190,
      total: 1210,
      liquido: 1020,
    });
  });

  it("cualquier céntimo de descuadre se tiene que resolver", () => {
    expect(descuadreLiquido(1020, 1020)).toBeNull();
    expect(descuadreLiquido(1020, 1019.99)).toBe(-0.01);
    expect(descuadreLiquido(40.33, 40.3)).toBe(-0.03);
  });

  it("el tipo que explica la cuota leída; si ninguno, lo elige la persona", () => {
    expect(tipoProbable(100, 21)).toBe(0.21);
    expect(tipoProbable(33.33, 7)).toBe(0.21);
    expect(tipoProbable(100, 10)).toBe(0.1);
    expect(tipoProbable(100, 15.5)).toBeNull(); // 21 % y 10 % mezclados
    expect(tipoProbable(0, 0)).toBe(0);
    expect(tipoIrpfProbable(1000, 190)).toBe(0.19);
    expect(tipoIrpfProbable(200, 30)).toBe(0.15);
  });

  it("cuentan los importes de la base; los impresos si vale la factura; las borradas, nada", () => {
    const fila = compra("x", {
      base: 100,
      iva: 20,
      irpf: 0,
      total: 120,
      cuota_iva: 21,
      cuota_irpf: 0,
      liquido: 121,
      liquido_origen: "calculado",
    });
    expect(importesDeCompra(fila)).toMatchObject({ iva: 21, total: 121 });
    expect(importesDeCompra({ ...fila, liquido_origen: "factura", liquido: 120 })).toMatchObject({
      iva: 20,
      total: 120,
    });
    expect(importesDeCompra({ ...fila, borrada_en: "2026-10-07T10:00:00Z" })).toBeNull();
    // Sin la migración, lo guardado.
    expect(importesDeCompra(compra("y", { iva: 21 }))).toMatchObject({ iva: 21 });
    expect(comprasQueCuentan([fila, { ...fila, id: "b", borrada_en: "2026-10-07" }])).toHaveLength(
      1,
    );
  });
});

describe("líneas de una factura recibida", () => {
  const linea = { descripcion: "Camiseta", cantidad: 3, precio_unitario: 2.5, importe: 7.5 };

  it("el importe es cantidad por coste, al céntimo", () => {
    expect(importeLineaCompra({ cantidad: 3, precio_unitario: 1.115 })).toBe(3.35);
    expect(importeLineaCompra({ cantidad: "2", precio_unitario: "0.1" })).toBe(0.2);
    expect(importeLineaCompra({ cantidad: null, precio_unitario: 4 })).toBe(0);
  });

  it("cambiar la cantidad o el coste recalcula el importe", () => {
    expect(cambiarLineaCompra(linea, { cantidad: 4 })).toMatchObject({ cantidad: 4, importe: 10 });
    expect(cambiarLineaCompra(linea, { precio_unitario: 3.333 })).toMatchObject({
      precio_unitario: 3.333,
      importe: 10,
    });
  });

  it("cambiar el importe se queda con él y recalcula el coste, a cuatro decimales", () => {
    // El papel trae 3 × 10 = 27: un descuento.
    expect(cambiarLineaCompra({ ...linea, precio_unitario: 10 }, { importe: 27 })).toMatchObject({
      cantidad: 3,
      precio_unitario: 9,
      importe: 27,
    });
    expect(cambiarLineaCompra(linea, { importe: 10 })).toMatchObject({
      precio_unitario: 3.3333,
      importe: 10,
    });
    expect(cambiarLineaCompra(linea, { importe: 0 })).toMatchObject({
      precio_unitario: 0,
      importe: 0,
    });
  });

  it("con el importe corregido, cambiar luego la cantidad vuelve a calcular el importe", () => {
    const corregida = cambiarLineaCompra({ ...linea, cantidad: 2 }, { importe: 27 });
    expect(corregida).toMatchObject({ cantidad: 2, precio_unitario: 13.5, importe: 27 });
    expect(cambiarLineaCompra(corregida, { cantidad: 3 })).toMatchObject({
      cantidad: 3,
      precio_unitario: 13.5,
      importe: 40.5,
    });
    // Y si después se escribe el importe del papel, el coste se ajusta otra vez.
    expect(
      cambiarLineaCompra(cambiarLineaCompra(corregida, { cantidad: 3 }), { importe: 27 }),
    ).toMatchObject({ cantidad: 3, precio_unitario: 9, importe: 27 });
  });

  it("con cantidad 0 el importe escrito se queda y el coste no cambia", () => {
    expect(cambiarLineaCompra({ ...linea, cantidad: 0 }, { importe: 12 })).toMatchObject({
      cantidad: 0,
      precio_unitario: 2.5,
      importe: 12,
    });
  });

  it("si llegan a la vez el importe y el coste, se quedan los dos", () => {
    expect(cambiarLineaCompra(linea, { precio_unitario: 10, importe: 27 })).toMatchObject({
      precio_unitario: 10,
      importe: 27,
    });
    // El importe y la cantidad a la vez: el coste sale de los dos nuevos.
    expect(cambiarLineaCompra(linea, { cantidad: 4, importe: 30 })).toMatchObject({
      cantidad: 4,
      precio_unitario: 7.5,
      importe: 30,
    });
  });

  it("el coste unitario que explica un importe", () => {
    expect(costeUnitarioDeImporte({ cantidad: 3, importe: 27 })).toBe(9);
    expect(costeUnitarioDeImporte({ cantidad: 7, importe: 100 })).toBe(14.2857);
    expect(costeUnitarioDeImporte({ cantidad: "4", importe: "10" })).toBe(2.5);
    expect(costeUnitarioDeImporte({ cantidad: 3, importe: -10 })).toBe(-3.3333);
    expect(costeUnitarioDeImporte({ cantidad: 0, importe: 10 })).toBeNull();
    expect(costeUnitarioDeImporte({ cantidad: null, importe: 10 })).toBeNull();
    // Recalculado con ese coste, el importe vuelve a ser el escrito.
    expect(importeLineaCompra({ cantidad: 7, precio_unitario: 14.2857 })).toBe(100);
    // Con muchas unidades, cuatro decimales no siempre bastan: la línea guarda el escrito.
    const mil = cambiarLineaCompra({ ...linea, cantidad: 1000 }, { importe: 1234.56 });
    expect(mil).toMatchObject({ precio_unitario: 1.2346, importe: 1234.56 });
    expect(importeLineaCompra(mil)).toBe(1234.6);
  });

  it("cambiar solo el concepto deja el importe leído, aunque no cuadre", () => {
    const leida = { ...linea, importe: 7 }; // un descuento que no se leyó
    expect(cambiarLineaCompra(leida, { descripcion: "Polo" })).toEqual({
      ...leida,
      descripcion: "Polo",
    });
  });

  it("una línea nueva cuadra desde el principio", () => {
    const nueva = lineaCompraNueva();
    expect(nueva).toMatchObject({ cantidad: 1, precio_unitario: 0, importe: 0 });
    expect(cambiarLineaCompra(nueva, { precio_unitario: 12.4 }).importe).toBe(12.4);
  });

  it("una factura a mano empieza con el IVA general, que es uno de los tipos", () => {
    expect(TIPO_IVA_GENERAL).toBe(0.21);
    expect(TIPOS_IVA).toContain(TIPO_IVA_GENERAL);
  });
});
