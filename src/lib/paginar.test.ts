import { describe, expect, it } from "vitest";
import { enParalelo, juntarEnOrden } from "./paginar";

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
