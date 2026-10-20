/**
 * Monta un presupuesto con un modelo de lenguaje, desde un documento (PDF o
 * imagen) o desde un texto escrito como en un chat.
 *
 * Solo servidor: usa la clave de la API (la misma del lector de facturas,
 * `claveLector`). Se importa dinámicamente dentro de los handlers de
 * `presupuestos-ia.functions.ts`, nunca en el nivel superior.
 *
 * Lo que devuelve la IA es una PROPUESTA: se valida con
 * `validarLecturaPresupuesto` (dominio) y se convierte en un borrador del
 * modelo de siempre con `montarBorradorTienda` o `montarBorradorTextil`. No se
 * guarda nada: el borrador abre el editor y lo guarda la persona.
 */

import Anthropic from "@anthropic-ai/sdk";
import { claveLector } from "./lector-facturas.server";
// Reexportado para que presupuestos-ia.functions lo cargue con el mismo
// import() que el resto: lector-facturas.server se importa aquí de forma
// normal (ver src/arquitectura/importaciones-mixtas.test.ts).
export { hayLectorConfigurado } from "./lector-facturas.server";
import {
  ESQUEMA_LECTURA_PRESUPUESTO_JSON,
  revisarDocumentoIa,
  validarLecturaPresupuesto,
  type LecturaPresupuesto,
} from "@/dominio/presupuesto-ia";

const MODELO = process.env.MODELO_LECTURA ?? "claude-opus-5-5";
/** Un texto de chat no necesita más: frena pegar un libro por error. */
export const MAXIMO_CARACTERES_TEXTO = 20_000;

type TipoImagen = "image/jpeg" | "image/png" | "image/webp";

/**
 * Un error que no se arregla repitiendo la petición: lo que la API rechaza
 * (4xx: la petición está mal o el fichero no vale) o lo que falta para
 * llamarla. No se reintenta.
 */
class ErrorSinReintento extends Error {}

export type AmbitoIa = "tienda" | "textil";

const QUE_SE_VENDE: Record<AmbitoIa, string> = {
  tienda:
    "una tienda de impresión DTF que vende, sobre todo, metros de film impreso y productos de su catálogo",
  textil:
    "el taller de textil personalizado, que vende prendas (camisetas, sudaderas…) de su stock con el diseño estampado",
};

function instrucciones(ambito: AmbitoIa): string {
  return `Preparas BORRADORES de presupuesto para ${QUE_SE_VENDE[ambito]}, de una empresa española. Una persona revisa siempre el borrador antes de guardarlo.

Te llega un documento (un presupuesto, un pedido, un correo, una foto de una nota) o un texto escrito como en un chat. Devuelve el presupuesto con el esquema que se te pide. Cuando un dato no aparece, escribe un texto vacío (""): NUNCA lo inventes ni lo deduzcas.

- cliente_nombre, cliente_email, cliente_telefono, cliente_nif, cliente_direccion: los del cliente al que va el presupuesto (no los de quien lo hace).
- fecha: la del presupuesto si la dice, tal como aparece; si no, "".
- validez_dias: los días de validez si los dice; si no, "".
- con_iva: "no" si dice expresamente que va sin IVA (exento, exportación, inversión del sujeto pasivo); "si" si dice que lleva IVA; "" si no dice nada.
- envio: el importe del envío o los portes, sin IVA, si lo dice; si no, "".
- notas: plazos de entrega, condiciones, observaciones para el cliente que diga el texto. Nada más.
- lineas: una por cada cosa que se presupuesta.
  - catalogo_id: el id EXACTO de la entrada del CATÁLOGO que corresponde a la línea (mismo producto; en el textil, misma prenda, color y talla). Si ninguna encaja de verdad, "". No elijas una parecida: si dudas, "" y dilo en dudas.
  - descripcion: lo que se ofrece, en castellano y claro para el cliente (por ejemplo «Camiseta Gildan Heavy Cotton negra, talla M, logo en el pecho»).
  - cantidad, unidad: como estén escritas. Si una línea trae varias tallas con sus cantidades, haz una línea por talla. Si no dice cuántas, "" y dilo en dudas.
  - precio_unitario: el precio por unidad que dice el texto, tal cual (con su coma decimal); si no lo dice, "". NO pongas el del catálogo: eso lo hace la aplicación.
  - importe: el importe total de la línea si lo dice; si no, "".
  - precio_con_iva: "si" si el precio que dice el texto lleva el IVA incluido; "no" si dice que es sin IVA o más IVA; "" si no lo dice.
- dudas: cada cosa que no esté clara o que falte (una cantidad, un precio, una talla, qué producto es), en castellano y en una frase. Si no hay, una lista vacía.

Copia los números TAL CUAL; no hagas cuentas ni totales: la aplicación calcula la base, el IVA y el total.`;
}

/**
 * Manda la petición al modelo y devuelve lo que ha contestado, sin tocar: un
 * objeto que hay que validar con `validarLecturaPresupuesto`.
 */
async function pedirPresupuesto(e: {
  ambito: AmbitoIa;
  catalogo: string;
  texto: string;
  fichero: { bytes: Uint8Array; tipo: string } | null;
}): Promise<unknown> {
  const clave = await claveLector();
  if (!clave) {
    throw new ErrorSinReintento(
      "Falta la clave de la IA: el secreto «facturas_key» en el Vault de Supabase (la misma del lector de facturas). " +
        "Mientras tanto, el presupuesto se puede hacer a mano.",
    );
  }

  const contenido: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (e.fichero) {
    const revisado = revisarDocumentoIa(e.fichero.bytes, e.fichero.tipo);
    if (!revisado.ok) throw new ErrorSinReintento(revisado.error);
    const datos = Buffer.from(e.fichero.bytes).toString("base64");
    contenido.push(
      revisado.esImagen
        ? {
            type: "image",
            source: { type: "base64", media_type: e.fichero.tipo as TipoImagen, data: datos },
          }
        : {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: datos },
          },
    );
  }
  contenido.push({
    type: "text",
    text: [
      "CATÁLOGO (id | descripción | … | precio sin IVA):",
      e.catalogo,
      "",
      e.texto.trim()
        ? `${e.fichero ? "INDICACIONES DE QUIEN SUBE EL DOCUMENTO" : "EL PRESUPUESTO, ESCRITO A MANO"}:\n${e.texto.trim()}`
        : "Monta el presupuesto del documento adjunto.",
    ].join("\n"),
  });

  const cliente = new Anthropic({ apiKey: clave });
  let respuesta: Anthropic.Beta.BetaMessage;
  try {
    respuesta = await cliente.beta.messages.create({
      model: MODELO,
      max_tokens: 16000,
      // Si el modelo declina por seguridad, la API repite la petición con otro.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: instrucciones(e.ambito),
      output_config: {
        effort: "medium",
        format: {
          type: "json_schema",
          schema: ESQUEMA_LECTURA_PRESUPUESTO_JSON as unknown as Record<string, unknown>,
        },
      },
      messages: [{ role: "user", content: contenido }],
    });
  } catch (err) {
    // El cuerpo del error puede traer la petición entera. Solo el código.
    if (err instanceof Anthropic.APIError) {
      const status = err.status ?? 0;
      // Los 4xx no se arreglan repitiendo (los 429 ya los repite el SDK).
      if (status >= 400 && status < 500) {
        throw new ErrorSinReintento(
          status === 413
            ? "El documento es demasiado grande para la IA. Redúcelo o divídelo."
            : `La IA ha rechazado la petición (${status}). Revisa el documento: formato, tamaño o páginas.`,
        );
      }
      throw new Error(`La IA ha respondido ${err.status ?? "sin código"}.`);
    }
    throw new Error("No se ha podido llegar a la IA.");
  }

  if (respuesta.stop_reason === "refusal") {
    throw new Error("La IA se ha negado a leer este documento.");
  }
  if (respuesta.stop_reason === "max_tokens") {
    throw new Error("El presupuesto es demasiado largo para montarlo de una vez: divídelo.");
  }
  const salida = respuesta.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  try {
    return JSON.parse(salida);
  } catch {
    throw new Error("La IA ha devuelto algo que no es JSON.");
  }
}

/**
 * Pide el presupuesto y lo valida; si no vale, lo pide una vez más. Si
 * tampoco, el error, a la vista. Nunca un borrador a medias.
 */
export async function leerPresupuestoConIa(e: {
  ambito: AmbitoIa;
  catalogo: string;
  texto: string;
  fichero: { bytes: Uint8Array; tipo: string } | null;
}): Promise<LecturaPresupuesto> {
  if (!e.fichero && !e.texto.trim()) throw new Error("Escribe el presupuesto o sube un documento.");
  if (e.texto.length > MAXIMO_CARACTERES_TEXTO) {
    throw new Error("El texto es demasiado largo: como mucho, 20.000 caracteres.");
  }
  // Lo que la API va a rechazar no se manda (ni se cobra).
  if (e.fichero) {
    const revisado = revisarDocumentoIa(e.fichero.bytes, e.fichero.tipo);
    if (!revisado.ok) throw new Error(revisado.error);
  }
  let error = "";
  for (let intento = 1; intento <= 2; intento++) {
    try {
      const v = validarLecturaPresupuesto(await pedirPresupuesto(e));
      if (v.ok) return v.lectura;
      error = v.error;
    } catch (err) {
      if (err instanceof ErrorSinReintento) throw new Error(err.message);
      error = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(`${error} (tras un reintento)`);
}
