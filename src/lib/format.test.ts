import { describe, expect, it } from "vitest";
import { fechaCorta, fechaHora, fechaLarga } from "./format";

describe("fechas y horas en hora de Madrid", () => {
  it("la hora es la de Madrid, sea cual sea la zona de quien la pinta", () => {
    // 15:05 en UTC son las 16:05 en Madrid en invierno, y las 17:05 en verano.
    expect(fechaHora("2026-11-18T15:05:00Z")).toBe("18/11/2026, 16:05");
    expect(fechaHora("2026-07-01T15:05:00Z")).toBe("01/07/2026, 17:05");
    expect(fechaLarga("2026-11-18T15:05:00Z")).toContain("16:05");
  });

  it("el día también: las 23:30 UTC del 1 de julio ya son el 2 en Madrid", () => {
    expect(fechaCorta("2026-07-01T23:30:00Z")).toBe("02/07/2026");
    expect(fechaCorta("2026-11-18")).toBe("18/11/2026");
  });

  it("sin fecha, una raya", () => {
    expect(fechaCorta(null)).toBe("—");
    expect(fechaHora(undefined)).toBe("—");
  });
});
