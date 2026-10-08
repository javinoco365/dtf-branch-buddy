import { describe, expect, it } from "vitest";
import {
  claseDeNombre,
  esEstimado,
  lineaPedidoWoo,
  medirLineaWoo,
  metrosPedidoWoo,
  numeroDeTexto,
  primerNumero,
  type LineaWoo,
} from "./metros-woo";

const PRECIO = 7;

// La línea del primer pedido real (DTF por Metros, 4,4 m a 7 €/m), con las
// etiquetas que enseña el panel como claves.
const montador = (extra: Partial<LineaWoo> = {}): LineaWoo => ({
  name: "DTF por Metros",
  quantity: 1,
  subtotal: "30.83",
  meta_data: [
    { key: "Tamaño de hoja", value: "58 × Auto" },
    { key: "Ancho de hoja (cm)", value: "58" },
    { key: "Longitud de hoja (m)", value: "4.4" },
    { key: "Longitud facturada por trabajo (m)", value: "4.4" },
    { key: "Precio por metro", value: "7,00 €" },
    { key: "Total de hojas", value: "1" },
    { key: "ID del proyecto", value: "8LTBE" },
    { key: "Unidad de medida", value: "cm" },
    { key: "Archivos de impresión", value: [{ url: "x" }] },
  ],
  ...extra,
});

// DCUL-64-2026: «DTF por Metros», cantidad 1, 12,27 €, y la API no trae
// ninguna longitud que se sepa leer.
const sinMedida: LineaWoo = {
  name: "DTF por Metros",
  quantity: 1,
  subtotal: "12.27",
  meta_data: [{ key: "_dtfb_project", value: "9QXRT" }],
};

describe("primerNumero", () => {
  it("se queda con el primer número y su unidad, no junta cifras", () => {
    expect(primerNumero("1,75 m (mín. 1 m)")).toEqual({ valor: 1.75, unidad: "m" });
    expect(primerNumero("4.4 m (440 cm)")).toEqual({ valor: 4.4, unidad: "m" });
    expect(primerNumero("175 cm")).toEqual({ valor: 175, unidad: "cm" });
    expect(primerNumero("4,4 metros")).toEqual({ valor: 4.4, unidad: null });
  });

  it("quita HTML y entidades", () => {
    expect(primerNumero("<p>1,75&#160;m</p>")).toEqual({ valor: 1.75, unidad: "m" });
    expect(numeroDeTexto("7,00&nbsp;&#8364;")).toBe(7);
  });

  it("entiende coma y punto", () => {
    expect(numeroDeTexto("4.4")).toBe(4.4);
    expect(numeroDeTexto("4,40 m")).toBe(4.4);
    expect(numeroDeTexto("1.234,5")).toBe(1234.5);
    expect(numeroDeTexto("1,234.5")).toBe(1234.5);
    expect(numeroDeTexto(7)).toBe(7);
    expect(numeroDeTexto("Auto")).toBeNull();
    expect(numeroDeTexto([1])).toBeNull();
  });
});

describe("claseDeNombre", () => {
  it("reconoce las etiquetas en español y en inglés, y las claves internas", () => {
    expect(claseDeNombre("Longitud facturada por trabajo (m)")).toBe("facturada");
    expect(claseDeNombre("billed_length")).toBe("facturada");
    expect(claseDeNombre("Longitud de hoja (m)")).toBe("hoja");
    expect(claseDeNombre("sheet_length_cm")).toBe("hoja");
    expect(claseDeNombre("Total de hojas")).toBe("hojas");
    expect(claseDeNombre("Precio por metro")).toBe("precio");
    expect(claseDeNombre("price_per_meter")).toBe("precio");
  });

  it("no confunde el ancho ni el tamaño con la longitud", () => {
    expect(claseDeNombre("Ancho de hoja (cm)")).toBeNull();
    expect(claseDeNombre("Tamaño de hoja")).toBeNull();
    expect(claseDeNombre("ID del proyecto")).toBeNull();
  });
});

describe("metros de una línea", () => {
  it("el primer pedido real: 4,4 m del montador", () => {
    expect(medirLineaWoo(montador(), PRECIO)).toEqual({
      metros: 4.4,
      origen: "montador",
      precio_metro: 7,
    });
    expect(lineaPedidoWoo(montador(), PRECIO)).toEqual({
      cantidad: 4.4,
      unidad: "m",
      precio_unitario: 7.0068,
      metros_origen: "montador",
      precio_metro_usado: 7,
    });
  });

  it("DCUL-64-2026: sin longitud legible, se estima 12,27 ÷ 7 = 1,753 m (no 1 m)", () => {
    expect(medirLineaWoo(sinMedida, PRECIO)).toEqual({
      metros: 1.753,
      origen: "precio_ajustes",
      precio_metro: 7,
    });
    const l = lineaPedidoWoo(sinMedida, PRECIO);
    expect(l).toMatchObject({ cantidad: 1.753, unidad: "m", metros_origen: "precio_ajustes" });
    // La factura que sale de la línea sigue cuadrando al céntimo.
    expect(Math.round(l.cantidad * l.precio_unitario * 100) / 100).toBe(12.27);
    expect(esEstimado(l.metros_origen)).toBe(true);
  });

  it("si la línea trae su precio por metro, estima con ese y no con el de Ajustes", () => {
    const li: LineaWoo = {
      name: "DTF por Metros",
      quantity: 1,
      subtotal: 18,
      meta_data: [{ key: "Precio por metro", value: "6,00 €" }],
    };
    expect(medirLineaWoo(li, PRECIO)).toEqual({
      metros: 3,
      origen: "precio_linea",
      precio_metro: 6,
    });
  });

  it("la cantidad multiplica los metros del trabajo", () => {
    expect(medirLineaWoo(montador({ quantity: 3, subtotal: "92.49" }), PRECIO)?.metros).toBe(13.2);
  });

  it("sin longitud facturada: longitud de hoja × total de hojas", () => {
    const li = montador({ subtotal: "61.60" });
    li.meta_data = li
      .meta_data!.filter((m) => m.key !== "Longitud facturada por trabajo (m)")
      .map((m) => (m.key === "Total de hojas" ? { ...m, value: "2" } : m));
    expect(medirLineaWoo(li, PRECIO)).toMatchObject({ metros: 8.8, origen: "montador" });
  });

  it("lee la clave interna con etiqueta legible, y pasa cm y mm a metros", () => {
    const enCm: LineaWoo = {
      name: "Hoja DTF",
      quantity: 2,
      subtotal: 21,
      meta_data: [{ key: "_dtfb_len", display_key: "Longitud de hoja (cm)", value: "150" }],
    };
    expect(medirLineaWoo(enCm, PRECIO)).toMatchObject({ metros: 3, origen: "montador" });
    const enMm: LineaWoo = {
      name: "Hoja DTF",
      quantity: 1,
      subtotal: 12.25,
      meta_data: [{ key: "_billed_length_mm", value: 1750 }],
    };
    expect(medirLineaWoo(enMm, PRECIO)).toMatchObject({ metros: 1.75, origen: "montador" });
  });

  it("lee un meta oculto con JSON o con objeto, por el nombre de cada propiedad", () => {
    const json: LineaWoo = {
      name: "DTF por Metros",
      quantity: 1,
      subtotal: "12.27",
      meta_data: [
        { key: "_dtfbuild_job", value: '{"width":58,"billed_length":1.753,"price_per_meter":7}' },
      ],
    };
    expect(medirLineaWoo(json, PRECIO)).toEqual({
      metros: 1.753,
      origen: "montador",
      precio_metro: 7,
    });
    const objeto: LineaWoo = {
      name: "DTF por Metros",
      quantity: 1,
      subtotal: "12.27",
      meta_data: [{ key: "_dtfbuild_job", value: { sheet: { width_cm: 58, length_cm: 175.3 } } }],
    };
    expect(medirLineaWoo(objeto, PRECIO)).toMatchObject({ metros: 1.753, origen: "montador" });
  });

  it("si lo leído no cuadra con lo cobrado, no se lo cree y estima", () => {
    // «1,75 m (mín. 1 m)» bien leído cuadra; un 175 sin unidad (eran cm) no.
    const mal: LineaWoo = {
      name: "DTF por Metros",
      quantity: 1,
      subtotal: "12.27",
      meta_data: [{ key: "Longitud de hoja", value: "175" }],
    };
    expect(medirLineaWoo(mal, PRECIO)).toEqual({
      metros: 1.753,
      origen: "precio_ajustes",
      precio_metro: 7,
    });
  });

  it("acepta un precio por volumen más bajo que el de Ajustes si no es disparatado", () => {
    const tramo: LineaWoo = {
      name: "DTF por Metros",
      quantity: 1,
      subtotal: 50,
      meta_data: [{ key: "Longitud facturada por trabajo (m)", value: "10" }],
    };
    expect(medirLineaWoo(tramo, PRECIO)).toMatchObject({ metros: 10, origen: "montador" });
  });

  it("una línea que no es de metros va en unidades, sin estimar nada", () => {
    expect(
      medirLineaWoo({ name: "Camiseta blanca", quantity: 5, subtotal: 40 }, PRECIO),
    ).toBeNull();
    expect(lineaPedidoWoo({ name: "Camiseta blanca", quantity: 5, subtotal: 40 }, PRECIO)).toEqual({
      cantidad: 5,
      unidad: "ud",
      precio_unitario: 8,
      metros_origen: null,
      precio_metro_usado: null,
    });
  });

  it("una línea del montador sin importe ni longitud no se inventa metros", () => {
    expect(medirLineaWoo({ ...sinMedida, subtotal: 0 }, PRECIO)).toBeNull();
    expect(medirLineaWoo(sinMedida, null)).toBeNull();
  });

  it("el pedido suma solo las líneas de metros", () => {
    expect(
      metrosPedidoWoo(
        [montador(), { name: "Camiseta", quantity: 4, subtotal: 20 }, sinMedida],
        PRECIO,
      ),
    ).toBe(6.153);
    expect(metrosPedidoWoo(null, PRECIO)).toBe(0);
  });
});
