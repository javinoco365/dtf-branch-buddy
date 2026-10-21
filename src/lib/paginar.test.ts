import { describe, expect, it } from "vitest";
import { enParalelo, juntarEnOrden, leerTodas, leerTodasEnParalelo } from "./paginar";

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("enParalelo", () => {
  it("devuelve los resultados en el orden de entrada aunque lleguen desordenados", async () => {
    const r = await enParalelo([30, 5, 20, 1, 10], 3, async (ms, i) => {
      await esperar(ms);
      return `${i}:${ms}`;
    });
    expect(r).toEqual(["0:30", "1:5", "2:20", "3:1", "4:10"]);
  });

  it("nunca tiene más de `limite` llamadas en marcha", async () => {
    let enMarcha = 0;
    let maximo = 0;
    await enParalelo(
      Array.from({ length: 12 }, (_, i) => i),
      4,
      async (i) => {
        enMarcha++;
        maximo = Math.max(maximo, enMarcha);
        await esperar(1 + (i % 3));
        enMarcha--;
        return i;
      },
    );
    expect(maximo).toBe(4);
  });

  it("con límite 1 va en serie", async () => {
    const orden: number[] = [];
    await enParalelo([3, 1, 2], 1, async (x) => {
      orden.push(x);
      await esperar(x);
    });
    expect(orden).toEqual([3, 1, 2]);
  });

  it("lista vacía: no llama a nada y devuelve []", async () => {
    let llamadas = 0;
    expect(await enParalelo([], 4, async () => llamadas++)).toEqual([]);
    expect(llamadas).toBe(0);
  });

  it("lanza el error del primero que falla en el orden de la lista y no empieza más", async () => {
    const empezados: number[] = [];
    const p = enParalelo([0, 1, 2, 3, 4, 5, 6, 7], 2, async (i) => {
      empezados.push(i);
      if (i === 1) {
        await esperar(10);
        throw new Error("uno");
      }
      if (i === 2) {
        await esperar(1);
        throw new Error("dos");
      }
      await esperar(1);
      return i;
    });
    await expect(p).rejects.toThrow("uno");
    expect(empezados).not.toContain(7);
  });
});

describe("juntarEnOrden", () => {
  it("concatena en orden si no hay errores", () => {
    expect(
      juntarEnOrden([
        { data: [1, 2], error: null },
        { data: [3], error: null },
      ]),
    ).toEqual({ data: [1, 2, 3], error: null });
  });

  it("se para en el primer trozo con error y conserva lo leído hasta ahí", () => {
    expect(
      juntarEnOrden([
        { data: [1], error: null },
        { data: [2], error: "fallo" },
        { data: [3], error: "otro" },
      ]),
    ).toEqual({ data: [1, 2], error: "fallo" });
  });
});

describe("leerTodasEnParalelo", () => {
  type R = { data: number[] | null; error: { message: string } | null; count?: number | null };
  /** Una tabla de `n` filas leída por páginas, con lo que se le pida torcer. */
  function fuente(
    n: number,
    opciones: { fallaDesde?: number; crece?: number; sinCuenta?: boolean } = {},
  ) {
    let filas = Array.from({ length: n }, (_, i) => i);
    const pedidas: number[] = [];
    let primera = true;
    const pagina = async (desde: number, hasta: number, contar = false): Promise<R> => {
      pedidas.push(desde);
      await esperar(desde % 3);
      if (opciones.fallaDesde !== undefined && desde >= opciones.fallaDesde) {
        return { data: null, error: { message: `falla ${desde}` } };
      }
      const r: R = { data: filas.slice(desde, hasta + 1), error: null };
      if (contar) r.count = opciones.sinCuenta ? null : filas.length;
      // Entran filas justo después de leer la primera página.
      if (primera && opciones.crece) {
        filas = [...filas, ...Array.from({ length: opciones.crece }, (_, i) => n + i)];
      }
      primera = false;
      return r;
    };
    return { pagina, pedidas };
  }

  for (const n of [0, 5, 999, 1000, 1001, 2500, 3000, 7321]) {
    it(`${n} filas: lo mismo que leerTodas`, async () => {
      const enSerie = await leerTodas(fuente(n).pagina);
      const aLaVez = await leerTodasEnParalelo(fuente(n).pagina);
      expect(aLaVez).toEqual(enSerie);
    });
  }

  it("un error para donde pararía en serie", async () => {
    const enSerie = await leerTodas(fuente(4500, { fallaDesde: 2000 }).pagina);
    const aLaVez = await leerTodasEnParalelo(fuente(4500, { fallaDesde: 2000 }).pagina);
    expect(aLaVez).toEqual(enSerie);
    expect(aLaVez.data).toHaveLength(2000);
    expect(aLaVez.error?.message).toBe("falla 2000");
  });

  it("si entran filas mientras se lee, no se pierde ninguna", async () => {
    const r = await leerTodasEnParalelo(fuente(3000, { crece: 1500 }).pagina);
    expect(r.data).toHaveLength(4500);
    expect(r.data).toEqual(Array.from({ length: 4500 }, (_, i) => i));
  });

  it("sin recuento, en serie", async () => {
    const f = fuente(2500, { sinCuenta: true });
    const r = await leerTodasEnParalelo(f.pagina);
    expect(r.data).toHaveLength(2500);
    expect(f.pedidas).toEqual([0, 1000, 2000]);
  });

  it("con recuento, las páginas a la vez y ninguna de más", async () => {
    const f = fuente(2500);
    await leerTodasEnParalelo(f.pagina);
    expect([...f.pedidas].sort((a, b) => a - b)).toEqual([0, 1000, 2000]);
  });
});
