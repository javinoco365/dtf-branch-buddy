/**
 * El ZIP del archivo, montado en el navegador.
 *
 * Cada fichero se descarga directamente de Supabase Storage con una URL
 * firmada (urlsArchivo) y se mete en el ZIP sin comprimir: los PDF ya van
 * comprimidos y las imágenes también, así que comprimir otra vez solo gasta
 * tiempo. Nada pasa por Vercel, que no deja responder con más de 4,5 MB.
 *
 * Las URL se piden por tandas, justo antes de usarlas, porque caducan a los
 * diez minutos y un trimestre grande puede tardar más en bajar entero.
 */

import { filasIndice, rutasEnZip, type DocArchivo } from "@/dominio/archivo";
import { textoCSV } from "@/lib/csv";
import { numero } from "@/lib/format";

export type ProgresoZip = { hechos: number; total: number; bytes: number };

/** Un documento que no ha entrado en el ZIP, y por qué. */
export type Falta = { doc: DocArchivo; motivo: string };

type Firmar = (docs: DocArchivo[]) => Promise<Map<string, string | null>>;

/** Lo que tiene que esperar el ZIP: a partir de aquí conviene partirlo por meses. */
export const AVISO_DOCUMENTOS = 500;

export async function montarZipArchivo(
  docs: readonly DocArchivo[],
  {
    firmar,
    alProgreso,
    signal,
    tanda = 50,
    concurrencia = 4,
  }: {
    firmar: Firmar;
    alProgreso?: (p: ProgresoZip) => void;
    signal?: AbortSignal;
    tanda?: number;
    concurrencia?: number;
  },
): Promise<{ blob: Blob; incluidos: number; faltan: Falta[] }> {
  // Se carga al pulsar, no con la página: solo hace falta para esto.
  const { Zip, ZipPassThrough, strToU8 } = await import("fflate");

  const trozos: Uint8Array[] = [];
  let fallo: Error | null = null;
  let terminar: () => void = () => {};
  const terminado = new Promise<void>((r) => (terminar = r));
  const zip = new Zip((err, datos, final) => {
    if (err) fallo = err;
    else trozos.push(datos);
    if (final || err) terminar();
  });
  const meter = (ruta: string, bytes: Uint8Array) => {
    const f = new ZipPassThrough(ruta);
    zip.add(f);
    f.push(bytes, true);
  };

  const rutas = rutasEnZip(docs);
  const incluidas: (string | null)[] = docs.map(() => null);
  const faltan: Falta[] = [];
  const progreso: ProgresoZip = { hechos: 0, total: docs.length, bytes: 0 };
  alProgreso?.({ ...progreso });

  for (let i = 0; i < docs.length; i += tanda) {
    signal?.throwIfAborted();
    const lote = docs.slice(i, i + tanda);
    const urls = await firmar([...lote]);

    // De `concurrencia` en `concurrencia`: todos a la vez saturan la conexión
    // y el navegador acaba cortando alguna.
    let siguiente = 0;
    const trabajador = async () => {
      while (siguiente < lote.length) {
        const k = siguiente++;
        const doc = lote[k];
        const url = urls.get(doc.id) ?? null;
        try {
          if (!url) {
            faltan.push({
              doc,
              motivo: doc.tieneFichero ? "no se encuentra el fichero" : "sin fichero",
            });
            continue;
          }
          const r = await fetch(url, { signal });
          if (!r.ok) {
            faltan.push({ doc, motivo: `no se pudo descargar (${r.status})` });
            continue;
          }
          const bytes = new Uint8Array(await r.arrayBuffer());
          meter(rutas[i + k], bytes);
          incluidas[i + k] = rutas[i + k];
          progreso.bytes += bytes.byteLength;
        } catch (e) {
          if (signal?.aborted) throw e;
          faltan.push({ doc, motivo: `no se pudo descargar (${(e as Error).message})` });
        } finally {
          progreso.hechos++;
          alProgreso?.({ ...progreso });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrencia, lote.length) }, trabajador));
  }
  signal?.throwIfAborted();

  // El índice, con todos (también los que faltan, marcados), y la lista de
  // lo que no ha entrado. Datos reales: nada se rellena.
  meter("indice.csv", strToU8(textoCSV(filasIndice(docs, incluidas, (n) => numero(n, 2)))));
  if (faltan.length) {
    const lineas = faltan.map(
      ({ doc, motivo }) =>
        `${doc.fecha ?? "sin fecha"}  ${doc.referencia || "(sin número)"}  ${doc.tercero ?? ""}  → ${motivo}`,
    );
    meter(
      "FALTAN.txt",
      strToU8(
        [`${faltan.length} documento(s) del periodo no están en el ZIP:`, "", ...lineas, ""].join(
          "\r\n",
        ),
      ),
    );
  }
  zip.end();
  await terminado;
  if (fallo) throw fallo;

  return {
    blob: new Blob(trozos as BlobPart[], { type: "application/zip" }),
    incluidos: incluidas.filter(Boolean).length,
    faltan,
  };
}
