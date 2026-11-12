import { describe, expect, it } from "vitest";
import { idDeSesion } from "./sesion-jwt";

function token(carga: object): string {
  const b64 = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64(carga)}.firma`;
}

describe("idDeSesion", () => {
  it("saca session_id del token", () => {
    expect(idDeSesion(token({ sub: "u1", session_id: "abc-123" }))).toBe("abc-123");
  });

  it("aguanta los caracteres que base64url cambia (- y _) y la falta de relleno", () => {
    // «?>?» en base64 es «Pz4/»: el token lo lleva como «Pz4_».
    const id = "a?>?>b~~?";
    expect(token({ session_id: id })).toMatch(/[-_]/);
    expect(idDeSesion(token({ session_id: id }))).toBe(id);
  });

  it("sin token, sin session_id o con basura: null", () => {
    expect(idDeSesion(null)).toBeNull();
    expect(idDeSesion("")).toBeNull();
    expect(idDeSesion("solo-una-parte")).toBeNull();
    expect(idDeSesion(token({ sub: "u1" }))).toBeNull();
    expect(idDeSesion("a.%%%.c")).toBeNull();
  });
});
