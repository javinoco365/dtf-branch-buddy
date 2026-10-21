import { describe, expect, it } from "vitest";
import { errorDeFirma, tipoPorFirma } from "./ficheros";

const bytes = (...partes: (string | number[])[]) =>
  new Uint8Array(
    partes.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );

const PDF = bytes("%PDF-1.7\n");
const JPG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ");
const GIF = bytes("GIF89a", [1, 0]);

describe("tipoPorFirma", () => {
  it("reconoce los tipos admitidos por sus bytes", () => {
    expect(tipoPorFirma(PDF)).toBe("application/pdf");
    expect(tipoPorFirma(bytes([0xef, 0xbb, 0xbf], "%PDF-1.4"))).toBe("application/pdf");
    expect(tipoPorFirma(JPG)).toBe("image/jpeg");
    expect(tipoPorFirma(PNG)).toBe("image/png");
    expect(tipoPorFirma(WEBP)).toBe("image/webp");
    expect(tipoPorFirma(GIF)).toBe("image/gif");
  });

  it("no reconoce otra cosa", () => {
    expect(tipoPorFirma(bytes("<html><script>"))).toBeNull();
    expect(tipoPorFirma(bytes("MZ"))).toBeNull();
    expect(tipoPorFirma(new Uint8Array())).toBeNull();
  });
});

describe("errorDeFirma", () => {
  it("sin error si coincide", () => {
    expect(errorDeFirma(PDF, "application/pdf")).toBeNull();
    expect(errorDeFirma(PNG, "image/png")).toBeNull();
  });

  it("con error si el navegador dice otra cosa o no es nada conocido", () => {
    expect(errorDeFirma(bytes("<svg onload=x>"), "application/pdf")).toMatch(/no es un PDF/);
    expect(errorDeFirma(PNG, "application/pdf")).toMatch(/image\/png/);
  });
});
