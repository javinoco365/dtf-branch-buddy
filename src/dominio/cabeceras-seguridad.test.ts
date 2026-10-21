import { describe, expect, it } from "vitest";
import { cabecerasSeguridad, conCabecerasSeguridad } from "./cabeceras-seguridad";

describe("cabecerasSeguridad", () => {
  const c = cabecerasSeguridad({ supabaseUrl: "https://abc.supabase.co/" });

  it("impide meter el CRM en un marco ajeno", () => {
    expect(c["X-Frame-Options"]).toBe("SAMEORIGIN");
    expect(c["Content-Security-Policy"]).toContain("frame-ancestors 'self'");
    expect(c["Content-Security-Policy"]).toContain("object-src 'none'");
  });

  it("la política completa solo informa, y deja conectar con Supabase", () => {
    const p = c["Content-Security-Policy-Report-Only"];
    expect(p).toContain("connect-src 'self' https://abc.supabase.co wss://abc.supabase.co");
    expect(c["Content-Security-Policy"]).not.toContain("script-src");
  });

  it("HSTS, nosniff y Referrer-Policy", () => {
    expect(c["Strict-Transport-Security"]).toMatch(/max-age=\d+/);
    expect(c["X-Content-Type-Options"]).toBe("nosniff");
    expect(c["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("sin URL de Supabase, solo 'self'", () => {
    const sin = cabecerasSeguridad({});
    expect(sin["Content-Security-Policy-Report-Only"]).toContain("connect-src 'self';");
  });
});

describe("conCabecerasSeguridad", () => {
  it("añade las que faltan sin pisar las que ya trae la respuesta", () => {
    const h = conCabecerasSeguridad(new Headers({ "X-Frame-Options": "DENY", a: "1" }), {
      "X-Frame-Options": "SAMEORIGIN",
      "X-Content-Type-Options": "nosniff",
    });
    expect(h.get("X-Frame-Options")).toBe("DENY");
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("a")).toBe("1");
  });
});
