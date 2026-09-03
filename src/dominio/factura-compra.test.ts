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
    total: 302.5,
    lineas: [
      { descripcion: "Camiseta negra M", cantidad: 50, precio_unitario: 3, importe: 150 },
      { descripcion: "Camiseta negra L", cantidad: 25, precio_unitario: 4, importe: 100 },
    ],
  };

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
