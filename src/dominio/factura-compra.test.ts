import { describe, expect, it } from "vitest";
import { aFecha, aNumero, normalizarCompra, revisarCompra } from "./factura-compra";

describe("aNumero", () => {
  it("lee el formato español", () => {
    expect(aNumero("1.234,56")).toBe(1234.56);
    expect(aNumero("0,85")).toBe(0.85);
    expect(aNumero("12")).toBe(12);
  });

  it("lee el formato inglés", () => {
    expect(aNumero("1,234.56")).toBe(1234.56);
    expect(aNumero("1234.56")).toBe(1234.56);
  });

  it("se queda con el separador de más a la derecha, que es el decimal", () => {
    // La prueba que separa los dos formatos: mil doscientos, no 1,234.
    expect(aNumero("1.200")).toBe(1200);
    expect(aNumero("1,200")).toBe(1200);
    expect(aNumero("1.200,50")).toBe(1200.5);
  });

  it("quita el símbolo de moneda y los espacios", () => {
    expect(aNumero(" 1.234,56 € ")).toBe(1234.56);
    expect(aNumero("€3,50")).toBe(3.5);
  });

  it("devuelve null cuando no hay número", () => {
    expect(aNumero("")).toBeNull();
    expect(aNumero("—")).toBeNull();
    expect(aNumero(null)).toBeNull();
    expect(aNumero(undefined)).toBeNull();
  });
});

describe("aFecha", () => {
  it("acepta ISO y formato español", () => {
    expect(aFecha("2026-09-03")).toBe("2026-09-03");
    expect(aFecha("03/09/2026")).toBe("2026-09-03");
    expect(aFecha("3-9-26")).toBe("2026-09-03");
    expect(aFecha("03.09.2026")).toBe("2026-09-03");
  });

  it("rechaza una fecha que no existe en vez de inventarse otra", () => {
    // new Date(2026, 1, 31) daría el 3 de marzo sin avisar.
    expect(aFecha("31/02/2026")).toBeNull();
    expect(aFecha("00/01/2026")).toBeNull();
    expect(aFecha("cualquier cosa")).toBeNull();
  });
});

describe("normalizarCompra", () => {
  it("deduce el precio unitario a partir del importe", () => {
    const c = normalizarCompra({
      lineas: [{ descripcion: "Camiseta", cantidad: 50, importe: "150,00" }],
    });
    expect(c.lineas[0].precio_unitario).toBe(3);
  });

  it("deduce el importe a partir del precio unitario", () => {
    const c = normalizarCompra({
      lineas: [{ descripcion: "Camiseta", cantidad: "50", precio_unitario: "3,00" }],
    });
    expect(c.lineas[0].importe).toBe(150);
  });

  it("cuando no viene base, la base es lo que suman las líneas", () => {
    const c = normalizarCompra({
      lineas: [
        { descripcion: "A", cantidad: 2, precio_unitario: 10 },
        { descripcion: "B", cantidad: 1, precio_unitario: 5 },
      ],
    });
    expect(c.base).toBe(25);
  });

  it("no revienta con una lectura vacía", () => {
    const c = normalizarCompra(null);
    expect(c.lineas).toEqual([]);
    expect(c.base).toBe(0);
    expect(c.proveedor).toBeNull();
  });
});

describe("revisarCompra", () => {
  const buena = {
    proveedor: "Textiles del Sur S.L.",
    nif_proveedor: "B12345678",
    numero: "F-2026-114",
    fecha: "2026-09-01",
    base: 250,
    iva: 52.5,
    irpf: 0,
    total: 302.5,
    lineas: [
      { descripcion: "Camiseta negra M", cantidad: 50, precio_unitario: 3, importe: 150 },
      { descripcion: "Camiseta negra L", cantidad: 25, precio_unitario: 4, importe: 100 },
    ],
  };

  it("la retención se resta del total", () => {
    expect(revisarCompra({ ...buena, irpf: 37.5, total: 265 })).toEqual([]);
    expect(revisarCompra({ ...buena, irpf: 37.5 })[0].mensaje).toContain("menos IRPF 37.5");
  });

  it("una factura que cuadra no da avisos", () => {
    expect(revisarCompra(buena)).toEqual([]);
  });

  it("perdona un céntimo de redondeo del proveedor", () => {
    expect(revisarCompra({ ...buena, total: 302.51 })).toEqual([]);
  });

  it("caza el dígito de más, que es el error que importa", () => {
    // 500 en vez de 50: cantidad × precio deja de dar el importe.
    const avisos = revisarCompra({
      ...buena,
      lineas: [{ ...buena.lineas[0], cantidad: 500 }, buena.lineas[1]],
    });
    expect(avisos.some((a) => a.linea === 0)).toBe(true);
  });

  it("avisa cuando las líneas no suman la base", () => {
    const avisos = revisarCompra({ ...buena, base: 300, total: 352.5 });
    expect(avisos.some((a) => a.linea === null && a.mensaje.includes("suman"))).toBe(true);
  });

  it("avisa cuando base más IVA no da el total", () => {
    const avisos = revisarCompra({ ...buena, total: 999 });
    expect(avisos.some((a) => a.mensaje.includes("no 999"))).toBe(true);
  });

  it("avisa de una cantidad de cero y de una línea sin descripción", () => {
    const avisos = revisarCompra({
      ...buena,
      base: 0,
      iva: 0,
      total: 0,
      lineas: [{ descripcion: "", cantidad: 0, precio_unitario: 0, importe: 0 }],
    });
    expect(avisos.length).toBeGreaterThanOrEqual(2);
  });

  it("avisa cuando no ha leído ninguna línea", () => {
    const avisos = revisarCompra({ ...buena, base: 0, iva: 0, total: 0, lineas: [] });
    expect(avisos.some((a) => a.mensaje.includes("ninguna línea"))).toBe(true);
  });
});

describe("normalizarCompra: escáner textil", () => {
  it("lee tipo, referencia, marca, modelo, color, talla, EAN y pack", () => {
    const c = normalizarCompra({
      lineas: [
        {
          descripcion: " Camiseta Gildan 5000 Negro XL ",
          cantidad: "10",
          precio_unitario: "3,00",
          importe: "30,00",
          tipo: "articulo",
          referencia: " 5000 ",
          marca: "Gildan",
          modelo: "Heavy Cotton",
          color: "Negro",
          talla: "XL",
          ean: "4006 3813 3393 1",
          unidades_por_pack: "1",
        },
      ],
    });
    expect(c.lineas[0]).toEqual({
      descripcion: "Camiseta Gildan 5000 Negro XL",
      cantidad: 10,
      precio_unitario: 3,
      importe: 30,
      unidad: null,
      tipo: "articulo",
      referencia: "5000",
      marca: "Gildan",
      modelo: "Heavy Cotton",
      color: "Negro",
      talla: "XL",
      ean: "4006381333931",
      unidades_por_pack: 1,
      linea_papel: null,
      importe_linea_papel: null,
    });
  });

  it("sin tipo de la IA, lo deduce: porte, descuento o artículo", () => {
    const c = normalizarCompra({
      lineas: [
        { descripcion: "Portes", cantidad: 1, importe: "10,00" },
        { descripcion: "Dto. pronto pago", cantidad: 1, importe: "-5,00" },
        { descripcion: "Camiseta", cantidad: 1, importe: "5,00", tipo: "rarito" },
      ],
    });
    expect(c.lineas.map((l) => l.tipo)).toEqual(["porte", "descuento", "articulo"]);
  });

  it("pack: el de la IA si es entero ≥ 1; si no, el del texto (deducido); si no, 1", () => {
    const c = normalizarCompra({
      lineas: [
        { descripcion: "Calcetín pack 5", cantidad: 2, importe: 10, unidades_por_pack: "3" },
        { descripcion: "Calcetín pack 5", cantidad: 2, importe: 10, unidades_por_pack: "2,5" },
        { descripcion: "Calcetín pack 5", cantidad: 2, importe: 10 },
        { descripcion: "Camiseta", cantidad: 2, importe: 10, unidades_por_pack: "0" },
      ],
    });
    expect(c.lineas.map((l) => [l.unidades_por_pack, l.pack_deducido ?? false])).toEqual([
      [3, false],
      [5, true],
      [5, true],
      [1, false],
    ]);
  });

  it("EAN: solo cifras, aunque no sea válido (lo avisa revisarCompra)", () => {
    const c = normalizarCompra({
      lineas: [
        { descripcion: "A", cantidad: 1, importe: 1, ean: "EAN: 123" },
        { descripcion: "B", cantidad: 1, importe: 1, ean: "" },
      ],
    });
    expect(c.lineas.map((l) => l.ean)).toEqual(["123", null]);
  });

  it("una línea con importe y cantidad negativa no se pierde: 1 × importe, y pasa a descuento", () => {
    const c = normalizarCompra({
      lineas: [
        {
          descripcion: "Abono camisetas",
          cantidad: "-2",
          precio_unitario: "10,00",
          importe: "-20,00",
          tipo: "articulo",
        },
      ],
    });
    expect(c.lineas[0]).toMatchObject({
      cantidad: 1,
      precio_unitario: -20,
      importe: -20,
      tipo: "descuento",
      cantidad_ajustada: true,
      cantidad_leida: -2,
    });
  });

  it("cantidad sin leer o 0 con importe: 1 × importe", () => {
    const c = normalizarCompra({
      lineas: [
        { descripcion: "Portes", cantidad: null, importe: "7,50" },
        { descripcion: "Camiseta", cantidad: "0", importe: "12,00" },
      ],
    });
    expect(
      c.lineas.map((l) => [l.cantidad, l.precio_unitario, l.importe, l.tipo, l.cantidad_ajustada]),
    ).toEqual([
      [1, 7.5, 7.5, "porte", true],
      [1, 12, 12, "articulo", true],
    ]);
  });

  it("un porte con cantidad negativa sigue siendo porte (solo el artículo pasa a descuento)", () => {
    const c = normalizarCompra({
      lineas: [{ descripcion: "Portes", cantidad: -1, importe: "-4,00", tipo: "porte" }],
    });
    expect(c.lineas[0]).toMatchObject({ tipo: "porte", cantidad: 1, importe: -4 });
  });

  it("cantidad 0 e importe 0: se queda como está (y revisarCompra avisa)", () => {
    const c = normalizarCompra({ lineas: [{ descripcion: "Nada", cantidad: 0, importe: 0 }] });
    expect(c.lineas[0].cantidad).toBe(0);
    expect(c.lineas[0].cantidad_ajustada).toBeUndefined();
  });
});

describe("revisarCompra: avisos del escáner textil", () => {
  const cabecera = {
    proveedor: "Textiles del Sur S.L.",
    nif_proveedor: "B12345678",
    numero: "F-1",
    fecha: "2026-09-01",
    base: 30,
    iva: 6.3,
    irpf: 0,
    total: 36.3,
  };

  it("EAN no válido, pack deducido y cantidad ajustada", () => {
    const leida = normalizarCompra({
      ...cabecera,
      base: "30",
      iva: "6,30",
      total: "36,30",
      lineas: [
        { descripcion: "Camiseta", cantidad: 1, importe: 10, ean: "4006381333932" },
        { descripcion: "Calcetín pack 5", cantidad: 1, importe: 10 },
        { descripcion: "Gorra", cantidad: -1, importe: 10 },
      ],
    });
    const avisos = revisarCompra(leida);
    expect(avisos).toEqual([
      { linea: 0, mensaje: "el EAN 4006381333932 no es válido." },
      { linea: 1, mensaje: "pack deducido del texto (5 uds): compruébalo." },
      { linea: 2, mensaje: "tenía cantidad -1; queda como 1 × importe: compruébalo." },
    ]);
  });

  it("un EAN válido no avisa", () => {
    const leida = normalizarCompra({
      ...cabecera,
      lineas: [{ descripcion: "Camiseta", cantidad: 3, importe: 30, ean: "4006381333931" }],
    });
    expect(revisarCompra(leida)).toEqual([]);
  });
});

describe("líneas partidas por talla y factura o proforma", () => {
  const partida = (
    talla: string,
    cantidad: number,
    importe: string,
    linea: string,
    total: string,
  ) => ({
    descripcion: `Camiseta ${talla}`,
    cantidad,
    precio_unitario: "3,00",
    importe,
    talla,
    linea_papel: linea,
    importe_linea_papel: total,
  });

  it("normalizarCompra lee linea_papel, importe_linea_papel y tipo_documento", () => {
    const c = normalizarCompra({
      tipo_documento: "proforma",
      referencia_proforma: " ",
      lineas: [
        {
          descripcion: "a",
          cantidad: 1,
          importe: "3",
          linea_papel: "3",
          importe_linea_papel: "-18,00",
        },
        { descripcion: "b", cantidad: 1, importe: "3", linea_papel: "", importe_linea_papel: "18" },
        { descripcion: "c", cantidad: 1, importe: "3", linea_papel: "0", importe_linea_papel: "" },
        { descripcion: "d", cantidad: 1, importe: "3", linea_papel: "2", importe_linea_papel: "" },
      ],
    });
    expect(c.lineas.map((l) => [l.linea_papel, l.importe_linea_papel])).toEqual([
      [3, -18],
      [null, null],
      [null, null],
      [2, null],
    ]);
    expect(c.tipo_documento).toBe("proforma");
    expect(c.referencia_proforma).toBeNull();
    expect(normalizarCompra({ tipo_documento: "", lineas: [] }).tipo_documento).toBeNull();
    expect(normalizarCompra({ tipo_documento: "otra", lineas: [] }).tipo_documento).toBeNull();
    expect(normalizarCompra({ referencia_proforma: "PF-1" }).referencia_proforma).toBe("PF-1");
  });

  it("«S:2 M:3 L:1» partida que suma la línea del papel: sin aviso", () => {
    const c = normalizarCompra({
      base: "18,00",
      iva: "0",
      total: "18,00",
      lineas: [
        partida("S", 2, "6,00", "1", "18,00"),
        partida("M", 3, "9,00", "1", "18,00"),
        partida("L", 1, "3,00", "1", "18,00"),
      ],
    });
    expect(revisarCompra(c)).toEqual([]);
  });

  it("si las tallas no suman la línea por un céntimo: aviso de cabecera", () => {
    const c = normalizarCompra({
      base: "18,00",
      iva: "0",
      total: "18,00",
      lineas: [
        partida("S", 2, "6,00", "1", "18,01"),
        partida("M", 3, "9,00", "1", "18,01"),
        partida("L", 1, "3,00", "1", "18,01"),
      ],
    });
    expect(revisarCompra(c)).toEqual([
      { linea: null, mensaje: "Línea 1 del papel: las tallas suman 18 y la línea dice 18.01." },
    ]);
  });

  it("importes de línea distintos en el mismo grupo: aviso", () => {
    const c = normalizarCompra({
      base: "18,00",
      iva: "0",
      total: "18,00",
      lineas: [
        partida("S", 2, "6,00", "1", "18,00"),
        partida("M", 3, "9,00", "1", "19,00"),
        partida("L", 1, "3,00", "1", "18,00"),
      ],
    });
    expect(revisarCompra(c)).toEqual([
      {
        linea: null,
        mensaje: "Línea 1 del papel: la IA da dos importes distintos para la misma línea.",
      },
    ]);
  });

  it("sin importe de la línea del papel no se comprueba nada", () => {
    const c = normalizarCompra({
      base: "18,00",
      iva: "0",
      total: "18,00",
      lineas: [partida("S", 2, "6,00", "1", ""), partida("M", 4, "12,00", "1", "")],
    });
    expect(revisarCompra(c)).toEqual([]);
  });
});
