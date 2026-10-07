/**
 * Lee una factura de compra con un modelo de lenguaje (visión).
 *
 * Solo servidor. La clave de API es un secreto y no puede acabar en el bundle
 * del navegador, así que este módulo se importa dinámicamente dentro del
 * handler, nunca en el nivel superior de un `*.functions.ts`.
 *
 * Se pide salida estructurada: la API obliga al modelo a devolver un JSON con
 * la forma de `ESQUEMA_LECTURA_JSON`. Aun así, lo que devuelve NO es un dato
 * bueno: es una propuesta. Quien lo valida es `validarLectura` (dominio) y
 * quien lo confirma, la persona que revisa la cola.
 */

import Anthropic from "@anthropic-ai/sdk";
import { ESQUEMA_LECTURA_JSON } from "@/dominio/cola-compras";
import { CATEGORIAS_COMPRA } from "@/dominio/compras";

const MODELO = process.env.MODELO_LECTURA ?? "claude-opus-5-5";
const MAXIMO_BYTES = 10 * 1024 * 1024;

const TIPOS_IMAGEN = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type TipoImagen = (typeof TIPOS_IMAGEN)[number];
const esImagen = (t: string): t is TipoImagen => (TIPOS_IMAGEN as readonly string[]).includes(t);

const INSTRUCCIONES = `Eres un lector de facturas de compra de una empresa española de impresión DTF y textil.

Devuelve los datos de la factura con el esquema que se te pide:

- proveedor: razón social de quien EMITE la factura (no de quien la recibe).
- nif_proveedor: su NIF o CIF.
- numero: número de la factura.
- fecha: fecha de emisión, tal como aparece.
- concepto: en pocas palabras, qué se compra.
- categoria: una de ${CATEGORIAS_COMPRA.map((c) => `"${c.valor}" (${c.etiqueta})`).join(", ")}. Si no está claro, null.
- base, iva, irpf, total: base imponible, cuota de IVA, retención de IRPF y total a pagar.
- lineas: cada concepto con su cantidad, unidad, precio unitario e importe.
- confianza: de 0 a 1, cuánto te fías de tu lectura en conjunto.
- dudas: cada cosa que no esté clara (un número borroso, un dato que no aparece, dos tipos de IVA…), en castellano y en una frase. Si no hay, una lista vacía.

Reglas:
- Copia los importes TAL CUAL están escritos, con su coma decimal si la tienen.
  No los conviertas ni los recalcules.
- Si un dato no aparece en el documento, pon null y dilo en dudas. NO lo
  deduzcas ni lo inventes: un hueco se rellena a mano, un dato inventado no se
  detecta.
- Los descuentos, portes y recargos van como líneas más, con su importe y su
  signo.`;

export function hayLectorConfigurado(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Manda el fichero al modelo y devuelve lo que ha leído, sin tocar: un objeto
 * que hay que validar con `validarLectura` antes de usarlo.
 *
 * La normalización, la validación y la revisión de la aritmética viven en el
 * dominio, no aquí: así se pueden probar sin red.
 */
export async function leerFactura(bytes: Uint8Array, tipoMime: string): Promise<unknown> {
  const clave = process.env.ANTHROPIC_API_KEY;
  if (!clave) {
    throw new Error(
      "Falta ANTHROPIC_API_KEY. Configúrala en el entorno del despliegue para " +
        "poder leer facturas; mientras tanto, la compra se puede dar de alta a mano.",
    );
  }
  if (tipoMime !== "application/pdf" && !esImagen(tipoMime)) {
    throw new Error(`Formato no admitido (${tipoMime}). Sube un PDF, un JPG o un PNG.`);
  }
  if (bytes.byteLength > MAXIMO_BYTES) {
    throw new Error("El fichero pesa más de 10 MB. Baja la resolución o divide el PDF.");
  }

  const datos = Buffer.from(bytes).toString("base64");
  const contenido: Anthropic.Beta.BetaContentBlockParam = esImagen(tipoMime)
    ? { type: "image", source: { type: "base64", media_type: tipoMime, data: datos } }
    : { type: "document", source: { type: "base64", media_type: "application/pdf", data: datos } };

  const cliente = new Anthropic({ apiKey: clave });
  let respuesta: Anthropic.Beta.BetaMessage;
  try {
    respuesta = await cliente.beta.messages.create({
      model: MODELO,
      max_tokens: 16000,
      // Si el modelo declina por seguridad, la API repite la petición con otro.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: INSTRUCCIONES,
      output_config: {
        // Leer bien los números importa más que la velocidad.
        effort: "medium",
        format: {
          type: "json_schema",
          schema: ESQUEMA_LECTURA_JSON as unknown as Record<string, unknown>,
        },
      },
      messages: [
        {
          role: "user",
          content: [contenido, { type: "text", text: "Lee esta factura de compra." }],
        },
      ],
    });
  } catch (e) {
    // El cuerpo del error puede traer la petición entera. Solo el código.
    if (e instanceof Anthropic.APIError) {
      throw new Error(`El lector de facturas ha respondido ${e.status ?? "sin código"}.`);
    }
    throw new Error("No se ha podido llegar al lector de facturas.");
  }

  if (respuesta.stop_reason === "refusal") {
    throw new Error("El lector de facturas se ha negado a leer este documento.");
  }
  if (respuesta.stop_reason === "max_tokens") {
    throw new Error("La factura es demasiado larga para leerla de una vez.");
  }
  const texto = respuesta.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  try {
    return JSON.parse(texto);
  } catch {
    throw new Error("El lector ha devuelto algo que no es JSON.");
  }
}
