import { describe, expect, it } from "vitest";
import {
  FILTRO_PENDIENTES_TODO,
  diasDesde,
  filtrarPendientes,
  ordenarPendientes,
  origenPendiente,
  resumirPendientes,
  tiendaDelPendiente,
  type PedidoPendiente,
} from "./pendientes";
import { TIENDA_TEXTIL } from "./cobros";

const base: PedidoPendiente = {
  tipo: "tienda",
  id: "p1",
  tienda_id: "t1",
  numero: "M-1",
  fecha: "2026-09-20",
  cliente_id: null,
  cliente_nombre: "Peña La Charanga",
  origen: "manual",
  estado: "pendiente",
  total: "100.00",
  cobrado: "40.00",
  pendiente: "60.00",
  ultimo_cobro: "2026-09-21",
};
const web: PedidoPendiente = {
  ...base,
  id: "p2",
  numero: "DCUL-9",
  origen: "woocommerce",
  cliente_nombre: "Club Náutico",
  cobrado: 0,
  pendiente: 45,
  fecha: "2026-08-01",
};
const textil: PedidoPendiente = {
  ...base,
  tipo: "textil",
  id: "p3",
  tienda_id: null,
  numero: "TPD-3",
  origen: "textil",
  cliente_nombre: "Talleres Pérez",
  cobrado: 0,
  pendiente: 30,
  fecha: "2026-09-27",
};
const todos = [base, web, textil];
const hoy = new Date(2026, 8, 28, 10);

describe("origenPendiente y tiendaDelPendiente", () => {
  it("manual, web o textil", () => {
    expect(todos.map(origenPendiente)).toEqual(["manual", "web", "textil"]);
  });

  it("el textil va con el mismo identificador que en la Consolidada", () => {
    expect(tiendaDelPendiente(textil)).toBe(TIENDA_TEXTIL.id);
    expect(tiendaDelPendiente(base)).toBe("t1");
  });
});

describe("diasDesde", () => {
  it("cuenta días naturales, sin líos de hora", () => {
    expect(diasDesde("2026-09-20", hoy)).toBe(8);
    expect(diasDesde("2026-09-28", hoy)).toBe(0);
  });

  it("una fecha futura no da días negativos", () => {
    expect(diasDesde("2026-10-01", hoy)).toBe(0);
  });
});

describe("filtrarPendientes", () => {
  it("sin filtro, todos", () => {
    expect(filtrarPendientes(todos, FILTRO_PENDIENTES_TODO)).toHaveLength(3);
  });

  it("por tienda, con el textil como una más", () => {
    const f = { ...FILTRO_PENDIENTES_TODO, tienda: TIENDA_TEXTIL.id };
    expect(filtrarPendientes(todos, f).map((p) => p.id)).toEqual(["p3"]);
  });

  it("por origen y solo los cobrados en parte", () => {
    expect(
      filtrarPendientes(todos, { ...FILTRO_PENDIENTES_TODO, origen: "web" }).map((p) => p.id),
    ).toEqual(["p2"]);
    expect(
      filtrarPendientes(todos, { ...FILTRO_PENDIENTES_TODO, soloParciales: true }).map((p) => p.id),
    ).toEqual(["p1"]);
  });

  it("busca por cliente sin tildes y por número", () => {
    const f = (texto: string) =>
      filtrarPendientes(todos, { ...FILTRO_PENDIENTES_TODO, texto }).map((p) => p.id);
    expect(f("nautico")).toEqual(["p2"]);
    expect(f("tpd")).toEqual(["p3"]);
  });
});

describe("resumirPendientes", () => {
  it("suma lo pendiente, cuenta los parciales y los de más de 30 días", () => {
    expect(resumirPendientes(todos, hoy)).toEqual({
      pedidos: 3,
      pendiente: 135,
      parciales: 1,
      antiguos: 1,
      pendienteAntiguo: 45,
    });
  });

  it("sin pedidos, ceros", () => {
    expect(resumirPendientes([], hoy).pendiente).toBe(0);
  });
});

describe("ordenarPendientes", () => {
  it("los más antiguos primero", () => {
    expect(ordenarPendientes(todos).map((p) => p.id)).toEqual(["p2", "p1", "p3"]);
  });
});
