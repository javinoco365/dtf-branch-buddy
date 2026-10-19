import { describe, expect, it } from "vitest";
import {
  diaRealizado,
  fueraDeHora,
  horaCorta,
  instanteDeRelojEspana,
  horaDelPedido,
  metrosRealizadosPorDia,
  momentoDeInstante,
  realizadoOtroDia,
} from "./realizado";

describe("horaDelPedido", () => {
  it("un pedido web guarda la hora de la web como si fuera UTC: se lee tal cual", () => {
    expect(
      horaDelPedido({ fecha_pedido: "2026-10-19T21:47:00+00:00", origen: "woocommerce" }),
    ).toBe("21:47");
  });
  it("un pedido del CRM guarda el instante: se pasa a la hora de España", () => {
    // 19 de octubre: horario de verano, UTC+2.
    expect(horaDelPedido({ fecha_pedido: "2026-10-19T08:15:00+00:00", origen: "manual" })).toBe(
      "10:15",
    );
  });
  it("sin hora (solo el día), null", () => {
    expect(horaDelPedido({ fecha_pedido: "2026-10-19" })).toBeNull();
    expect(horaDelPedido({ fecha_pedido: null })).toBeNull();
  });
});

describe("fueraDeHora", () => {
  const web = (hora: string) => ({
    fecha_pedido: `2026-10-19T${hora}:00+00:00`,
    origen: "woocommerce",
  });
  it("a la hora de corte o después, fuera de hora", () => {
    expect(fueraDeHora(web("13:30"), "13:30")).toBe(true);
    expect(fueraDeHora(web("21:47"), "13:30:00")).toBe(true);
  });
  it("antes del corte, dentro", () => {
    expect(fueraDeHora(web("13:29"), "13:30")).toBe(false);
    expect(fueraDeHora(web("09:00"))).toBe(false);
  });
  it("sin hora, nunca fuera de hora", () => {
    expect(fueraDeHora({ fecha_pedido: "2026-10-19" })).toBe(false);
  });
});

describe("horaCorta", () => {
  it("normaliza lo que da la base", () => {
    expect(horaCorta("13:30:00")).toBe("13:30");
    expect(horaCorta("9:05")).toBe("09:05");
    expect(horaCorta(null)).toBe("13:30");
    expect(horaCorta("basura", "18:00")).toBe("18:00");
  });
});

describe("día realizado", () => {
  it("el día y la hora en España de realizado_en", () => {
    // 22:30 UTC del 19 = 00:30 del 20 en Madrid (verano).
    expect(diaRealizado("2026-10-19T22:30:00+00:00")).toBe("2026-10-20");
    expect(momentoDeInstante("2026-10-19T22:30:00+00:00")).toBe("2026-10-20T00:30:00");
    expect(diaRealizado(null)).toBeNull();
    expect(diaRealizado("no")).toBeNull();
  });
  it("realizado otro día que el del pedido", () => {
    const tarde = {
      fecha_pedido: "2026-10-19T21:47:00+00:00",
      origen: "woocommerce",
      realizado_en: "2026-10-20T07:15:00+00:00",
    };
    expect(realizadoOtroDia(tarde)).toBe(true);
    expect(realizadoOtroDia({ ...tarde, realizado_en: "2026-10-19T20:00:00+00:00" })).toBe(false);
    expect(realizadoOtroDia({ ...tarde, realizado_en: null })).toBe(false);
  });
});

describe("metrosRealizadosPorDia", () => {
  it("suma los metros por el día en que se realizaron", () => {
    const m = metrosRealizadosPorDia([
      { realizado_en: "2026-10-20T07:00:00Z", metros_total: 3.5 },
      { realizado_en: "2026-10-20T10:00:00Z", metros_total: "1.25" },
      { realizado_en: "2026-10-21T07:00:00Z", metros_total: 2 },
      { realizado_en: null, metros_total: 9 },
    ]);
    expect(m.get("2026-10-20")).toBe(4.75);
    expect(m.get("2026-10-21")).toBe(2);
    expect(m.size).toBe(2);
  });
});

describe("instanteDeRelojEspana", () => {
  it("verano (+2) e invierno (+1)", () => {
    expect(instanteDeRelojEspana("2026-10-20T09:15")).toBe("2026-10-20T07:15:00.000Z");
    expect(instanteDeRelojEspana("2026-12-01T09:15")).toBe("2026-12-01T08:15:00.000Z");
  });
  it("ida y vuelta con momentoDeInstante", () => {
    const iso = instanteDeRelojEspana("2026-03-29T12:00")!;
    expect(momentoDeInstante(iso)?.slice(0, 16)).toBe("2026-03-29T12:00");
  });
  it("lo que no es una hora, null", () => {
    expect(instanteDeRelojEspana("ayer")).toBeNull();
    expect(instanteDeRelojEspana("")).toBeNull();
  });
});
