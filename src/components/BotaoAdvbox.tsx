import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { atualizarDaAdvbox } from "@/lib/advbox.functions";
import { friendlyError } from "@/lib/errors";
import { toast } from "sonner";

type Props = {
  tipo: "clientes" | "processos";
  /** Chaves de consulta a recarregar depois que a atualização termina. */
  recarregar: string[];
};

/**
 * O botão que traz o cadastro da Advbox.
 *
 * Nada é puxado sozinho: a atualização acontece só quando esse botão é
 * apertado. A confirmação existe porque isso mexe no cadastro inteiro, e
 * numa base grande demora — melhor a pessoa saber antes de começar.
 */
export function BotaoAdvbox({ tipo, recarregar }: Props) {
  const qc = useQueryClient();
  const [confirmando, setConfirmando] = useState(false);
  const atualizar = useServerFn(atualizarDaAdvbox);

  const rodar = useMutation({
    mutationFn: () => atualizar({ data: { tipo } }),
    onSuccess: (r) => {
      setConfirmando(false);
      for (const chave of recarregar) void qc.invalidateQueries({ queryKey: [chave] });

      const partes = [
        `${r.criados} cadastrado(s)`,
        `${r.atualizados} atualizado(s)`,
        ...(r.clientesCriados ? [`${r.clientesCriados} cliente(s) novo(s)`] : []),
      ];
      toast.success(`${r.lidosDaAdvbox} registro(s) lidos da Advbox`, {
        description: partes.join(", ") + ".",
      });

      // Linha que a Advbox devolveu torta não derruba a atualização inteira,
      // mas quem apertou o botão precisa ficar sabendo.
      if (r.avisos.length) {
        toast.warning(`${r.avisos.length} registro(s) ficaram de fora`, {
          description: r.avisos.slice(0, 3).join(" "),
          duration: 12_000,
        });
      }
    },
    onError: (e: Error) =>
      toast.error("Não foi possível atualizar pela Advbox", { description: friendlyError(e) }),
  });

  return (
    <>
      <Button variant="outline" onClick={() => setConfirmando(true)} disabled={rodar.isPending}>
        {rodar.isPending ? "Atualizando…" : "Atualizar da Advbox"}
      </Button>

      <AlertDialog open={confirmando} onOpenChange={(v) => !rodar.isPending && setConfirmando(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Buscar {tipo} na Advbox agora?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Cada {tipo === "clientes" ? "cliente" : "processo"} que já existe aqui é
                  completado com o que estiver preenchido lá, e o que estiver vazio na Advbox não
                  apaga o que você digitou aqui dentro.
                </p>
                <p>
                  {tipo === "clientes"
                    ? "Quem estiver só na Advbox entra como cliente novo."
                    : "Processo que estiver só na Advbox entra novo, e o cliente dele é cadastrado se ainda não existir."}
                </p>
                <p className="text-xs">
                  Com a base inteira isso leva alguns segundos. Não feche a tela enquanto roda.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rodar.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={rodar.isPending}
              onClick={(e) => {
                e.preventDefault();
                rodar.mutate();
              }}
            >
              {rodar.isPending ? "Atualizando…" : "Atualizar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
