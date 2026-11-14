import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tag } from "@/components/StatusBadge";
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
import {
  ligarDesligarAdvbox,
  removerTokenAdvbox,
  salvarTokenAdvbox,
  statusAdvbox,
} from "@/lib/advbox.functions";
import { friendlyError } from "@/lib/errors";
import { toast } from "sonner";

/** "12/08/2026 14:32" a partir do timestamp do banco. */
function quando(iso: string | null): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Configuração da integração com a Advbox. Só o Administrador vê.
 *
 * O token é escrito aqui e vai direto para o servidor; depois de salvo
 * ninguém o lê de volta, nem nesta tela — ficam só os quatro últimos
 * caracteres, para reconhecer qual está valendo.
 */
export function AdvboxPanel() {
  const qc = useQueryClient();
  const [token, setToken] = useState("");
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false);

  const buscarStatus = useServerFn(statusAdvbox);
  const salvar = useServerFn(salvarTokenAdvbox);
  const alternar = useServerFn(ligarDesligarAdvbox);
  const remover = useServerFn(removerTokenAdvbox);

  const { data: status, isLoading } = useQuery({
    queryKey: ["advbox-status"],
    queryFn: () => buscarStatus({}),
  });

  const recarregar = () => void qc.invalidateQueries({ queryKey: ["advbox-status"] });

  const salvarToken = useMutation({
    mutationFn: async () => {
      await salvar({ data: { token: token.trim() } });
    },
    onSuccess: () => {
      toast.success("Token guardado e testado com a Advbox.");
      setToken("");
      recarregar();
    },
    onError: (e: Error) =>
      toast.error("Não foi possível guardar o token", { description: friendlyError(e) }),
  });

  const ligarDesligar = useMutation({
    mutationFn: async (ativo: boolean) => {
      await alternar({ data: { ativo } });
    },
    onSuccess: () => {
      toast.success("Integração atualizada.");
      recarregar();
    },
    onError: (e: Error) => toast.error("Não foi possível mudar", { description: friendlyError(e) }),
  });

  const apagar = useMutation({
    mutationFn: async () => {
      await remover({});
    },
    onSuccess: () => {
      toast.success("Token apagado.");
      setConfirmandoRemocao(false);
      recarregar();
    },
    onError: (e: Error) =>
      toast.error("Não foi possível apagar", { description: friendlyError(e) }),
  });

  return (
    <div className="panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
        <div>
          <h2 className="font-display text-sm font-semibold">Advbox</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Traz clientes e processos da Advbox quando você pedir, nas telas de Clientes e
            Processos.
          </p>
        </div>
        {status?.configurado && (
          <Tag tone={status.ativo ? "success" : "neutral"}>
            {status.ativo ? "Ligada" : "Desligada"}
          </Tag>
        )}
      </div>

      <div className="space-y-4 p-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <>
            {status?.configurado ? (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                <p>
                  Token guardado, terminado em{" "}
                  <span className="font-mono font-medium">…{status.tokenDica}</span>.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Última atualização: {quando(status.ultimaSincronizacao)}
                  {status.ultimoResultado ? ` — ${status.ultimoResultado}` : ""}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhum token cadastrado. Gere um em Configurações → API na Advbox e cole abaixo.
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="advbox-token">
                {status?.configurado ? "Trocar o token" : "Token da Advbox"}
              </Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="advbox-token"
                  type="password"
                  autoComplete="off"
                  placeholder="Cole aqui o token gerado na Advbox"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="min-w-[16rem] flex-1"
                />
                <Button
                  onClick={() => salvarToken.mutate()}
                  disabled={token.trim().length < 20 || salvarToken.isPending}
                >
                  {salvarToken.isPending ? "Testando…" : "Salvar"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                O token fica guardado no servidor e não volta mais para a tela. Se alguém de fora
                vir esse valor, gere outro na Advbox e cole o novo aqui.
              </p>
            </div>

            {status?.configurado && (
              <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => ligarDesligar.mutate(!status.ativo)}
                  disabled={ligarDesligar.isPending}
                >
                  {status.ativo ? "Desligar integração" : "Ligar integração"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => setConfirmandoRemocao(true)}
                >
                  Apagar token
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <AlertDialog open={confirmandoRemocao} onOpenChange={setConfirmandoRemocao}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar o token da Advbox?</AlertDialogTitle>
            <AlertDialogDescription>
              Os botões de atualizar param de funcionar até você cadastrar outro token. Os clientes
              e processos já trazidos continuam aqui.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                apagar.mutate();
              }}
            >
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
