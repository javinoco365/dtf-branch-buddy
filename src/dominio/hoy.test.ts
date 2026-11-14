import { describe, expect, it } from "vitest";
import { pedidosDeHoy } from "./hoy";

describe("pedidos de hoy", () => {
  it("por producir y por enviar, sin la web sin pagar ni lo ya enviado", () => {
    expect(
      pedidosDeHoy([
        { estado: "pendiente", canal: "manual" },
        { estado: "pendiente", canal: "web" },
        { estado: "en_produccion", canal: "web" },
        { estado: "imprimiendo", canal: "textil" },
        { estado: "listo", canal: "manual" },
        { estado: "listo", canal: "textil" },
        { estado: "enviado", canal: "manual" },
        { estado: "cancelado", canal: "manual" },
      ]),
    ).toEqual({ porProducir: 3, porEnviar: 2 });
  });

  it("sin pedidos, ceros: no hay nada que hacer", () => {
    expect(pedidosDeHoy([])).toEqual({ porProducir: 0, porEnviar: 0 });
  });
});
