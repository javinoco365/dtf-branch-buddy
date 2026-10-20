import { describe, expect, it } from "vitest";
import {
  DECIMALES_COSTE_ENTRADA,
  conCostesDeEntrada,
  repartirCostes,
  unidadesDeLinea,
  type LineaParaRepartir,
} from "./reparto-compra";
import type { LineaRegistro, TipoLineaCompra } from "./tipos-textil";

const art = (importe: number, cantidad = 1, unidades_por_pack = 1): LineaParaRepartir => ({
  tipo: "articulo",
  cantidad,
  unidades_por_pack,
  importe,
});
const otra = (tipo: TipoLineaCompra, importe: number): LineaParaRepartir => ({
  tipo,
  cantidad: 1,
  unidades_por_pack: 1,
  importe,
});

function ok(r: ReturnType<typeof repartirCostes>) {
  if (!r.ok) throw new Error(`Se esperaba reparto y dio errores: ${JSON.stringify(r.errores)}`);
  return r;
}
const centimos = (n: number) => Math.round(n * 100);

describe("unidadesDeLinea", () => {
  it("cantidad × pack, sin basura binaria", () => {
    expect(unidadesDeLinea(2, 2)).toBe(4);
    expect(unidadesDeLinea(0.1 * 3, 10)).toBe(3);
    expect(unidadesDeLinea(1.5, 1)).toBe(1.5);
  });
});

describe("repartirCostes", () => {
  it("R1: portes y descuento por importe; packs a unidades", () => {
    const r = ok(
      repartirCostes([art(60, 6), art(40, 2, 2), otra("porte", 10), otra("descuento", -5)], 105),
    );
    expect(r.criterio).toBe("importe");
    expect(r.aRepartir).toBe(5);
    expect(r.sumaLineas).toBe(105);
    expect(r.entradas.map((e) => e.indice)).toEqual([0, 1]);
    expect(r.entradas.map((e) => e.unidades)).toEqual([6, 4]);
    expect(r.entradas.map((e) => e.repartido)).toEqual([3, 2]);
    expect(r.entradas.map((e) => e.coste_total)).toEqual([63, 42]);
    expect(r.entradas.map((e) => e.coste_unitario)).toEqual([10.5, 10.5]);
  });

  it("R2: tres artículos de 10,00 y porte 1,00: el céntimo que sobra, al primero", () => {
    const r = ok(repartirCostes([art(10), art(10), art(10), otra("porte", 1)], 31));
    expect(r.entradas.map((e) => e.coste_total)).toEqual([10.34, 10.33, 10.33]);
  });

  it("R3: descuento de 1,00 entre 10,00 y 20,00", () => {
    const r = ok(repartirCostes([art(10), art(20), otra("descuento", -1)], 29));
    expect(r.entradas.map((e) => e.coste_total)).toEqual([9.67, 19.33]);
    expect(r.entradas.map((e) => e.repartido)).toEqual([-0.33, -0.67]);
  });

  it("R4: base 0,01 por encima de las líneas: se reparte y Σ = base", () => {
    const r = ok(repartirCostes([art(10), art(20)], 30.01));
    expect(r.aRepartir).toBe(0.01);
    expect(r.entradas.map((e) => e.coste_total)).toEqual([10, 20.01]);
    expect(centimos(r.entradas.reduce((a, e) => a + e.coste_total, 0))).toBe(3001);
  });

  it("R4 bis: 0,02 por debajo también se admite (redondeo del proveedor)", () => {
    const r = ok(repartirCostes([art(10), art(10)], 19.98));
    expect(r.entradas.map((e) => e.coste_total)).toEqual([9.99, 9.99]);
  });

  it("R5: base 0,50 por encima → E-REG-14 con lo que suman y la base", () => {
    const r = repartirCostes([art(10), art(20)], 30.5);
    expect(r).toEqual({
      ok: false,
      errores: [{ linea: null, codigo: "E-REG-14", datos: [30, 30.5] }],
    });
  });

  it("R5 bis: 0,03 de diferencia ya es demasiado", () => {
    const r = repartirCostes([art(10)], 10.03);
    expect(r.ok).toBe(false);
  });

  it("R6: sin artículos → E-REG-8", () => {
    expect(repartirCostes([otra("porte", 5)], 5)).toEqual({
      ok: false,
      errores: [{ linea: null, codigo: "E-REG-8", datos: [] }],
    });
    expect(repartirCostes([], 0)).toMatchObject({ ok: false });
  });

  it("R7: artículo negativo → E-REG-9 en su línea", () => {
    const r = repartirCostes([art(10), art(-2)], 8);
    expect(r).toEqual({ ok: false, errores: [{ linea: 1, codigo: "E-REG-9", datos: [] }] });
  });

  it("R8: 1,5 unidades → E-REG-10 con cantidad, pack y unidades", () => {
    const r = repartirCostes([otra("porte", 1), art(15, 1.5)], 16);
    expect(r).toEqual({
      ok: false,
      errores: [{ linea: 1, codigo: "E-REG-10", datos: [1.5, 1, 1.5] }],
    });
  });

  it("R8 bis: cero unidades y pack que no da entero", () => {
    const r = repartirCostes([art(10, 0), art(10, 3, 0.5)], 20);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errores).toEqual([
        { linea: 0, codigo: "E-REG-10", datos: [0, 1, 0] },
        { linea: 1, codigo: "E-REG-10", datos: [3, 0.5, 1.5] },
      ]);
    }
  });

  it("un pack decimal que da unidades enteras vale", () => {
    const r = ok(repartirCostes([art(12, 4, 0.5)], 12));
    expect(r.entradas[0].unidades).toBe(2);
    expect(r.entradas[0].coste_unitario).toBe(6);
  });

  it("devuelve todos los errores de línea y el de la base juntos", () => {
    const r = repartirCostes([art(-1), art(5, 1.5)], 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.map((e) => e.codigo)).toEqual(["E-REG-9", "E-REG-10", "E-REG-14"]);
  });

  it("R9: artículos a 0 € con porte 5,00 → por unidades", () => {
    const r = ok(repartirCostes([art(0, 3), art(0, 1), otra("porte", 5)], 5));
    expect(r.criterio).toBe("unidades");
    expect(r.entradas.map((e) => e.coste_total)).toEqual([3.75, 1.25]);
    expect(r.entradas.map((e) => e.coste_unitario)).toEqual([1.25, 1.25]);
  });

  it("un artículo a 0 € con otros de pago no recibe nada (se reparte por importe)", () => {
    const r = ok(repartirCostes([art(0, 1), art(10, 1), otra("porte", 2)], 12));
    expect(r.entradas.map((e) => e.coste_total)).toEqual([0, 12]);
  });

  it("R10: descuento mayor que los artículos → E-REP-1", () => {
    const r = repartirCostes([art(10), otra("descuento", -15)], -5);
    expect(r).toEqual({ ok: false, errores: [{ linea: 0, codigo: "E-REP-1", datos: [] }] });
  });

  it("descuento mayor que una línea, pero no que el total: ninguna queda en negativo", () => {
    const r = ok(repartirCostes([art(100), art(1), otra("descuento", -50)], 51));
    expect(r.entradas.map((e) => e.coste_total)).toEqual([50.5, 0.5]);
    expect(r.entradas.every((e) => e.coste_total >= 0)).toBe(true);
  });

  it("un descuento que lo deja todo a 0 € (base 0)", () => {
    const r = ok(repartirCostes([art(10, 10), otra("descuento", -10)], 0));
    expect(r.entradas[0]).toMatchObject({ coste_total: 0, coste_unitario: 0, unidades: 10 });
  });

  it("otros cargos y redondeo van juntos en lo repartido", () => {
    const r = ok(repartirCostes([art(30), otra("otro", 1.5), otra("porte", 4.5)], 36.01));
    expect(r.aRepartir).toBe(6.01);
    expect(r.entradas[0].coste_total).toBe(36.01);
  });

  it("redondeos difíciles: 0,01 entre tres artículos iguales va al primero", () => {
    const r = ok(repartirCostes([art(1), art(1), art(1)], 3.01));
    expect(r.entradas.map((e) => e.coste_total)).toEqual([1.01, 1, 1]);
  });

  it("redondeos difíciles: −0,02 entre tres, a los de mayor resto y luego por índice", () => {
    const r = ok(repartirCostes([art(1), art(2), art(1)], 3.98));
    // Pesos 100, 200, 100 sobre 2 céntimos: 0,5 / 1,0 / 0,5 → el 2.º se lleva 1 y
    // el céntimo que falta, el primero (empate de resto y de peso: menor índice).
    expect(r.entradas.map((e) => e.repartido)).toEqual([-0.01, -0.01, 0]);
    expect(r.entradas.map((e) => e.coste_total)).toEqual([0.99, 1.99, 1]);
  });

  it("E-REG-13: un porte negativo o un descuento positivo no se reparten (la base tampoco los deja)", () => {
    const r = repartirCostes([art(100), otra("descuento", 8), otra("porte", -3)], 105);
    expect(r).toEqual({
      ok: false,
      errores: [
        { linea: 1, codigo: "E-REG-13", datos: [] },
        { linea: 2, codigo: "E-REG-13", datos: [] },
      ],
    });
    // Con su signo, sí; y «otro» puede llevar cualquiera.
    expect(repartirCostes([art(100), otra("descuento", -8), otra("otro", -2)], 90).ok).toBe(true);
  });

  it("mayor resto: el céntimo suelto va al de más resto aunque pese menos", () => {
    // R = 3 céntimos, pesos 100 y 300: partes 0 y 2, restos 300 y 100 → al primero.
    const r = ok(repartirCostes([art(1), art(3), otra("porte", 0.03)], 4.03));
    expect(r.entradas.map((e) => e.repartido)).toEqual([0.01, 0.02]);
  });

  it("empate de resto: gana el de más peso", () => {
    // R = 1 céntimo, pesos 100, 200, 100 (W 400): restos 100, 200, 100 → al 2.º.
    const r = ok(repartirCostes([art(1), art(2), art(1), otra("porte", 0.01)], 4.01));
    expect(r.entradas.map((e) => e.repartido)).toEqual([0, 0.01, 0]);
    const r2 = ok(repartirCostes([art(2), art(1), art(1), otra("porte", 0.01)], 4.01));
    // Restos 200, 100, 100: al 1.º (más resto y más peso).
    expect(r2.entradas.map((e) => e.repartido)).toEqual([0.01, 0, 0]);
  });

  it("el coste unitario lleva 8 decimales y cuadra con el total", () => {
    const r = ok(repartirCostes([art(10, 3)], 10));
    expect(DECIMALES_COSTE_ENTRADA).toBe(8);
    expect(r.entradas[0].coste_unitario).toBe(3.33333333);
    expect(Math.abs(3 * r.entradas[0].coste_unitario - 10)).toBeLessThan(0.005);
  });

  it("importes con basura binaria (0,1 + 0,2) no descuadran", () => {
    const r = ok(repartirCostes([art(0.1), art(0.2)], 0.3));
    expect(r.entradas.map((e) => e.coste_total)).toEqual([0.1, 0.2]);
  });

  it("R11: 200 repartos aleatorios cuadran al céntimo", () => {
    // Generador congruencial con semilla fija: la prueba es repetible.
    let semilla = 20261019;
    const azar = () => {
      semilla = (semilla * 1103515245 + 12345) % 2147483648;
      return semilla / 2147483648;
    };
    const entero = (min: number, max: number) => min + Math.floor(azar() * (max - min + 1));

    for (let n = 0; n < 200; n++) {
      const lineas: LineaParaRepartir[] = [];
      const articulos = entero(1, 8);
      for (let i = 0; i < articulos; i++) {
        const packs = entero(1, 3) === 1 ? entero(2, 12) : 1;
        lineas.push(art(entero(0, 50000) / 100, entero(1, 40), packs));
      }
      const sa = lineas.reduce((a, l) => a + centimos(l.importe), 0);
      if (entero(0, 1)) lineas.push(otra("porte", entero(0, 3000) / 100));
      if (entero(0, 1)) {
        const tope = Math.max(0, Math.min(sa, 5000));
        lineas.push(otra("descuento", -entero(0, tope) / 100));
      }
      if (entero(0, 3) === 0) lineas.push(otra("otro", entero(1, 999) / 100));
      const sumaC = lineas.reduce((a, l) => a + centimos(l.importe), 0);
      const baseC = sumaC + entero(-2, 2);
      if (baseC < 0) continue;
      const base = baseC / 100;
      // Cuando los artículos suman 0 y hay descuento, puede quedar negativo:
      // ese caso tiene su propia prueba (R10).
      const r = repartirCostes(lineas, base);
      if (!r.ok) {
        expect(r.errores.every((e) => e.codigo === "E-REP-1")).toBe(true);
        continue;
      }
      const suma = r.entradas.reduce((a, e) => a + centimos(e.coste_total), 0);
      expect(suma).toBe(baseC);
      for (const e of r.entradas) {
        expect(e.coste_total).toBeGreaterThanOrEqual(0);
        expect(Math.abs(e.unidades * e.coste_unitario - e.coste_total)).toBeLessThan(0.005);
        expect(centimos(e.importe + e.repartido)).toBe(centimos(e.coste_total));
      }
    }
  });
});

describe("conCostesDeEntrada", () => {
  const linea = (
    tipo: TipoLineaCompra,
    importe: number,
    cantidad = 1,
    unidades_por_pack = 1,
  ): LineaRegistro => ({
    descripcion: tipo,
    cantidad,
    precio_unitario: importe / cantidad,
    importe,
    unidad: null,
    tipo,
    referencia: null,
    marca: null,
    modelo: null,
    color: null,
    talla: null,
    ean: null,
    unidades_por_pack,
    stock_id: null,
    nueva_variante: null,
    casado_metodo: null,
    unidades_stock: 99,
    coste_total_entrada: 99,
    coste_unitario_entrada: 99,
  });

  it("rellena los artículos y deja en null lo demás", () => {
    const r = conCostesDeEntrada(
      [
        linea("articulo", 60, 6),
        linea("porte", 10),
        linea("articulo", 40, 2, 2),
        linea("descuento", -5),
      ],
      105,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(
      r.lineas.map((l) => [l.unidades_stock, l.coste_total_entrada, l.coste_unitario_entrada]),
    ).toEqual([
      [6, 63, 10.5],
      [null, null, null],
      [4, 42, 10.5],
      [null, null, null],
    ]);
  });

  it("no cambia las líneas de entrada", () => {
    const entrada = [linea("articulo", 10)];
    conCostesDeEntrada(entrada, 10);
    expect(entrada[0].unidades_stock).toBe(99);
  });

  it("pasa los errores tal cual", () => {
    expect(conCostesDeEntrada([linea("porte", 3)], 3)).toEqual({
      ok: false,
      errores: [{ linea: null, codigo: "E-REG-8", datos: [] }],
    });
  });
});
