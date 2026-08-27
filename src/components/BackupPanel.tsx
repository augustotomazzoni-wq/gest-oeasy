import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tag } from "@/components/StatusBadge";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { friendlyError } from "@/lib/errors";
import { dropUndefined } from "@/lib/utils";
import { toast } from "sonner";

type BackupRow = {
  id: string;
  label: string;
  kind: string;
  counts: Record<string, number> | null;
  size_bytes: number;
  created_at: string;
  created_by_email: string | null;
};

/** "12/08/2026 14:32" a partir do timestamp do banco. */
function quando(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function tamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function totalRegistros(counts: Record<string, number> | null): number {
  return Object.values(counts ?? {}).reduce((s, n) => s + n, 0);
}

/**
 * Backup completo do escritório: gerar, baixar, restaurar e o histórico das
 * versões anteriores. Visível só para o Administrador.
 */
export function BackupPanel() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState("");
  const [restoreTarget, setRestoreTarget] = useState<{
    origem: string;
    payload: unknown;
  } | null>(null);
  const [confirmacao, setConfirmacao] = useState("");
  const [baixando, setBaixando] = useState<string | null>(null);

  const { data: backups, isLoading } = useQuery({
    queryKey: ["backups"],
    queryFn: async () => {
      // A lista não traz o payload: são só os metadados, para a tela abrir
      // rápido mesmo com muitas versões guardadas.
      const { data, error } = await supabase
        .from("backups")
        .select("id, label, kind, counts, size_bytes, created_at, created_by_email")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as BackupRow[];
    },
  });

  const gerar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc(
        "create_backup",
        dropUndefined({ _label: label.trim() || undefined, _kind: "manual" }),
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Backup gerado e guardado no histórico.");
      setLabel("");
      void qc.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (e: Error) => toast.error("Erro ao gerar backup", { description: friendlyError(e) }),
  });

  const apagar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("backups").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Versão removida do histórico.");
      void qc.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (e: Error) => toast.error("Erro ao remover", { description: friendlyError(e) }),
  });

  const restaurar = useMutation({
    mutationFn: async () => {
      if (!restoreTarget) throw new Error("Nenhum backup selecionado");
      const { error } = await supabase.rpc("restore_backup", {
        _payload: restoreTarget.payload as never,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Backup restaurado.");
      setRestoreTarget(null);
      setConfirmacao("");
      if (fileRef.current) fileRef.current.value = "";
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao restaurar", { description: friendlyError(e) }),
  });

  /** Baixa o backup como arquivo, para guardar fora do sistema. */
  async function baixar(row: BackupRow) {
    setBaixando(row.id);
    try {
      const { data, error } = await supabase
        .from("backups")
        .select("payload")
        .eq("id", row.id)
        .single();
      if (error) throw error;
      const blob = new Blob([JSON.stringify(data.payload, null, 1)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `backup_gestaoeasy_${row.created_at.slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Arquivo baixado.");
    } catch (e) {
      toast.error("Não foi possível baixar", { description: friendlyError(e) });
    } finally {
      setBaixando(null);
    }
  }

  /** Prepara a restauração a partir de um arquivo escolhido pelo usuário. */
  async function lerArquivo(file: File) {
    try {
      const payload = JSON.parse(await file.text());
      if (!payload || typeof payload !== "object" || !("tabelas" in payload)) {
        throw new Error("Este arquivo não é um backup do GestãoEasy.");
      }
      setRestoreTarget({ origem: file.name, payload });
      setConfirmacao("");
    } catch (e) {
      if (fileRef.current) fileRef.current.value = "";
      toast.error("Arquivo inválido", { description: (e as Error).message });
    }
  }

  /** Prepara a restauração a partir de uma versão já guardada. */
  async function restaurarDoHistorico(row: BackupRow) {
    try {
      const { data, error } = await supabase
        .from("backups")
        .select("payload")
        .eq("id", row.id)
        .single();
      if (error) throw error;
      setRestoreTarget({ origem: `${row.label} (${quando(row.created_at)})`, payload: data.payload });
      setConfirmacao("");
    } catch (e) {
      toast.error("Não foi possível abrir a versão", { description: friendlyError(e) });
    }
  }

  return (
    <div className="panel mt-6 p-4">
      <h2 className="font-display text-sm font-semibold">Backup do sistema</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Cópia completa de clientes, processos, acordos, parcelas, recebimentos, repasses e fluxo
        de caixa. Usuários e o histórico de auditoria ficam de fora: os logins pertencem ao serviço
        de acesso e o histórico nunca é sobrescrito.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="bkl">Nome desta versão (opcional)</Label>
          <Input
            id="bkl"
            className="w-72"
            placeholder="Ex.: antes de importar o Advbox"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <Button onClick={() => gerar.mutate()} disabled={gerar.isPending}>
          {gerar.isPending ? "Gerando…" : "Gerar backup agora"}
        </Button>
        <div className="space-y-2">
          <Label htmlFor="bkf">Restaurar de um arquivo</Label>
          <Input
            id="bkf"
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="w-72"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void lerArquivo(f);
            }}
          />
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
              <th className="p-3">Versão</th>
              <th>Quando</th>
              <th>Quem gerou</th>
              <th className="text-right">Registros</th>
              <th className="text-right">Tamanho</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  Carregando…
                </td>
              </tr>
            )}
            {!isLoading && (backups?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  Nenhum backup ainda. Gere o primeiro no botão acima.
                </td>
              </tr>
            )}
            {(backups ?? []).map((b) => (
              <tr key={b.id} className="border-b border-border/60 last:border-0">
                <td className="p-3">
                  <span className="font-medium">{b.label}</span>
                  {b.kind !== "manual" && (
                    <Tag tone="info">
                      {b.kind === "automatico" ? "automático" : b.kind}
                    </Tag>
                  )}
                </td>
                <td className="whitespace-nowrap">{quando(b.created_at)}</td>
                <td className="text-xs">{b.created_by_email ?? "—"}</td>
                <td className="num text-right">{totalRegistros(b.counts)}</td>
                <td className="num text-right">{tamanho(b.size_bytes)}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={baixando === b.id}
                    onClick={() => void baixar(b)}
                  >
                    {baixando === b.id ? "Baixando…" : "Baixar"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void restaurarDoHistorico(b)}>
                    Restaurar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => apagar.mutate(b.id)}
                  >
                    Remover
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Restaurar troca os dados atuais pelos do backup. Pede o nome escrito
          à mão de propósito: é a última barreira antes de uma ação grande. */}
      <AlertDialog
        open={!!restoreTarget}
        onOpenChange={(v) => {
          if (!v) {
            setRestoreTarget(null);
            setConfirmacao("");
            if (fileRef.current) fileRef.current.value = "";
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restaurar este backup?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Origem: <strong>{restoreTarget?.origem}</strong>
                </p>
                <p>
                  Os dados de hoje serão substituídos pelos do backup. Antes disso, o sistema grava
                  sozinho uma versão do estado atual no histórico — se você restaurar a versão
                  errada, dá para voltar.
                </p>
                <p>Para confirmar, escreva RESTAURAR no campo abaixo.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            placeholder="RESTAURAR"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={confirmacao.trim().toUpperCase() !== "RESTAURAR" || restaurar.isPending}
              onClick={() => restaurar.mutate()}
            >
              {restaurar.isPending ? "Restaurando…" : "Restaurar agora"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
