import { describe, expect, it } from "vitest";
import { contadoresPorSerie, impedimentoBorrado } from "./borrado-facturas";

const contadores = contadoresPorSerie([
  { serie: "", ejercicio: 2026, ultimo_numero: 12 },
  { serie: "T", ejercicio: 2026, ultimo_numero: 7 },
]);

describe("impedimentoBorrado", () => {
  it("la última de su serie se puede borrar", () => {
    expect(
      impedimentoBorrado(
        { estado: "emitida", serie: "", ejercicio: 2026, numero: 12 },
        contadores,
        "2026/0012",
      ),
    ).toBeNull();
    expect(
      impedimentoBorrado(
        { estado: "pagada", serie: "T", ejercicio: 2026, numero: 7 },
        contadores,
        "T2026/0007",
      ),
    ).toBeNull();
  });

  it("la penúltima no", () => {
    expect(
      impedimentoBorrado(
        { estado: "emitida", serie: "", ejercicio: 2026, numero: 11 },
        contadores,
        "2026/0011",
      ),
    ).toMatch(/Solo se puede borrar la última/);
  });

  it("el mismo número en otro ejercicio u otra serie no cuenta", () => {
    expect(
      impedimentoBorrado(
        { estado: "emitida", serie: "", ejercicio: 2025, numero: 12 },
        contadores,
        "2025/0012",
      ),
    ).not.toBeNull();
    expect(
      impedimentoBorrado(
        { estado: "emitida", serie: "R", ejercicio: 2026, numero: 12 },
        contadores,
        "R2026/0012",
      ),
    ).not.toBeNull();
  });

  it("un borrador siempre; sin número, nunca", () => {
    expect(
      impedimentoBorrado(
        { estado: "borrador", serie: null, ejercicio: null, numero: null },
        contadores,
        "—",
      ),
    ).toBeNull();
    expect(
      impedimentoBorrado(
        { estado: "emitida", serie: "FAC", ejercicio: null, numero: null },
        contadores,
        "FAC-1",
      ),
    ).toMatch(/no tiene número/);
  });

  it("la serie sin prefijo y la serie nula son la misma", () => {
    expect(
      impedimentoBorrado(
        { estado: "emitida", serie: null, ejercicio: 2026, numero: 12 },
        contadores,
        "2026/0012",
      ),
    ).toBeNull();
  });
});
