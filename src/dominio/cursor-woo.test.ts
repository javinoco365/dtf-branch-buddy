import { describe, expect, it } from "vitest";
import {
  PAGINA_MAXIMA_WOO,
  avanzarCursor,
  clientesNuevosDePagina,
  columnasEstadoWoo,
  continuacionPendiente,
  cursorDesdeUltimoPedido,
  estadoDeFilaWoo,
  fechaGmtWoo,
  filtroDeFechaIgnorado,
  mismaContinuacion,
  modificadoDespuesDe,
  modificadoMasReciente,
  otraPaginaEnEstaTanda,
  parametrosPaginaWoo,
  parametrosUltimosWoo,
  pasadaDesdeEstado,
  quedanTrasPagina,
  seguirConOtraTanda,
  siguientePasadaClientes,
  sinGuardarTodavia,
  totalDeCabecera,
  type ContinuacionWoo,
  type CursorWoo,
  type EstadoClientesWoo,
  type PasadaClientesWoo,
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

  it("la primera página va siempre, aunque lo de antes haya tardado", () => {
    expect(otraPaginaEnEstaTanda(0, 60_000, limites)).toBe(true);
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
  const c = (desde: string | null, pagina = 1): ContinuacionWoo => ({
    clientes: null,
    pedidos: { desde, pagina },
    productos: null,
  });

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

  it("si solo avanzan los clientes o los productos, también sigue", () => {
    const antes: ContinuacionWoo = {
      clientes: { hasta_id: 10, tope_id: 900, pagina: 2 },
      pedidos: null,
      productos: { desde: null, pagina: 1 },
    };
    expect(
      seguirConOtraTanda(2, antes, { ...antes, clientes: { ...antes.clientes!, pagina: 3 } }),
    ).toBe("seguir");
    expect(
      seguirConOtraTanda(2, antes, {
        ...antes,
        productos: { desde: "2026-10-01T00:00:00.000Z", pagina: 1 },
      }),
    ).toBe("seguir");
  });

  it("si nada se ha movido, para: repetiría lo mismo para siempre", () => {
    expect(
      seguirConOtraTanda(3, c("2026-10-01T00:00:00.000Z"), c("2026-10-01T00:00:00.000Z")),
    ).toBe("sin_avance");
  });

  it("para en el tope de tandas", () => {
    expect(seguirConOtraTanda(200, undefined, c("2026-10-01T00:00:00.000Z"), 200)).toBe("tope");
  });
});

describe("parametrosUltimosWoo", () => {
  it("los pedidos: los 100 últimos por fecha de creación, como antes de haber cursor", () => {
    expect(parametrosUltimosWoo("date")).toEqual({
      per_page: "100",
      orderby: "date",
      order: "desc",
    });
  });

  it("los productos sin cursor: los 100 modificados más recientemente", () => {
    expect(parametrosUltimosWoo("modified")).toMatchObject({ orderby: "modified", order: "desc" });
  });
});

describe("sinGuardarTodavia", () => {
  const guardados = new Map<number, string | null>([
    [1, "2026-10-09T08:00:00.000Z"],
    [2, "2026-10-09T08:00:00.000Z"],
    [3, null],
  ]);

  it("no repite lo ya guardado con la misma fecha de modificación", () => {
    const pagina = [
      { id: 1, date_modified_gmt: "2026-10-09T08:00:00" },
      { id: 2, date_modified_gmt: "2026-10-09T08:05:00" },
      { id: 3, date_modified_gmt: "2026-10-09T08:00:00" },
      { id: 4, date_modified_gmt: "2026-10-09T08:00:00" },
    ];
    // 1: igual que se guardó. 2: ha cambiado. 3: no se sabía con qué fecha. 4: nuevo.
    expect(sinGuardarTodavia(pagina, guardados).map((o) => o.id)).toEqual([2, 3, 4]);
  });

  it("sin fecha de modificación se guarda otra vez: no se puede saber si ha cambiado", () => {
    expect(sinGuardarTodavia([{ id: 1 }], guardados)).toHaveLength(1);
  });
});

/** Una tienda de mentira con lo que tiene cada pedido (las líneas) aparte de su fecha. */
type PedidoConLineas = PedidoFalso & { lineas: number };

/**
 * Una sincronización como la hace sincronizarWoo con los pedidos: primero los
 * 100 últimos por fecha de creación (aquí, por id), después el cursor, sin
 * escribir dos veces lo que ya se ha guardado igual.
 */
function sincronizarConUltimos(
  tienda: PedidoConLineas[],
  inicio: CursorWoo,
  crm: Map<number, number>,
) {
  let escrituras = 0;
  const guardados = new Map<number, string | null>();
  const guardar = (items: { id: number; date_modified_gmt: string }[]) => {
    for (const it of sinGuardarTodavia(items, guardados)) {
      crm.set(it.id, tienda.find((o) => o.id === it.id)!.lineas);
      guardados.set(it.id, fechaGmtWoo(it.date_modified_gmt));
      escrituras++;
    }
  };
  guardar(
    [...tienda]
      .sort((a, b) => b.id - a.id)
      .slice(0, 100)
      .map((o) => ({ id: o.id, date_modified_gmt: isoDe(o.mod) })),
  );
  let cursor = inicio;
  for (;;) {
    const { items } = consultar(tienda, parametrosPaginaWoo(cursor));
    guardar(items);
    const a = avanzarCursor(cursor, items);
    cursor = a.siguiente;
    if (a.fin) return { cursor, escrituras };
  }
}

describe("los 100 últimos además del cursor", () => {
  const nuevaTienda = (): PedidoConLineas[] =>
    Array.from({ length: 300 }, (_, i) => ({ id: i + 1, mod: i * 10, lineas: 1 }));

  it("un pedido reciente editado sin que cambie su fecha (tienda sin HPOS) se corrige igual", () => {
    const tienda = nuevaTienda();
    const crm = new Map<number, number>();
    const { cursor } = sincronizarConUltimos(tienda, { desde: null, pagina: 1 }, crm);
    expect(crm.size).toBe(300);

    // Le cambian las líneas al 290 en WordPress clásico: su fecha de
    // modificación no se mueve.
    tienda[289].lineas = 5;

    // Por el cursor no llega: desde ahí solo sale lo del último segundo.
    const porElCursor = consultar(tienda, parametrosPaginaWoo(cursor)).items.map((o) => o.id);
    expect(porElCursor).not.toContain(290);

    sincronizarConUltimos(tienda, cursor, crm);
    expect(crm.get(290)).toBe(5);
  });

  it("lo que el cursor vuelve a traer igual que los 100 últimos no se escribe dos veces", () => {
    const tienda = nuevaTienda();
    const crm = new Map<number, number>();
    const { cursor } = sincronizarConUltimos(tienda, { desde: null, pagina: 1 }, crm);

    // Cambian de estado los 20 más recientes: entran por el cursor y también
    // están entre los 100 últimos.
    for (const o of tienda.slice(280)) o.mod += 10_000;

    const segunda = sincronizarConUltimos(tienda, cursor, crm);
    // Los 100 últimos una vez; el cursor no escribe nada más (si no, 120).
    expect(segunda.escrituras).toBe(100);
  });
});

describe("cientos de pedidos en el mismo segundo, una tanda de 5 páginas por pulsación", () => {
  // Una acción masiva: 1.200 pedidos modificados en el mismo segundo.
  const tienda: PedidoFalso[] = [
    ...Array.from({ length: 50 }, (_, i) => ({ id: i + 1, mod: i })),
    ...Array.from({ length: 1200 }, (_, i) => ({ id: 1000 + i, mod: 500 })),
    ...Array.from({ length: 30 }, (_, i) => ({ id: 5000 + i, mod: 600 + i })),
  ];

  /** Una pulsación del botón de Pedidos: hasta 5 páginas desde lo guardado. */
  function pulsar(guardado: CursorWoo, vistos: Set<number>, conPagina: boolean) {
    let cursor = guardado;
    for (let p = 0; p < 5; p++) {
      const { items } = consultar(tienda, parametrosPaginaWoo(cursor));
      items.forEach((it) => vistos.add(it.id));
      const a = avanzarCursor(cursor, items);
      if (conPagina) guardado = a.siguiente;
      // Como estaba: solo se guardaba la fecha, y solo si cambiaba.
      else if (a.siguiente.desde !== cursor.desde) {
        guardado = { desde: a.siguiente.desde, pagina: 1 };
      }
      cursor = a.siguiente;
      if (a.fin) return { guardado, fin: true };
    }
    return { guardado, fin: false };
  }

  it("guardando también la página, cada pulsación sigue donde se quedó y se llega al final", () => {
    const vistos = new Set<number>();
    let guardado: CursorWoo = { desde: null, pagina: 1 };
    let pulsaciones = 0;
    for (let fin = false; !fin && pulsaciones < 50; pulsaciones++) {
      ({ guardado, fin } = pulsar(guardado, vistos, true));
    }
    expect(vistos.size).toBe(1280);
    expect(pulsaciones).toBeLessThanOrEqual(4);
  });

  it("guardando solo la fecha (como estaba), no se salía nunca de ese segundo", () => {
    const vistos = new Set<number>();
    let guardado: CursorWoo = { desde: null, pagina: 1 };
    for (let n = 0; n < 50; n++) ({ guardado } = pulsar(guardado, vistos, false));
    expect(vistos.size).toBeLessThan(1280);
  });
});

describe("siguientePasadaClientes", () => {
  const ids = (...n: number[]) => n.map((id) => ({ id }));
  const pasada = (p: Partial<PasadaClientesWoo> = {}): PasadaClientesWoo => ({
    hasta_id: 10,
    tope_id: null,
    pagina: 1,
    ...p,
  });

  it("en la primera página apunta el tope, y sigue si la página va llena de nuevos", () => {
    const r = siguientePasadaClientes(pasada(), ids(40, 39, 38), 3);
    expect(r.siguiente).toEqual({ hasta_id: 10, tope_id: 40, pagina: 2 });
    expect(r.estado).toEqual({ hasta_id: 10, tope_id: 40, pagina: 2 });
    expect(r.tope).toBe(false);
  });

  it("en las páginas siguientes el tope no cambia", () => {
    const r = siguientePasadaClientes(pasada({ tope_id: 40, pagina: 2 }), ids(55, 37, 36), 3);
    expect(r.siguiente?.tope_id).toBe(40);
  });

  it("al llegar a los que había, termina y lo cubierto pasa a ser el tope", () => {
    const r = siguientePasadaClientes(pasada({ tope_id: 40, pagina: 3 }), ids(12, 11, 10), 3);
    expect(r.nuevos).toEqual(ids(12, 11));
    expect(r.siguiente).toBeNull();
    expect(r.estado).toEqual({ hasta_id: 40, tope_id: null, pagina: null });
  });

  it("si no hay nadie nuevo, lo cubierto no retrocede", () => {
    const r = siguientePasadaClientes(pasada(), ids(10, 9, 8), 3);
    expect(r.nuevos).toEqual([]);
    expect(r.estado).toEqual({ hasta_id: 10, tope_id: null, pagina: null });
  });

  it("sin ningún cliente aquí todavía, todos son nuevos", () => {
    const r = siguientePasadaClientes(pasada({ hasta_id: null }), ids(3, 2, 1), 100);
    expect(r.nuevos).toHaveLength(3);
    expect(r.estado).toEqual({ hasta_id: 3, tope_id: null, pagina: null });
  });

  it("en la última página que se permite, para y avisa", () => {
    const r = siguientePasadaClientes(
      pasada({ tope_id: 900_000, pagina: PAGINA_MAXIMA_WOO }),
      ids(500, 499, 498),
      3,
    );
    expect(r.siguiente).toBeNull();
    expect(r.tope).toBe(true);
    expect(r.estado).toEqual({ hasta_id: 900_000, tope_id: null, pagina: null });
  });
});

describe("pasadas de clientes contra una tienda de mentira", () => {
  /** /customers?orderby=id&order=desc&per_page=100&page=N */
  const paginaClientes = (tienda: number[], pagina: number) =>
    [...tienda]
      .sort((a, b) => b - a)
      .slice((pagina - 1) * 100, pagina * 100)
      .map((id) => ({ id }));

  /** Una sincronización que solo llega a `paginas` páginas de clientes. */
  function pasar(tienda: number[], crm: Set<number>, estado: EstadoClientesWoo, paginas: number) {
    let p = pasadaDesdeEstado(estado);
    for (let n = 0; n < paginas; n++) {
      const r = siguientePasadaClientes(p, paginaClientes(tienda, p.pagina));
      r.nuevos.forEach((c) => crm.add(c.id));
      estado = r.estado;
      if (!r.siguiente) break;
      p = r.siguiente;
    }
    return estado;
  }

  it("cortada a medias, con altas y el pedido de un cliente nuevo entretanto, no se salta a nadie", () => {
    const tienda = Array.from({ length: 1000 }, (_, i) => i + 1);
    const crm = new Set(tienda.slice(0, 300));

    // La primera vez, desde el más alto de aquí. Esta sincronización solo
    // llega a dos páginas.
    let estado = pasar(tienda, crm, { hasta_id: 300, tope_id: null, pagina: 1 }, 2);
    expect(estado).toEqual({ hasta_id: 300, tope_id: 1000, pagina: 3 });

    // Entretanto se dan de alta 1.001-1.010, y el 1.005 compra: su pedido lo
    // da de alta aquí.
    tienda.push(...Array.from({ length: 10 }, (_, i) => 1001 + i));
    crm.add(1005);

    estado = pasar(tienda, crm, estado, 100); // termina la que quedó a medias
    expect(estado).toEqual({ hasta_id: 1000, tope_id: null, pagina: null });
    pasar(tienda, crm, estado, 100); // la siguiente, desde 1.000
    expect(crm.size).toBe(1010);
  });

  it("si cada pasada empezara en el más alto de Clientes (como estaba), se saltaría 1.001-1.004", () => {
    const tienda = Array.from({ length: 1010 }, (_, i) => i + 1);
    const crm = new Set(Array.from({ length: 1000 }, (_, i) => i + 1));
    crm.add(1005); // dado de alta por su pedido
    pasar(tienda, crm, { hasta_id: Math.max(...crm), tope_id: null, pagina: null }, 100);
    expect([1001, 1002, 1003, 1004].some((id) => crm.has(id))).toBe(false);
  });
});

describe("continuación", () => {
  const nada: ContinuacionWoo = { clientes: null, pedidos: null, productos: null };

  it("sin nada pendiente, no hay continuación", () => {
    expect(continuacionPendiente(nada)).toBeNull();
    const c = { ...nada, productos: { desde: null, pagina: 1 } };
    expect(continuacionPendiente(c)).toBe(c);
  });

  it("dos continuaciones son la misma solo si coinciden en todo", () => {
    const a: ContinuacionWoo = {
      clientes: { hasta_id: 1, tope_id: 9, pagina: 2 },
      pedidos: { desde: "2026-10-01T00:00:00.000Z", pagina: 1 },
      productos: null,
    };
    expect(mismaContinuacion(a, { ...a })).toBe(true);
    expect(mismaContinuacion(a, { ...a, clientes: { hasta_id: 1, tope_id: 8, pagina: 2 } })).toBe(
      false,
    );
    expect(mismaContinuacion(a, { ...a, pedidos: null })).toBe(false);
    expect(mismaContinuacion(a, { ...a, productos: { desde: null, pagina: 1 } })).toBe(false);
  });
});

describe("lo guardado en woo_sincronizacion", () => {
  it("sin fila, nada guardado", () => {
    expect(estadoDeFilaWoo(null)).toEqual({ pedidos: null, productos: null, clientes: null });
  });

  it("sin la migración 20261024110000 no hay página: se toma la 1", () => {
    const e = estadoDeFilaWoo({
      pedidos_hasta: "2026-10-09T08:00:00+00:00",
      productos_hasta: null,
    });
    expect(e.pedidos).toEqual({ desde: "2026-10-09T08:00:00.000Z", pagina: 1 });
    expect(e.productos).toBeNull();
    expect(e.clientes).toBeNull();
  });

  it("lee la página y la pasada de clientes a medias", () => {
    const e = estadoDeFilaWoo({
      pedidos_hasta: "2026-10-09T08:00:00+00:00",
      pedidos_pagina: 7,
      productos_hasta: "2026-10-08T08:00:00+00:00",
      productos_pagina: 1,
      clientes_hasta_id: 300,
      clientes_tope_id: 1000,
      clientes_pagina: 3,
    });
    expect(e.pedidos).toEqual({ desde: "2026-10-09T08:00:00.000Z", pagina: 7 });
    expect(e.clientes).toEqual({ hasta_id: 300, tope_id: 1000, pagina: 3 });
  });

  it("entre pasadas, solo hasta dónde están los clientes; la siguiente empieza ahí", () => {
    const e = estadoDeFilaWoo({
      clientes_hasta_id: 1000,
      clientes_tope_id: null,
      clientes_pagina: null,
    });
    expect(e.clientes).toEqual({ hasta_id: 1000, tope_id: null, pagina: null });
    expect(pasadaDesdeEstado(e.clientes!)).toEqual({ hasta_id: 1000, tope_id: null, pagina: 1 });
  });

  it("una página fuera de rango se toma como la 1", () => {
    for (const pagina of [0, -3, 2.5, PAGINA_MAXIMA_WOO + 1, "x"]) {
      expect(
        estadoDeFilaWoo({ pedidos_hasta: "2026-10-09T08:00:00Z", pedidos_pagina: pagina }).pedidos
          ?.pagina,
      ).toBe(1);
    }
  });

  it("sin la migración 20261024110000 solo se escriben las fechas", () => {
    expect(
      columnasEstadoWoo(
        {
          pedidos: { desde: "2026-10-09T08:00:00.000Z", pagina: 4 },
          clientes: { hasta_id: 1, tope_id: 2, pagina: 3 },
        },
        false,
      ),
    ).toEqual({ pedidos_hasta: "2026-10-09T08:00:00.000Z" });
  });

  it("con ella, también la página y los clientes; y lo escrito se lee igual", () => {
    const cambio = {
      pedidos: { desde: "2026-10-09T08:00:00.000Z", pagina: 4 },
      productos: { desde: "2026-10-01T00:00:00.000Z", pagina: 1 },
      clientes: { hasta_id: 300, tope_id: 1000, pagina: 3 },
    };
    const fila = columnasEstadoWoo(cambio, true);
    expect(fila).toEqual({
      pedidos_hasta: "2026-10-09T08:00:00.000Z",
      pedidos_pagina: 4,
      productos_hasta: "2026-10-01T00:00:00.000Z",
      productos_pagina: 1,
      clientes_hasta_id: 300,
      clientes_tope_id: 1000,
      clientes_pagina: 3,
    });
    expect(estadoDeFilaWoo(fila)).toEqual(cambio);
  });
});
