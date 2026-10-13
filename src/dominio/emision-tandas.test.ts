import { describe, expect, it } from "vitest";
import { MOTIVO_SIN_RESPUESTA, emitirPorTandas, type ResultadoEmision } from "./emision-tandas";

const pedidos = Array.from({ length: 5 }, (_, i) => ({ id: `id-${i + 1}`, numero: `W-${i + 1}` }));

/** Un servidor que emite todo lo que le llega, salvo W-2, que ya tiene documento. */
const emitirBien = async (ids: string[]): Promise<ResultadoEmision> => ({
  emitidos: ids
    .filter((id) => id !== "id-2")
    .map((id) => ({ pedido: id.replace("id-", "W-"), referencia: `T${id}`, id: `f-${id}` })),
  omitidos: ids.includes("id-2") ? [{ pedido: "W-2", motivo: "ya tiene documento" }] : [],
});

describe("emitirPorTandas", () => {
  it("manda las tandas en orden y junta lo que responde cada una", async () => {
    const llamadas: string[][] = [];
    const avance: number[] = [];
    const r = await emitirPorTandas(
      pedidos,
      2,
      (ids) => {
        llamadas.push(ids);
        return emitirBien(ids);
      },
      (n) => avance.push(n),
    );
    expect(llamadas).toEqual([["id-1", "id-2"], ["id-3", "id-4"], ["id-5"]]);
    expect(avance).toEqual([2, 4, 5]);
    expect(r.emitidos.map((e) => e.pedido)).toEqual(["W-1", "W-3", "W-4", "W-5"]);
    expect(r.omitidos).toEqual([{ pedido: "W-2", motivo: "ya tiene documento" }]);
    expect(r.corte).toBeNull();
  });

  it("si falla una tanda que no es la primera, esa y las siguientes salen para revisar", async () => {
    let n = 0;
    const r = await emitirPorTandas(pedidos, 2, (ids) => {
      n += 1;
      if (n === 2) return Promise.reject(new Error("Tiempo agotado"));
      return emitirBien(ids);
    });
    // No se manda nada después del fallo.
    expect(n).toBe(2);
    expect(r.emitidos.map((e) => e.pedido)).toEqual(["W-1"]);
    expect(r.omitidos).toEqual([
      { pedido: "W-2", motivo: "ya tiene documento" },
      { pedido: "W-3", motivo: MOTIVO_SIN_RESPUESTA },
      { pedido: "W-4", motivo: MOTIVO_SIN_RESPUESTA },
      { pedido: "W-5", motivo: MOTIVO_SIN_RESPUESTA },
    ]);
    expect(r.corte).toEqual({ pedidos: 3, motivo: "Tiempo agotado", enLaPrimera: false });
  });

  it("si falla la primera, todos sin respuesta y se dice que fue la primera", async () => {
    const r = await emitirPorTandas(pedidos, 20, () => Promise.reject(new Error("")));
    expect(r.emitidos).toEqual([]);
    expect(r.omitidos).toHaveLength(5);
    expect(r.corte).toEqual({
      pedidos: 5,
      motivo: "el servidor no ha respondido",
      enLaPrimera: true,
    });
  });

  it("sin pedidos no llama a nadie", async () => {
    let llamado = false;
    const r = await emitirPorTandas([], 20, async () => {
      llamado = true;
      return { emitidos: [], omitidos: [] };
    });
    expect(llamado).toBe(false);
    expect(r).toEqual({ emitidos: [], omitidos: [], corte: null });
  });
});
