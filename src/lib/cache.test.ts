import { QueryObserver, type QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { crearQueryClient, invalidarTrasGuardar } from "./cache";

// Sin red ni React: el QueryClient de la aplicación con consultas de mentira
// que cuentan cuántas veces se piden.

const esperar = (ms = 0) => new Promise((r) => setTimeout(r, ms));

let limpiar: Array<() => void> = [];
afterEach(() => {
  for (const f of limpiar) f();
  limpiar = [];
});

/** Una consulta que se está viendo en pantalla (con observador). */
function enPantalla(qc: QueryClient, clave: string, retraso = 0) {
  const veces = { n: 0 };
  const obs = new QueryObserver(qc, {
    queryKey: [clave],
    queryFn: async () => {
      veces.n++;
      if (retraso) await esperar(retraso);
      return veces.n;
    },
  });
  limpiar.push(obs.subscribe(() => {}));
  return veces;
}

async function mutar(
  qc: QueryClient,
  fn: () => Promise<unknown>,
  meta?: { invalida?: false },
): Promise<void> {
  const m = qc.getMutationCache().build(qc, { mutationFn: fn, meta });
  await m.execute(undefined).catch(() => {});
  await esperar(5);
}

describe("crearQueryClient: invalidación central tras guardar", () => {
  it("al guardar, lo que está en pantalla se vuelve a pedir", async () => {
    const qc = crearQueryClient();
    const pedidos = enPantalla(qc, "pedidos");
    const gerencia = enPantalla(qc, "gerencia-ventas");
    await esperar(5);
    expect([pedidos.n, gerencia.n]).toEqual([1, 1]);

    await mutar(qc, async () => "guardado");
    expect([pedidos.n, gerencia.n]).toEqual([2, 2]);
  });

  it("también si el guardado falla (puede haber escrito a medias)", async () => {
    const qc = crearQueryClient();
    const pedidos = enPantalla(qc, "pedidos");
    await esperar(5);

    await mutar(qc, async () => {
      throw new Error("se cortó en la segunda tanda");
    });
    expect(pedidos.n).toBe(2);
  });

  it("con meta { invalida: false } no recarga nada", async () => {
    const qc = crearQueryClient();
    const pedidos = enPantalla(qc, "pedidos");
    await esperar(5);

    await mutar(qc, async () => "exportado", { invalida: false });
    expect(pedidos.n).toBe(1);
    expect(qc.getQueryState(["pedidos"])?.isInvalidated).toBe(false);
  });

  it("lo que no está en pantalla queda viejo, sin pedirse ahora", async () => {
    const qc = crearQueryClient();
    let veces = 0;
    await qc.fetchQuery({ queryKey: ["fiscal"], queryFn: async () => ++veces });
    expect(veces).toBe(1);

    await mutar(qc, async () => "guardado");
    expect(veces).toBe(1);
    expect(qc.getQueryState(["fiscal"])?.isInvalidated).toBe(true);
  });

  it("no cancela una recarga en marcha: se une a ella (no repite la consulta)", async () => {
    const qc = crearQueryClient();
    const pedidos = enPantalla(qc, "pedidos", 20);
    await esperar(30);
    expect(pedidos.n).toBe(1);

    // Como hacen las mutaciones que además invalidan a mano en su onSuccess.
    void qc.invalidateQueries({ queryKey: ["pedidos"] });
    await esperar(1);
    await invalidarTrasGuardar(qc);
    await esperar(30);
    expect(pedidos.n).toBe(2);
  });
});
