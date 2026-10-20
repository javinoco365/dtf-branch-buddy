import { describe, expect, it } from "vitest";
import {
  comprasParaDevolucion,
  devueltasAntesDeFactura,
  esProforma,
  estadoFilaRegularizacion,
  facturasPorProforma,
  FILTROS_DOCUMENTO,
  gruposPorLineaPapel,
  pagoPrevisto,
  pasaFiltroDocumento,
  proformasSinFactura,
  PUNTOS_PROFORMA,
  regularizacionPrevista,
  resumenProformas,
  sugerirProformas,
  type ArticuloFactura,
  type DocumentoParaCasar,
  type EntradaProforma,
  type ProformaFila,
  type StockActual,
} from "./proformas";
import type { RegularizacionStock } from "./tipos-textil";

const fila = (id: string, extra: Partial<ProformaFila> = {}): ProformaFila => ({
  id,
  tipo_documento: "proforma",
  proforma_id: null,
  estado: "registrada",
  borrada_en: null,
  proveedor: "Textiles Sur",
  nif_proveedor: "B12345678",
  proveedor_id: null,
  numero: `P-${id}`,
  fecha: "2026-10-01",
  categoria: "textil",
  base: 100,
  total: 121,
  liquido: 121,
  estado_pago: "pendiente",
  fecha_pago: null,
  ...extra,
});

const HOY = new Date(2026, 9, 20);

describe("esProforma y facturasPorProforma", () => {
  it("solo «proforma» es proforma; sin la columna es factura", () => {
    expect(esProforma({ tipo_documento: "proforma" })).toBe(true);
    expect(esProforma({ tipo_documento: "factura" })).toBe(false);
    expect(esProforma({})).toBe(false);
  });

  it("enlaza cada proforma con la factura que la cita", () => {
    const f = fila("f", { tipo_documento: "factura", proforma_id: "p" });
    const mapa = facturasPorProforma([fila("p"), f, fila("g", { tipo_documento: "factura" })]);
    expect(mapa.size).toBe(1);
    expect(mapa.get("p")).toBe(f);
  });
});

describe("proformasSinFactura", () => {
  it("excluye facturas, borradores, borradas y la casada; la más antigua primero; desde el día 1", () => {
    const compras = [
      fila("hoy", { fecha: "2026-10-20" }),
      fila("vieja", { fecha: "2026-10-01" }),
      fila("borrador", { estado: "borrador" }),
      fila("borrada", { borrada_en: "2026-10-10T10:00:00Z" }),
      fila("casada"),
      fila("fac", { tipo_documento: "factura", proforma_id: "casada" }),
      fila("otra", { tipo_documento: "factura" }),
    ];
    const r = proformasSinFactura(compras, HOY);
    expect(r.map((p) => p.proforma.id)).toEqual(["vieja", "hoy"]);
    expect(r.map((p) => p.dias)).toEqual([19, 0]);
  });

  it("vale con lo que da compras_proformas_pendientes() (sin estado) y sin fecha da días null", () => {
    const r = proformasSinFactura([fila("a", { estado: undefined, fecha: null })], HOY);
    expect(r).toHaveLength(1);
    expect(r[0].dias).toBeNull();
  });
});

describe("resumenProformas", () => {
  it("suma el importe (líquido o, sin él, total) y las pagadas", () => {
    const r = resumenProformas(
      proformasSinFactura(
        [
          fila("a", { liquido: 121, estado_pago: "pagada", fecha: "2026-09-30" }),
          fila("b", { liquido: null, total: "60.50", fecha: "2026-10-10" }),
        ],
        HOY,
      ),
    );
    expect(r).toEqual({
      proformas: 2,
      importe: 181.5,
      pagadas: 1,
      importePagado: 121,
      masAntigua: "2026-09-30",
      diasMasAntigua: 20,
    });
  });

  it("sin proformas, todo a cero y sin fechas", () => {
    expect(resumenProformas([])).toEqual({
      proformas: 0,
      importe: 0,
      pagadas: 0,
      importePagado: 0,
      masAntigua: null,
      diasMasAntigua: null,
    });
  });
});

describe("sugerirProformas", () => {
  const doc: DocumentoParaCasar = {
    id: "fac",
    proveedor: "Textiles Sur",
    nif_proveedor: "B-12345678",
    fecha: "2026-10-15",
    base: 100,
    total: 121,
    liquido: 121,
    categoria: "textil",
    referencia_proforma: "p 1",
    unidades: new Map([["s1", 10]]),
  };

  it("otro proveedor, casada, textil con no textil, borrador, facturas y el propio documento no salen", () => {
    const r = sugerirProformas(
      doc,
      [
        fila("otro", { nif_proveedor: "B99999999", proveedor: "Otro" }),
        fila("casada"),
        fila("en-lista"),
        fila("x", { tipo_documento: "factura", proforma_id: "en-lista" }),
        fila("material", { categoria: "material" }),
        fila("borrador", { estado: "borrador" }),
        fila("fac"),
        fila("buena"),
      ],
      new Set(["casada"]),
    );
    expect(r.map((s) => s.proforma.id)).toEqual(["buena"]);
  });

  it("mismo proveedor por proveedor_id aunque falte el NIF; distinto proveedor_id no sale", () => {
    const d = { ...doc, proveedor_id: "prov1", nif_proveedor: null, proveedor: "Nombre raro" };
    const r = sugerirProformas(
      d,
      [
        fila("si", { proveedor_id: "prov1", nif_proveedor: null }),
        fila("no", { proveedor_id: "prov2" }),
      ],
      new Set(),
    );
    expect(r.map((s) => s.proforma.id)).toEqual(["si"]);
  });

  it("puntos por referencia, total, base, unidades y fecha, y orden", () => {
    const todo = fila("1", {
      numero: "P1",
      fecha: "2026-10-01",
      lineas: [
        { tipo: "articulo", stock_id: "s1", unidades_stock: 6 },
        { tipo: "articulo", stock_id: "s1", unidades_stock: "4" },
        { tipo: "porte", stock_id: null, unidades_stock: null },
      ],
    });
    const soloImporte = fila("2", { numero: "P2", fecha: "2026-10-05" });
    const posterior = fila("3", { numero: "P3", fecha: "2026-10-20", base: 50, liquido: 60 });
    const r = sugerirProformas(doc, [posterior, soloImporte, todo], new Set());
    expect(r.map((s) => s.proforma.id)).toEqual(["1", "2", "3"]);
    const total =
      PUNTOS_PROFORMA.referencia +
      PUNTOS_PROFORMA.total +
      PUNTOS_PROFORMA.base +
      PUNTOS_PROFORMA.unidades +
      PUNTOS_PROFORMA.fecha;
    expect(r[0].puntos).toBe(total);
    expect(r[0].motivos).toEqual([
      "Cita su número",
      "Mismo total",
      "Misma base",
      "Mismas unidades por talla",
      "Anterior a la factura",
    ]);
    expect(r[1].puntos).toBe(PUNTOS_PROFORMA.total + PUNTOS_PROFORMA.base + PUNTOS_PROFORMA.fecha);
    expect(r[2].puntos).toBe(0);
  });

  it("con el mismo número de puntos, la más reciente primero", () => {
    const r = sugerirProformas(
      { ...doc, referencia_proforma: null, unidades: null },
      [fila("a", { fecha: "2026-10-01" }), fila("b", { fecha: "2026-10-10" })],
      new Set(),
    );
    expect(r.map((s) => s.proforma.id)).toEqual(["b", "a"]);
  });

  it("compara el total cuando una de las dos no tiene líquido", () => {
    const r = sugerirProformas(
      { ...doc, liquido: null, total: 121 },
      [fila("a", { liquido: 100, total: 121 })],
      new Set(),
    );
    expect(r[0].motivos).toContain("Mismo total");
  });
});

// ---------------------------------------------------------------------------
// Regularización
// ---------------------------------------------------------------------------

const pro = (
  stock_id: string,
  unidades: number,
  valor: number,
  devueltas = 0,
): EntradaProforma => ({
  stock_id,
  unidades,
  valor,
  coste_unitario: valor / unidades,
  devueltas,
});
const art = (
  indice: number,
  stock_id: string | null,
  unidades: number,
  coste_total: number,
): ArticuloFactura => ({ indice, stock_id, unidades, coste_total });
const stock = (entradas: [string, number, number][]) =>
  new Map<string, StockActual>(
    entradas.map(([id, cantidad, coste_unitario]) => [id, { cantidad, coste_unitario }]),
  );

/** P7: valor_proforma + entradas + devoluciones + ajustes + sin aplicar = base. */
const cuadra = (r: RegularizacionStock, base: number) =>
  Math.round(
    (r.valor_proforma +
      r.valor_entradas +
      r.valor_devoluciones +
      r.importe_ajustes +
      r.diferencia_sin_aplicar) *
      100,
  ) /
    100 ===
  base;

describe("regularizacionPrevista", () => {
  it("(a) factura igual que la proforma: sin movimientos y nada sin aplicar", () => {
    const r = regularizacionPrevista({
      proforma: [pro("s1", 10, 50)],
      factura: [art(0, "s1", 10, 50)],
      stock: stock([["s1", 10, 5]]),
      base_factura: 50,
    });
    expect(r.movimientos).toBe(0);
    expect(r.diferencia_sin_aplicar).toBe(0);
    expect(r.variantes[0]).toMatchObject({ entran: 0, salen: 0, importe_ajuste: 0 });
  });

  it("(b) la factura trae 2 más: entran 2 al coste de la factura", () => {
    const r = regularizacionPrevista({
      proforma: [pro("s1", 10, 50)],
      factura: [art(0, "s1", 12, 60)],
      stock: stock([["s1", 10, 5]]),
      base_factura: 60,
    });
    expect(r.entran).toBe(2);
    expect(r.valor_entradas).toBe(10);
    expect(r.variantes[0].coste_unitario_factura).toBe(5);
    expect(r.movimientos).toBe(1);
    expect(r.diferencia_sin_aplicar).toBe(0);
    expect(cuadra(r, 60)).toBe(true);
  });

  it("(c) la factura trae 3 menos: salen 3 al coste medio de hoy", () => {
    const r = regularizacionPrevista({
      proforma: [pro("s1", 10, 50)],
      factura: [art(0, "s1", 7, 35)],
      stock: stock([["s1", 10, 5]]),
      base_factura: 35,
    });
    expect(r.salen).toBe(3);
    expect(r.valor_devoluciones).toBe(-15);
    expect(r.diferencia_sin_aplicar).toBe(0);
    expect(cuadra(r, 35)).toBe(true);
  });

  it("(d) variante solo en la factura entra entera; solo en la proforma sale entera", () => {
    const r = regularizacionPrevista({
      proforma: [pro("s1", 10, 50)],
      factura: [art(0, "s2", 4, 20)],
      stock: stock([
        ["s1", 10, 5],
        ["s2", 0, 0],
      ]),
      base_factura: 20,
    });
    expect(r.variantes.map((v) => [v.stock_id, v.entran, v.salen])).toEqual([
      ["s1", 0, 10],
      ["s2", 4, 0],
    ]);
    expect(r.variantes[0].coste_unitario_factura).toBeNull();
    expect(r.variantes[1].coste_unitario_proforma).toBeNull();
    expect(r.movimientos).toBe(2);
    expect(r.diferencia_sin_aplicar).toBe(0);
    expect(cuadra(r, 20)).toBe(true);
  });

  it("(e) mismas unidades y +0,50 €/ud con todo el stock: ajuste m×d, nada sin aplicar", () => {
    const r = regularizacionPrevista({
      proforma: [pro("s1", 10, 50)],
      factura: [art(0, "s1", 10, 55)],
      stock: stock([["s1", 10, 5]]),
      base_factura: 55,
    });
    expect(r.variantes[0]).toMatchObject({
      unidades_ajustadas: 10,
      importe_ajuste: 5,
      importe_sin_aplicar: 0,
    });
    expect(r.importe_ajustes).toBe(5);
    expect(r.movimientos).toBe(1);
    expect(r.diferencia_sin_aplicar).toBe(0);
    expect(cuadra(r, 55)).toBe(true);
  });

  it("(f) con la mitad vendida: ajuste sobre lo que queda y el resto sin aplicar", () => {
    const r = regularizacionPrevista({
      proforma: [pro("s1", 10, 50)],
      factura: [art(0, "s1", 10, 55)],
      stock: stock([["s1", 5, 5]]),
      base_factura: 55,
    });
    expect(r.variantes[0]).toMatchObject({
      unidades_ajustadas: 5,
      importe_ajuste: 2.5,
      importe_sin_aplicar: 2.5,
    });
    expect(r.diferencia_sin_aplicar).toBe(2.5);
    expect(cuadra(r, 55)).toBe(true);
  });

  it("(g) una bajada que dejaría el coste negativo se queda en el tope", () => {
    const r = regularizacionPrevista({
      proforma: [pro("s1", 10, 50)],
      factura: [art(0, "s1", 10, 10)],
      stock: stock([["s1", 10, 2]]),
      base_factura: 10,
    });
    // teórico 10 × (1 − 5) = −40; el stock vale 20: el ajuste se queda en −20.
    expect(r.variantes[0].importe_ajuste).toBe(-20);
    expect(r.variantes[0].importe_sin_aplicar).toBe(-20);
    expect(10 * 2 + r.variantes[0].importe_ajuste).toBeGreaterThanOrEqual(0);
    expect(cuadra(r, 10)).toBe(true);
  });

  it("(h) una variante nueva (sin stock_id) entra entera con clave propia", () => {
    const r = regularizacionPrevista({
      proforma: [pro("s1", 10, 50)],
      factura: [art(0, "s1", 10, 50), art(1, null, 3, 15)],
      stock: stock([["s1", 10, 5]]),
      base_factura: 65,
    });
    const nueva = r.variantes.find((v) => v.stock_id === "nueva:1");
    expect(nueva).toMatchObject({ unidades_proforma: 0, unidades_factura: 3, entran: 3 });
    expect(r.valor_entradas).toBe(15);
    expect(r.movimientos).toBe(1);
    expect(r.diferencia_sin_aplicar).toBe(0);
  });

  it("(i) P7 cuadra en una factura con todo a la vez", () => {
    const base = 154.37;
    const r = regularizacionPrevista({
      proforma: [pro("a", 10, 50), pro("b", 4, 33.33), pro("c", 3, 12)],
      factura: [art(0, "a", 12, 63.37), art(1, "b", 3, 26.01), art(2, "d", 5, 64.99)],
      stock: stock([
        ["a", 6, 5],
        ["b", 4, 8.3325],
        ["c", 3, 4],
        ["d", 0, 0],
      ]),
      base_factura: base,
    });
    expect(cuadra(r, base)).toBe(true);
  });

  it("(j) más unidades y otro coste con parte vendida: solo se revaloriza lo que queda de la proforma", () => {
    // P = 10 a 5 €, F = 12 a 6 €, vendidas 8 → saldo 2.
    const r = regularizacionPrevista({
      proforma: [pro("s1", 10, 50)],
      factura: [art(0, "s1", 12, 72)],
      stock: stock([["s1", 2, 5]]),
      base_factura: 72,
    });
    expect(r.variantes[0]).toMatchObject({
      entran: 2,
      unidades_ajustadas: 2,
      importe_ajuste: 2,
      importe_sin_aplicar: 8,
    });
    expect(r.movimientos).toBe(2);
    expect(cuadra(r, 72)).toBe(true);
  });

  it("ordena las variantes por stock_id", () => {
    const r = regularizacionPrevista({
      proforma: [pro("b", 1, 5), pro("a", 1, 5)],
      factura: [art(0, "b", 1, 5), art(1, "a", 1, 5)],
      stock: stock([]),
      base_factura: 10,
    });
    expect(r.variantes.map((v) => v.stock_id)).toEqual(["a", "b"]);
  });
});

describe("devueltasAntesDeFactura", () => {
  it("solo las variantes con devueltas > 0", () => {
    expect(
      devueltasAntesDeFactura([pro("a", 10, 50, 0), pro("b", 4, 20, 2), pro("c", 1, 5, 1)]),
    ).toEqual([
      { stock_id: "b", devueltas: 2 },
      { stock_id: "c", devueltas: 1 },
    ]);
  });
});

describe("estadoFilaRegularizacion", () => {
  const filaDe = (
    proforma: EntradaProforma[],
    factura: ArticuloFactura[],
    s: [string, number, number][],
  ) => regularizacionPrevista({ proforma, factura, stock: stock(s), base_factura: 0 }).variantes;

  it("los seis estados", () => {
    expect(
      estadoFilaRegularizacion(
        filaDe([pro("s", 10, 50)], [art(0, "s", 10, 50)], [["s", 10, 5]])[0],
      ),
    ).toBe("igual");
    expect(
      estadoFilaRegularizacion(
        filaDe([pro("s", 10, 50)], [art(0, "s", 10, 55)], [["s", 10, 5]])[0],
      ),
    ).toBe("coste");
    expect(
      estadoFilaRegularizacion(
        filaDe([pro("s", 10, 50)], [art(0, "s", 12, 72)], [["s", 10, 5]])[0],
      ),
    ).toBe("mas");
    expect(
      estadoFilaRegularizacion(filaDe([pro("s", 10, 50)], [art(0, "s", 7, 35)], [["s", 10, 5]])[0]),
    ).toBe("menos");
    const d = filaDe([pro("p", 10, 50)], [art(0, "f", 4, 20)], [["p", 10, 5]]);
    expect(estadoFilaRegularizacion(d.find((v) => v.stock_id === "f")!)).toBe("solo_factura");
    expect(estadoFilaRegularizacion(d.find((v) => v.stock_id === "p")!)).toBe("solo_proforma");
  });

  it("una diferencia de coste por debajo de la décima de céntimo por unidad es «igual»", () => {
    const v = filaDe([pro("s", 3, 10)], [art(0, "s", 3, 10.0001)], [["s", 3, 3.3333]])[0];
    expect(estadoFilaRegularizacion(v)).toBe("igual");
  });
});

describe("pagoPrevisto", () => {
  it("pagada con el mismo líquido: no queda nada por revisar", () => {
    expect(
      pagoPrevisto(
        { estado_pago: "pagada", fecha_pago: "2026-10-02", liquido: 121, total: 121 },
        121,
      ),
    ).toEqual({ pagada: true, fecha: "2026-10-02", diferencia: 0, revisarSiEnlazada: false });
  });

  it("pagada con otro líquido: el enlace quedaría por revisar", () => {
    expect(
      pagoPrevisto(
        { estado_pago: "pagada", fecha_pago: "2026-10-02", liquido: 121, total: 121 },
        125.5,
      ),
    ).toMatchObject({ pagada: true, diferencia: 4.5, revisarSiEnlazada: true });
  });

  it("pendiente con otro líquido (usa el total sin líquido): también por revisar si hay enlace", () => {
    expect(
      pagoPrevisto({ estado_pago: "pendiente", fecha_pago: null, liquido: null, total: "100" }, 99),
    ).toEqual({ pagada: false, fecha: null, diferencia: -1, revisarSiEnlazada: true });
  });
});

describe("gruposPorLineaPapel", () => {
  it("las consecutivas con el mismo número van juntas; las nulas, sueltas", () => {
    expect(
      gruposPorLineaPapel([
        { linea_papel: 1 },
        { linea_papel: 1 },
        { linea_papel: null },
        {},
        { linea_papel: 2 },
        { linea_papel: 2 },
        { linea_papel: 1 },
      ]),
    ).toEqual([
      { linea_papel: 1, indices: [0, 1] },
      { linea_papel: null, indices: [2] },
      { linea_papel: null, indices: [3] },
      { linea_papel: 2, indices: [4, 5] },
      { linea_papel: 1, indices: [6] },
    ]);
  });
});

describe("pasaFiltroDocumento y comprasParaDevolucion", () => {
  const p1 = fila("p1");
  const p2 = fila("p2", { numero: "P-2" });
  const f2 = fila("f2", { tipo_documento: "factura", proforma_id: "p2", numero: "F-2" });
  const f3 = fila("f3", { tipo_documento: "factura" });
  const vieja = fila("v", { tipo_documento: undefined });
  const casadas = new Set(["p2"]);

  it("filtra por documento", () => {
    const pasan = (filtro: (typeof FILTROS_DOCUMENTO)[number]["valor"]) =>
      [p1, p2, f2, f3, vieja]
        .filter((c) => pasaFiltroDocumento(c, filtro, casadas))
        .map((c) => c.id);
    expect(FILTROS_DOCUMENTO.map((f) => f.valor)).toEqual([
      "todos",
      "facturas",
      "proformas_pendientes",
      "proformas_facturadas",
    ]);
    expect(pasan("todos")).toEqual(["p1", "p2", "f2", "f3", "v"]);
    expect(pasan("facturas")).toEqual(["f2", "f3", "v"]);
    expect(pasan("proformas_pendientes")).toEqual(["p1"]);
    expect(pasan("proformas_facturadas")).toEqual(["p2"]);
  });

  it("para devolver: proformas (con su factura) y facturas sin casar; nunca la casada ni las no textil", () => {
    const r = comprasParaDevolucion([
      p1,
      p2,
      f2,
      f3,
      fila("mat", { tipo_documento: "factura", categoria: "material" }),
      fila("bor", { tipo_documento: "factura", estado: "borrador" }),
    ]);
    expect(r.map((x) => [x.compra.id, x.facturadaEn])).toEqual([
      ["p1", null],
      ["p2", "F-2"],
      ["f3", null],
    ]);
  });
});
