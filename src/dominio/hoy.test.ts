import { describe, expect, it } from "vitest";
import { filasDelTaller, filasPorCobrar, pedidosDeHoy } from "./hoy";

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

describe("listas de «Hoy»", () => {
  const p = (estado: string, canal: string, extra: Record<string, unknown> = {}) => ({
    id: `${estado}-${canal}`,
    numero: `N-${estado}`,
    cliente_nombre: "Taller Ruiz",
    tienda_id: canal === "textil" ? "textil-personalizado" : "t1",
    fecha_pedido: "2026-11-05T10:00:00.000Z",
    total: 121,
    estado,
    canal,
    ...extra,
  });

  it("por producir: los mismos que cuenta la cifra, con su día", () => {
    const lista = [
      p("pendiente", "manual"),
      p("pendiente", "web"),
      p("imprimiendo", "textil"),
      p("listo", "manual"),
    ];
    const filas = filasDelTaller(lista, "producir");
    expect(filas.map((f) => f.id)).toEqual(["pendiente-manual", "imprimiendo-textil"]);
    expect(filas.length).toBe(pedidosDeHoy(lista).porProducir);
    expect(filas[0]).toMatchObject({
      numero: "N-pendiente",
      cliente: "Taller Ruiz",
      fecha: "2026-11-05",
      importe: 121,
    });
  });

  it("por enviar: los listos", () => {
    expect(
      filasDelTaller([p("listo", "web"), p("enviado", "web")], "enviar").map((f) => f.estado),
    ).toEqual(["listo"]);
  });

  it("por cobrar: lo pendiente, y el textil a su sitio", () => {
    const filas = filasPorCobrar([
      {
        tipo: "textil",
        id: "x",
        tienda_id: null,
        numero: "T-1",
        fecha: "2026-11-02",
        cliente_id: null,
        cliente_nombre: null,
        origen: "textil",
        estado: "pendiente",
        total: 100,
        cobrado: 40,
        pendiente: 60,
        ultimo_cobro: null,
      },
    ]);
    expect(filas[0]).toMatchObject({ tiendaId: "textil-personalizado", importe: 60 });
  });
});
