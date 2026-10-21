import { describe, expect, it } from "vitest";
import { leerListaPedidos, leerListaPedidosPorPartes } from "./pedidos-lista";

// La lista de Pedidos con un Supabase de mentira: cada consulta se apunta y
// responde con filas fijas. La comparación de verdad (las dos lecturas contra
// PostgreSQL 16 y PostgREST 12 con 2.400 pedidos, mismo JSON) se hizo en el
// banco; aquí queda lo que no debe romperse:
//
// - Supabase corta también lo incrustado en 1000 filas por pedido (max_rows):
//   en el banco, un pedido de 1500 líneas llegaba con 1000. Un pedido que
//   llega con 1000 líneas se vuelve a leer entero.
// - Si la consulta única falla, o llegan 1000 cobros o documentos de un
//   pedido, la lista se lee como antes.

type Consulta = {
  tabla: string;
  select: string;
  filtros: [string, string, unknown][];
  rango: [number, number] | null;
};
type Respuesta = {
  data: unknown;
  error: { code?: string; message: string } | null;
  count?: number;
};

function falso(responder: (c: Consulta) => Respuesta) {
  const consultas: Consulta[] = [];
  const cliente = {
    from(tabla: string) {
      const c: Consulta = { tabla, select: "", filtros: [], rango: null };
      const b: Record<string, unknown> = {
        select: (s: string) => ((c.select = s), b),
        range: (a: number, z: number) => ((c.rango = [a, z]), b),
        then: (ok: (r: Respuesta) => unknown, ko: (e: unknown) => unknown) => {
          consultas.push(c);
          return Promise.resolve(responder(c)).then(ok, ko);
        },
      };
      for (const op of ["gte", "lt", "eq", "neq", "in", "order", "limit", "maybeSingle"]) {
        b[op] = (col: string, val: unknown) => (c.filtros.push([op, col, val]), b);
      }
      return b;
    },
  };
  return { cliente, consultas };
}

const PERIODO = { desde: "2026-10-01", hasta: "2026-10-31" };
const pedido = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  numero: id.toUpperCase(),
  tienda_id: "t1",
  cliente_id: null,
  cliente_nombre: null,
  cliente_email: null,
  fecha_pedido: "2026-10-10T10:00:00+00:00",
  origen: "manual",
  ...extra,
});
const lineas = (pedidoId: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${pedidoId}-l${String(i).padStart(4, "0")}`,
    pedido_id: pedidoId,
  }));

/** El id del pedido: la fila lleva todas las columnas de `pedidos`. */
const idDe = (p: object) => (p as { id: string }).id;

const esUnica = (c: Consulta) => c.tabla === "pedidos" && c.select.includes("_lineas");

/** Las tablas de antes, para leerListaPedidosPorPartes. */
function porPartes(
  c: Consulta,
  pedidos: Record<string, unknown>[],
  todas: Record<string, unknown>[],
) {
  if (c.tabla === "pedidos" && c.select === "*") return { data: pedidos, error: null };
  if (c.tabla === "pedido_items") return { data: todas, error: null };
  if (c.tabla === "tiendas") return { data: [{ id: "t1", nombre: "Tienda Uno" }], error: null };
  return { data: [], error: null };
}

function comun(c: Consulta): Respuesta | null {
  if (c.tabla === "gerencia_ajustes") return { data: null, error: null };
  if (c.tabla === "pedidos" && c.select.startsWith("realizado_en"))
    return { data: [], error: null };
  return null;
}

describe("leerListaPedidos", () => {
  it("un pedido que llega con 1000 líneas (el tope) se vuelve a leer entero", async () => {
    const todas = lineas("p1", 1500);
    const { cliente, consultas } = falso((c) => {
      const r = comun(c);
      if (r) return r;
      if (esUnica(c)) {
        return {
          data: [
            {
              ...pedido("p1"),
              _lineas: todas.slice(0, 1000),
              _cobros: [],
              _envios: [],
              _cliente: null,
              _tienda: { nombre: "Tienda Uno" },
              _docs: [],
            },
            {
              ...pedido("p2"),
              _lineas: lineas("p2", 3),
              _cobros: [],
              _envios: [],
              _cliente: null,
              _tienda: { nombre: "Tienda Uno" },
              _docs: [],
            },
          ],
          error: null,
          count: 2,
        };
      }
      if (c.tabla === "pedido_items") {
        // Como Supabase: 1000 como mucho por respuesta.
        const [a, z] = c.rango ?? [0, 999];
        return { data: todas.slice(a, Math.min(z + 1, a + 1000)), error: null };
      }
      throw new Error(`consulta inesperada: ${c.tabla} ${c.select}`);
    });
    const r = await leerListaPedidos(cliente, PERIODO);
    const p1 = r.pedidos.find((p) => idDe(p) === "p1")!;
    expect(p1.items).toHaveLength(1500);
    expect(r.pedidos.find((p) => idDe(p) === "p2")!.items).toHaveLength(3);
    // Solo p1 se vuelve a leer.
    const relectura = consultas.filter((c) => c.tabla === "pedido_items");
    expect(
      relectura.every((c) =>
        c.filtros.some(([op, , v]) => op === "in" && JSON.stringify(v) === '["p1"]'),
      ),
    ).toBe(true);
    // Y los alias no llegan a la pantalla.
    expect(Object.keys(p1).filter((k) => k.startsWith("_"))).toEqual([]);
  });

  for (const [nombre, cambio] of [
    ["si la consulta única falla", { error: { code: "PGRST200", message: "no relationship" } }],
    ["si un pedido llega con 1000 cobros", { cobros: 1000 }],
    ["si un pedido llega con 1000 documentos", { docs: 1000 }],
    ["si la respuesta no trae lo incrustado", { sinIncrustar: true }],
  ] as const) {
    it(`${nombre}, se lee como antes`, async () => {
      const filas = [pedido("p1")];
      const { cliente, consultas } = falso((c) => {
        const r = comun(c);
        if (r) return r;
        if (esUnica(c)) {
          if ("error" in cambio) return { data: null, error: cambio.error };
          if ("sinIncrustar" in cambio) return { data: [pedido("p1")], error: null, count: 1 };
          return {
            data: [
              {
                ...pedido("p1"),
                _lineas: [],
                _cobros:
                  "cobros" in cambio ? Array.from({ length: cambio.cobros }, () => ({})) : [],
                _envios: [],
                _cliente: null,
                _tienda: null,
                _docs:
                  "docs" in cambio
                    ? Array.from({ length: cambio.docs }, () => ({ _rect: [] }))
                    : [],
              },
            ],
            error: null,
            count: 1,
          };
        }
        return porPartes(c, filas, lineas("p1", 2));
      });
      const r = await leerListaPedidos(cliente, PERIODO);
      const antes = await leerListaPedidosPorPartes(
        falso((c) => comun(c) ?? porPartes(c, filas, lineas("p1", 2))).cliente,
        PERIODO,
      );
      expect(r).toEqual(antes);
      expect(consultas.some((c) => c.tabla === "pedidos" && c.select === "*")).toBe(true);
    });
  }

  it("el documento: rectificado, canjeado o vigente, como antes", async () => {
    const doc = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      pedido_id: "p1",
      tipo: "ordinaria",
      serie: "F",
      ejercicio: 2026,
      numero: Number(id.replace(/\D/g, "")),
      estado: "emitida",
      rectifica_a_id: null,
      sustituye_a_id: null,
      _rect: [],
      ...extra,
    });
    const casos: [string, unknown[], string | null][] = [
      ["vigente", [doc("f1")], "f1"],
      ["rectificada por una sin pedido", [doc("f1", { _rect: [{ id: "r9" }] })], null],
      [
        "ticket canjeado por factura",
        [doc("t1", { tipo: "simplificada", serie: "T" }), doc("f2", { sustituye_a_id: "t1" })],
        "f2",
      ],
      [
        "rectificada y vuelta a emitir",
        [doc("f1"), doc("r2", { tipo: "rectificativa", rectifica_a_id: "f1" }), doc("f3")],
        "f3",
      ],
    ];
    for (const [nombre, docs, esperado] of casos) {
      const { cliente } = falso((c) => {
        const r = comun(c);
        if (r) return r;
        return {
          data: [
            {
              ...pedido("p1"),
              _lineas: [],
              _cobros: [],
              _envios: [],
              _cliente: null,
              _tienda: null,
              _docs: docs,
            },
          ],
          error: null,
          count: 1,
        };
      });
      const r = await leerListaPedidos(cliente, PERIODO);
      expect(r.pedidos[0].documento?.id ?? null, nombre).toBe(esperado);
    }
  });
});
