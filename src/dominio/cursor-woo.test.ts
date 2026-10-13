import { describe, expect, it } from "vitest";
import {
  DESDE_EL_PRINCIPIO_WOO,
  PAGINA_MAXIMA_WOO,
  avanzarCursor,
  columnasEstadoWoo,
  comoSeguirWoo,
  continuacionPendiente,
  cursorDesdeUltimoPedido,
  estadoDeFilaWoo,
  fechaGmtWoo,
  filtroDeFechaIgnorado,
  mismaContinuacion,
  modificadoDespuesDe,
  modificadoMasReciente,
  otraPaginaDePedidos,
  otraPaginaEnEstaTanda,
  parametrosPaginaWoo,
  parametrosPasadaClientes,
  parametrosUltimosWoo,
  quedanTrasPagina,
  reanudableTrasTanda,
  seguirConOtraTanda,
  siguientePasadaClientes,
  sinGuardarTodavia,
  totalDeCabecera,
  ventanaClientes,
  type ContinuacionWoo,
  type CursorWoo,
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

describe("otraPaginaDePedidos", () => {
  const limites = { paginas: 5, milisegundos: 10_000 };

  it("la primera página de pedidos va siempre, aunque los 100 últimos hayan gastado el presupuesto", () => {
    expect(otraPaginaDePedidos(0, 1, 60_000, limites)).toBe(true);
    expect(otraPaginaDePedidos(0, 5, 2_000, limites)).toBe(true);
  });

  it("las siguientes, solo si queda presupuesto", () => {
    expect(otraPaginaDePedidos(1, 2, 2_000, limites)).toBe(true);
    expect(otraPaginaDePedidos(1, 2, 10_000, limites)).toBe(false);
    expect(otraPaginaDePedidos(4, 5, 2_000, limites)).toBe(false);
  });
});

describe("el botón de Pedidos en una tienda lenta", () => {
  // 450 pedidos cambiados desde la última vez, y una tienda que tarda 11 s por
  // página: los 100 últimos ya gastan todo el presupuesto de la llamada.
  const tienda: PedidoFalso[] = Array.from({ length: 450 }, (_, i) => ({
    id: i + 1,
    mod: 100 + i,
  }));
  const MS_POR_PAGINA = 11_000;

  /** Una pulsación: los 100 últimos y las páginas del cursor que deje `otra`. */
  function pulsar(
    guardado: CursorWoo,
    vistos: Set<number>,
    otra: (paginasDePedidos: number, paginas: number, ms: number) => boolean,
  ) {
    let paginas = 1; // los 100 últimos
    let ms = MS_POR_PAGINA;
    let cursor = guardado;
    for (let n = 0; otra(n, paginas, ms); n++) {
      const { items } = consultar(tienda, parametrosPaginaWoo(cursor));
      paginas++;
      ms += MS_POR_PAGINA;
      items.forEach((it) => vistos.add(it.id));
      const a = avanzarCursor(cursor, items);
      cursor = a.siguiente;
      if (a.fin) return { guardado: cursor, fin: true };
    }
    return { guardado: cursor, fin: false };
  }

  it("cada pulsación mueve el cursor al menos una página, y se llega al final", () => {
    const vistos = new Set<number>();
    let guardado: CursorWoo = { desde: null, pagina: 1 };
    let pulsaciones = 0;
    for (let fin = false; !fin && pulsaciones < 20; pulsaciones++) {
      ({ guardado, fin } = pulsar(guardado, vistos, otraPaginaDePedidos));
    }
    expect(vistos.size).toBe(450);
    expect(pulsaciones).toBe(5);
  });

  it("si la página del cursor dependiera del tiempo que queda (como estaba), no se movería nunca", () => {
    const vistos = new Set<number>();
    let guardado: CursorWoo = { desde: null, pagina: 1 };
    for (let n = 0; n < 20; n++) {
      ({ guardado } = pulsar(guardado, vistos, (_, paginas, ms) =>
        otraPaginaEnEstaTanda(paginas, ms),
      ));
    }
    expect(vistos.size).toBe(0);
    expect(guardado).toEqual({ desde: null, pagina: 1 });
  });
});

describe("el primer cursor de pedidos se guarda antes de traer los 100 últimos", () => {
  // 500 pedidos, uno por hora (el margen de cursorDesdeUltimoPedido es un día).
  // Aquí ya están los 200 primeros, de cuando se traían solo los 100 últimos.
  const HORA = 3600;
  const tienda: PedidoFalso[] = Array.from({ length: 500 }, (_, i) => ({
    id: i + 1,
    mod: (i + 1) * HORA,
  }));
  const fechaDe = (id: number) => new Date(ORIGEN + id * HORA * 1000).toISOString();
  const ahora = new Date(ORIGEN + 1000 * HORA * 1000);

  /**
   * Una pulsación como la hace sincronizarWoo: el cursor guardado o, si no
   * hay, calculado desde el último pedido de aquí; los 100 últimos; y las
   * páginas del cursor que le dé tiempo a hacer. Lo guardado pasa por la fila
   * de woo_sincronizacion, como en la base.
   */
  function pulsar(
    crm: Map<number, string>,
    fila: Record<string, unknown> | null,
    guardarAlEmpezar: boolean,
    paginas: number,
  ) {
    let cursor = estadoDeFilaWoo(fila).pedidos;
    if (!cursor) {
      const fechas = [...crm.values()].sort();
      const ultimo = fechas.length ? fechas[fechas.length - 1] : null;
      cursor = { desde: cursorDesdeUltimoPedido(ultimo, ahora), pagina: 1 };
      if (guardarAlEmpezar) fila = columnasEstadoWoo({ pedidos: cursor }, true);
    }
    for (const o of [...tienda].sort((a, b) => b.id - a.id).slice(0, 100)) {
      crm.set(o.id, fechaDe(o.id));
    }
    for (let p = 0; p < paginas; p++) {
      const { items } = consultar(tienda, parametrosPaginaWoo(cursor));
      items.forEach((it) => crm.set(it.id, fechaDe(it.id)));
      const a = avanzarCursor(cursor, items);
      cursor = a.siguiente;
      fila = columnasEstadoWoo({ pedidos: cursor }, true);
      if (a.fin) break;
    }
    return fila;
  }

  const crmInicial = () =>
    new Map(Array.from({ length: 200 }, (_, i) => [i + 1, fechaDe(i + 1)] as const));

  it("si la primera llamada se queda sin tiempo tras los 100 últimos, la siguiente no se salta nada", () => {
    const crm = crmInicial();
    const fila = pulsar(crm, null, true, 0);
    pulsar(crm, fila, true, 100);
    expect(crm.size).toBe(500);
  });

  it("guardándolo solo tras una página del cursor (como estaba), se perdían los de entre medias", () => {
    const crm = crmInicial();
    const fila = pulsar(crm, null, false, 0);
    pulsar(crm, fila, false, 100);
    // La segunda empieza un día antes del 500, que trajeron los 100 últimos.
    expect(crm.has(250)).toBe(false);
    expect(crm.size).toBeLessThan(500);
  });

  it("sin ningún pedido aquí, «desde el principio» también se guarda y se respeta", () => {
    const crm = new Map<number, string>();
    const fila = pulsar(crm, null, true, 0);
    expect(fila).toEqual({ pedidos_hasta: DESDE_EL_PRINCIPIO_WOO, pedidos_pagina: 1 });
    expect(estadoDeFilaWoo(fila).pedidos).toEqual({ desde: null, pagina: 1 });
    pulsar(crm, fila, true, 100);
    expect(crm.size).toBe(500);
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
      clientes: { hasta_id: 10, tope_id: 900, bajo_id: 801 },
      pedidos: null,
      productos: { desde: null, pagina: 1 },
    };
    expect(
      seguirConOtraTanda(2, antes, { ...antes, clientes: { ...antes.clientes!, bajo_id: 701 } }),
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
    bajo_id: null,
    ...p,
  });

  it("la primera petición es la página 1 por id, sin include", () => {
    expect(parametrosPasadaClientes(pasada(), 3)).toEqual({
      orderby: "id",
      order: "desc",
      per_page: "3",
    });
  });

  it("en la primera apunta el tope y hasta dónde ha bajado, y sigue si va llena de nuevos", () => {
    const r = siguientePasadaClientes(pasada(), ids(40, 39, 38), 3);
    expect(r.nuevos).toEqual(ids(40, 39, 38));
    expect(r.siguiente).toEqual({ hasta_id: 10, tope_id: 40, bajo_id: 38 });
    expect(r.estado).toEqual(r.siguiente);
    expect(r.aviso).toBeNull();
  });

  it("las siguientes piden por id los que quedan justo debajo, nunca por número de página", () => {
    const p = pasada({ tope_id: 40, bajo_id: 38 });
    expect(ventanaClientes(p, 3)).toEqual([37, 36, 35]);
    expect(parametrosPasadaClientes(p, 3)).toEqual({
      orderby: "id",
      order: "desc",
      per_page: "3",
      include: "37,36,35",
    });
  });

  it("nunca pide ids que ya estaban", () => {
    expect(ventanaClientes(pasada({ tope_id: 40, bajo_id: 13 }), 100)).toEqual([12, 11]);
    expect(parametrosPasadaClientes(pasada({ tope_id: 40, bajo_id: 11 }), 100)).toBeNull();
  });

  it("una tanda de ids sin ningún cliente (usuarios que no lo son, o borrados) sigue bajando", () => {
    const r = siguientePasadaClientes(pasada({ tope_id: 40, bajo_id: 30 }), [], 3);
    expect(r.siguiente).toEqual({ hasta_id: 10, tope_id: 40, bajo_id: 27 });
  });

  it("al llegar a los que había, termina y lo cubierto pasa a ser el tope", () => {
    const r = siguientePasadaClientes(pasada({ tope_id: 40, bajo_id: 14 }), ids(13, 11), 3);
    expect(r.nuevos).toEqual(ids(13, 11));
    expect(r.siguiente).toBeNull();
    expect(r.estado).toEqual({ hasta_id: 40, tope_id: null, bajo_id: null });
  });

  it("si la primera ya llega a los que había, termina ahí", () => {
    const r = siguientePasadaClientes(pasada(), ids(12, 11, 10), 3);
    expect(r.nuevos).toEqual(ids(12, 11));
    expect(r.estado).toEqual({ hasta_id: 12, tope_id: null, bajo_id: null });
  });

  it("si no hay nadie nuevo, lo cubierto no retrocede", () => {
    const r = siguientePasadaClientes(pasada(), ids(10, 9, 8), 3);
    expect(r.nuevos).toEqual([]);
    expect(r.estado).toEqual({ hasta_id: 10, tope_id: null, bajo_id: null });
  });

  it("sin ningún cliente aquí todavía (hasta 0), todos son nuevos", () => {
    const r = siguientePasadaClientes(pasada({ hasta_id: 0 }), ids(3, 2, 1), 100);
    expect(r.nuevos).toHaveLength(3);
    expect(r.estado).toEqual({ hasta_id: 3, tope_id: null, bajo_id: null });
  });

  it("una tienda sin clientes termina sin mover nada", () => {
    const r = siguientePasadaClientes(pasada(), [], 3);
    expect(r.siguiente).toBeNull();
    expect(r.estado).toEqual({ hasta_id: 10, tope_id: null, bajo_id: null });
  });

  it(`con más de ${PAGINA_MAXIMA_WOO} tandas de ids nuevos, para en el límite y avisa`, () => {
    const p = pasada({ hasta_id: 0, tope_id: 100_000, bajo_id: 90_003 });
    expect(ventanaClientes(p, 100)).toEqual([90_002, 90_001]);
    const r = siguientePasadaClientes(p, ids(90_002), 100);
    expect(r.nuevos).toEqual(ids(90_002));
    expect(r.siguiente).toBeNull();
    expect(r.aviso).toBe("limite");
    expect(r.estado).toEqual({ hasta_id: 100_000, tope_id: null, bajo_id: null });
  });

  it("si la primera página ya baja del límite, para ahí y avisa", () => {
    const pagina = Array.from({ length: 100 }, (_, i) => ({ id: 100_000 - i * 200 }));
    const r = siguientePasadaClientes(pasada({ hasta_id: 0 }), pagina, 100);
    expect(r.nuevos).toHaveLength(100);
    expect(r.aviso).toBe("limite");
    expect(r.estado).toEqual({ hasta_id: 100_000, tope_id: null, bajo_id: null });
  });

  it("si WooCommerce no respeta el include, para sin guardar a nadie y avisa", () => {
    const r = siguientePasadaClientes(pasada({ tope_id: 40, bajo_id: 30 }), ids(40, 29, 5), 3);
    expect(r.nuevos).toEqual([]);
    expect(r.siguiente).toBeNull();
    expect(r.aviso).toBe("sin_filtro");
  });
});

describe("pasadas de clientes contra una tienda de mentira", () => {
  /**
   * /customers como WooCommerce: con `include`, solo esos ids; sin él, todos.
   * Por id de mayor a menor, y la página que diga `page`.
   */
  const pedirClientes = (tienda: Set<number>, p: Record<string, string>) => {
    const porPagina = Number(p.per_page);
    const desde = (Number(p.page ?? "1") - 1) * porPagina;
    const ids = p.include ? p.include.split(",").map(Number) : [...tienda];
    return ids
      .filter((id) => tienda.has(id))
      .sort((a, b) => b - a)
      .slice(desde, desde + porPagina)
      .map((id) => ({ id }));
  };

  /**
   * Una sincronización que solo llega a `peticiones` peticiones de clientes.
   * `entre` cambia la tienda entre una petición y la siguiente.
   */
  function pasar(
    tienda: Set<number>,
    crm: Set<number>,
    estado: PasadaClientesWoo,
    peticiones: number,
    entre?: (n: number) => void,
  ) {
    let p = estado;
    for (let n = 0; n < peticiones; n++) {
      const parametros = parametrosPasadaClientes(p);
      const r = siguientePasadaClientes(p, parametros ? pedirClientes(tienda, parametros) : []);
      r.nuevos.forEach((c) => crm.add(c.id));
      estado = r.estado;
      if (!r.siguiente) break;
      p = r.siguiente;
      entre?.(n);
    }
    return estado;
  }

  const desde1 = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

  it("cortada a medias, con altas y el pedido de un cliente nuevo entretanto, no se salta a nadie", () => {
    const tienda = new Set(desde1(1000));
    const crm = new Set(desde1(300));

    // La primera vez, desde el más alto de aquí. Esta sincronización solo
    // llega a dos peticiones.
    let estado = pasar(tienda, crm, { hasta_id: 300, tope_id: null, bajo_id: null }, 2);
    expect(estado).toEqual({ hasta_id: 300, tope_id: 1000, bajo_id: 801 });

    // Entretanto se dan de alta 1.001-1.010, y el 1.005 compra: su pedido lo
    // da de alta aquí.
    desde1(10).forEach((i) => tienda.add(1000 + i));
    crm.add(1005);

    estado = pasar(tienda, crm, estado, 100); // termina la que quedó a medias
    expect(estado).toEqual({ hasta_id: 1000, tope_id: null, bajo_id: null });
    pasar(tienda, crm, estado, 100); // la siguiente, desde 1.000
    expect(crm.size).toBe(1010);
  });

  it("si cada pasada empezara en el más alto de Clientes (como estaba), se saltaría 1.001-1.004", () => {
    const tienda = new Set(desde1(1010));
    const crm = new Set(desde1(1000));
    crm.add(1005); // dado de alta por su pedido
    pasar(tienda, crm, { hasta_id: Math.max(...crm), tope_id: null, bajo_id: null }, 100);
    expect([1001, 1002, 1003, 1004].some((id) => crm.has(id))).toBe(false);
  });

  it("si se borran en WooCommerce clientes ya vistos entre una petición y otra, no se salta a nadie", () => {
    const tienda = new Set(desde1(1000));
    const crm = new Set(desde1(300));
    // Después de cada petición se borra uno de los que ya se han visto.
    pasar(tienda, crm, { hasta_id: 300, tope_id: null, bajo_id: null }, 100, (n) =>
      tienda.delete(1000 - n * 50),
    );
    expect([...tienda].filter((id) => !crm.has(id))).toEqual([]);
  });

  it("por número de página (como estaba), un borrado entre dos páginas hacía saltarse a alguno", () => {
    const tienda = new Set(desde1(1000));
    const vistos = new Set<number>();
    for (let pagina = 1; pagina <= 7; pagina++) {
      pedirClientes(tienda, { per_page: "100", page: String(pagina) }).forEach((c) =>
        vistos.add(c.id),
      );
      tienda.delete(1000 - (pagina - 1) * 50);
    }
    // Siguen en la tienda, tienen id alto y no se han visto.
    expect([...tienda].filter((id) => id > 400 && !vistos.has(id)).length).toBeGreaterThan(0);
  });

  it("con huecos (ids de usuarios que no son clientes), sigue bajando hasta llegar", () => {
    // Solo los pares son clientes; los impares son otros usuarios de WordPress.
    const tienda = new Set(desde1(3000).filter((id) => id % 2 === 0));
    const crm = new Set<number>([...tienda].filter((id) => id <= 1000));
    const estado = pasar(tienda, crm, { hasta_id: 1000, tope_id: null, bajo_id: null }, 100);
    expect(estado).toEqual({ hasta_id: 3000, tope_id: null, bajo_id: null });
    expect(crm.size).toBe(tienda.size);
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
      clientes: { hasta_id: 1, tope_id: 9, bajo_id: 5 },
      pedidos: { desde: "2026-10-01T00:00:00.000Z", pagina: 1 },
      productos: null,
    };
    expect(mismaContinuacion(a, { ...a })).toBe(true);
    expect(mismaContinuacion(a, { ...a, clientes: { hasta_id: 1, tope_id: 9, bajo_id: 4 } })).toBe(
      false,
    );
    expect(mismaContinuacion(a, { ...a, pedidos: null })).toBe(false);
    expect(mismaContinuacion(a, { ...a, productos: { desde: null, pagina: 1 } })).toBe(false);
  });
});

describe("si volver a pulsar sigue donde se quedó", () => {
  const pedidos = (pagina: number): CursorWoo => ({ desde: "2026-10-01T00:00:00.000Z", pagina });
  const clientes: PasadaClientesWoo = { hasta_id: 10, tope_id: 900, bajo_id: 801 };
  const c = (p: Partial<ContinuacionWoo>): ContinuacionWoo => ({
    clientes: null,
    pedidos: null,
    productos: null,
    ...p,
  });

  it("con la migración 20261024110000 todo se guarda: sí", () => {
    expect(reanudableTrasTanda(c({ clientes, pedidos: pedidos(7) }), true)).toBe(true);
    expect(comoSeguirWoo(c({ clientes, pedidos: pedidos(7) }), true)).toEqual({
      pulsar: true,
      ajustes: false,
      clientes: false,
    });
  });

  it("sin ella, los pedidos en la página 1 sí: su fecha se guarda", () => {
    expect(reanudableTrasTanda(c({ pedidos: pedidos(1) }), false)).toBe(true);
  });

  it("sin ella, a media página de un mismo segundo no: «Sincronizar ahora» de los ajustes", () => {
    const s = c({ pedidos: pedidos(3) });
    expect(reanudableTrasTanda(s, false)).toBe(false);
    expect(comoSeguirWoo(s, false)).toEqual({ pulsar: false, ajustes: true, clientes: false });
  });

  it("sin ella, con clientes a medias no: «Sincronizar clientes»", () => {
    const s = c({ clientes, pedidos: pedidos(1) });
    expect(reanudableTrasTanda(s, false)).toBe(false);
    expect(comoSeguirWoo(s, false)).toEqual({ pulsar: true, ajustes: false, clientes: true });
  });

  it("sin nada pendiente, no hay nada que retomar", () => {
    expect(reanudableTrasTanda(null, false)).toBe(true);
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
      clientes_bajo_id: 801,
    });
    expect(e.pedidos).toEqual({ desde: "2026-10-09T08:00:00.000Z", pagina: 7 });
    expect(e.clientes).toEqual({ hasta_id: 300, tope_id: 1000, bajo_id: 801 });
  });

  it("entre pasadas, solo hasta dónde están los clientes: una pasada nueva sin empezar", () => {
    const e = estadoDeFilaWoo({
      clientes_hasta_id: 1000,
      clientes_tope_id: null,
      clientes_bajo_id: null,
    });
    expect(e.clientes).toEqual({ hasta_id: 1000, tope_id: null, bajo_id: null });
  });

  it("hasta 0 es «ninguno todavía», que no es lo mismo que no haber guardado nada", () => {
    expect(estadoDeFilaWoo({ clientes_hasta_id: 0 }).clientes).toEqual({
      hasta_id: 0,
      tope_id: null,
      bajo_id: null,
    });
    expect(estadoDeFilaWoo({ clientes_hasta_id: null }).clientes).toBeNull();
  });

  it("una pasada a medias sin tope o sin por dónde va empieza otra desde hasta_id", () => {
    expect(
      estadoDeFilaWoo({ clientes_hasta_id: 300, clientes_tope_id: null, clientes_bajo_id: 801 })
        .clientes,
    ).toEqual({ hasta_id: 300, tope_id: null, bajo_id: null });
  });

  it("«desde el principio» se lee como desde el principio, venga como venga la fecha", () => {
    for (const valor of [DESDE_EL_PRINCIPIO_WOO, "1970-01-01T00:00:00+00:00"]) {
      expect(estadoDeFilaWoo({ pedidos_hasta: valor, pedidos_pagina: 2 }).pedidos).toEqual({
        desde: null,
        pagina: 2,
      });
    }
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
          clientes: { hasta_id: 1, tope_id: 2, bajo_id: 2 },
        },
        false,
      ),
    ).toEqual({ pedidos_hasta: "2026-10-09T08:00:00.000Z" });
  });

  it("un cursor «desde el principio» se escribe con su fecha, no vacío", () => {
    expect(columnasEstadoWoo({ productos: { desde: null, pagina: 3 } }, false)).toEqual({
      productos_hasta: DESDE_EL_PRINCIPIO_WOO,
    });
  });

  it("con ella, también la página y los clientes; y lo escrito se lee igual", () => {
    const cambio = {
      pedidos: { desde: "2026-10-09T08:00:00.000Z", pagina: 4 },
      productos: { desde: null, pagina: 2 },
      clientes: { hasta_id: 300, tope_id: 1000, bajo_id: 801 },
    };
    const fila = columnasEstadoWoo(cambio, true);
    expect(fila).toEqual({
      pedidos_hasta: "2026-10-09T08:00:00.000Z",
      pedidos_pagina: 4,
      productos_hasta: DESDE_EL_PRINCIPIO_WOO,
      productos_pagina: 2,
      clientes_hasta_id: 300,
      clientes_tope_id: 1000,
      clientes_bajo_id: 801,
    });
    expect(estadoDeFilaWoo(fila)).toEqual(cambio);
  });
});
