import { describe, expect, it } from "vitest";
import {
  capacidad,
  diasEntre,
  horasJornada,
  margenes,
  resumenPeriodo,
  variacionResumen,
  type AjustesResumen,
  type EntradaResumen,
  type PedidoParaResumen,
} from "./resumen-diario";

const AJUSTES: AjustesResumen = {
  horaCorte: "13:30",
  metrosHora: 70,
  jornadaInicio: "09:00",
  jornadaFin: "13:00",
  costeEnvioDefecto: 5,
  costeMetroActual: 2,
};

/** Un pedido web de 10 m: 100 € de base con 5 € de envío dentro, 21 % de IVA. */
function web(id: string, cambios: Partial<PedidoParaResumen> = {}): PedidoParaResumen {
  return {
    id,
    negocio: "t1",
    tienda_id: "t1",
    canal: "web",
    origen: "woocommerce",
    cliente_id: null,
    fecha_pedido: "2026-10-19T10:00:00+00:00",
    estado: "pendiente",
    subtotal: 100,
    iva: 21,
    envio: 5,
    total: 121,
    metros_total: 10,
    coste_metro_snapshot: 2,
    realizado_en: null,
    coste_envio_real: null,
    con_envio: true,
    cobrado: 121,
    ...cambios,
  };
}

function textil(id: string, cambios: Partial<PedidoParaResumen> = {}): PedidoParaResumen {
  return {
    id,
    negocio: "textil",
    tienda_id: "textil",
    canal: "textil",
    cliente_id: null,
    fecha_pedido: "2026-10-19T12:00:00",
    estado: "pendiente",
    subtotal: 80,
    iva: 16.8,
    envio: 0,
    total: 96.8,
    metros_total: 0,
    coste_textil: 30,
    realizado_en: null,
    coste_envio_real: null,
    con_envio: false,
    cobrado: 0,
    ...cambios,
  };
}

const entrada = (e: Partial<EntradaResumen>): EntradaResumen => ({
  desde: "2026-10-19",
  hasta: "2026-10-19",
  hoy: "2026-10-20",
  negocios: [
    { id: "t1", nombre: "DTF Culture" },
    { id: "textil", nombre: "Textil personalizado" },
  ],
  pedidos: [],
  cobros: [],
  documentos: [],
  ajustes: AJUSTES,
  gastosFijos: null,
  objetivo: { metros: null, vendido: null },
  ...e,
});

describe("margenes", () => {
  it("sin envíos: bruta − producción; con envíos: + envío cobrado − coste real", () => {
    const m = margenes([web("a", { coste_envio_real: 3.2 })], AJUSTES);
    expect(m.bruta).toBe(95);
    expect(m.costeProduccion).toBe(20);
    expect(m.margenSinEnvios).toBe(75);
    expect(m.enviosCobrados).toBe(5);
    expect(m.costeEnvios).toBe(3.2);
    expect(m.resultadoEnvios).toBe(1.8);
    expect(m.margenConEnvios).toBe(76.8);
    expect(m.enviosEstimados).toBe(0);
  });

  it("sin coste real, el de por defecto, y se cuenta como estimado", () => {
    const m = margenes([web("a")], AJUSTES);
    expect(m.costeEnvios).toBe(5);
    expect(m.enviosEstimados).toBe(1);
    expect(m.margenConEnvios).toBe(75);
  });

  it("un envío gratis cuesta igual: el margen con envíos baja", () => {
    const gratis = web("a", {
      subtotal: 95,
      iva: 19.95,
      total: 114.95,
      envio: 0,
      coste_envio_real: 4,
    });
    const m = margenes([gratis], AJUSTES);
    expect(m.resultadoEnvios).toBe(-4);
    expect(m.margenConEnvios).toBe(m.margenSinEnvios - 4);
  });

  it("textil: la ropa que salió del almacén; recogida sin envío: sin coste de envío", () => {
    const m = margenes([textil("x")], AJUSTES);
    expect(m.costeProduccion).toBe(30);
    expect(m.margenSinEnvios).toBe(50);
    expect(m.costeEnvios).toBe(0);
  });

  it("los cancelados no cuentan", () => {
    expect(margenes([web("a", { estado: "cancelado" })], AJUSTES).pedidos).toBe(0);
  });
});

describe("resumenPeriodo: lo pedido y lo realizado, por separado", () => {
  // Entra a las 21:47 del lunes 19 (después del corte) y se hace el martes 20 a las 09:15.
  const tarde = web("tarde", {
    fecha_pedido: "2026-10-19T21:47:00+00:00",
    estado: "enviado",
    realizado_en: "2026-10-20T07:15:00Z",
    coste_envio_real: 3,
  });
  const temprano = web("temprano", {
    fecha_pedido: "2026-10-19T09:00:00+00:00",
    estado: "enviado",
    realizado_en: "2026-10-19T09:30:00Z",
    cobrado: 0,
  });

  it("el día del pedido: cuenta como pedido, fuera de hora, y en cola al cierre", () => {
    const r = resumenPeriodo(entrada({ pedidos: [tarde, temprano] }));
    const t1 = r.negocios.find((n) => n.id === "t1")!;
    expect(t1.pedido.pedidos).toBe(2);
    expect(t1.pedido.metros).toBe(20);
    expect(t1.pedido.fueraDeHora).toBe(1);
    expect(t1.realizado.pedidos).toBe(1);
    expect(t1.realizado.metrosImpresos).toBe(10);
    expect(t1.cola).toEqual({ pedidos: 1, metros: 10 });
  });

  it("el día siguiente: no es pedido de ese día, pero sí realizado", () => {
    const r = resumenPeriodo(
      entrada({
        desde: "2026-10-20",
        hasta: "2026-10-20",
        hoy: "2026-10-21",
        pedidos: [tarde, temprano],
      }),
    );
    expect(r.total.pedido.pedidos).toBe(0);
    expect(r.total.realizado.pedidos).toBe(1);
    expect(r.total.realizado.metrosImpresos).toBe(10);
    // De las 21:47 del 19 a las 09:15 del 20.
    expect(r.total.realizado.horasMedias).toBe(11.5);
    expect(r.total.cola.pedidos).toBe(0);
  });

  it("un pedido cancelado tras realizarse cuenta sus metros impresos, no su margen", () => {
    const cancelado = { ...temprano, estado: "cancelado" };
    const r = resumenPeriodo(entrada({ pedidos: [cancelado] }));
    expect(r.total.realizado.metrosImpresos).toBe(10);
    expect(r.total.realizado.pedidos).toBe(0);
    expect(r.total.pedido.cancelados).toBe(1);
  });

  it("realizados sin cobrar y lo que queda pendiente de lo pedido", () => {
    const r = resumenPeriodo(entrada({ pedidos: [temprano] }));
    expect(r.total.realizado.sinCobrar).toBe(1);
    expect(r.total.realizado.importeSinCobrar).toBe(121);
    expect(r.total.pedido.pendiente).toBe(121);
    expect(r.avisos.map((a) => a.tipo)).toContain("realizados_sin_cobrar");
  });

  it("cobrado y facturado por negocio y por fecha del periodo", () => {
    const r = resumenPeriodo(
      entrada({
        pedidos: [temprano, textil("x")],
        cobros: [
          { negocio: "t1", fecha: "2026-10-19", importe: 50 },
          { negocio: "t1", fecha: "2026-10-18", importe: 999 },
          { negocio: "textil", fecha: "2026-10-19", importe: 20 },
        ],
        documentos: [{ negocio: "t1", fecha: "2026-10-19", base: 100 }],
      }),
    );
    expect(r.negocios.find((n) => n.id === "t1")!.cobrado).toBe(50);
    expect(r.negocios.find((n) => n.id === "textil")!.cobrado).toBe(20);
    expect(r.total.cobrado).toBe(70);
    expect(r.total.facturado).toBe(100);
  });

  it("el total suma los negocios y recalcula los cocientes", () => {
    const r = resumenPeriodo(entrada({ pedidos: [temprano, textil("x")] }));
    expect(r.total.pedido.pedidos).toBe(2);
    expect(r.total.pedido.margenSinEnvios).toBe(75 + 50);
    expect(r.total.pedido.ticket).toBe(Math.round(((121 + 96.8) / 2) * 100) / 100);
    // € por metro solo con lo que se vende por metros: el textil no lo baja.
    expect(r.total.pedido.euroMetro).toBe(9.5);
  });

  it("los negocios sin nada en el periodo no salen", () => {
    const r = resumenPeriodo(entrada({ pedidos: [temprano] }));
    expect(r.negocios.map((n) => n.id)).toEqual(["t1"]);
  });

  it("beneficio = margen con envíos − gastos fijos; objetivo de metros con lo impreso", () => {
    const r = resumenPeriodo(
      entrada({ pedidos: [temprano], gastosFijos: 40, objetivo: { metros: 20, vendido: 242 } }),
    );
    expect(r.beneficio).toBe(r.total.pedido.margenConEnvios - 40);
    expect(r.objetivo.avanceMetros).toBe(0.5);
    expect(r.objetivo.avanceVendido).toBe(0.5);
  });

  it("un periodo de varios días lleva el día a día, hasta hoy", () => {
    const r = resumenPeriodo(
      entrada({
        desde: "2026-10-19",
        hasta: "2026-10-25",
        hoy: "2026-10-21",
        pedidos: [tarde, temprano],
      }),
    );
    expect(r.porDia.map((d) => d.dia)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21"]);
    expect(r.porDia[0].pedidos).toBe(2);
    expect(r.porDia[0].metrosImpresos).toBe(10);
    expect(r.porDia[1].metrosImpresos).toBe(10);
    expect(resumenPeriodo(entrada({})).porDia).toEqual([]);
  });
});

describe("capacidad", () => {
  it("70 m/h × 4 h × días laborables hasta hoy", () => {
    // Lunes 19 a domingo 25, con hoy el miércoles 21: 3 días laborables.
    const c = capacidad("2026-10-19", "2026-10-25", "2026-10-21", AJUSTES, 420);
    expect(c.dias).toBe(3);
    expect(c.horasDia).toBe(4);
    expect(c.metros).toBe(840);
    expect(c.uso).toBe(0.5);
  });
  it("un fin de semana no tiene capacidad", () => {
    const c = capacidad("2026-10-24", "2026-10-25", "2026-10-30", AJUSTES, 0);
    expect(c.dias).toBe(0);
    expect(c.uso).toBeNull();
  });
  it("horas de jornada", () => {
    expect(horasJornada("09:00", "13:00")).toBe(4);
    expect(horasJornada("08:30:00", "14:00:00")).toBe(5.5);
  });
});

describe("avisos", () => {
  it("máquina llena, cola larga, fuera de hora y envíos estimados", () => {
    const muchos = Array.from({ length: 30 }, (_, i) =>
      web(`p${i}`, {
        fecha_pedido: "2026-10-19T15:00:00+00:00",
        estado: i < 28 ? "enviado" : "listo",
        realizado_en: i < 28 ? "2026-10-19T12:00:00Z" : null,
      }),
    );
    const r = resumenPeriodo(entrada({ pedidos: muchos }));
    const tipos = r.avisos.map((a) => a.tipo);
    expect(tipos).toContain("maquina_llena");
    expect(tipos).toContain("fuera_de_hora");
    expect(tipos).toContain("envios_estimados");
    expect(r.avisos[0].nivel).toBe("alto");
  });
});

describe("utilidades", () => {
  it("días entre dos fechas y variación", () => {
    expect(diasEntre("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
    expect(variacionResumen(120, 100)).toBe(0.2);
    expect(variacionResumen(5, 0)).toBeNull();
    expect(variacionResumen(-50, -100)).toBe(0.5);
  });
});
