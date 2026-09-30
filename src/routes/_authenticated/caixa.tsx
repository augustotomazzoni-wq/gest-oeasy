import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/AppLayout";
import { Tag } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { PeriodFilter } from "@/components/PeriodFilter";
import {
  monthLabel,
  periodLabel,
  periodRange,
  startOfPeriodAnchor,
  type PeriodType,
} from "@/lib/period";
import {
  money,
  num,
  dateBR,
  todayISO,
  addMonthsISO,
  TX_TYPE_LABEL,
  TX_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS_IN,
  PAYMENT_METHODS_OUT,
} from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { downloadXlsx } from "@/lib/export-xlsx";
import { dropUndefined } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/caixa")({
  head: () => ({
    meta: [
      { title: "Fluxo de Caixa | Gestão Financeira do Escritório" },
      {
        name: "description",
        content:
          "Livro-caixa do escritório com entradas, saídas, contas a pagar, valores de terceiros e saldo por conta bancária.",
      },
      { property: "og:title", content: "Fluxo de caixa" },
      {
        property: "og:description",
        content: "Movimentações financeiras, contas a pagar e saldos das contas do escritório.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CaixaPage,
});

const EMPTY = {
  type: "saida",
  description: "",
  amount: "",
  /** "pago" = já saiu/entrou; "previsto" = agendado, ainda não pago. */
  situacao: "pago",
  /** Data do pagamento (quando já pago) ou do vencimento (quando previsto). */
  date: todayISO(),
  payment_method: "",
  bank_account_id: "",
  category_id: "",
  notes: "",
  /** Recorrência: repete o mesmo lançamento nos meses seguintes. */
  repeat: false,
  repeat_months: "12",
};

const THIRD_PARTY = new Set(["entrada_de_terceiros", "repasse_de_terceiros"]);

/**
 * As duas pernas de uma transferência entre contas do próprio escritório.
 * Elas são `saida` e `entrada` para o saldo das contas se mexer, mas não são
 * receita nem despesa: o dinheiro só trocou de lugar.
 */
const TRANSFER_OUT = "transfer_out";
const TRANSFER_IN = "transfer_in";

const EMPTY_TRANSFER = { from: "", to: "", amount: "", date: "", notes: "" };
const isTransfer = (t: { source_type: string | null }) =>
  t.source_type === TRANSFER_OUT || t.source_type === TRANSFER_IN;

type TxRow = {
  id: string;
  type: string;
  status: string;
  description: string;
  amount: number;
  paid_on: string | null;
  due_date: string | null;
  payment_method: string | null;
  category_id: string | null;
  bank_account_id: string | null;
  notes: string | null;
  recurrence_group_id: string | null;
  recurrence_index: number | null;
  recurrence_total: number | null;
  source_type: string | null;
  /** Nas transferências entre contas é o id que liga a saída à entrada. */
  source_id: string | null;
  is_financing: boolean | null;
  bank_accounts: { name: string } | null;
  categories: { name: string } | null;
  /** Preenchido nos lançamentos que nasceram de uma baixa ou de um repasse. */
  clients: { name: string } | null;
};

/** A data que vale para o lançamento: pagamento quando pago, vencimento quando previsto. */
function refDate(t: { status: string; paid_on: string | null; due_date: string | null }) {
  return (t.status === "pago" ? t.paid_on : t.due_date) ?? t.paid_on ?? t.due_date ?? "";
}

function CaixaPage() {
  const { profile, canWrite, roles, can } = useAuth();
  // O Lançador Financeiro também pode registrar entradas e saídas de caixa.
  const canLaunch = canWrite || roles.includes("lancador");
  const canExport = can("caixa", "export");
  const canEdit = can("caixa", "edit");
  const canDelete = can("caixa", "delete");
  const qc = useQueryClient();

  const today = todayISO();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TxRow | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [periodType, setPeriodType] = useState<PeriodType>("mes");
  const [anchor, setAnchor] = useState(today);
  const [customStart, setCustomStart] = useState(today.slice(0, 8) + "01");
  const [customEnd, setCustomEnd] = useState(today);
  const [view, setView] = useState<"todos" | "pago" | "previsto">("todos");
  // Filtro de tipo, que se combina com o de situação acima: dá para ver "só
  // despesas ainda a pagar" marcando um de cada.
  const [kind, setKind] = useState<"todos" | "receitas" | "despesas">("todos");
  const [payTarget, setPayTarget] = useState<TxRow | null>(null);
  const [payDate, setPayDate] = useState(today);
  const [deleteTarget, setDeleteTarget] = useState<TxRow | null>(null);
  // Transferência entre contas tem formulário próprio: são duas contas e nenhuma
  // categoria, nada a ver com o de receita e despesa.
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferEditing, setTransferEditing] = useState<string | null>(null);
  const [transfer, setTransfer] = useState({ ...EMPTY_TRANSFER, date: today });

  const custom = { start: customStart, end: customEnd };
  const { start, end } = periodRange(periodType, anchor, custom);
  // A competência continua sempre à vista, qualquer que seja o recorte
  // escolhido — é a referência que o escritório usa para fechar o mês.
  const competencia = monthLabel(startOfPeriodAnchor(periodType, anchor, custom));

  const { data, isLoading } = useQuery({
    queryKey: ["caixa", start, end],
    queryFn: async () => {
      // Pago entra pela data em que o dinheiro andou; previsto entra pelo
      // vencimento — senão conta a pagar nenhuma apareceria (ela não tem
      // data de pagamento ainda).
      const [pagas, previstas, banks, cats, balances] = await Promise.all([
        supabase
          .from("financial_transactions")
          .select("*, bank_accounts(name), categories(name), clients(name)")
          .eq("status", "pago")
          .gte("paid_on", start)
          .lte("paid_on", end)
          .order("paid_on", { ascending: false }),
        supabase
          .from("financial_transactions")
          .select("*, bank_accounts(name), categories(name), clients(name)")
          .eq("status", "previsto")
          .gte("due_date", start)
          .lte("due_date", end)
          .order("due_date", { ascending: true }),
        supabase.from("bank_accounts").select("id, name").eq("active", true).order("name"),
        supabase.from("categories").select("id, name, type").eq("active", true).order("name"),
        supabase.from("v_bank_balances").select("*"),
      ]);
      if (pagas.error) throw pagas.error;
      if (previstas.error) throw previstas.error;
      return {
        transactions: [
          ...((pagas.data ?? []) as unknown as TxRow[]),
          ...((previstas.data ?? []) as unknown as TxRow[]),
        ],
        banks: banks.data ?? [],
        categories: cats.data ?? [],
        balances: (balances.data ?? []) as unknown as {
          bank_account_id: string;
          name: string;
          balance: number;
        }[],
      };
    },
  });

  const rows = useMemo(() => {
    const all = data?.transactions ?? [];
    const porSituacao =
      view === "todos"
        ? all
        : all.filter((t) => (view === "pago" ? t.status === "pago" : t.status !== "pago"));
    // Receita é tudo que entrou, despesa é tudo que saiu — empréstimo incluído,
    // para nenhuma linha do caixa sumir quando se filtra. Os cards acima é que
    // deixam o empréstimo de fora, porque ali a pergunta é o resultado.
    const filtered =
      kind === "todos"
        ? porSituacao
        : porSituacao.filter(
            (t) =>
              !isTransfer(t) && (kind === "receitas" ? t.type === "entrada" : t.type === "saida"),
          );
    return [...filtered].sort((a, b) => refDate(b).localeCompare(refDate(a)));
  }, [data, view, kind]);

  const totals = useMemo(() => {
    const t = {
      in: 0,
      out: 0,
      thirdIn: 0,
      thirdOut: 0,
      aPagar: 0,
      aReceber: 0,
      finIn: 0,
      finOut: 0,
      transferido: 0,
    };
    for (const r of data?.transactions ?? []) {
      const v = num(r.amount);
      // Transferência entre contas do escritório: o dinheiro só mudou de
      // lugar. Somar a entrada como receita e a saída como despesa criaria um
      // faturamento e um custo que nunca existiram — e o resultado do período
      // ficaria igual, mas por cima de dois números inventados. Conta uma
      // ponta só, para o card mostrar quanto foi movido.
      if (isTransfer(r)) {
        if (r.source_type === TRANSFER_OUT) t.transferido += v;
        continue;
      }
      if (r.status !== "pago") {
        if (r.type === "saida") t.aPagar += v;
        else if (r.type === "entrada") t.aReceber += v;
        continue;
      }
      // Empréstimo entra e sai do caixa, mas não é receita nem despesa da
      // operação: fica numa linha só dele para não sujar o resultado do mês.
      if (r.is_financing) {
        if (r.type === "entrada") t.finIn += v;
        else if (r.type === "saida") t.finOut += v;
      } else if (r.type === "entrada") t.in += v;
      else if (r.type === "saida") t.out += v;
      else if (r.type === "entrada_de_terceiros") t.thirdIn += v;
      else if (r.type === "repasse_de_terceiros") t.thirdOut += v;
    }
    return t;
  }, [data]);

  /** Validação comum a criar e editar. */
  function validate() {
    if (!form.description.trim()) throw new Error("Informe a descrição");
    const amount = num(Number(form.amount));
    if (amount <= 0) throw new Error("Informe um valor válido");
    // Conta bancária só é obrigatória no que já foi pago: uma conta agendada
    // pode nem ter a conta definida ainda.
    if (form.situacao === "pago" && !form.bank_account_id)
      throw new Error("Selecione a conta bancária");
    if (!form.date) throw new Error("Informe a data");
    return amount;
  }

  const create = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Perfil não carregado");
      const amount = validate();

      const months = form.repeat ? Math.trunc(Number(form.repeat_months)) : 1;
      if (form.repeat && (!Number.isFinite(months) || months < 2 || months > 120))
        throw new Error("A recorrência precisa ser de 2 a 120 meses");

      const groupId = form.repeat ? crypto.randomUUID() : null;
      const isPaid = form.situacao === "pago";

      const linhas = Array.from({ length: months }, (_, i) => {
        const data = addMonthsISO(form.date, i);
        return {
          organization_id: profile.organization_id,
          created_by: profile.id,
          type: form.type as never,
          // Só o primeiro mês pode nascer pago; os seguintes são sempre
          // previstos — ninguém paga em agosto a conta de dezembro.
          status: (isPaid && i === 0 ? "pago" : "previsto") as never,
          description: form.description.trim(),
          amount,
          paid_on: isPaid && i === 0 ? data : null,
          due_date: data,
          competence_date: data,
          payment_method: form.payment_method || null,
          bank_account_id: form.bank_account_id || null,
          category_id: form.category_id || null,
          notes: form.notes.trim() || null,
          recurrence_group_id: groupId,
          recurrence_index: groupId ? i + 1 : null,
          recurrence_total: groupId ? months : null,
        };
      });

      const { error } = await supabase.from("financial_transactions").insert(linhas as never);
      if (error) throw error;
      return linhas.length;
    },
    onSuccess: (qtd) => {
      toast.success(qtd > 1 ? `${qtd} lançamentos criados.` : "Lançamento registrado.");
      closeForm();
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: friendlyError(e) }),
  });

  const update = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error("Lançamento inválido");
      const amount = validate();
      const { error } = await supabase.rpc(
        "update_manual_transaction",
        dropUndefined({
          _id: editing.id,
          _type: form.type,
          _description: form.description.trim(),
          _amount: amount,
          _status: form.situacao,
          _date: form.date,
          _payment_method: form.payment_method || undefined,
          _bank_account_id: form.bank_account_id || undefined,
          _category_id: form.category_id || undefined,
          _notes: form.notes.trim() || undefined,
        }),
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lançamento atualizado.");
      closeForm();
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: friendlyError(e) }),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!deleteTarget) throw new Error("Lançamento inválido");
      const { error } = await supabase.rpc("delete_manual_transaction", { _id: deleteTarget.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lançamento excluído.");
      setDeleteTarget(null);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao excluir", { description: friendlyError(e) }),
  });

  const markPaid = useMutation({
    mutationFn: async () => {
      if (!payTarget) throw new Error("Lançamento inválido");
      if (!payDate) throw new Error("Informe a data do pagamento");
      const { error } = await supabase
        .from("financial_transactions")
        .update({ status: "pago" as never, paid_on: payDate })
        .eq("id", payTarget.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Baixa registrada.");
      setPayTarget(null);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao dar baixa", { description: friendlyError(e) }),
  });

  const removeSeries = useMutation({
    mutationFn: async (groupId: string) => {
      const { data: removed, error } = await supabase.rpc("delete_recurrence_series", {
        _group_id: groupId,
      });
      if (error) throw error;
      return removed as unknown as number;
    },
    onSuccess: (qtd) => {
      toast.success(`${qtd} lançamento(s) futuro(s) apagado(s). Os já pagos foram mantidos.`);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao apagar", { description: friendlyError(e) }),
  });

  const salvarTransferencia = useMutation({
    mutationFn: async () => {
      const valor = num(Number(transfer.amount));
      if (!transfer.from) throw new Error("Escolha a conta de origem");
      if (!transfer.to) throw new Error("Escolha a conta de destino");
      if (transfer.from === transfer.to)
        throw new Error("A origem e o destino são a mesma conta");
      if (valor <= 0) throw new Error("Informe um valor maior que zero");
      if (!transfer.date) throw new Error("Informe a data da transferência");

      // Corrigir mexe nas duas pernas de uma vez; criar grava as duas.
      if (transferEditing) {
        const { error } = await supabase.rpc(
          "update_account_transfer",
          dropUndefined({
            _group_id: transferEditing,
            _from_account: transfer.from,
            _to_account: transfer.to,
            _amount: valor,
            _date: transfer.date,
            _notes: transfer.notes.trim() || undefined,
          }),
        );
        if (error) throw error;
        return null;
      }

      const { data: resumo, error } = await supabase.rpc(
        "create_account_transfer",
        dropUndefined({
          _from_account: transfer.from,
          _to_account: transfer.to,
          _amount: valor,
          _date: transfer.date,
          _notes: transfer.notes.trim() || undefined,
        }),
      );
      if (error) throw error;
      return resumo as unknown as {
        de: string;
        para: string;
        valor: number;
        saldo_da_origem: number;
      } | null;
    },
    onSuccess: (r) => {
      // O saldo da origem depois da transferência vem junto: se ficou negativo,
      // quem lançou precisa saber na hora, não no fim do mês.
      const negativo = r && num(r.saldo_da_origem) < 0;
      toast.success(
        transferEditing
          ? "Transferência corrigida nas duas contas."
          : `Transferência registrada: ${r?.de} → ${r?.para}.`,
        {
          description: negativo
            ? `Atenção: ${r?.de} ficou com saldo de ${money(num(r?.saldo_da_origem))}.`
            : undefined,
        },
      );
      closeTransfer();
      void qc.invalidateQueries();
    },
    onError: (e: Error) =>
      toast.error("Erro na transferência", { description: friendlyError(e) }),
  });

  const removeTransfer = useMutation({
    mutationFn: async (groupId: string) => {
      const { error } = await supabase.rpc("delete_account_transfer", { _group_id: groupId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Transferência apagada das duas contas.");
      setDeleteTarget(null);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao excluir", { description: friendlyError(e) }),
  });

  function closeForm() {
    setOpen(false);
    setEditing(null);
    setForm(EMPTY);
  }

  function closeTransfer() {
    setTransferOpen(false);
    setTransferEditing(null);
    setTransfer({ ...EMPTY_TRANSFER, date: today });
  }

  function openNewTransfer() {
    setTransferEditing(null);
    setTransfer({ ...EMPTY_TRANSFER, date: today });
    setTransferOpen(true);
  }

  /**
   * Abre a correção a partir de qualquer uma das duas linhas. A origem e o
   * destino são descobertos pelo par: a linha clicada dá uma das contas, e a
   * irmã dá a outra.
   */
  function openEditTransfer(linha: TxRow) {
    const grupo = linha.source_id;
    if (!grupo) return;
    const par = (data?.transactions ?? []).filter((t) => t.source_id === grupo && isTransfer(t));
    const saida = par.find((t) => t.source_type === TRANSFER_OUT);
    const entrada = par.find((t) => t.source_type === TRANSFER_IN);
    // As duas pernas nascem com a mesma data, então aparecem sempre no mesmo
    // recorte. Faltar uma significa dado quebrado — melhor avisar do que abrir
    // o formulário com a origem e o destino trocados.
    if (!saida || !entrada) {
      toast.error("Transferência incompleta", {
        description: "Não encontrei as duas pernas desta transferência. Apague e lance de novo.",
      });
      return;
    }
    setTransferEditing(grupo);
    setTransfer({
      from: saida.bank_account_id ?? "",
      to: entrada.bank_account_id ?? "",
      amount: String(num(linha.amount)),
      date: refDate(linha) || today,
      notes: linha.notes ?? "",
    });
    setTransferOpen(true);
  }

  function openNew() {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  }

  function openEdit(t: TxRow) {
    setEditing(t);
    setForm({
      type: t.type,
      description: t.description,
      amount: String(num(t.amount)),
      situacao: t.status === "pago" ? "pago" : "previsto",
      date: refDate(t) || today,
      payment_method: t.payment_method ?? "",
      bank_account_id: t.bank_account_id ?? "",
      category_id: t.category_id ?? "",
      notes: t.notes ?? "",
      // Recorrência é decisão de criação: editar um mês não recria a série.
      repeat: false,
      repeat_months: "12",
    });
    setOpen(true);
  }

  function exportar() {
    const linhas = rows.map((t) => ({
      Data: dateBR(refDate(t)),
      Situação: TX_STATUS_LABEL[t.status] ?? t.status,
      // Na planilha a transferência não pode sair como "Receita" ou "Despesa":
      // quem conferir no Excel somaria as duas pernas como se fossem faturamento
      // e custo.
      Tipo: isTransfer(t)
        ? t.source_type === TRANSFER_OUT
          ? "Transferência enviada"
          : "Transferência recebida"
        : (TX_TYPE_LABEL[t.type] ?? t.type),
      Descrição: t.description,
      Cliente: t.clients?.name ?? "",
      Categoria: t.categories?.name ?? "",
      Conta: t.bank_accounts?.name ?? "",
      "Forma de pagamento": t.payment_method ? (PAYMENT_METHOD_LABEL[t.payment_method] ?? "") : "",
      Vencimento: dateBR(t.due_date),
      Pagamento: dateBR(t.paid_on),
      Valor: num(t.amount),
      Recorrência: t.recurrence_total ? `${t.recurrence_index}/${t.recurrence_total}` : "",
    }));
    downloadXlsx(`fluxo_de_caixa_${start}_a_${end}.xlsx`, "Caixa", linhas);
    toast.success("Planilha gerada.");
  }

  const metodos = form.type === "entrada" ? PAYMENT_METHODS_IN : PAYMENT_METHODS_OUT;
  const saving = create.isPending || update.isPending;

  return (
    <>
      <PageHeader
        title="Fluxo de Caixa"
        description="Movimentações do escritório, contas a pagar e valores de terceiros."
        action={
          <div className="flex flex-wrap gap-2">
            {canExport && (
              <Button variant="outline" onClick={exportar} disabled={rows.length === 0}>
                Exportar
              </Button>
            )}
            {canLaunch && (
              <Button variant="outline" onClick={openNewTransfer}>
                Transferir entre contas
              </Button>
            )}
            {canLaunch && <Button onClick={openNew}>Novo lançamento</Button>}
          </div>
        }
      />

      <div className="panel mb-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-sm font-semibold">Competência: {competencia}</h2>
            <p className="text-xs text-muted-foreground">{periodLabel(periodType, anchor, custom)}</p>
          </div>
          <PeriodFilter
            type={periodType}
            onTypeChange={setPeriodType}
            anchor={anchor}
            onAnchorChange={setAnchor}
            customStart={customStart}
            customEnd={customEnd}
            onCustomStartChange={setCustomStart}
            onCustomEndChange={setCustomEnd}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {(
            [
              ["todos", "Todos"],
              ["pago", "Pagos"],
              ["previsto", "A pagar / a receber"],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              variant={view === key ? "default" : "outline"}
              onClick={() => setView(key)}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {(
            [
              ["todos", "Tudo"],
              ["receitas", "Só receitas"],
              ["despesas", "Só despesas"],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              variant={kind === key ? "default" : "outline"}
              onClick={() => setKind(key)}
            >
              {label}
            </Button>
          ))}
          {kind !== "todos" && (
            <span className="text-xs text-muted-foreground">
              Os dois filtros se somam — {kind === "receitas" ? "receitas" : "despesas"}
              {view === "pago" ? " já pagas" : view === "previsto" ? " ainda em aberto" : ""}.
              Repasses e transferências entre contas só aparecem em “Tudo”.
            </span>
          )}
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-7">
        <div className="panel p-4">
          <p className="text-xs text-muted-foreground uppercase">Entradas na conta</p>
          <p className="num mt-1 text-xl font-semibold text-success">{money(totals.in)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Sem empréstimo e sem dinheiro de cliente, que tem linha própria. Além dos honorários,
            inclui o que foi lançado à mão aqui.
          </p>
        </div>
        <div className="panel p-4">
          <p className="text-xs text-muted-foreground uppercase">Despesas pagas</p>
          <p className="num mt-1 text-xl font-semibold text-destructive">{money(totals.out)}</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs text-muted-foreground uppercase">Resultado do período</p>
          <p className="num mt-1 text-xl font-semibold">{money(totals.in - totals.out)}</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs text-muted-foreground uppercase">A pagar</p>
          <p className="num mt-1 text-xl font-semibold text-warning">{money(totals.aPagar)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Ainda não saiu do caixa</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs text-muted-foreground uppercase">A receber</p>
          <p className="num mt-1 text-xl font-semibold">{money(totals.aReceber)}</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs text-muted-foreground uppercase">Empréstimos (entrou / saiu)</p>
          <p className="num mt-1 text-xl font-semibold">
            {money(totals.finIn)} / {money(totals.finOut)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Fora do resultado</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs text-muted-foreground uppercase">Terceiros (entrada / repasse)</p>
          <p className="num mt-1 text-xl font-semibold">
            {money(totals.thirdIn)} / {money(totals.thirdOut)}
          </p>
        </div>
        {totals.transferido > 0.01 && (
          <div className="panel p-4">
            <p className="text-xs text-muted-foreground uppercase">Transferido entre contas</p>
            <p className="num mt-1 text-xl font-semibold">{money(totals.transferido)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Mudou de conta, não é receita nem despesa
            </p>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
                <th className="p-3">Data</th>
                <th>Descrição</th>
                <th>Tipo</th>
                <th>Situação</th>
                <th>Forma</th>
                <th>Conta</th>
                <th className="text-right">Valor</th>
                {canLaunch && <th className="p-3" />}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-muted-foreground">
                    Carregando…
                  </td>
                </tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-muted-foreground">
                    Nenhuma movimentação no período.
                  </td>
                </tr>
              )}
              {rows.map((t) => (
                <tr key={t.id} className="border-b border-border/60 last:border-0">
                  <td className="p-3 whitespace-nowrap">
                    {dateBR(refDate(t))}
                    {t.status !== "pago" && (
                      <span className="block text-xs text-muted-foreground">vencimento</span>
                    )}
                  </td>
                  <td>
                    <span className="font-medium">{t.description}</span>
                    {/* De quem é a parcela. Sem isto a linha mostrava o valor e
                        deixava quem lê adivinhar de qual cliente veio. */}
                    {t.clients?.name && (
                      <span className="block text-xs font-medium text-info">
                        {t.clients.name}
                      </span>
                    )}
                    {t.categories?.name && (
                      <span className="block text-xs text-muted-foreground">
                        {t.categories.name}
                      </span>
                    )}
                    {t.recurrence_total && (
                      <span className="block text-xs text-muted-foreground">
                        Recorrência {t.recurrence_index}/{t.recurrence_total}
                      </span>
                    )}
                  </td>
                  <td>
                    {/* A transferência tem etiqueta própria: marcada como
                        "Receita" ou "Despesa" ela pareceria dinheiro entrando
                        ou saindo do escritório, e não é. */}
                    {isTransfer(t) ? (
                      <Tag tone="info">
                        {t.source_type === TRANSFER_OUT ? "Transf. enviada" : "Transf. recebida"}
                      </Tag>
                    ) : (
                      <Tag
                        tone={
                          THIRD_PARTY.has(t.type)
                            ? "info"
                            : t.type === "entrada"
                              ? "success"
                              : "danger"
                        }
                      >
                        {TX_TYPE_LABEL[t.type] ?? t.type}
                      </Tag>
                    )}
                  </td>
                  <td>
                    <Tag tone={t.status === "pago" ? "success" : "warning"}>
                      {TX_STATUS_LABEL[t.status] ?? t.status}
                    </Tag>
                  </td>
                  <td className="text-xs">
                    {t.payment_method ? (PAYMENT_METHOD_LABEL[t.payment_method] ?? "—") : "—"}
                  </td>
                  <td>{t.bank_accounts?.name ?? "—"}</td>
                  <td className="num text-right">{money(t.amount)}</td>
                  {canLaunch && (
                    <td className="p-3 text-right whitespace-nowrap">
                      {t.status !== "pago" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setPayTarget(t);
                            setPayDate(today);
                          }}
                        >
                          Marcar como pago
                        </Button>
                      )}
                      {/* Editar e excluir só valem para lançamento manual: o que
                          veio de um recebimento é espelho da parcela e se
                          desfaz estornando a origem. */}
                      {canEdit && !t.source_type && (
                        <Button size="sm" variant="ghost" onClick={() => openEdit(t)}>
                          Editar
                        </Button>
                      )}
                      {canDelete && !t.source_type && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => setDeleteTarget(t)}
                        >
                          Excluir
                        </Button>
                      )}
                      {/* A transferência é um par: editar ou apagar leva as duas
                          pernas juntas, senão uma conta ficaria com saldo errado.
                          Por isso não usa os botões acima. */}
                      {canEdit && isTransfer(t) && (
                        <Button size="sm" variant="ghost" onClick={() => openEditTransfer(t)}>
                          Editar transferência
                        </Button>
                      )}
                      {canDelete && isTransfer(t) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => setDeleteTarget(t)}
                        >
                          Apagar transferência
                        </Button>
                      )}
                      {t.recurrence_group_id && t.status !== "pago" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          disabled={removeSeries.isPending}
                          onClick={() => removeSeries.mutate(t.recurrence_group_id!)}
                        >
                          Apagar série
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel overflow-x-auto">
          <div className="border-b border-border p-3">
            <h2 className="font-display text-sm font-semibold">Saldo por conta</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Só o que já foi pago — contas agendadas não mexem no saldo.
            </p>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {(data?.balances ?? []).map((b) => (
                <tr key={b.bank_account_id} className="border-b border-border/60 last:border-0">
                  <td className="p-3">{b.name}</td>
                  <td className="num p-3 text-right font-medium">{money(b.balance)}</td>
                </tr>
              ))}
              {(data?.balances.length ?? 0) === 0 && (
                <tr>
                  <td className="p-6 text-center text-muted-foreground">
                    Cadastre uma conta bancária para acompanhar os saldos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mesmo formulário serve para criar e para editar. */}
      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : closeForm())}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar lançamento" : "Novo lançamento manual"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select
                value={form.type}
                onValueChange={(v) =>
                  // Trocar de despesa para receita invalida a forma de
                  // pagamento escolhida (alvará não paga despesa).
                  setForm({ ...form, type: v, payment_method: "", category_id: "" })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="entrada">Receita (entrada)</SelectItem>
                  <SelectItem value="saida">Despesa (saída)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="val">Valor</Label>
              <Input
                id="val"
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="dsc">Descrição</Label>
              <Input
                id="dsc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Situação</Label>
              <Select
                value={form.situacao}
                onValueChange={(v) => setForm({ ...form, situacao: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pago">
                    {form.type === "entrada" ? "Já recebido" : "Já pago"}
                  </SelectItem>
                  <SelectItem value="previsto">
                    {form.type === "entrada" ? "A receber" : "A pagar"}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dt">
                {form.situacao === "pago" ? "Data do pagamento" : "Data de vencimento"}
              </Label>
              <Input
                id="dt"
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Forma de pagamento</Label>
              <Select
                value={form.payment_method}
                onValueChange={(v) => setForm({ ...form, payment_method: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {metodos.map((m) => (
                    <SelectItem key={m} value={m}>
                      {PAYMENT_METHOD_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Conta {form.situacao === "pago" ? "*" : ""}</Label>
              <Select
                value={form.bank_account_id}
                onValueChange={(v) => setForm({ ...form, bank_account_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a conta" />
                </SelectTrigger>
                <SelectContent>
                  {(data?.banks ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label>Categoria</Label>
              <Select
                value={form.category_id}
                onValueChange={(v) => setForm({ ...form, category_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {(data?.categories ?? [])
                    .filter((c) =>
                      form.type === "entrada" ? c.type === "receita" : c.type === "despesa",
                    )
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Recorrência é decisão de criação: ao editar, um mês é um mês. */}
            {!editing && (
              <div className="space-y-3 rounded-md border border-border p-3 sm:col-span-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="rep"
                    checked={form.repeat}
                    onCheckedChange={(v) => setForm({ ...form, repeat: v === true })}
                  />
                  <Label htmlFor="rep" className="cursor-pointer font-normal">
                    Repetir todo mês (recorrência)
                  </Label>
                </div>
                {form.repeat && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="repm">Repetir por quantos meses</Label>
                      <Input
                        id="repm"
                        type="number"
                        min={2}
                        max={120}
                        className="w-32"
                        value={form.repeat_months}
                        onChange={(e) => setForm({ ...form, repeat_months: e.target.value })}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Cria um lançamento por mês, sempre no mesmo dia, a partir de{" "}
                      <strong>{dateBR(form.date)}</strong>. Cada mês pode ser pago, editado ou
                      apagado sozinho — e a série inteira pode ser apagada de uma vez.
                    </p>
                  </>
                )}
              </div>
            )}

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="ob">Observações</Label>
              <Textarea
                id="ob"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeForm}>
              Cancelar
            </Button>
            <Button
              onClick={() => (editing ? update.mutate() : create.mutate())}
              disabled={saving}
            >
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Baixa de conta agendada: a data vem preenchida com hoje, mas pode ser
          trocada quando o pagamento aconteceu em outro dia. */}
      <Dialog open={!!payTarget} onOpenChange={(v) => !v && setPayTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar como pago</DialogTitle>
            <DialogDescription>
              {payTarget?.description} — {money(payTarget?.amount ?? 0)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="pgdt">Data em que foi pago</Label>
            <Input
              id="pgdt"
              type="date"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Vinha para {dateBR(payTarget?.due_date)}. Se pagou em outro dia, troque a data aqui —
              é ela que entra no caixa e no saldo da conta.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayTarget(null)}>
              Cancelar
            </Button>
            <Button onClick={() => markPaid.mutate()} disabled={markPaid.isPending}>
              {markPaid.isPending ? "Salvando…" : "Confirmar pagamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transferência entre contas do escritório: duas contas, um valor, uma
          data. Sem categoria e sem forma de pagamento — não é receita nem
          despesa, então nada disso se aplica. */}
      <Dialog
        open={transferOpen}
        onOpenChange={(v) => (v ? setTransferOpen(true) : closeTransfer())}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {transferEditing ? "Corrigir transferência" : "Transferir entre contas"}
            </DialogTitle>
            <DialogDescription>
              O dinheiro sai de uma conta e entra na outra no mesmo dia. Não conta como receita nem
              como despesa: o escritório continua com o mesmo total, só em outro lugar.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Sai da conta</Label>
              <Select
                value={transfer.from}
                onValueChange={(v) => setTransfer({ ...transfer, from: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Escolha a conta de origem" />
                </SelectTrigger>
                <SelectContent>
                  {(data?.banks ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* O saldo à vista evita a transferência que deixa a conta
                  negativa por distração. */}
              {transfer.from && (
                <p className="text-xs text-muted-foreground">
                  Saldo hoje:{" "}
                  <span className="num">
                    {money(
                      num(
                        (data?.balances ?? []).find((b) => b.bank_account_id === transfer.from)
                          ?.balance,
                      ),
                    )}
                  </span>
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Entra na conta</Label>
              <Select
                value={transfer.to}
                onValueChange={(v) => setTransfer({ ...transfer, to: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Escolha a conta de destino" />
                </SelectTrigger>
                <SelectContent>
                  {(data?.banks ?? [])
                    // A mesma conta nos dois lados não é transferência nenhuma.
                    .filter((b) => b.id !== transfer.from)
                    .map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {transfer.to && (
                <p className="text-xs text-muted-foreground">
                  Saldo hoje:{" "}
                  <span className="num">
                    {money(
                      num(
                        (data?.balances ?? []).find((b) => b.bank_account_id === transfer.to)
                          ?.balance,
                      ),
                    )}
                  </span>
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="tval">Valor</Label>
              <Input
                id="tval"
                type="number"
                min="0"
                step="0.01"
                value={transfer.amount}
                onChange={(e) => setTransfer({ ...transfer, amount: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tdt">Data da transferência</Label>
              <Input
                id="tdt"
                type="date"
                value={transfer.date}
                onChange={(e) => setTransfer({ ...transfer, date: e.target.value })}
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="tobs">Observações</Label>
              <Textarea
                id="tobs"
                rows={2}
                placeholder="Opcional — o motivo da transferência, por exemplo."
                value={transfer.notes}
                onChange={(e) => setTransfer({ ...transfer, notes: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeTransfer}>
              Cancelar
            </Button>
            <Button
              disabled={salvarTransferencia.isPending}
              onClick={() => salvarTransferencia.mutate()}
            >
              {salvarTransferencia.isPending
                ? "Salvando…"
                : transferEditing
                  ? "Salvar correção"
                  : "Transferir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget && isTransfer(deleteTarget)
                ? "Apagar esta transferência?"
                : "Excluir este lançamento?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.description} — {money(deleteTarget?.amount ?? 0)} em{" "}
              {dateBR(refDate(deleteTarget ?? { status: "", paid_on: null, due_date: null }))}.{" "}
              {deleteTarget && isTransfer(deleteTarget)
                ? "As duas pernas somem juntas, e o saldo das duas contas volta ao que era antes."
                : "O lançamento sai do caixa e do saldo da conta."}{" "}
              Fica registrado quem apagou, quando e com quais valores, no histórico de auditoria.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending || removeTransfer.isPending}
              onClick={() => {
                if (deleteTarget && isTransfer(deleteTarget) && deleteTarget.source_id) {
                  removeTransfer.mutate(deleteTarget.source_id);
                  return;
                }
                remove.mutate();
              }}
            >
              {remove.isPending || removeTransfer.isPending ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
