import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { friendlyError } from "@/lib/errors";
import { money } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/auditoria")({
  head: () => ({
    meta: [
      { title: "Auditoria | Gestão Financeira do Escritório" },
      {
        name: "description",
        content: "Registro de quem fez o quê no sistema: baixas, estornos, exclusões e edições.",
      },
    ],
  }),
  component: AuditoriaPage,
});

/**
 * O sistema grava cada ação importante (quem deu baixa, quem estornou, quem
 * apagou), mas não havia onde consultar: o registro existia só dentro do
 * banco. Esta tela é a leitura dele, para o Administrador.
 */

const POR_VEZ = 50;

const ACAO: Record<string, string> = {
  registrar_recebimento: "Registrou recebimento",
  estornar_recebimento: "Estornou recebimento",
  criar_repasse: "Criou repasse",
  repasse_pago: "Marcou repasse como pago",
  editar_repasse: "Editou repasse",
  cancelar_repasse: "Cancelou repasse",
  repasse_do_recebimento: "Criou repasse a partir da baixa",
  editar_acordo: "Editou acordo",
  cancelar_acordo: "Cancelou acordo",
  excluir_acordo: "Excluiu acordo",
  apagar_acordo_cancelado: "Apagou acordo cancelado",
  editar_parcela: "Editou parcela",
  editar_parcela_paga: "Editou parcela já paga",
  cancelar_parcela: "Cancelou parcela",
  apagar_parcela_cancelada: "Apagou parcela cancelada",
  mover_saldo_da_parcela: "Moveu saldo da parcela",
  criar_cliente: "Cadastrou cliente",
  editar_cliente: "Editou cliente",
  excluir_cliente: "Excluiu cliente",
  editar_lancamento: "Editou lançamento do caixa",
  excluir_lancamento: "Excluiu lançamento do caixa",
  apagar_recorrencia: "Apagou série recorrente",
  cadastrar_emprestimo: "Cadastrou empréstimo",
  apagar_emprestimo: "Apagou empréstimo",
  excluir_conta: "Excluiu conta bancária",
  excluir_categoria: "Excluiu categoria",
  importar_planilha: "Importou planilha",
  importar_financeiro: "Importou financeiro",
  sincronizar_advbox_clientes: "Atualizou clientes pela Advbox",
  sincronizar_advbox_processos: "Atualizou processos pela Advbox",
};

const ONDE: Record<string, string> = {
  receipts: "Recebimentos",
  installments: "Parcelas",
  legal_receivables: "Acordos",
  client_transfers: "Repasses",
  financial_transactions: "Fluxo de caixa",
  loans: "Empréstimos",
  clients: "Clientes",
  cases: "Processos",
  bank_accounts: "Contas bancárias",
  categories: "Categorias",
  profiles: "Usuários",
};

/** "editar_parcela" -> "Editar parcela", para ação que não está na lista. */
const legivel = (v: string) => {
  const t = v.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function quando(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** Chaves que são dinheiro, para aparecerem como R$ e não como número solto. */
const EH_DINHEIRO = /valor|amount|total|saldo|entrada/i;

/** O que mudou, em linguagem de gente: "valor: R$ 500,00 · parcela: 2". */
function detalhes(valores: unknown): string {
  if (!valores || typeof valores !== "object") return "";
  return Object.entries(valores as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== "" && typeof v !== "object")
    .slice(0, 6)
    .map(([k, v]) => {
      const rotulo = k.replace(/_/g, " ");
      const texto = typeof v === "number" && EH_DINHEIRO.test(k) ? money(v) : String(v);
      return `${rotulo}: ${texto.length > 60 ? `${texto.slice(0, 60)}…` : texto}`;
    })
    .join(" · ");
}

function AuditoriaPage() {
  const { isAdmin } = useAuth();
  const [busca, setBusca] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [limite, setLimite] = useState(POR_VEZ);
  useEffect(() => setLimite(POR_VEZ), [busca, de, ate]);

  // Vírgula, parêntese e % têm significado no filtro do banco: saem do termo.
  const termo = busca.replace(/[,()%*]/g, " ").trim();

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["auditoria", termo, de, ate, limite],
    enabled: isAdmin,
    queryFn: async () => {
      let consulta = supabase
        .from("audit_logs")
        .select("id, created_at, user_email, action, table_name, new_values, old_values", {
          count: "exact",
        })
        .order("created_at", { ascending: false })
        .range(0, limite - 1);
      if (termo) {
        consulta = consulta.or(
          `user_email.ilike.%${termo}%,action.ilike.%${termo}%,table_name.ilike.%${termo}%`,
        );
      }
      if (de) consulta = consulta.gte("created_at", `${de}T00:00:00`);
      if (ate) consulta = consulta.lte("created_at", `${ate}T23:59:59`);
      const { data: linhas, error: erro, count } = await consulta;
      if (erro) throw erro;
      return { linhas: linhas ?? [], total: count ?? 0 };
    },
  });

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Auditoria" />
        <div className="panel p-6 text-sm text-muted-foreground">
          Só o Administrador Principal consulta o registro de ações.
        </div>
      </>
    );
  }

  const linhas = data?.linhas ?? [];
  const total = data?.total ?? 0;

  return (
    <>
      <PageHeader
        title="Auditoria"
        description="Quem fez o quê, e quando: baixas, estornos, edições e exclusões."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="Buscar por e-mail ou ação…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <Input
          type="date"
          className="w-40"
          aria-label="A partir de"
          value={de}
          onChange={(e) => setDe(e.target.value)}
        />
        <span className="text-sm text-muted-foreground">até</span>
        <Input
          type="date"
          className="w-40"
          aria-label="Até"
          value={ate}
          onChange={(e) => setAte(e.target.value)}
        />
        {(busca || de || ate) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setBusca("");
              setDe("");
              setAte("");
            }}
          >
            Limpar
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {isLoading ? "Carregando…" : `${linhas.length} de ${total} registro(s)`}
        </span>
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Não foi possível carregar a auditoria: {friendlyError(error)}
        </p>
      )}

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
              <th className="p-3">Quando</th>
              <th>Quem</th>
              <th>O que fez</th>
              <th>Onde</th>
              <th className="p-3">Detalhes</th>
            </tr>
          </thead>
          <tbody>
            {!isLoading && linhas.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  Nenhum registro para esse filtro.
                </td>
              </tr>
            )}
            {linhas.map((l) => (
              <tr key={l.id} className="border-b border-border/60 align-top last:border-0">
                <td className="num p-3 whitespace-nowrap">{quando(l.created_at)}</td>
                <td className="py-3 pr-3">{l.user_email ?? "—"}</td>
                <td className="py-3 pr-3 font-medium">{ACAO[l.action] ?? legivel(l.action)}</td>
                <td className="py-3 pr-3">
                  {l.table_name ? (ONDE[l.table_name] ?? l.table_name) : "—"}
                </td>
                <td className="p-3 text-xs text-muted-foreground">
                  {detalhes(l.new_values) || detalhes(l.old_values) || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {linhas.length < total && (
        <div className="mt-3 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={isFetching}
            onClick={() => setLimite((n) => n + POR_VEZ)}
          >
            {isFetching ? "Carregando…" : "Mostrar mais 50"}
          </Button>
        </div>
      )}
    </>
  );
}
