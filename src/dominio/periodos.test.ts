import { describe, expect, it } from "vitest";
import {
  compararCon,
  diaDeFecha,
  diasDelRango,
  enRango,
  escribirSeleccion,
  etiquetaPeriodo,
  leerSeleccion,
  moverSeleccion,
  rangoDe,
  textoRango,
  tramosGrafica,
  type Rango,
  type Seleccion,
} from "./periodos";

// Lunes 5 de octubre de 2026, a media mañana.
const HOY = new Date(2026, 9, 5, 10, 0);
const d = (a: number, m: number, dia: number) => new Date(a, m - 1, dia);
const dias = (r: Rango | null) =>
  r && [r.desde, r.hasta].map((x) => `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`);

describe("rangoDe", () => {
  it("cada tipo de periodo, alrededor del 5 de octubre de 2026", () => {
    const ref = HOY;
    expect(dias(rangoDe({ tipo: "hoy", ref }))).toEqual(["2026-10-5", "2026-10-5"]);
    expect(dias(rangoDe({ tipo: "semana", ref }))).toEqual(["2026-10-5", "2026-10-11"]);
    expect(dias(rangoDe({ tipo: "mes", ref }))).toEqual(["2026-10-1", "2026-10-31"]);
    expect(dias(rangoDe({ tipo: "trimestre", ref }))).toEqual(["2026-10-1", "2026-12-31"]);
    expect(dias(rangoDe({ tipo: "anio", ref }))).toEqual(["2026-1-1", "2026-12-31"]);
    expect(dias(rangoDe({ tipo: "ultimos7", ref }))).toEqual(["2026-9-29", "2026-10-5"]);
    expect(dias(rangoDe({ tipo: "ultimos30", ref }))).toEqual(["2026-9-6", "2026-10-5"]);
    expect(rangoDe({ tipo: "todo", ref })).toBeNull();
  });

  it("incluye el último instante del último día", () => {
    const r = rangoDe({ tipo: "mes", ref: HOY })!;
    expect(r.hasta.getHours()).toBe(23);
    expect(r.hasta.getMinutes()).toBe(59);
  });

  it("fechas libres al revés se ordenan", () => {
    const r = rangoDe({ tipo: "libre", ref: HOY, desde: d(2026, 9, 15), hasta: d(2026, 9, 1) });
    expect(dias(r)).toEqual(["2026-9-1", "2026-9-15"]);
  });
});

describe("moverSeleccion", () => {
  it("las flechas saltan un periodo entero del mismo tipo", () => {
    const mover = (s: Seleccion, dir: -1 | 1) => dias(rangoDe(moverSeleccion(s, dir)));
    expect(mover({ tipo: "mes", ref: HOY }, -1)).toEqual(["2026-9-1", "2026-9-30"]);
    expect(mover({ tipo: "trimestre", ref: HOY }, -1)).toEqual(["2026-7-1", "2026-9-30"]);
    expect(mover({ tipo: "semana", ref: HOY }, 1)).toEqual(["2026-10-12", "2026-10-18"]);
    expect(mover({ tipo: "ultimos7", ref: HOY }, -1)).toEqual(["2026-9-22", "2026-9-28"]);
    expect(
      mover({ tipo: "libre", ref: HOY, desde: d(2026, 9, 1), hasta: d(2026, 9, 10) }, 1),
    ).toEqual(["2026-9-11", "2026-9-20"]);
  });

  it("el 31 de marzo, un mes atrás es febrero y no se salta a marzo", () => {
    const r = rangoDe(moverSeleccion({ tipo: "mes", ref: d(2026, 3, 31) }, -1));
    expect(dias(r)).toEqual(["2026-2-1", "2026-2-28"]);
  });
});

describe("etiquetaPeriodo", () => {
  it("nombres para la cabecera", () => {
    expect(etiquetaPeriodo({ tipo: "mes", ref: HOY }, HOY)).toBe("Octubre 2026");
    expect(etiquetaPeriodo({ tipo: "trimestre", ref: HOY }, HOY)).toBe("4.º trimestre 2026");
    expect(etiquetaPeriodo({ tipo: "anio", ref: HOY }, HOY)).toBe("2026");
    expect(etiquetaPeriodo({ tipo: "hoy", ref: HOY }, HOY)).toBe("Hoy");
    expect(etiquetaPeriodo({ tipo: "hoy", ref: d(2026, 10, 4) }, HOY)).toBe("Ayer");
    expect(etiquetaPeriodo({ tipo: "semana", ref: HOY }, HOY)).toBe("5–11 oct 2026");
    expect(etiquetaPeriodo({ tipo: "ultimos30", ref: HOY }, HOY)).toBe("Últimos 30 días");
    expect(etiquetaPeriodo({ tipo: "todo", ref: HOY }, HOY)).toBe("Todo");
  });

  it("rangos que cruzan mes o año", () => {
    expect(textoRango({ desde: d(2026, 9, 28), hasta: d(2026, 10, 4) })).toBe(
      "28 sep – 4 oct 2026",
    );
    expect(textoRango({ desde: d(2025, 12, 15), hasta: d(2026, 1, 10) })).toBe(
      "15 dic 2025 – 10 ene 2026",
    );
  });
});

describe("compararCon", () => {
  it("un mes en curso va contra el mismo trozo del mes anterior, no contra el mes entero", () => {
    const c = compararCon({ tipo: "mes", ref: HOY }, "anterior", HOY)!;
    expect(c.parcial).toBe(true);
    expect(dias(c.actual)).toEqual(["2026-10-1", "2026-10-5"]);
    expect(dias(c.previo)).toEqual(["2026-9-1", "2026-9-5"]);
    expect(c.etiqueta).toBe("1–5 sep 2026");
  });

  it("un mes cerrado va contra el mes anterior entero", () => {
    const c = compararCon({ tipo: "mes", ref: d(2026, 9, 10) }, "anterior", HOY)!;
    expect(c.parcial).toBe(false);
    expect(dias(c.previo)).toEqual(["2026-8-1", "2026-8-31"]);
    expect(c.etiqueta).toBe("agosto 2026");
  });

  it("frente al año pasado: el mismo mes, y el mismo trozo si está en curso", () => {
    const cerrado = compararCon({ tipo: "mes", ref: d(2026, 9, 10) }, "anio", HOY)!;
    expect(dias(cerrado.previo)).toEqual(["2025-9-1", "2025-9-30"]);
    expect(cerrado.etiqueta).toBe("septiembre 2025");

    const enCurso = compararCon({ tipo: "mes", ref: HOY }, "anio", HOY)!;
    expect(dias(enCurso.previo)).toEqual(["2025-10-1", "2025-10-5"]);
  });

  it("febrero bisiesto frente al año pasado acaba el 28", () => {
    const c = compararCon({ tipo: "mes", ref: d(2028, 2, 10) }, "anio", d(2028, 6, 1))!;
    expect(dias(c.previo)).toEqual(["2027-2-1", "2027-2-28"]);
  });

  it("el trozo comparado no se sale del periodo anterior (31 de marzo frente a febrero)", () => {
    const hoy = d(2026, 3, 31);
    const c = compararCon({ tipo: "mes", ref: hoy }, "anterior", hoy)!;
    expect(c.parcial).toBe(false);
    expect(dias(c.previo)).toEqual(["2026-2-1", "2026-2-28"]);
  });

  it("los últimos 30 días van contra los 30 de antes", () => {
    const c = compararCon({ tipo: "ultimos30", ref: HOY }, "anterior", HOY)!;
    expect(dias(c.previo)).toEqual(["2026-8-7", "2026-9-5"]);
  });

  it("sin comparación, o con «todo», no hay nada que comparar", () => {
    expect(compararCon({ tipo: "mes", ref: HOY }, "no", HOY)).toBeNull();
    expect(compararCon({ tipo: "todo", ref: HOY }, "anterior", HOY)).toBeNull();
  });
});

describe("en la dirección", () => {
  it("el periodo que contiene hoy no escribe fecha", () => {
    expect(escribirSeleccion({ tipo: "mes", ref: d(2026, 10, 20) }, HOY)).toEqual({
      periodo: "mes",
      fecha: "",
      desde: "",
      hasta: "",
    });
    expect(escribirSeleccion({ tipo: "mes", ref: d(2026, 9, 20) }, HOY).fecha).toBe("2026-09-20");
  });

  it("ida y vuelta de fechas libres", () => {
    const url = escribirSeleccion(
      { tipo: "libre", ref: HOY, desde: d(2026, 9, 1), hasta: d(2026, 9, 15) },
      HOY,
    );
    expect(url).toEqual({ periodo: "libre", fecha: "", desde: "2026-09-01", hasta: "2026-09-15" });
    expect(dias(rangoDe(leerSeleccion(url, "mes", HOY)))).toEqual(["2026-9-1", "2026-9-15"]);
  });

  it("sin nada, el de por defecto; con desde/hasta sueltos (enlaces viejos), fechas libres", () => {
    expect(leerSeleccion({}, "anio", HOY).tipo).toBe("anio");
    expect(leerSeleccion({ periodo: "raro" }, "mes", HOY).tipo).toBe("mes");
    const vieja = leerSeleccion({ desde: "2026-01-01", hasta: "2026-03-31" }, "anio", HOY);
    expect(vieja.tipo).toBe("libre");
    expect(dias(rangoDe(vieja))).toEqual(["2026-1-1", "2026-3-31"]);
  });
});

describe("enRango", () => {
  const octubre = rangoDe({ tipo: "mes", ref: HOY });

  it("un día suelto es ese día en hora local", () => {
    expect(enRango("2026-10-01", octubre)).toBe(true);
    expect(enRango("2026-10-31", octubre)).toBe(true);
    expect(enRango("2026-09-30", octubre)).toBe(false);
  });

  it("sin fecha, fuera; sin rango, todo dentro", () => {
    expect(enRango(null, octubre)).toBe(false);
    expect(enRango("2020-01-01", null)).toBe(true);
  });
});

describe("diasDelRango", () => {
  it("el primer y el último día, en la hora del navegador", () => {
    expect(diasDelRango(rangoDe({ tipo: "mes", ref: HOY })!)).toEqual({
      desde: "2026-10-01",
      hasta: "2026-10-31",
    });
    expect(diasDelRango(rangoDe({ tipo: "hoy", ref: HOY })!)).toEqual({
      desde: "2026-10-05",
      hasta: "2026-10-05",
    });
    expect(diaDeFecha(new Date(2026, 0, 9, 23, 59))).toBe("2026-01-09");
  });

  it("un rango que empieza después de acabar está vacío, aunque sea de un día", () => {
    const hoy = rangoDe({ tipo: "hoy", ref: HOY })!;
    expect(diasDelRango({ desde: hoy.hasta, hasta: hoy.desde })).toBeNull();
  });
});

describe("tramosGrafica", () => {
  it("un mes, una barra por día", () => {
    const t = tramosGrafica(rangoDe({ tipo: "mes", ref: HOY })!);
    expect(t.por).toBe("dia");
    expect(t.tramos).toHaveLength(31);
    expect(t.tramos[0].etiqueta).toBe("1 oct");
  });

  it("un año, una barra por mes", () => {
    const t = tramosGrafica(rangoDe({ tipo: "anio", ref: HOY })!);
    expect(t.por).toBe("mes");
    expect(t.tramos).toHaveLength(12);
    expect(dias(t.tramos[11])).toEqual(["2026-12-1", "2026-12-31"]);
  });

  it("los meses de los extremos se recortan al rango", () => {
    const t = tramosGrafica(
      rangoDe({ tipo: "libre", ref: HOY, desde: d(2026, 1, 15), hasta: d(2026, 4, 10) })!,
    );
    expect(dias(t.tramos[0])).toEqual(["2026-1-15", "2026-1-31"]);
    expect(dias(t.tramos[3])).toEqual(["2026-4-1", "2026-4-10"]);
  });
});
