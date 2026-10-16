import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { rellenarTexto, type ModoNombre } from "@/dominio/plantilla-presupuesto";
import { LARGOS, MAXIMOS, MINIMOS } from "./limites";
import {
  conCabecera,
  conElemento,
  conGrupo,
  conPartes,
  deLaBase,
  useEditor,
  type Plantilla,
} from "./editor";
import { coloresHeredados } from "./aspecto";
import {
  CampoAlineacion,
  CampoColor,
  CampoInterruptor,
  CampoNumero,
  CampoTexto,
  TextoConVariables,
} from "./Campos";
import { SeccionLogo } from "./SeccionLogo";
import { useMaquetaCabecera } from "./use-maqueta-cabecera";
import { PiePagina, RENGLONES_PIE } from "./PiePagina";

/**
 * Todos los campos de la plantilla, por secciones plegables: primero lo de la
 * cabecera (lo mismo que se arrastra en el diseñador, con todas sus opciones),
 * luego el cuerpo y el pie.
 */

const largo = (s: string) => s.length;

type SeccionFormulario =
  | "logo"
  | "nombre"
  | "titulo"
  | "datos"
  | "texto"
  | "cabecera"
  | "colores"
  | "partes"
  | "tabla"
  | "resumen"
  | "secciones"
  | "pie";

export function SeccionesPlantilla({
  abiertas,
  onAbiertas,
}: {
  abiertas: string[];
  onAbiertas: (v: string[]) => void;
}) {
  const { plantilla: p, ambito } = useEditor();
  const cab = p.cabecera;

  // Una pista de cada sección cerrada: lo que tiene ahora, de un vistazo.
  const no = (b: boolean) => (b ? null : "No sale");
  const pistas: Record<SeccionFormulario, string | null> = {
    logo: no(cab.logo.mostrar),
    nombre: cab.nombre.mostrar === "nunca" ? "No sale" : null,
    titulo: no(cab.titulo.mostrar),
    datos: no(cab.datos.mostrar),
    texto: cab.texto.mostrar && cab.texto.texto.trim() ? null : "No sale",
    cabecera: null,
    colores: p.colores.principal || p.colores.acento || p.colores.destacado ? "Propios" : null,
    partes: null,
    tabla: null,
    resumen: null,
    secciones: null,
    pie: null,
  };

  const item = (
    valor: SeccionFormulario,
    titulo: string,
    desc: string,
    contenido: React.ReactNode,
  ) => (
    <AccordionItem key={valor} value={valor} id={`seccion-${valor}`} className="scroll-mt-4">
      <AccordionTrigger className="gap-3 py-3 hover:no-underline">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-medium">{titulo}</span>
            {pistas[valor] && (
              <Badge variant="outline" className="py-0 text-[10px] font-normal">
                {pistas[valor]}
              </Badge>
            )}
          </span>
          <span className="block text-xs font-normal text-muted-foreground">{desc}</span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="space-y-4 pt-1">{contenido}</AccordionContent>
    </AccordionItem>
  );

  return (
    <Accordion type="multiple" value={abiertas} onValueChange={onAbiertas} className="w-full">
      <p className="pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Cabecera
      </p>
      {item("logo", "Logo", `El ${deLaBase(ambito)} o uno propio, y su caja`, <SeccionLogo />)}
      {item(
        "nombre",
        "Nombre comercial",
        "El nombre que sale arriba, cuándo y dónde",
        <SeccionNombre />,
      )}
      {item("titulo", "Título", "«PRESUPUESTO», o lo que pongas", <SeccionTitulo />)}
      {item("datos", "Datos del presupuesto", "Número, fecha y validez", <SeccionDatos />)}
      {item(
        "texto",
        "Antetítulo",
        "La línea pequeña sobre el título; admite variables",
        <SeccionTextoLibre />,
      )}
      {item(
        "cabecera",
        "Banda y cinta de lemas",
        "El alto de la banda y los lemas de la cinta de debajo",
        <SeccionCabecera />,
      )}
      {item("colores", "Colores", "La banda, el acento y el del TOTAL", <SeccionColores />)}

      <p className="pb-1 pt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Cuerpo y pie
      </p>
      {item(
        "partes",
        "Emisor y cliente",
        "Las dos cajas: orden, títulos y qué datos llevan",
        <SeccionPartes />,
      )}
      {item(
        "tabla",
        "Detalle del pedido",
        "El título, las columnas y cuáles salen",
        <SeccionTabla />,
      )}
      {item(
        "resumen",
        "Resumen",
        "Base imponible, IVA, TOTAL y la nota de debajo",
        <SeccionResumen />,
      )}
      {item(
        "secciones",
        "Observaciones, aceptación y condiciones",
        "Qué sale y con qué textos",
        <SeccionesFinales />,
      )}
      {item("pie", "Pie de página", "La banda del pie y el número de página", <SeccionPie />)}
    </Accordion>
  );
}

// ---------------------------------------------------------------------------
// Cabecera
// ---------------------------------------------------------------------------

/** X, Y, tamaño y alineación de un texto de la cabecera. */
function PosicionTexto({ el }: { el: "nombre" | "titulo" | "texto" }) {
  const { plantilla, cambiar } = useEditor();
  const t = plantilla.cabecera[el];
  // Con la caja del texto dentro del papel, como al arrastrarlo.
  const l = useMaquetaCabecera().limites(el);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <CampoNumero
        etiqueta="X"
        valor={t.x}
        min={l.minX}
        max={l.maxX}
        onChange={(x) => cambiar(conElemento(el, { x }))}
      />
      <CampoNumero
        etiqueta="Y (línea base)"
        valor={t.y}
        min={l.minY}
        max={l.maxY}
        onChange={(y) => cambiar(conElemento(el, { y }))}
      />
      <CampoNumero
        etiqueta="Tamaño"
        unidad="pt"
        valor={t.tamano}
        min={MINIMOS.cabecera[el].tamano}
        max={MAXIMOS.cabecera[el].tamano}
        onChange={(tamano) => cambiar(conElemento(el, { tamano }))}
      />
      <CampoAlineacion
        valor={t.alineacion}
        onChange={(alineacion) => cambiar(conElemento(el, { alineacion }))}
      />
    </div>
  );
}

const MODOS_NOMBRE: { valor: ModoNombre; texto: string }[] = [
  { valor: "auto", texto: "Solo si no hay logo" },
  { valor: "siempre", texto: "Siempre" },
  { valor: "nunca", texto: "Nunca" },
];

function SeccionNombre() {
  const { plantilla, cambiar, base, ambito } = useEditor();
  const n = plantilla.cabecera.nombre;
  const de = deLaBase(ambito);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <CampoTexto
          etiqueta="Nombre comercial"
          valor={n.texto}
          maximo={largo(LARGOS.cabecera.nombre.texto)}
          placeholder={base.nombre ?? ""}
          onChange={(texto) => cambiar(conElemento("nombre", { texto }))}
          ayuda={
            base.nombre
              ? `Vacío: el ${de} («${base.nombre}»). Sale también en la caja del emisor.`
              : `Vacío: el ${de}.`
          }
        />
        <div className="space-y-1.5">
          <Label className="text-xs">En la cabecera</Label>
          <Select
            value={n.mostrar}
            onValueChange={(v) => cambiar(conElemento("nombre", { mostrar: v as ModoNombre }))}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODOS_NOMBRE.map((m) => (
                <SelectItem key={m.valor} value={m.valor}>
                  {m.texto}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <PosicionTexto el="nombre" />
    </>
  );
}

function SeccionTitulo() {
  const { plantilla, cambiar } = useEditor();
  const t = plantilla.cabecera.titulo;
  return (
    <>
      <CampoInterruptor
        etiqueta="Poner el título"
        valor={t.mostrar}
        onChange={(mostrar) => cambiar(conElemento("titulo", { mostrar }))}
      />
      <CampoTexto
        etiqueta="Texto"
        valor={t.texto}
        maximo={largo(LARGOS.cabecera.titulo.texto)}
        placeholder="PRESUPUESTO"
        onChange={(texto) => cambiar(conElemento("titulo", { texto }))}
      />
      <PosicionTexto el="titulo" />
    </>
  );
}

function SeccionDatos() {
  const { plantilla, cambiar } = useEditor();
  const d = plantilla.cabecera.datos;
  // Con la caja de los datos dentro del papel, como al arrastrarla.
  const { limites, anchoMax } = useMaquetaCabecera();
  const l = limites("datos");
  return (
    <>
      <CampoInterruptor
        etiqueta="Poner número, fecha y validez"
        valor={d.mostrar}
        onChange={(mostrar) => cambiar(conElemento("datos", { mostrar }))}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <CampoTexto
          etiqueta="Etiqueta del número"
          valor={d.etiquetaNumero}
          maximo={largo(LARGOS.cabecera.datos.etiquetaNumero)}
          onChange={(etiquetaNumero) => cambiar(conElemento("datos", { etiquetaNumero }))}
        />
        <CampoTexto
          etiqueta="Etiqueta de la fecha"
          valor={d.etiquetaFecha}
          maximo={largo(LARGOS.cabecera.datos.etiquetaFecha)}
          onChange={(etiquetaFecha) => cambiar(conElemento("datos", { etiquetaFecha }))}
        />
        <CampoTexto
          etiqueta="Etiqueta de la validez"
          valor={d.etiquetaValidez}
          maximo={largo(LARGOS.cabecera.datos.etiquetaValidez)}
          onChange={(etiquetaValidez) => cambiar(conElemento("datos", { etiquetaValidez }))}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CampoNumero
          etiqueta="X (desde)"
          valor={d.x}
          min={l.minX}
          max={l.maxX}
          onChange={(x) => cambiar(conElemento("datos", { x }))}
        />
        <CampoNumero
          etiqueta="Y (arriba)"
          valor={d.y}
          min={l.minY}
          max={l.maxY}
          onChange={(y) => cambiar(conElemento("datos", { y }))}
        />
        <CampoNumero
          etiqueta="Ancho"
          valor={d.ancho}
          min={MINIMOS.cabecera.datos.ancho}
          max={anchoMax("datos")}
          onChange={(ancho) => cambiar(conElemento("datos", { ancho }))}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Cada dato va en una pastilla con su etiqueta delante («Nº PRE-…»); la de la validez, en el
        color destacado. Van alineadas a la derecha entre X y X + ancho y, si no caben en una fila,
        siguen debajo. Con una etiqueta vacía, esa pastilla no sale.
      </p>
    </>
  );
}

function SeccionTextoLibre() {
  const { plantilla, cambiar } = useEditor();
  const t = plantilla.cabecera.texto;
  return (
    <>
      <CampoInterruptor
        etiqueta="Poner un antetítulo sobre el título"
        valor={t.mostrar}
        onChange={(mostrar) => cambiar(conElemento("texto", { mostrar }))}
      />
      <TextoConVariables
        etiqueta="Texto"
        valor={t.texto}
        maximo={largo(LARGOS.cabecera.texto.texto)}
        filas={2}
        placeholder="Presupuesto de impresión DTF"
        ayuda="Sale en mayúsculas espaciadas, en el color de acento, con una raya delante."
        onChange={(texto) => cambiar(conElemento("texto", { texto }))}
      />
      <PosicionTexto el="texto" />
    </>
  );
}

function SeccionCabecera() {
  const { plantilla, cambiar } = useEditor();
  const c = plantilla.cabecera;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CampoNumero
          etiqueta="Alto de la banda"
          valor={c.alto}
          min={MINIMOS.cabecera.alto}
          max={MAXIMOS.cabecera.alto}
          onChange={(alto) => cambiar(conCabecera({ alto }))}
        />
      </div>
      <CampoInterruptor
        etiqueta="Cinta de lemas bajo la banda"
        valor={c.cinta.mostrar}
        onChange={(mostrar) => cambiar(conCabecera({ cinta: { ...c.cinta, mostrar } }))}
      />
      <TextoConVariables
        etiqueta="Lemas"
        valor={c.cinta.texto}
        maximo={largo(LARGOS.cabecera.cinta.texto)}
        filas={4}
        disabled={!c.cinta.mostrar}
        ayuda="Uno por línea. Salen en mayúsculas, separados por estrellas, y se repiten hasta llenar la cinta."
        onChange={(texto) => cambiar(conCabecera({ cinta: { ...c.cinta, texto } }))}
      />
      <p className="text-xs text-muted-foreground">
        Medido desde el borde de arriba del papel. El cuerpo empieza 5 mm por debajo de la banda (o
        de la cinta); si algo de la cabecera baja más, el cuerpo empieza debajo de ello, así que
        nunca se pisan.
      </p>
    </>
  );
}

function SeccionColores() {
  const { plantilla, cambiar } = useEditor();
  const c = plantilla.colores;
  const heredado = coloresHeredados();
  return (
    <>
      <CampoColor
        etiqueta="Color principal"
        valor={c.principal}
        heredado={heredado.principal}
        nombreHeredado="el azul noche de la casa"
        ayuda="La banda de la cabecera y del pie, la cabecera de la tabla y los títulos. Si es muy claro, lo que va escrito encima sale en oscuro para que se lea."
        onChange={(principal) => cambiar(conGrupo("colores", { principal }))}
      />
      <CampoColor
        etiqueta="Color de acento"
        valor={c.acento}
        heredado={heredado.acento}
        nombreHeredado="el azul cielo de la casa"
        ayuda="La cinta de lemas, el antetítulo, la última palabra de los títulos y las marcas de las condiciones."
        onChange={(acento) => cambiar(conGrupo("colores", { acento }))}
      />
      <CampoColor
        etiqueta="Color destacado"
        valor={c.destacado}
        heredado={heredado.destacado}
        nombreHeredado="el naranja de la casa"
        ayuda="La caja del TOTAL, la pastilla de la validez y la raya del antetítulo."
        onChange={(destacado) => cambiar(conGrupo("colores", { destacado }))}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Cuerpo
// ---------------------------------------------------------------------------

function SeccionPartes() {
  const { plantilla, cambiar } = useEditor();
  const { emisorPrimero, emisor, cliente } = plantilla.partes;

  const camposEmisor: [keyof typeof emisor, string][] = [
    ["razonSocial", "Razón social"],
    ["cif", "CIF"],
    ["direccion", "Dirección"],
    ["email", "Correo"],
    ["telefono", "Teléfono"],
    ["web", "Web"],
  ];
  const camposCliente: [keyof typeof cliente, string][] = [
    ["empresa", "Empresa"],
    ["nif", "NIF / CIF"],
    ["direccion", "Dirección"],
    ["email", "Correo"],
    ["telefono", "Teléfono"],
  ];

  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Orden de las cajas</Label>
        <Select
          value={emisorPrimero ? "emisor" : "cliente"}
          onValueChange={(v) => cambiar(conPartes({ emisorPrimero: v === "emisor" }))}
        >
          <SelectTrigger className="h-8 sm:w-80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="emisor">Emisor a la izquierda, cliente a la derecha</SelectItem>
            <SelectItem value="cliente">Cliente a la izquierda, emisor a la derecha</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-xs font-medium text-muted-foreground">Emisor</legend>
          <CampoInterruptor
            etiqueta="Poner la caja del emisor"
            valor={emisor.mostrar}
            onChange={(mostrar) => cambiar(conPartes({ emisor: { mostrar } }))}
          />
          <CampoTexto
            etiqueta="Título de la caja"
            valor={emisor.titulo}
            maximo={largo(LARGOS.partes.emisor.titulo)}
            disabled={!emisor.mostrar}
            onChange={(titulo) => cambiar(conPartes({ emisor: { titulo } }))}
          />
          <div className="grid grid-cols-2 gap-2.5">
            {camposEmisor.map(([k, texto]) => (
              <CampoInterruptor
                key={k}
                etiqueta={texto}
                valor={emisor[k] as boolean}
                disabled={!emisor.mostrar}
                onChange={(v) =>
                  cambiar(conPartes({ emisor: { [k]: v } as Partial<typeof emisor> }))
                }
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-xs font-medium text-muted-foreground">Cliente</legend>
          <CampoInterruptor
            etiqueta="Poner la caja del cliente"
            valor={cliente.mostrar}
            onChange={(mostrar) => cambiar(conPartes({ cliente: { mostrar } }))}
          />
          <CampoTexto
            etiqueta="Título de la caja"
            valor={cliente.titulo}
            maximo={largo(LARGOS.partes.cliente.titulo)}
            disabled={!cliente.mostrar}
            onChange={(titulo) => cambiar(conPartes({ cliente: { titulo } }))}
          />
          <div className="grid grid-cols-2 gap-2.5">
            {camposCliente.map(([k, texto]) => (
              <CampoInterruptor
                key={k}
                etiqueta={texto}
                valor={cliente[k] as boolean}
                disabled={!cliente.mostrar}
                onChange={(v) =>
                  cambiar(conPartes({ cliente: { [k]: v } as Partial<typeof cliente> }))
                }
              />
            ))}
          </div>
        </fieldset>
      </div>
      <p className="text-xs text-muted-foreground">
        El nombre encabeza siempre cada caja. Un dato que el presupuesto no tenga no sale aunque
        esté marcado.
      </p>
    </>
  );
}

function SeccionTabla() {
  const { plantilla, cambiar } = useEditor();
  const t = plantilla.tabla;
  const tx =
    (k: "titulo" | "ref" | "descripcion" | "cantidad" | "precio" | "iva" | "importe") =>
    (v: string) =>
      cambiar(conGrupo("tabla", { [k]: v } as Partial<Plantilla["tabla"]>));
  return (
    <>
      <CampoTexto
        etiqueta="Título de la tabla"
        valor={t.titulo}
        maximo={largo(LARGOS.tabla.titulo)}
        ayuda="La última palabra sale en el color de acento. Vacío: sin título."
        onChange={tx("titulo")}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <CampoTexto
          etiqueta="Columna de la descripción"
          valor={t.descripcion}
          maximo={largo(LARGOS.tabla.descripcion)}
          onChange={tx("descripcion")}
        />
        <CampoTexto
          etiqueta="Columna del importe"
          valor={t.importe}
          maximo={largo(LARGOS.tabla.importe)}
          onChange={tx("importe")}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ["mostrarRef", "ref", "Referencia (01, 02…)"],
            ["mostrarCantidad", "cantidad", "Cantidad"],
            ["mostrarPrecio", "precio", "Precio unitario"],
            ["mostrarIva", "iva", "IVA"],
          ] as const
        ).map(([interruptor, k, nombre]) => (
          <div key={k} className="space-y-2 rounded-lg border p-3">
            <CampoInterruptor
              etiqueta={`Columna ${nombre}`}
              valor={t[interruptor]}
              onChange={(v) =>
                cambiar(conGrupo("tabla", { [interruptor]: v } as Partial<Plantilla["tabla"]>))
              }
            />
            <CampoTexto
              etiqueta="Título"
              valor={t[k]}
              maximo={largo(LARGOS.tabla[k])}
              disabled={!t[interruptor]}
              onChange={tx(k)}
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        La descripción y el importe salen siempre. Los importes de las líneas van sin IVA.
      </p>
    </>
  );
}

function SeccionResumen() {
  const { plantilla, cambiar } = useEditor();
  const r = plantilla.resumen;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <CampoTexto
          etiqueta="Base imponible"
          valor={r.base}
          maximo={largo(LARGOS.resumen.base)}
          onChange={(base) => cambiar(conGrupo("resumen", { base }))}
        />
        <CampoTexto
          etiqueta="IVA"
          valor={r.iva}
          maximo={largo(LARGOS.resumen.iva)}
          ayuda={`Va delante del tipo: «${r.iva || "IVA"} (21 %)».`}
          onChange={(iva) => cambiar(conGrupo("resumen", { iva }))}
        />
        <CampoTexto
          etiqueta="Total"
          valor={r.total}
          maximo={largo(LARGOS.resumen.total)}
          onChange={(total) => cambiar(conGrupo("resumen", { total }))}
        />
      </div>
      <CampoInterruptor
        etiqueta="Con una sola línea, poner el precio por unidad con IVA"
        ayuda="Debajo del TOTAL: «20 ud. × 8,00 € + IVA · 9,68 €/ud. IVA incluido»."
        valor={r.mostrarUnitario}
        onChange={(mostrarUnitario) => cambiar(conGrupo("resumen", { mostrarUnitario }))}
      />
      <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
        <CampoInterruptor
          etiqueta="Poner los metros totales"
          ayuda="Debajo del TOTAL. Solo salen si el presupuesto tiene líneas por metros."
          valor={r.mostrarMetros}
          onChange={(mostrarMetros) => cambiar(conGrupo("resumen", { mostrarMetros }))}
        />
        <CampoTexto
          etiqueta="Rótulo de los metros"
          valor={r.metros}
          maximo={largo(LARGOS.resumen.metros)}
          disabled={!r.mostrarMetros}
          onChange={(metros) => cambiar(conGrupo("resumen", { metros }))}
        />
      </div>
    </>
  );
}

/** Lo que va después de la tabla: cada sección en su sitio del modelo. */
const SECCIONES = [
  ["observaciones", "Observaciones", "A la izquierda del resumen; si son largas, debajo."],
  ["aceptacion", "Aceptación del cliente", "Debajo del TOTAL: dónde firmar y la fecha."],
  ["condiciones", "Condiciones", "Al final, a dos columnas."],
] as const;

function SeccionesFinales() {
  const { plantilla, cambiar } = useEditor();
  return (
    <ol className="space-y-3">
      {SECCIONES.map(([s, nombre, donde]) => {
        const mostrar = plantilla[s].mostrar;
        return (
          <li key={s} className={cn("space-y-3 rounded-lg border p-3", !mostrar && "bg-muted/30")}>
            <div>
              <p className="text-sm font-medium">{nombre}</p>
              <p className="text-xs text-muted-foreground">{donde}</p>
            </div>
            <CampoInterruptor
              etiqueta="Sale en el PDF"
              valor={mostrar}
              onChange={(v) => cambiar(conGrupo(s, { mostrar: v }))}
            />
            {s === "observaciones" && <CamposObservaciones />}
            {s === "condiciones" && <CamposCondiciones />}
            {s === "aceptacion" && <CamposAceptacion />}
          </li>
        );
      })}
    </ol>
  );
}

function CamposObservaciones() {
  const { plantilla, cambiar } = useEditor();
  const o = plantilla.observaciones;
  return (
    <CampoTexto
      etiqueta="Título"
      valor={o.titulo}
      maximo={largo(LARGOS.observaciones.titulo)}
      disabled={!o.mostrar}
      ayuda="El texto es el de las observaciones de cada presupuesto. Si no tiene, la sección no sale."
      onChange={(titulo) => cambiar(conGrupo("observaciones", { titulo }))}
    />
  );
}

function CamposCondiciones() {
  const { plantilla, cambiar } = useEditor();
  const c = plantilla.condiciones;
  return (
    <>
      <CampoTexto
        etiqueta="Título"
        valor={c.titulo}
        maximo={largo(LARGOS.condiciones.titulo)}
        disabled={!c.mostrar}
        onChange={(titulo) => cambiar(conGrupo("condiciones", { titulo }))}
      />
      <TextoConVariables
        etiqueta="Condiciones"
        valor={c.texto}
        maximo={largo(LARGOS.condiciones.texto)}
        filas={5}
        disabled={!c.mostrar}
        ayuda="Una condición por línea; cada una sale con una marca delante."
        onChange={(texto) => cambiar(conGrupo("condiciones", { texto }))}
      />
    </>
  );
}

function CamposAceptacion() {
  const { plantilla, cambiar } = useEditor();
  const a = plantilla.aceptacion;
  return (
    <>
      <CampoTexto
        etiqueta="Título"
        valor={a.titulo}
        maximo={largo(LARGOS.aceptacion.titulo)}
        disabled={!a.mostrar}
        onChange={(titulo) => cambiar(conGrupo("aceptacion", { titulo }))}
      />
      <TextoConVariables
        etiqueta="Texto"
        valor={a.texto}
        maximo={largo(LARGOS.aceptacion.texto)}
        filas={2}
        disabled={!a.mostrar}
        onChange={(texto) => cambiar(conGrupo("aceptacion", { texto }))}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <CampoTexto
          etiqueta="Rótulo de la fecha"
          ayuda="Vacío: sin caja para la fecha."
          valor={a.etiquetaFecha}
          maximo={largo(LARGOS.aceptacion.etiquetaFecha)}
          disabled={!a.mostrar}
          onChange={(etiquetaFecha) => cambiar(conGrupo("aceptacion", { etiquetaFecha }))}
        />
        <CampoTexto
          etiqueta="Rótulo de la firma"
          ayuda="Vacío: sin caja para la firma."
          valor={a.etiquetaFirma}
          maximo={largo(LARGOS.aceptacion.etiquetaFirma)}
          disabled={!a.mostrar}
          onChange={(etiquetaFirma) => cambiar(conGrupo("aceptacion", { etiquetaFirma }))}
        />
      </div>
    </>
  );
}

function SeccionPie() {
  const { plantilla, cambiar, valores } = useEditor();
  const pie = plantilla.pie;
  const lineas = pie.texto.split(/\r?\n/).filter((l) => l.trim() !== "").length;
  const rellenas = rellenarTexto(pie.texto, valores).length;
  return (
    <>
      <TextoConVariables
        etiqueta="A la izquierda, en grande"
        valor={pie.titulo}
        maximo={largo(LARGOS.pie.titulo)}
        filas={1}
        placeholder="{web}"
        ayuda="En mayúsculas y en el color de acento. Vacío: el texto ocupa toda la banda."
        onChange={(titulo) => cambiar(conGrupo("pie", { titulo }))}
      />
      <TextoConVariables
        etiqueta="Texto del pie"
        valor={pie.texto}
        maximo={largo(LARGOS.pie.texto)}
        filas={3}
        placeholder="WhatsApp {telefono} · {email} · {direccion}"
        ayuda={`El contacto o los datos fiscales, en cada página. Hasta ${RENGLONES_PIE} renglones; los largos se parten solos y, si no caben, la letra se hace más pequeña.`}
        onChange={(texto) => cambiar(conGrupo("pie", { texto }))}
      />
      {Math.max(lineas, rellenas) > RENGLONES_PIE && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Hay más de {RENGLONES_PIE} líneas: la letra del pie se hará más pequeña y, si aun así no
          caben, el pie subirá y le quitará sitio al cuerpo.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CampoAlineacion
          valor={pie.alineacion}
          onChange={(alineacion) => cambiar(conGrupo("pie", { alineacion }))}
        />
        <CampoNumero
          etiqueta="Tamaño"
          unidad="pt"
          valor={pie.tamano}
          min={MINIMOS.pie.tamano}
          max={MAXIMOS.pie.tamano}
          onChange={(tamano) => cambiar(conGrupo("pie", { tamano }))}
        />
      </div>
      <CampoInterruptor
        etiqueta="Número de página («Página 1 de 2») encima de la banda, si hay más de una"
        valor={pie.paginas}
        onChange={(paginas) => cambiar(conGrupo("pie", { paginas }))}
      />
      <PiePagina />
    </>
  );
}
