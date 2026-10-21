import { QueryObserver, type QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import {
  crearQueryClient,
  delPeriodoAnterior,
  invalidarTrasGuardar,
  reintentar,
  VIGENCIA,
  VIGENCIA_HISTORIA,
  VIGENCIA_REFERENCIA,
} from "./cache";

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

describe("crearQueryClient: vigencia de lo leído", () => {
  const vigencia = (qc: QueryClient, clave: unknown[]) =>
    qc.defaultQueryOptions({ queryKey: clave }).staleTime;

  it("un minuto por defecto; diez la referencia; cinco la historia pesada", () => {
    const qc = crearQueryClient();
    expect(vigencia(qc, ["pedidos", "all", "a", "b"])).toBe(VIGENCIA);
    expect(vigencia(qc, ["pedidos-periodo", "a", "b", "todas"])).toBe(60_000);
    expect(vigencia(qc, ["tiendas"])).toBe(VIGENCIA_REFERENCIA);
    expect(vigencia(qc, ["tiendas-sidebar", "x"])).toBe(10 * 60_000);
    expect(vigencia(qc, ["gerencia-ajustes"])).toBe(VIGENCIA_REFERENCIA);
    // «tienda-dashboard» son datos, no referencia: no casa con «tiendas».
    expect(vigencia(qc, ["tienda-dashboard", "x"])).toBe(VIGENCIA);
    expect(vigencia(qc, ["gerencia-fiscal", 2026])).toBe(VIGENCIA_HISTORIA);
    expect(vigencia(qc, ["almacen-movimientos"])).toBe(5 * 60_000);
  });

  it("volver a una pantalla antes de un minuto no vuelve a pedir", async () => {
    const qc = crearQueryClient();
    const primera = enPantalla(qc, "gerencia-ventas");
    await esperar(5);
    limpiar.forEach((f) => f());
    limpiar = [];
    // Se vuelve a montar con la misma clave y la misma función.
    const obs = new QueryObserver(qc, {
      queryKey: ["gerencia-ventas"],
      queryFn: async () => ++primera.n,
    });
    limpiar.push(obs.subscribe(() => {}));
    await esperar(5);
    expect(primera.n).toBe(1);
  });
});

describe("reintentar", () => {
  it("una vez ante un fallo cualquiera, ninguna si es de sesión o permisos", () => {
    expect(reintentar(0, new Error("fetch failed"))).toBe(true);
    expect(reintentar(1, new Error("fetch failed"))).toBe(false);
    expect(reintentar(0, new Error("Unauthorized"))).toBe(false);
    expect(reintentar(0, new Error("JWT expired"))).toBe(false);
    expect(reintentar(0, new Error("PGRST301: algo"))).toBe(false);
    expect(reintentar(0, new Error("permission denied for table pedidos"))).toBe(false);
  });

  it("un importe o un número de pedido con 4xx no cuenta como error HTTP", () => {
    expect(reintentar(0, new Error("El pedido 404 no cuadra: 412,50 €"))).toBe(true);
  });
});

describe("delPeriodoAnterior", () => {
  const conservar = delPeriodoAnterior<number[]>((clave) => clave[3] === "tienda-a");

  it("con la misma tienda, los datos del periodo anterior", () => {
    expect(conservar([1, 2], { queryKey: ["pedidos-periodo", "x", "y", "tienda-a"] })).toEqual([
      1, 2,
    ]);
  });

  it("si cambia la tienda, nada (no se enseñan los de la otra)", () => {
    expect(
      conservar([1, 2], { queryKey: ["pedidos-periodo", "x", "y", "tienda-b"] }),
    ).toBeUndefined();
  });

  it("sin consulta anterior, nada", () => {
    expect(conservar(undefined, undefined)).toBeUndefined();
  });
});
