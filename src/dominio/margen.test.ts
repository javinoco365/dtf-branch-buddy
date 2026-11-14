import { describe, expect, it } from "vitest";
import { porcentajeMargen } from "./margen";

describe("porcentajeMargen", () => {
  it("margen ÷ bruta con un decimal; nulo sin ventas", () => {
    expect(porcentajeMargen(25, 80)).toBe(31.3);
    expect(porcentajeMargen(-10, 50)).toBe(-20);
    expect(porcentajeMargen(5, 0)).toBeNull();
  });
});
