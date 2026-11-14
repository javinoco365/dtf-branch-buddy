import { describe, expect, it } from "vitest";
import { instanteDeMadrid, type Tarea } from "./agenda";
import {
  casillasDelMes,
  diasDelMesDe,
  esVista,
  moverReferencia,
  referenciaDelMes,
  prioridadMasAlta,
  rangoDeVista,
  semanaDe,
  tareasPorDia,
  tituloDeVista,
} from "./agenda-calendario";

let n = 0;
function tarea(t: Partial<Tarea> & { dia: string; hora?: string }): Tarea {
  const { dia, hora, ...resto } = t;
  return {
    id: `t${++n}`,
    titulo: "Tarea",
    notas: null,
    categoriaId: "c",
    prioridad: "normal",
    todoElDia: !hora,
    inicio: instanteDeMadrid(dia, hora ?? "00:00"),
    fin: null,
    deSocioId: "a",
    paraSocioId: "a",
    pedidoId: null,
    clienteId: null,
    enlaceTexto: null,
    estado: "pendiente",
    hechaEn: null,
    vistaEn: null,
    ...resto,
  };
}

describe("días de cada vista", () => {
  it("semanaDe: de lunes a domingo", () => {
    expect(semanaDe("2026-11-12")).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
    ]);
  });

  it("casillasDelMes: semanas completas que cubren el mes", () => {
    // Noviembre de 2026 empieza en domingo y acaba en lunes: 6 semanas.
    const c = casillasDelMes("2026-11-12");
    expect(c.length % 7).toBe(0);
    expect(c[0]).toBe("2026-10-26");
    expect(c[c.length - 1]).toBe("2026-12-06");
    expect(c).toHaveLength(42);
    expect(c).toContain("2026-11-01");
    expect(c).toContain("2026-11-30");
  });

  it("un mes que empieza en lunes no lleva días del anterior", () => {
    expect(casillasDelMes("2027-02-10")[0]).toBe("2027-02-01");
  });

  it("diasDelMesDe con años bisiestos", () => {
    expect(diasDelMesDe("2028-02-03")).toBe(29);
    expect(diasDelMesDe("2027-02-03")).toBe(28);
    expect(diasDelMesDe("2026-12-03")).toBe(31);
  });

  it("rangoDeVista", () => {
    expect(rangoDeVista("2026-11-12", "dia")).toEqual({ desde: "2026-11-12", hasta: "2026-11-12" });
    expect(rangoDeVista("2026-11-12", "semana")).toEqual({
      desde: "2026-11-09",
      hasta: "2026-11-15",
    });
    expect(rangoDeVista("2026-11-12", "mes")).toEqual({ desde: "2026-10-26", hasta: "2026-12-06" });
    expect(rangoDeVista("2026-11-12", "anio")).toEqual({
      desde: "2026-01-01",
      hasta: "2026-12-31",
    });
  });
});

describe("moverReferencia", () => {
  it("día y semana", () => {
    expect(moverReferencia("2026-11-30", "dia", 1)).toBe("2026-12-01");
    expect(moverReferencia("2026-11-12", "semana", -1)).toBe("2026-11-05");
  });

  it("mes: al día 1 del mes de al lado, también el 31", () => {
    expect(moverReferencia("2026-01-31", "mes", 1)).toBe("2026-02-01");
    expect(moverReferencia("2026-01-15", "mes", -1)).toBe("2025-12-01");
  });

  it("año: el mismo día, salvo el 29 de febrero", () => {
    expect(moverReferencia("2026-11-12", "anio", 1)).toBe("2027-11-12");
    expect(moverReferencia("2028-02-29", "anio", 1)).toBe("2029-02-28");
  });
});

describe("tareasPorDia", () => {
  it("agrupa por día de Madrid y deja fuera las canceladas y las de fuera del rango", () => {
    const a = tarea({ dia: "2026-11-12" });
    const b = tarea({ dia: "2026-11-12", estado: "cancelada" });
    const c = tarea({ dia: "2026-11-20" });
    const m = tareasPorDia([a, b, c], "2026-11-09", "2026-11-15");
    expect([...m.keys()]).toEqual(["2026-11-12"]);
    expect(m.get("2026-11-12")).toEqual([a]);
  });

  it("orden: todo el día, luego por hora; realizadas al final; a igual hora, la urgente", () => {
    const tarde = tarea({ id: "tarde", dia: "2026-11-12", hora: "17:00" });
    const manana = tarea({ id: "manana", dia: "2026-11-12", hora: "09:00", prioridad: "baja" });
    const mananaUrgente = tarea({
      id: "manana-urgente",
      dia: "2026-11-12",
      hora: "09:00",
      prioridad: "urgente",
    });
    const todoDia = tarea({ id: "todo-dia", dia: "2026-11-12" });
    const hecha = tarea({ id: "hecha", dia: "2026-11-12", hora: "08:00", estado: "hecha" });
    const m = tareasPorDia(
      [tarde, hecha, manana, todoDia, mananaUrgente],
      "2026-11-12",
      "2026-11-12",
    );
    expect(m.get("2026-11-12")!.map((t) => t.id)).toEqual([
      "todo-dia",
      "manana-urgente",
      "manana",
      "tarde",
      "hecha",
    ]);
  });
});

describe("prioridadMasAlta", () => {
  it("la más importante entre las pendientes", () => {
    expect(
      prioridadMasAlta([
        tarea({ dia: "2026-11-12", prioridad: "baja" }),
        tarea({ dia: "2026-11-12", prioridad: "alta" }),
        tarea({ dia: "2026-11-12", prioridad: "urgente", estado: "hecha" }),
      ]),
    ).toBe("alta");
  });
  it("sin pendientes, null", () => {
    expect(prioridadMasAlta([])).toBeNull();
    expect(prioridadMasAlta([tarea({ dia: "2026-11-12", estado: "hecha" })])).toBeNull();
  });
});

describe("tituloDeVista", () => {
  it("cada vista, sin mayúsculas de más", () => {
    expect(tituloDeVista("2026-11-12", "dia")).toBe("Jueves, 12 de noviembre de 2026");
    expect(tituloDeVista("2026-11-12", "semana")).toBe("9 – 15 de noviembre de 2026");
    expect(tituloDeVista("2026-11-12", "mes")).toBe("Noviembre de 2026");
    expect(tituloDeVista("2026-11-12", "anio")).toBe("2026");
  });
  it("semana entre dos meses y entre dos años", () => {
    expect(tituloDeVista("2026-12-01", "semana")).toBe("30 de noviembre – 6 de diciembre de 2026");
    expect(tituloDeVista("2026-12-31", "semana")).toBe(
      "28 de diciembre de 2026 – 3 de enero de 2027",
    );
  });
  it("esVista", () => {
    expect(esVista("mes")).toBe(true);
    expect(esVista("trimestre")).toBe(false);
  });
});

describe("moverReferencia con hoy", () => {
  it("al llegar al mes de hoy, se queda en hoy; a otro mes, el día 1", () => {
    expect(moverReferencia("2026-10-01", "mes", 1, "2026-11-14")).toBe("2026-11-14");
    expect(moverReferencia("2026-11-14", "mes", 1, "2026-11-14")).toBe("2026-12-01");
    expect(moverReferencia("2026-12-01", "mes", -1, "2026-11-14")).toBe("2026-11-14");
  });
  it("al llegar al año de hoy, se queda en hoy", () => {
    expect(moverReferencia("2025-03-10", "anio", 1, "2026-11-14")).toBe("2026-11-14");
    expect(moverReferencia("2026-11-14", "anio", 1, "2026-11-14")).toBe("2027-11-14");
  });
  it("referenciaDelMes: hoy si es su mes, si no el día 1", () => {
    expect(referenciaDelMes("2026-11-01", "2026-11-14")).toBe("2026-11-14");
    expect(referenciaDelMes("2026-12-20", "2026-11-14")).toBe("2026-12-01");
    expect(referenciaDelMes("2026-12-20")).toBe("2026-12-01");
  });
});
