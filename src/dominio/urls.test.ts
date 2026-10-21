import { describe, expect, it } from "vitest";
import { logoIncrustado, urlExternaSegura } from "./urls";

describe("urlExternaSegura", () => {
  it("admite logos públicos por https", () => {
    expect(urlExternaSegura("https://abc.supabase.co/storage/v1/object/public/logos/a.png")).toBe(
      true,
    );
    expect(urlExternaSegura("https://tienda.example.com/logo.webp")).toBe(true);
  });

  it("rechaza http y direcciones internas", () => {
    expect(urlExternaSegura("http://tienda.example.com/logo.png")).toBe(false);
    expect(urlExternaSegura("https://localhost/logo.png")).toBe(false);
    expect(urlExternaSegura("https://127.0.0.1/logo.png")).toBe(false);
    expect(urlExternaSegura("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(urlExternaSegura("https://10.0.0.5/x.png")).toBe(false);
    expect(urlExternaSegura("https://172.20.1.1/x.png")).toBe(false);
    expect(urlExternaSegura("https://192.168.1.1/x.png")).toBe(false);
    expect(urlExternaSegura("https://[::1]/x.png")).toBe(false);
    expect(urlExternaSegura("https://servidor.internal/x.png")).toBe(false);
    expect(urlExternaSegura("https://u:p@tienda.example.com/x.png")).toBe(false);
    expect(urlExternaSegura("file:///etc/passwd")).toBe(false);
    expect(urlExternaSegura("no es una url")).toBe(false);
  });
});

describe("logoIncrustado", () => {
  it("acepta PNG, JPG y WEBP en base64 y cuenta los bytes", () => {
    expect(logoIncrustado("data:image/png;base64,iVBORw0KGgo=")).toEqual({
      tipo: "image/png",
      bytes: 8,
    });
    expect(logoIncrustado("data:image/jpeg;base64,/9j/4AAQ")?.tipo).toBe("image/jpeg");
    expect(logoIncrustado("data:image/webp;base64,UklGRg==")?.bytes).toBe(4);
  });

  it("rechaza otros tipos, sin base64 o con caracteres de más", () => {
    expect(logoIncrustado("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
    expect(logoIncrustado("data:text/html;base64,PGgxPg==")).toBeNull();
    expect(logoIncrustado("data:image/png,hola")).toBeNull();
    expect(logoIncrustado("data:image/png;base64,abc<script>")).toBeNull();
    expect(logoIncrustado("https://ejemplo.es/logo.png")).toBeNull();
  });
});
