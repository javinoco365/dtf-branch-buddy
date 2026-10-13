import { describe, expect, it } from "vitest";
import { filasDePagina, paginaDeLista, tramoDePagina, ultimaPagina } from "./paginacion";

describe("filasDePagina", () => {
  it("la primera página son las filas 0 a 99", () => {
    expect(filasDePagina(0, 100)).toEqual({ desde: 0, hasta: 99 });
  });

  it("la tercera, de la 200 a la 299", () => {
    expect(filasDePagina(2, 100)).toEqual({ desde: 200, hasta: 299 });
  });

  it("una página negativa, rota o con decimales cuenta como la que es", () => {
    expect(filasDePagina(-3, 100)).toEqual({ desde: 0, hasta: 99 });
    expect(filasDePagina(Number.NaN, 100)).toEqual({ desde: 0, hasta: 99 });
    expect(filasDePagina(1.7, 100)).toEqual({ desde: 100, hasta: 199 });
  });
});

describe("ultimaPagina", () => {
  it("340 filas de 100 en 100: cuatro páginas, la última es la 3", () => {
    expect(ultimaPagina(340, 100)).toBe(3);
  });

  it("justas: 200 filas son dos páginas, no tres", () => {
    expect(ultimaPagina(200, 100)).toBe(1);
  });

  it("sin filas, la 0", () => {
    expect(ultimaPagina(0, 100)).toBe(0);
  });
});

describe("tramoDePagina", () => {
  it("la segunda de 340: de la 101 a la 200", () => {
    expect(tramoDePagina(1, 100, 340)).toEqual({ pagina: 1, primera: 101, ultima: 200 });
  });

  it("la última no pasa del total", () => {
    expect(tramoDePagina(3, 100, 340)).toEqual({ pagina: 3, primera: 301, ultima: 340 });
  });

  it("si la página ya no existe (se deshizo lo último), la última que queda", () => {
    expect(tramoDePagina(3, 100, 300)).toEqual({ pagina: 2, primera: 201, ultima: 300 });
  });

  it("sin filas, de 0 a 0", () => {
    expect(tramoDePagina(2, 100, 0)).toEqual({ pagina: 0, primera: 0, ultima: 0 });
  });
});

describe("paginaDeLista", () => {
  const lista = Array.from({ length: 250 }, (_, i) => i);

  it("la segunda página de 250 filas de 100 en 100: de la 100 a la 199", () => {
    const p = paginaDeLista(lista, 1, 100);
    expect(p.pagina).toBe(1);
    expect(p.total).toBe(250);
    expect(p.filas[0]).toBe(100);
    expect(p.filas.at(-1)).toBe(199);
  });

  it("la última, incompleta", () => {
    expect(paginaDeLista(lista, 2, 100).filas).toHaveLength(50);
  });

  it("una página que ya no existe da la última que queda", () => {
    const p = paginaDeLista(lista, 7, 100);
    expect(p.pagina).toBe(2);
    expect(p.filas[0]).toBe(200);
  });

  it("sin filas, la página 0 y vacía", () => {
    expect(paginaDeLista([], 3, 100)).toEqual({ filas: [], pagina: 0, total: 0 });
  });
});
