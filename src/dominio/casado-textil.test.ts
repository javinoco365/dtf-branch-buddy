import { describe, expect, it } from "vitest";
import {
  MAX_SUGERENCIAS,
  PUNTOS_MINIMOS_SUGERENCIA,
  SINONIMOS_COLOR,
  casarLinea,
  casarLineas,
  mismoColor,
  nombreProductoDesdeLinea,
  nuevaVarianteDesdeLinea,
  productoParaLinea,
  puntosParecido,
  type ContextoCasado,
} from "./casado-textil";
import { claveMemoria, claveTexto } from "./normalizar-textil";
import type {
  EntradaMemoria,
  LineaParaCasar,
  ProductoTextil,
  VarianteCatalogo,
} from "./tipos-textil";

const gildan: ProductoTextil = {
  id: "p-gildan",
  marca: "Gildan",
  referencia: "5000",
  nombre: "Camiseta Heavy",
  categoria: null,
  activo: true,
};

function variante(id: string, extra: Partial<VarianteCatalogo> = {}): VarianteCatalogo {
  return {
    id,
    producto_id: gildan.id,
    producto: gildan,
    nombre: "Camiseta Heavy",
    sku: null,
    ean: null,
    color: "Negro",
    talla: "M",
    categoria: null,
    cantidad: 0,
    cantidad_reservada: 0,
    cantidad_minima: 0,
    coste_unitario: 0,
    precio_venta: 0,
    activa: true,
    repetida: false,
    ...extra,
  };
}

function linea(extra: Partial<LineaParaCasar> = {}): LineaParaCasar {
  return {
    tipo: "articulo",
    descripcion: "Camiseta Gildan 5000 Negro M",
    referencia: "5000",
    marca: "Gildan",
    modelo: null,
    color: "Negro",
    talla: "M",
    ean: null,
    ...extra,
  };
}

const memoria = (clave: string, stock_id: string, unidades_por_pack = 1): EntradaMemoria => ({
  id: `m-${stock_id}-${clave}`,
  clave,
  stock_id,
  unidades_por_pack,
  veces: 1,
});

const EAN_A = "4006381333931";
const EAN_B = "96385074";

describe("mismoColor", () => {
  it("misma clave o sinónimos", () => {
    expect(mismoColor("Black", "negro")).toBe(true);
    expect(mismoColor("Azul Marino", "NAVY")).toBe(true);
    expect(mismoColor("Gray", "gris")).toBe(true);
    expect(mismoColor("Beige", "Sand")).toBe(true);
    expect(mismoColor("Rojo ", "rojo")).toBe(true);
  });

  it("azul y azul marino no son el mismo; negro y blanco tampoco", () => {
    expect(mismoColor("Azul", "Azul marino")).toBe(false);
    expect(mismoColor("Negro", "Blanco")).toBe(false);
    expect(mismoColor("Negro", null)).toBe(false);
  });

  it("dos sin color son el mismo", () => {
    expect(mismoColor(null, "")).toBe(true);
  });

  it("los sinónimos ya están normalizados", () => {
    for (const grupo of SINONIMOS_COLOR) for (const c of grupo) expect(claveTexto(c)).toBe(c);
  });
});

describe("casarLinea", () => {
  const v = variante("v-negro-m", { ean: EAN_A });
  const otra = variante("v-negro-l", { talla: "L", ean: EAN_B });

  it("un porte, un descuento u otro cargo no se casan", () => {
    const ctx: ContextoCasado = { variantes: [v], memoria: [] };
    expect(casarLinea(linea({ tipo: "porte" }), ctx)).toEqual({ estado: "no_aplica" });
    expect(casarLinea(linea({ tipo: "descuento" }), ctx)).toEqual({ estado: "no_aplica" });
    expect(casarLinea(linea({ tipo: "otro" }), ctx)).toEqual({ estado: "no_aplica" });
  });

  it("la memoria gana al EAN y trae su pack", () => {
    const l = linea({ ean: null });
    const ctx = { variantes: [v, otra], memoria: [memoria(claveMemoria(l), otra.id, 5)] };
    expect(casarLinea(l, ctx)).toEqual({
      estado: "casada",
      stock_id: otra.id,
      metodo: "memoria",
      unidades_por_pack: 5,
    });
  });

  it("memoria a una variante inactiva cae al EAN", () => {
    const inactiva = variante("v-vieja", { activa: false });
    const l = linea({ ean: EAN_A });
    const ctx = { variantes: [v, inactiva], memoria: [memoria(claveMemoria(l), inactiva.id)] };
    expect(casarLinea(l, ctx)).toMatchObject({ estado: "casada", stock_id: v.id, metodo: "ean" });
  });

  it("memoria vetada por un EAN distinto cae al EAN", () => {
    const l = linea({ ean: EAN_A });
    const ctx = { variantes: [v, otra], memoria: [memoria(claveMemoria(l), otra.id)] };
    expect(casarLinea(l, ctx)).toEqual({
      estado: "casada",
      stock_id: v.id,
      metodo: "ean",
      unidades_por_pack: null,
    });
  });

  it("memoria migrada (solo descripción) casa si color y talla cuadran", () => {
    const l = linea({
      referencia: null,
      descripcion: "Camiseta Heavy",
      color: "Black",
      talla: "M",
    });
    const ctx = { variantes: [v], memoria: [memoria("d:camisetaheavy", v.id)] };
    expect(casarLinea(l, ctx)).toMatchObject({
      estado: "casada",
      stock_id: v.id,
      metodo: "memoria",
    });
  });

  it("memoria migrada no casa si la talla no cuadra", () => {
    const l = linea({ referencia: null, descripcion: "Camiseta Heavy", talla: "XL" });
    const ctx = { variantes: [v], memoria: [memoria("d:camisetaheavy", v.id)] };
    expect(casarLinea(l, ctx).estado).not.toBe("casada");
  });

  it("memoria migrada no casa si el color no cuadra", () => {
    const l = linea({
      referencia: null,
      descripcion: "Camiseta Heavy",
      color: "Blanco",
      talla: "M",
    });
    const ctx = { variantes: [v], memoria: [memoria("d:camisetaheavy", v.id)] };
    expect(casarLinea(l, ctx).estado).not.toBe("casada");
  });

  it("memoria migrada sin color ni talla en la línea: casa", () => {
    const l = linea({ referencia: null, descripcion: "Camiseta Heavy", color: null, talla: null });
    const ctx = { variantes: [v], memoria: [memoria("d:camisetaheavy", v.id)] };
    expect(casarLinea(l, ctx)).toMatchObject({ estado: "casada", metodo: "memoria" });
  });

  it("con referencia, la memoria migrada no se mira", () => {
    const l = linea({
      referencia: "9999",
      descripcion: "Camiseta Heavy",
      color: null,
      talla: null,
    });
    const ctx = { variantes: [v], memoria: [memoria("d:camisetaheavy", v.id)] };
    expect(casarLinea(l, ctx).estado).not.toBe("casada");
  });

  it("casado por EAN, aunque venga como UPC-A o con espacios", () => {
    const upc = variante("v-upc", { ean: "0036000291452" });
    const ctx = { variantes: [v, upc], memoria: [] };
    expect(casarLinea(linea({ referencia: null, ean: "036000291452" }), ctx)).toMatchObject({
      stock_id: upc.id,
      metodo: "ean",
    });
    expect(casarLinea(linea({ referencia: null, ean: "4006 3813 3393 1" }), ctx)).toMatchObject({
      stock_id: v.id,
      metodo: "ean",
    });
  });

  it("un EAN que no vale no casa nada", () => {
    const ctx = { variantes: [variante("x", { ean: "4006381333931" })], memoria: [] };
    const r = casarLinea(
      linea({
        ean: "4006381333932",
        referencia: null,
        descripcion: "zzz",
        color: null,
        talla: null,
      }),
      ctx,
    );
    expect(r).toEqual({ estado: "sin_casar" });
  });

  it("referencia por SKU único y compatible", () => {
    const a = variante("a", { sku: "G5000-BK-M" });
    const b = variante("b", { sku: "G5000-BK-L", talla: "L" });
    const ctx = { variantes: [a, b], memoria: [] };
    expect(casarLinea(linea({ referencia: "g5000 bk m" }), ctx)).toEqual({
      estado: "casada",
      stock_id: "a",
      metodo: "referencia",
      unidades_por_pack: null,
    });
  });

  it("un SKU de modelo repetido en dos variantes no casa por SKU (pero sí por producto)", () => {
    // SKU «5000» en M y L, y la línea no trae talla: dos compatibles → no casa por SKU.
    const a = variante("a", { sku: "5000" });
    const b = variante("b", { sku: "5000", talla: "L" });
    const ctx = { variantes: [a, b], memoria: [] };
    const r = casarLinea(linea({ talla: null }), ctx);
    expect(r.estado).not.toBe("casada");
    // Con talla, el SKU de modelo solo deja una compatible: casa esa.
    expect(casarLinea(linea({ talla: "L" }), ctx)).toMatchObject({
      stock_id: "b",
      metodo: "referencia",
    });
  });

  it("referencia del producto + «Black»/«Negro» + «XXL»/«2XL»", () => {
    const xxl = variante("v-2xl", { talla: "2XL" });
    const ctx = { variantes: [v, xxl], memoria: [] };
    expect(casarLinea(linea({ color: "Black", talla: "XXL" }), ctx)).toEqual({
      estado: "casada",
      stock_id: "v-2xl",
      metodo: "referencia",
      unidades_por_pack: null,
    });
  });

  it("referencia ambigua → sugerida con las candidatas", () => {
    const otraGildan = { ...gildan, id: "p-gildan-2", nombre: "Camiseta Heavy Kids" };
    const a = variante("a");
    const b = variante("b", { producto_id: otraGildan.id, producto: otraGildan });
    const r = casarLinea(linea(), { variantes: [a, b], memoria: [] });
    expect(r.estado).toBe("sugerida");
    if (r.estado === "sugerida") {
      expect(r.sugerencias.map((s) => s.stock_id).sort()).toEqual(["a", "b"]);
      expect(r.sugerencias[0].motivo).toBe("Misma referencia, color y talla");
    }
  });

  it("referencia del producto vetada por el EAN", () => {
    const a = variante("a", { ean: EAN_B });
    const r = casarLinea(linea({ ean: EAN_A }), { variantes: [a], memoria: [] });
    expect(r.estado).not.toBe("casada");
  });

  it("el parecido nunca da «casada»", () => {
    const parecida = variante("p", {
      producto: { ...gildan, referencia: "OTRA" },
      sku: null,
    });
    const r = casarLinea(
      linea({ referencia: null, descripcion: "Camiseta Heavy Gildan", ean: null }),
      { variantes: [parecida], memoria: [] },
    );
    expect(r.estado).toBe("sugerida");
    if (r.estado === "sugerida") expect(r.sugerencias[0].stock_id).toBe("p");
  });

  it("parecido: como mucho tres, de más a menos puntos", () => {
    const vs = ["S", "M", "L", "XL", "2XL"].map((t) =>
      variante(`v-${t}`, { talla: t, producto: { ...gildan, referencia: null } }),
    );
    const r = casarLinea(linea({ referencia: null, ean: null }), { variantes: vs, memoria: [] });
    expect(r.estado).toBe("sugerida");
    if (r.estado === "sugerida") {
      expect(r.sugerencias).toHaveLength(MAX_SUGERENCIAS);
      expect(r.sugerencias[0].stock_id).toBe("v-M");
      const puntos = r.sugerencias.map((s) => s.puntos);
      expect([...puntos].sort((a, b) => b - a)).toEqual(puntos);
      expect(puntos.every((p) => p >= PUNTOS_MINIMOS_SUGERENCIA)).toBe(true);
    }
  });

  it("sin nada parecido → sin_casar", () => {
    const r = casarLinea(
      linea({
        referencia: null,
        descripcion: "Gorra trucker",
        marca: null,
        color: "Rojo",
        talla: null,
      }),
      { variantes: [v], memoria: [] },
    );
    expect(r).toEqual({ estado: "sin_casar" });
  });

  it("las repetidas y las desactivadas nunca salen", () => {
    const repetida = variante("rep", { repetida: true, ean: EAN_A, sku: "5000" });
    const inactiva = variante("ina", { activa: false });
    const ctx = {
      variantes: [repetida, inactiva],
      memoria: [memoria(claveMemoria(linea()), "rep")],
    };
    expect(casarLinea(linea({ ean: EAN_A }), ctx)).toEqual({ estado: "sin_casar" });
  });

  it("casarLineas casa cada una", () => {
    const r = casarLineas([linea({ tipo: "porte" }), linea()], { variantes: [v], memoria: [] });
    expect(r.map((c) => c.estado)).toEqual(["no_aplica", "casada"]);
  });
});

describe("puntosParecido", () => {
  it("60 × Jaccard + 20 color + 20 talla", () => {
    const v = variante("v", {
      producto: { ...gildan, referencia: null },
      nombre: "Camiseta Heavy",
    });
    const r = puntosParecido(
      linea({ descripcion: "Camiseta Heavy", marca: "Gildan", referencia: null }),
      v,
    );
    // Palabras: {camiseta, heavy, gildan} frente a {gildan, camiseta, heavy}: Jaccard 1.
    expect(r).toEqual({ puntos: 100, motivo: "Nombre parecido, mismo color, misma talla" });
  });

  it("el color y la talla solo puntúan si la línea los trae", () => {
    const v = variante("v", { color: null, talla: null });
    const r = puntosParecido(
      linea({ descripcion: "zz", marca: null, referencia: null, color: null, talla: null }),
      v,
    );
    expect(r).toEqual({ puntos: 0, motivo: "Nada en común" });
  });
});

describe("producto y variante nueva", () => {
  it("productoParaLinea por marca y referencia normalizadas", () => {
    const otro = { ...gildan, id: "p-otro", marca: "Fruit", referencia: "5000" };
    expect(
      productoParaLinea(linea({ marca: "GILDAN", referencia: " 5000 " }), [otro, gildan])?.id,
    ).toBe("p-gildan");
    expect(productoParaLinea(linea({ marca: "Gildan", referencia: "64000" }), [gildan])).toBeNull();
    expect(productoParaLinea(linea({ referencia: null }), [gildan])).toBeNull();
  });

  it("nombreProductoDesdeLinea quita color, talla, marca y referencia", () => {
    expect(
      nombreProductoDesdeLinea(
        linea({
          descripcion: "Camiseta Gildan 5000 Negro XL",
          color: "Negro",
          talla: "XL",
          marca: "Gildan",
          referencia: "5000",
        }),
      ),
    ).toBe("Camiseta");
  });

  it("con modelo, el modelo; si no queda nada, la descripción", () => {
    expect(nombreProductoDesdeLinea(linea({ modelo: " Heavy Cotton " }))).toBe("Heavy Cotton");
    expect(
      nombreProductoDesdeLinea(
        linea({ descripcion: "Gildan 5000", marca: "Gildan", referencia: "5000" }),
      ),
    ).toBe("Gildan 5000");
    expect(
      nombreProductoDesdeLinea(
        linea({
          descripcion: "Sudadera B&C Azul marino XXL",
          marca: "B&C",
          color: "Azul marino",
          talla: "2XL",
          referencia: null,
        }),
      ),
    ).toBe("Sudadera");
  });

  it("nuevaVarianteDesdeLinea usa el producto existente si lo hay", () => {
    const n = nuevaVarianteDesdeLinea(linea({ talla: "XL", ean: "4006 3813 3393 1" }), [gildan]);
    expect(n).toEqual({
      producto_id: "p-gildan",
      producto: null,
      color: "Negro",
      talla: "XL",
      ean: "4006381333931",
      sku: null,
      precio_venta: 0,
      cantidad_minima: 0,
    });
  });

  it("si no hay producto, lo propone desde la línea; un EAN que no vale no se propone", () => {
    const n = nuevaVarianteDesdeLinea(
      linea({
        marca: "B&C",
        referencia: "E190",
        descripcion: "Camiseta B&C E190 Negro M",
        ean: "123",
      }),
      [gildan],
    );
    // El producto nuevo nace sin referencia: la de la línea va al SKU de la talla.
    expect(n).toMatchObject({
      producto_id: null,
      producto: { marca: "B&C", referencia: null, nombre: "Camiseta", categoria: null },
      ean: null,
      sku: "E190",
      precio_venta: 0,
    });
  });

  // Roly mete la talla y el color en la referencia: SS643201011 es la Antartida
  // en S y blanco perla; SS643203011, en L.
  const antartida: ProductoTextil = {
    id: "p-antartida",
    marca: "Roly",
    referencia: null,
    nombre: "Antartida",
    categoria: null,
    activo: true,
  };
  const lineaRoly = (referencia: string, talla: string) =>
    linea({
      descripcion: `Roly Antartida ${referencia} Blanco perla ${talla}`,
      marca: "Roly",
      modelo: "Antartida",
      referencia,
      color: "Blanco perla",
      talla,
    });

  it("productoParaLinea: por el SKU de una variante que ya lleva esa referencia", () => {
    const v = variante("v-s", {
      producto_id: antartida.id,
      producto: antartida,
      sku: "SS643201011",
    });
    const otraAntartida = { ...antartida, id: "p-otra" };
    expect(
      productoParaLinea(lineaRoly("SS643201011", "S"), [antartida, otraAntartida], [v])?.id,
    ).toBe("p-antartida");
  });

  it("productoParaLinea: otra talla del mismo modelo, por la marca y el nombre", () => {
    expect(productoParaLinea(lineaRoly("SS643203011", "L"), [gildan, antartida])?.id).toBe(
      "p-antartida",
    );
    // Si hay dos con esa marca y nombre, no se adivina: producto nuevo.
    const otra = { ...antartida, id: "p-otra", referencia: "SS643202011" };
    expect(productoParaLinea(lineaRoly("SS643203011", "L"), [antartida, otra])).toBeNull();
  });

  it("productoParaLinea no propone un producto desactivado", () => {
    const apagado = { ...gildan, activo: false };
    expect(productoParaLinea(linea(), [apagado])).toBeNull();
    expect(
      productoParaLinea(lineaRoly("SS643203011", "L"), [{ ...antartida, activo: false }]),
    ).toBeNull();
  });

  it("nuevaVarianteDesdeLinea: la talla nueva cuelga del modelo y su referencia va al SKU", () => {
    expect(nuevaVarianteDesdeLinea(lineaRoly("SS643203011", "L"), [antartida])).toMatchObject({
      producto_id: "p-antartida",
      producto: null,
      color: "Blanco perla",
      talla: "L",
      sku: "SS643203011",
    });
  });
});
