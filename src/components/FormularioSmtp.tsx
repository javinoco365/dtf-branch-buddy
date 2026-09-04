import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Mail, Send } from "lucide-react";
import { toast } from "sonner";
import { estadoSmtp, guardarSmtp, probarSmtp } from "@/lib/smtp.functions";

/**
 * El formulario del servidor de correo.
 *
 * Se usa tal cual para la configuración general (`tiendaId` a null) y para la
 * de una tienda. La contraseña NUNCA se rellena con la guardada: la pantalla no
 * la conoce, y dejarla vacía significa «no la cambies».
 */
export function FormularioSmtp({ tiendaId }: { tiendaId: string | null }) {
  const qc = useQueryClient();
  const estadoFn = useServerFn(estadoSmtp);
  const guardarFn = useServerFn(guardarSmtp);
  const probarFn = useServerFn(probarSmtp);

  const { data, isLoading } = useQuery({
    queryKey: ["smtp-estado", tiendaId ?? "general"],
    queryFn: () => estadoFn({ data: { tienda_id: tiendaId } }),
  });
  const estado = (data as any)?.estado ?? null;

  const [host, setHost] = useState("");
  const [puerto, setPuerto] = useState(465);
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [destinatario, setDestinatario] = useState("");

  // Solo se rellena con lo que ya está guardado si es del ámbito que se edita:
  // si esta tienda usa la general, los campos salen vacíos para no dar a
  // entender que tiene configuración propia.
  const propia = estado && (tiendaId === null || estado.ambito === "tienda");
  useEffect(() => {
    if (propia) {
      setHost(estado.host ?? "");
      setPuerto(Number(estado.puerto) || 465);
      setUsuario(estado.usuario ?? "");
    }
  }, [propia, estado]);

  const guardar = useMutation({
    mutationFn: () => guardarFn({ data: { tienda_id: tiendaId, host, puerto, usuario, clave } }),
    onSuccess: () => {
      toast.success("Servidor de correo guardado");
      setClave("");
      qc.invalidateQueries({ queryKey: ["smtp-estado"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo guardar"),
  });

  const probar = useMutation({
    mutationFn: () => probarFn({ data: { tienda_id: tiendaId, destinatario } }),
    onSuccess: (r: any) => {
      if (r?.ok) toast.success(`Correo de prueba enviado a ${destinatario}`);
      else toast.error(r?.error ?? "No se pudo enviar");
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo enviar"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4" />
          {tiendaId ? "Servidor propio de esta tienda" : "Servidor de correo"}
        </CardTitle>
        <CardDescription>
          Para Resend: host <span className="font-mono">smtp.resend.com</span>, puerto{" "}
          <span className="font-mono">465</span>, usuario <span className="font-mono">resend</span>{" "}
          y la clave de API como contraseña.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
              <div className="space-y-1.5">
                <Label>Host</Label>
                <Input
                  value={host}
                  placeholder="smtp.resend.com"
                  onChange={(e) => setHost(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Puerto</Label>
                <Input
                  type="number"
                  value={puerto}
                  onChange={(e) => setPuerto(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Usuario</Label>
              <Input
                value={usuario}
                placeholder="resend"
                autoComplete="off"
                onChange={(e) => setUsuario(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Contraseña</Label>
              <Input
                type="password"
                value={clave}
                autoComplete="new-password"
                placeholder={
                  propia?.tiene_clave ? "Guardada. Déjala vacía para no cambiarla" : "Clave de API"
                }
                onChange={(e) => setClave(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Se guarda cifrada en Vault y no vuelve a salir de ahí. Ni esta pantalla puede
                leerla.
              </p>
            </div>

            <div className="flex justify-end pt-1">
              <Button
                onClick={() => guardar.mutate()}
                disabled={guardar.isPending || !host.trim() || !usuario.trim()}
              >
                {guardar.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Guardar
              </Button>
            </div>

            <div className="border-t pt-4 space-y-2">
              <Label>Mandar un correo de prueba</Label>
              <p className="text-xs text-muted-foreground">
                Una configuración mal puesta no da la cara hasta que un cliente se queda sin su
                aviso. Compruébalo ahora.
              </p>
              <div className="flex gap-2">
                <Input
                  type="email"
                  value={destinatario}
                  placeholder="tu@correo.com"
                  onChange={(e) => setDestinatario(e.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={() => probar.mutate()}
                  disabled={probar.isPending || !destinatario.includes("@")}
                >
                  {probar.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  Enviar
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
