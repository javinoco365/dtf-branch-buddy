import { describe, expect, it } from "vitest";
import { numeroPedidoWoo } from "./pedido-woo";

describe("numeroPedidoWoo", () => {
  it("prefiere el número formateado del plugin al de la API", () => {
    // El caso que motiva el módulo: el cliente tiene «DTF-1043» en su correo y
    // el CRM enseñaba 432. Al llamar preguntando por el 1043 no se encontraba.
    expect(
      numeroPedidoWoo({
        id: 432,
        number: "432",
        meta_data: [
          { key: "_order_number", value: "1043" },
          { key: "_order_number_formatted", value: "DTF-1043" },
        ],
      }),
    ).toBe("DTF-1043");
  });

  it("usa el número sin formato si no hay formateado", () => {
    expect(
      numeroPedidoWoo({
        id: 432,
        number: "432",
        meta_data: [{ key: "_order_number", value: 1043 }],
      }),
    ).toBe("1043");
  });

  it("cae en el campo number de la API cuando no hay plugin", () => {
    // Una tienda sin plugins: number e id valen lo mismo y da igual cuál se
    // coja. Lo que importa es que no falle.
    expect(numeroPedidoWoo({ id: 432, number: 432, meta_data: [] })).toBe("432");
  });

  it("solo usa el id cuando no hay absolutamente nada más", () => {
    expect(numeroPedidoWoo({ id: 432 })).toBe("432");
    expect(numeroPedidoWoo({ id: 432, number: "  " })).toBe("432");
  });

  it("ignora las claves de meta que no son de numeración", () => {
    expect(
      numeroPedidoWoo({
        id: 432,
        number: "432",
        meta_data: [
          { key: "_billing_nif", value: "B12345678" },
          { key: "is_vat_exempt", value: "no" },
        ],
      }),
    ).toBe("432");
  });

  it("ignora un meta presente pero vacío", () => {
    // Los plugins dejan la clave creada aunque no le hayan puesto valor.
    expect(
      numeroPedidoWoo({
        id: 432,
        number: "432",
        meta_data: [
          { key: "_order_number_formatted", value: "" },
          { key: "_order_number", value: null },
        ],
      }),
    ).toBe("432");
  });

  it("ignora valores que no son ni texto ni número", () => {
    expect(
      numeroPedidoWoo({
        id: 432,
        number: "432",
        meta_data: [{ key: "_order_number_formatted", value: { raro: true } }],
      }),
    ).toBe("432");
  });

  it("no se rompe sin pedido ni sin meta_data", () => {
    expect(numeroPedidoWoo(null)).toBe("");
    expect(numeroPedidoWoo(undefined)).toBe("");
    expect(numeroPedidoWoo({})).toBe("");
    expect(numeroPedidoWoo({ id: 1, meta_data: null })).toBe("1");
  });
});
