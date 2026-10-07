import { describe, expect, it } from "vitest";
import {
  FILTRO_TODO,
  cobrosDeTiendas,
  consolidarCobro,
  desglosePorMetodo,
  desglosePorTienda,
  filtrarCobros,
  origenDelCobro,
  totalPorRangos,
  totalizar,
  type CobroConsolidado,
  type CobroLeido,
} from "./facturacion";
import { TIENDA_TEXTIL } from "./cobros";

// Pedido de 121 €: 100 de base y 21 de IVA, 10 € de envío dentro, 4 metros.
const pedido = {
  id: "p1",
  numero: "M-1",
  fecha: "2026-09-01T09:00:00+00:00",
  cliente_nombre: "Peña La Charanga",
  total: "121.00",
  iva: "21.00",
  envio: 10,
  metros: 4,
};

const leido = (o: Partial<CobroLeido> = {}): CobroLeido => ({
  id: "c1",
  fecha: "2026-09-10",
  importe: 121,
  propina: 0,
  metodo: "tarjeta",
  previo: false,
  tienda_id: "t1",
  pedido,
  ...o,
});

describe("origenDelCobro", () => {
  it("lo previo manda: un cobro web de antes es previo", () => {
    expect(origenDelCobro({ metodo: "web", previo: true })).toBe("previo");
  });

  it("web nuevo, web; a mano, pedido", () => {
    expect(origenDelCobro({ metodo: "web", previo: false })).toBe("web");
    expect(origenDelCobro({ metodo: "efectivo", previo: false })).toBe("pedido");
  });
});

describe("consolidarCobro", () => {
  it("cobrado entero: base, IVA, envío y metros del pedido completos", () => {
    expect(consolidarCobro(leido(), "pedido")).toMatchObject({
      importe: 121,
      base: 100,
      iva: 21,
      envio: 10,
      metros: 4,
      origen: "pedido",
    });
  });

  it("cobrado a medias: la mitad de todo", () => {
    expect(consolidarCobro(leido({ importe: 60.5 }), "pedido")).toMatchObject({
      base: 50,
      iva: 10.5,
      envio: 5,
      metros: 2,
    });
  });

  it("la propina va aparte y no reparte IVA", () => {
    const c = consolidarCobro(leido({ propina: "5.00" }), "pedido");
    expect(c.propina).toBe(5);
    expect(c.base + c.iva).toBe(121);
  });

  it("por fecha del pedido se fecha con el pedido; por fecha de cobro, con el cobro", () => {
    expect(consolidarCobro(leido(), "pedido").fecha).toBe(pedido.fecha);
    expect(consolidarCobro(leido(), "cobro").fecha).toBe("2026-09-10T12:00:00");
  });

  it("el día sin hora del textil se sitúa a mediodía", () => {
    const textil = leido({
      tienda_id: TIENDA_TEXTIL.id,
      pedido: { ...pedido, fecha: "2026-09-28" },
    });
    expect(consolidarCobro(textil, "pedido").fecha).toBe("2026-09-28T12:00:00");
  });

  it("un pedido de total cero no divide por cero", () => {
    const c = consolidarCobro(leido({ importe: 10, pedido: { ...pedido, total: 0 } }), "cobro");
    expect(c).toMatchObject({ base: 10, iva: 0, envio: 0, metros: 0 });
  });
});

const cobros = [
  consolidarCobro(leido({ id: "a", importe: 60.5, metodo: "efectivo", propina: 2 }), "pedido"),
  consolidarCobro(leido({ id: "b", importe: 60.5, metodo: "tarjeta" }), "pedido"),
  consolidarCobro(
    leido({
      id: "c",
      importe: 30,
      metodo: "web",
      previo: true,
      tienda_id: "t2",
      pedido: { ...pedido, id: "p2", total: 30, iva: 0, envio: 0, metros: 1 },
    }),
    "pedido",
  ),
  consolidarCobro(
    leido({
      id: "d",
      importe: 50,
      metodo: "transferencia",
      tienda_id: TIENDA_TEXTIL.id,
      pedido: { ...pedido, id: "p3", total: 50, iva: 0, envio: 0, metros: 0 },
    }),
    "pedido",
  ),
];

describe("filtrarCobros", () => {
  it("sin filtro, todo", () => {
    expect(filtrarCobros(cobros, FILTRO_TODO)).toHaveLength(4);
  });

  it("solo el efectivo", () => {
    expect(filtrarCobros(cobros, { ...FILTRO_TODO, metodo: "efectivo" }).map((c) => c.id)).toEqual([
      "a",
    ]);
  });

  it("por tienda, textil incluido, y por origen", () => {
    expect(
      filtrarCobros(cobros, { ...FILTRO_TODO, tienda: TIENDA_TEXTIL.id }).map((c) => c.id),
    ).toEqual(["d"]);
    expect(filtrarCobros(cobros, { ...FILTRO_TODO, origen: "previo" }).map((c) => c.id)).toEqual([
      "c",
    ]);
  });
});

describe("totalizar", () => {
  it("la propina suma al total en su propia columna", () => {
    const t = totalizar(cobros);
    expect(t).toMatchObject({ cobros: 4, cobrado: 201, propina: 2, total: 203 });
  });

  it("un pedido cobrado en dos veces cuenta como un pedido", () => {
    expect(totalizar(cobros.slice(0, 2))).toMatchObject({ cobros: 2, pedidos: 1, metros: 4 });
  });

  it("sin cobros, ceros", () => {
    expect(totalizar([]).total).toBe(0);
  });
});

describe("desglosePorTienda", () => {
  it("de mayor a menor, y la tienda sin cobros sale a cero", () => {
    const filas = desglosePorTienda(cobros, [
      { id: "t1", nombre: "DTF Culture" },
      { id: "t2", nombre: "Otra" },
      { id: "t3", nombre: "Sin ventas" },
      TIENDA_TEXTIL,
    ]);
    expect(filas.map((f) => [f.nombre, f.total])).toEqual([
      ["DTF Culture", 123],
      ["Textil personalizado", 50],
      ["Otra", 30],
      ["Sin ventas", 0],
    ]);
  });
});

describe("desglosePorMetodo", () => {
  it("cada método con lo suyo, en orden fijo, y solo los que tienen cobros", () => {
    expect(desglosePorMetodo(cobros).map((f) => [f.etiqueta, f.total])).toEqual([
      ["Efectivo", 62.5],
      ["Tarjeta", 60.5],
      ["Transferencia", 50],
      ["Web", 30],
    ]);
  });
});

describe("totalPorRangos", () => {
  it("reparte por la fecha elegida, propinas incluidas", () => {
    const porCobro = [
      consolidarCobro(leido({ id: "x", fecha: "2026-09-28", propina: 1 }), "cobro"),
    ];
    const [anterior, actual] = totalPorRangos(porCobro, [
      { desde: new Date(2026, 8, 21, 0, 0, 0), hasta: new Date(2026, 8, 27, 23, 59, 59) },
      { desde: new Date(2026, 8, 28, 0, 0, 0), hasta: new Date(2026, 9, 4, 23, 59, 59) },
    ]);
    expect(anterior.total).toBe(0);
    expect(actual.total).toBe(122);
  });
});

describe("cobrosDeTiendas", () => {
  const c = (tienda_id: string) => ({ tienda_id }) as CobroConsolidado;

  it("sin tienda, todas menos el textil; con tienda, solo esa", () => {
    const cobros = [c("t1"), c("t2"), c(TIENDA_TEXTIL.id)];
    expect(cobrosDeTiendas(cobros).map((x) => x.tienda_id)).toEqual(["t1", "t2"]);
    expect(cobrosDeTiendas(cobros, "t2").map((x) => x.tienda_id)).toEqual(["t2"]);
  });
});

describe("consolidarCobro con un pedido sin fecha", () => {
  it("no se rompe: la fecha del pedido queda vacía", () => {
    const c = consolidarCobro(
      {
        id: "c",
        fecha: "2026-10-01",
        importe: 10,
        propina: 0,
        metodo: "efectivo",
        previo: false,
        tienda_id: "t1",
        pedido: {
          id: "p",
          numero: "N",
          fecha: null as unknown as string,
          cliente_nombre: null,
          total: 10,
          iva: 0,
          envio: 0,
          metros: 0,
        },
      },
      "cobro",
    );
    expect(c.fecha_pedido).toBe("");
    expect(c.importe).toBe(10);
  });
});
