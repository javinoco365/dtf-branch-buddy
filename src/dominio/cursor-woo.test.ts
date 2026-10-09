import { describe, expect, it } from "vitest";
import {
  avanzarCursor,
  clientesNuevosDePagina,
  cursorDesdeUltimoPedido,
  fechaGmtWoo,
  filtroDeFechaIgnorado,
  modificadoDespuesDe,
  modificadoMasReciente,
  otraPaginaEnEstaTanda,
  parametrosPaginaWoo,
  quedanTrasPagina,
  seguirConOtraTanda,
  totalDeCabecera,
  type CursorWoo,
} from "./cursor-woo";

describe("fechaGmtWoo", () => {
  it("lee la fecha GMT de WooCommerce, que viene sin zona, como UTC", () => {
    expect(fechaGmtWoo("2026-10-09T08:20:30")).toBe("2026-10-09T08:20:30.000Z");
  });

  it("respeta la zona si la trae", () => {
    expect(fechaGmtWoo("2026-10-09T10:20:30+02:00")).toBe("2026-10-09T08:20:30.000Z");
    expect(fechaGmtWoo("2026-10-09T08:20:30Z")).toBe("2026-10-09T08:20:30.000Z");
  });

  it("lo que no es una fecha da null", () => {
    expect(fechaGmtWoo(null)).toBeNull();
    expect(fechaGmtWoo("")).toBeNull();
    expect(fechaGmtWoo("ayer")).toBeNull();
    expect(fechaGmtWoo(1234)).toBeNull();
  });
});

describe("modificadoDespuesDe", () => {
  it("va un segundo antes del cursor, al segundo y sin zona", () => {
    expect(modificadoDespuesDe("2026-10-09T08:20:30.000Z")).toBe("2026-10-09T08:20:29");
  });

  it("los milisegundos se recortan hacia atrás, nunca hacia delante", () => {
    expect(modificadoDespuesDe("2026-10-09T08:20:30.900Z")).toBe("2026-10-09T08:20:29");
  });

  it("cruza el cambio de día", () => {
    expect(modificadoDespuesDe("2026-10-10T00:00:00.000Z")).toBe("2026-10-09T23:59:59");
  });
});

describe("parametrosPaginaWoo", () => {
  it("sin cursor pide desde el principio, por fecha de modificación ascendente", () => {
    expect(parametrosPaginaWoo({ desde: null, pagina: 1 })).toEqual({
      per_page: "100",
      page: "1",
      orderby: "modified",
      order: "asc",
      dates_are_gmt: "true",
    });
  });

  it("con cursor añade modified_after con el margen", () => {
    const p = parametrosPaginaWoo({ desde: "2026-10-09T08:20:30.000Z", pagina: 3 });
    expect(p.modified_after).toBe("2026-10-09T08:20:29");
    expect(p.page).toBe("3");
    expect(p.dates_are_gmt).toBe("true");
  });
});

describe("modificadoMasReciente", () => {
  it("coge la más reciente, sin fiarse del orden", () => {
    expect(
      modificadoMasReciente([
        { date_modified_gmt: "2026-10-09T08:00:00" },
        { date_modified_gmt: "2026-10-09T09:00:00" },
        { date_modified_gmt: "2026-10-09T07:00:00" },
      ]),
    ).toBe("2026-10-09T09:00:00.000Z");
  });

  it("sin fecha de modificación usa la de creación", () => {
    expect(modificadoMasReciente([{ date_created_gmt: "2026-10-09T08:00:00" }])).toBe(
      "2026-10-09T08:00:00.000Z",
    );
  });

  it("una página vacía no tiene fecha", () => {
    expect(modificadoMasReciente([])).toBeNull();
  });
});

const pagina = (n: number, fecha: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => ({ date_modified_gmt: fecha(i) }));

describe("avanzarCursor", () => {
  it("una página incompleta es la última: el cursor se queda en lo último visto", () => {
    const r = avanzarCursor(
      { desde: null, pagina: 1 },
      pagina(3, (i) => `2026-10-0${i + 1}T10:00:00`),
    );
    expect(r).toEqual({ siguiente: { desde: "2026-10-03T10:00:00.000Z", pagina: 1 }, fin: true });
  });

  it("una página vacía es la última y no mueve el cursor", () => {
    const c: CursorWoo = { desde: "2026-10-01T10:00:00.000Z", pagina: 1 };
    expect(avanzarCursor(c, [])).toEqual({ siguiente: c, fin: true });
  });

  it("una página llena que pasa del cursor avanza y vuelve a la página 1", () => {
    const r = avanzarCursor(
      { desde: "2026-10-01T00:00:00.000Z", pagina: 1 },
      pagina(
        100,
        (i) =>
          `2026-10-01T10:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}`,
      ),
    );
    expect(r.fin).toBe(false);
    expect(r.siguiente).toEqual({ desde: "2026-10-01T10:01:39.000Z", pagina: 1 });
  });

  it("una página llena en el mismo segundo que el cursor pide la página siguiente", () => {
    const c: CursorWoo = { desde: "2026-10-01T10:00:00.000Z", pagina: 1 };
    const r = avanzarCursor(
      c,
      pagina(100, () => "2026-10-01T10:00:00"),
    );
    expect(r).toEqual({ siguiente: { desde: c.desde, pagina: 2 }, fin: false });
  });

  it("si desde una página 2 se avanza, vuelve a la página 1", () => {
    const r = avanzarCursor(
      { desde: "2026-10-01T10:00:00.000Z", pagina: 2 },
      pagina(100, (i) => (i < 99 ? "2026-10-01T10:00:00" : "2026-10-01T10:00:05")),
    );
    expect(r.siguiente).toEqual({ desde: "2026-10-01T10:00:05.000Z", pagina: 1 });
  });

  it("nunca retrocede aunque la página traiga algo anterior al cursor", () => {
    const r = avanzarCursor({ desde: "2026-10-05T00:00:00.000Z", pagina: 1 }, [
      { date_modified_gmt: "2026-10-04T23:59:59" },
    ]);
    expect(r.siguiente.desde).toBe("2026-10-05T00:00:00.000Z");
  });
});

/**
 * Una tienda de mentira que responde como la API de WooCommerce:
 * modified_after estricto («>»), al segundo, orden por modificación y
 * después por id, páginas por número.
 */
type PedidoFalso = { id: number; mod: number }; // mod: segundos desde una fecha fija
const ORIGEN = Date.parse("2026-10-01T00:00:00Z");
const isoDe = (s: number) => new Date(ORIGEN + s * 1000).toISOString().slice(0, 19);

function consultar(tienda: PedidoFalso[], p: Record<string, string>) {
  const corte = p.modified_after ? (Date.parse(`${p.modified_after}Z`) - ORIGEN) / 1000 : -Infinity;
  const filtrados = tienda
    .filter((o) => o.mod > corte)
    .sort((a, b) => a.mod - b.mod || a.id - b.id);
  const porPagina = Number(p.per_page);
  const desde = (Number(p.page) - 1) * porPagina;
  return {
    items: filtrados
      .slice(desde, desde + porPagina)
      .map((o) => ({ id: o.id, date_modified_gmt: isoDe(o.mod) })),
    total: filtrados.length,
  };
}

/** Recorre la tienda como la sincronización, y deja que `mientras` la cambie entre páginas. */
function recorrer(
  tienda: PedidoFalso[],
  inicio: CursorWoo,
  mientras?: (pagina: number) => void,
  porPagina = 100,
) {
  const vistos = new Set<number>();
  let cursor = inicio;
  for (let n = 0; n < 10_000; n++) {
    const { items } = consultar(tienda, parametrosPaginaWoo(cursor, porPagina));
    for (const it of items) vistos.add(it.id);
    const a = avanzarCursor(cursor, items, porPagina);
    cursor = a.siguiente;
    if (a.fin) return { vistos, cursor, peticiones: n + 1 };
    mientras?.(n);
  }
  throw new Error("no termina");
}

describe("recorrido completo contra una tienda de mentira", () => {
  it("con 1.050 pedidos nuevos desde la última vez, llegan todos (antes, solo 100)", () => {
    const tienda = Array.from({ length: 1050 }, (_, i) => ({ id: i + 1, mod: 1000 + i * 7 }));
    const { vistos } = recorrer(tienda, { desde: new Date(ORIGEN).toISOString(), pagina: 1 });
    expect(vistos.size).toBe(1050);
  });

  it("desde el principio (sin cursor) también", () => {
    const tienda = Array.from({ length: 345 }, (_, i) => ({ id: i + 1, mod: i * 3 }));
    expect(recorrer(tienda, { desde: null, pagina: 1 }).vistos.size).toBe(345);
  });

  it("no se pierde nada aunque cientos de pedidos compartan el mismo segundo", () => {
    // Una acción masiva: 250 pedidos modificados en el mismo segundo, en medio.
    const tienda = [
      ...Array.from({ length: 150 }, (_, i) => ({ id: i + 1, mod: i })),
      ...Array.from({ length: 250 }, (_, i) => ({ id: 1000 + i, mod: 500 })),
      ...Array.from({ length: 80 }, (_, i) => ({ id: 2000 + i, mod: 600 + i })),
    ];
    const { vistos } = recorrer(tienda, { desde: null, pagina: 1 });
    expect(vistos.size).toBe(480);
  });

  it("no se pierde nada si un pedido se modifica mientras se recorre", () => {
    const tienda = Array.from({ length: 400 }, (_, i) => ({ id: i + 1, mod: i * 10 }));
    let ultimo = 400 * 10;
    const { vistos } = recorrer(tienda, { desde: null, pagina: 1 }, (n) => {
      // Entre página y página, alguien toca un pedido ya visto: se va al final.
      const tocado = tienda[n * 37];
      ultimo += 1;
      tocado.mod = ultimo;
    });
    expect(vistos.size).toBe(400);
  });

  it("si al cortar una tanda se sigue con el cursor devuelto, no falta ninguno", () => {
    const tienda = Array.from({ length: 730 }, (_, i) => ({ id: i + 1, mod: 50 + i * 2 }));
    const vistos = new Set<number>();
    let cursor: CursorWoo = { desde: null, pagina: 1 };
    // Tandas de 2 páginas: la pantalla vuelve a llamar con el cursor.
    for (let tanda = 0; tanda < 50; tanda++) {
      let fin = false;
      for (let p = 0; p < 2 && !fin; p++) {
        const { items } = consultar(tienda, parametrosPaginaWoo(cursor));
        items.forEach((it) => vistos.add(it.id));
        const a = avanzarCursor(cursor, items);
        cursor = a.siguiente;
        fin = a.fin;
      }
      if (fin) break;
    }
    expect(vistos.size).toBe(730);
  });

  it("una sincronización sin nada nuevo hace una sola petición", () => {
    const tienda = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, mod: i }));
    const primero = recorrer(tienda, { desde: null, pagina: 1 });
    const segunda = recorrer(tienda, primero.cursor);
    expect(segunda.peticiones).toBe(1);
  });
});

describe("filtroDeFechaIgnorado", () => {
  const c: CursorWoo = { desde: "2026-10-09T08:00:00.000Z", pagina: 1 };

  it("sin cursor no hay filtro que comprobar", () => {
    expect(
      filtroDeFechaIgnorado({ desde: null, pagina: 1 }, [
        { date_modified_gmt: "2020-01-01T00:00:00" },
      ]),
    ).toBe(false);
  });

  it("lo modificado después del corte es lo normal", () => {
    expect(filtroDeFechaIgnorado(c, [{ date_modified_gmt: "2026-10-09T07:59:59" }])).toBe(false);
  });

  it("algo de mucho antes del corte es que WooCommerce no ha filtrado", () => {
    expect(filtroDeFechaIgnorado(c, [{ date_modified_gmt: "2025-01-01T00:00:00" }])).toBe(true);
  });
});

describe("totalDeCabecera", () => {
  it("lee el número", () => {
    expect(totalDeCabecera("1234")).toBe(1234);
    expect(totalDeCabecera(" 0 ")).toBe(0);
  });

  it("sin cabecera o con basura, null", () => {
    expect(totalDeCabecera(null)).toBeNull();
    expect(totalDeCabecera(undefined)).toBeNull();
    expect(totalDeCabecera("")).toBeNull();
    expect(totalDeCabecera("muchos")).toBeNull();
    expect(totalDeCabecera("-3")).toBeNull();
  });
});

describe("quedanTrasPagina", () => {
  it("si era la última página, no queda nada", () => {
    expect(quedanTrasPagina(250, { desde: null, pagina: 1 }, 50, true)).toBe(0);
  });

  it("resta lo traído en esta página y en las anteriores de la misma consulta", () => {
    expect(quedanTrasPagina(1050, { desde: null, pagina: 1 }, 100, false)).toBe(950);
    expect(quedanTrasPagina(1050, { desde: null, pagina: 3 }, 100, false)).toBe(750);
  });

  it("sin total en la cabecera no se sabe", () => {
    expect(quedanTrasPagina(null, { desde: null, pagina: 1 }, 100, false)).toBeNull();
  });

  it("nunca negativo", () => {
    expect(quedanTrasPagina(100, { desde: null, pagina: 1 }, 100, false)).toBe(0);
  });
});

describe("otraPaginaEnEstaTanda", () => {
  const limites = { paginas: 5, milisegundos: 10_000 };

  it("sigue mientras quede tiempo y páginas", () => {
    expect(otraPaginaEnEstaTanda(1, 2_000, limites)).toBe(true);
  });

  it("para al llegar al número de páginas", () => {
    expect(otraPaginaEnEstaTanda(5, 2_000, limites)).toBe(false);
  });

  it("para al pasarse de tiempo", () => {
    expect(otraPaginaEnEstaTanda(1, 10_000, limites)).toBe(false);
  });
});

describe("cursorDesdeUltimoPedido", () => {
  const ahora = new Date("2026-10-09T12:00:00Z");

  it("un día antes del pedido más reciente", () => {
    expect(cursorDesdeUltimoPedido("2026-10-08T18:30:00+00:00", ahora)).toBe(
      "2026-10-07T18:30:00.000Z",
    );
  });

  it("sin pedidos de WooCommerce, desde el principio", () => {
    expect(cursorDesdeUltimoPedido(null, ahora)).toBeNull();
    expect(cursorDesdeUltimoPedido("no es fecha", ahora)).toBeNull();
  });

  it("una fecha en el futuro se recorta a ahora", () => {
    expect(cursorDesdeUltimoPedido("2027-01-01T00:00:00Z", ahora)).toBe("2026-10-08T12:00:00.000Z");
  });
});

describe("clientesNuevosDePagina", () => {
  const ids = (...n: number[]) => n.map((id) => ({ id }));

  it("sin clientes aquí, todos son nuevos", () => {
    expect(clientesNuevosDePagina(ids(9, 8, 7), null, 3)).toEqual({
      nuevos: ids(9, 8, 7),
      fin: false,
    });
  });

  it("se queda con los de id mayor y para al llegar a los que ya había", () => {
    expect(clientesNuevosDePagina(ids(12, 11, 10), 10, 3)).toEqual({
      nuevos: ids(12, 11),
      fin: true,
    });
  });

  it("una página llena de nuevos pide la siguiente", () => {
    expect(clientesNuevosDePagina(ids(15, 14, 13), 10, 3)).toEqual({
      nuevos: ids(15, 14, 13),
      fin: false,
    });
  });

  it("una página incompleta es la última", () => {
    expect(clientesNuevosDePagina(ids(15), 10, 3)).toEqual({ nuevos: ids(15), fin: true });
  });

  it("si no hay ninguno nuevo, nada", () => {
    expect(clientesNuevosDePagina(ids(10, 9, 8), 10, 3)).toEqual({ nuevos: [], fin: true });
  });
});

describe("seguirConOtraTanda", () => {
  const c = (desde: string | null, pagina = 1): CursorWoo => ({ desde, pagina });

  it("sin siguiente, ha terminado", () => {
    expect(seguirConOtraTanda(1, undefined, null)).toBe("terminado");
  });

  it("con siguiente distinto, sigue", () => {
    expect(seguirConOtraTanda(1, undefined, c("2026-10-01T00:00:00.000Z"))).toBe("seguir");
    expect(
      seguirConOtraTanda(2, c("2026-10-01T00:00:00.000Z"), c("2026-10-02T00:00:00.000Z")),
    ).toBe("seguir");
    expect(
      seguirConOtraTanda(2, c("2026-10-01T00:00:00.000Z"), c("2026-10-01T00:00:00.000Z", 2)),
    ).toBe("seguir");
  });

  it("si el cursor no se ha movido, para: repetiría lo mismo para siempre", () => {
    expect(
      seguirConOtraTanda(3, c("2026-10-01T00:00:00.000Z"), c("2026-10-01T00:00:00.000Z")),
    ).toBe("sin_avance");
  });

  it("para en el tope de tandas", () => {
    expect(seguirConOtraTanda(200, undefined, c("2026-10-01T00:00:00.000Z"), 200)).toBe("tope");
  });
});
