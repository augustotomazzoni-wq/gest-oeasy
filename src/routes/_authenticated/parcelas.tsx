import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/AppLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClienteLink } from "@/components/ClienteDetalhe";
import { useAuth } from "@/hooks/useAuth";
import { money, num, round2, dateBR, todayISO, daysBetween } from "@/lib/format";
import { friendlyError, throwFirstError } from "@/lib/errors";
import { dropUndefined } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/parcelas")({
  validateSearch: (search: Record<string, unknown>): { filtro?: string } => {
    const filtro = search["filtro"];
    return typeof filtro === "string" ? { filtro } : {};
  },
  head: () => ({
    meta: [
      { title: "Parcelas e Recebimentos | Gestão Financeira do Escritório" },
      {
        name: "description",
        content:
          "Controle de parcelas a vencer, atrasadas e pagas, com baixa de recebimentos e rateio automático entre escritório e cliente.",
      },
      { property: "og:title", content: "Parcelas e recebimentos" },
      {
        property: "og:description",
        content: "Baixa de parcelas com rateio entre honorários e valores de terceiros.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ParcelasPage,
});

type Row = {
  id: string;
  stream: string | null;
  receivable_id: string;
  client_id: string | null;
  label: string | null;
  number: number | null;
  total_count: number | null;
  due_date: string | null;
  gross_amount: number | null;
  fee_amount: number | null;
  success_fee_amount: number | null;
  client_amount: number | null;
  cost_reimbursement: number | null;
  paid_total: number | null;
  paid_fee: number | null;
  paid_success_fee: number | null;
  paid_client: number | null;
  paid_cost_reimbursement: number | null;
  balance: number | null;
  status: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
};

type ReceiptRow = {
  client_amount_received_by_firm: number | null;
  id: string;
  installment_id: string;
  received_on: string;
  total_amount: number;
  fee_amount: number;
  success_fee_amount: number;
  client_amount: number;
  cost_reimbursement: number;
  payment_method: string | null;
  reference: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
};


const FILTERS = [
  { key: "TODAS", label: "Todas" },
  { key: "ATRASADA", label: "Atrasadas" },
  { key: "VENCE_HOJE", label: "Vencem hoje" },
  { key: "VENCE_7", label: "Vencem em 7 dias" },
  { key: "VENCE_30", label: "Vencem em 30 dias" },
  { key: "A_VENCER", label: "A vencer" },
  { key: "PARCIAL", label: "Parciais" },
  { key: "PAGA", label: "Pagas" },
];

function ParcelasPage() {
  const { profile, canWrite, roles, can, isMainAdmin } = useAuth();
  // Cobrança e Recebíveis só pode confirmar valores que a cliente recebeu
  // diretamente — nunca dinheiro que entra na conta do escritório.
  const isCobrancaOnly = !canWrite && roles.includes("cobranca");
  const canReverse = can("parcelas", "cancel_or_reverse");
  const qc = useQueryClient();
  const { filtro } = Route.useSearch();
  const [filter, setFilter] = useState(() => filtro ?? "TODAS");
  const [search, setSearch] = useState("");

  // Os cartões do dashboard levam direto para o filtro certo (ex.: "Parcelas
  // atrasadas" → filtro=ATRASADA), sem exigir um clique extra na aba.
  useEffect(() => {
    if (filtro) setFilter(filtro);
  }, [filtro]);
  const [target, setTarget] = useState<Row | null>(null);
  const [pay, setPay] = useState({
    received_on: todayISO(),
    total_amount: "",
    fee_amount: "",
    success_fee_amount: "",
    client_amount: "",
    cost_reimbursement: "",
    receipt_destination: "conta_escritorio",
    client_amount_received_by_firm: "",
    client_amount_received_direct: "0.00",
    bank_account_id: "",
    payment_method: "pix",
    reference: "",
    notes: "",
    allocation_override_reason: "",
    // Quando entra menos que o valor da parcela, o que fazer com o que faltou.
    shortfall_action: "manter",
    shortfall_installment_id: "",
    shortfall_due_date: todayISO(),
  });

  // Painel de histórico/estorno de uma parcela.
  const [historyOf, setHistoryOf] = useState<Row | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [reversing, setReversing] = useState<string | null>(null);
  // Cancelamento da parcela em si.
  const [cancelTarget, setCancelTarget] = useState<Row | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  // Repasse oferecido logo após a baixa, e também pelo histórico de recebimentos.
  const [transferTarget, setTransferTarget] = useState<{
    receiptId: string;
    amount: number;
    cliente: string;
  } | null>(null);
  const [transferDate, setTransferDate] = useState(todayISO());

  const clientNameOf = (r: Row | null) =>
    (r?.client_id && data?.clientMap.get(r.client_id)) || "cliente";

  const { data: receipts, isLoading: receiptsLoading } = useQuery({
    queryKey: ["parcela-recebimentos", historyOf?.id],
    enabled: !!historyOf,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("receipts")
        .select(
          "id, installment_id, received_on, total_amount, fee_amount, success_fee_amount, client_amount, client_amount_received_by_firm, cost_reimbursement, payment_method, reference, reversed_at, reversal_reason",
        )
        .eq("installment_id", historyOf!.id)
        .order("received_on", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ReceiptRow[];
    },
  });

  const reverseReceipt = useMutation({
    mutationFn: async (receiptId: string) => {
      if (!reversalReason.trim()) throw new Error("Informe o motivo do estorno");
      const { error } = await supabase.rpc("reverse_receipt", {
        _receipt_id: receiptId,
        _reason: reversalReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Recebimento estornado.");
      setReversalReason("");
      setReversing(null);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao estornar", { description: friendlyError(e) }),
  });

  const cancelInstallment = useMutation({
    mutationFn: async () => {
      if (!cancelTarget) throw new Error("Parcela inválida");
      if (!cancelReason.trim()) throw new Error("Informe o motivo do cancelamento");
      const { error } = await supabase.rpc("cancel_installment", {
        _installment_id: cancelTarget.id,
        _reason: cancelReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Parcela cancelada.");
      setCancelTarget(null);
      setCancelReason("");
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao cancelar", { description: friendlyError(e) }),
  });

  const deleteInstallment = useMutation({
    mutationFn: async () => {
      if (!deleteTarget) throw new Error("Parcela inválida");
      const { error } = await supabase.rpc("delete_canceled_installment", {
        _installment_id: deleteTarget.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Parcela apagada definitivamente.");
      setDeleteTarget(null);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao apagar", { description: friendlyError(e) }),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["parcelas"],
    queryFn: async () => {
      const [inst, clients, banks] = await Promise.all([
        supabase
          .from("v_installments")
          .select("*")
          .order("due_date", { ascending: true, nullsFirst: false }),
        supabase.from("clients").select("id, name").is("deleted_at", null),
        supabase.from("bank_accounts").select("id, name").eq("active", true).order("name"),
      ]);
      throwFirstError(inst, clients, banks);
      return {
        rows: (inst.data ?? []) as unknown as Row[],
        clientMap: new Map((clients.data ?? []).map((c) => [c.id, c.name])),
        banks: banks.data ?? [],
      };
    },
  });

  const allRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const today = todayISO();
    return (data?.rows ?? []).filter((r) => {
      if (filter === "VENCE_7" || filter === "VENCE_30") {
        const limit = filter === "VENCE_7" ? 7 : 30;
        if (!r.due_date || !["A_VENCER", "VENCE_HOJE", "PARCIAL"].includes(r.status ?? ""))
          return false;
        const dd = daysBetween(today, r.due_date);
        if (dd < 0 || dd > limit) return false;
      } else if (filter === "PARCIAL") {
        // Parcela vencida com pagamento parcial passa a ter status ATRASADA
        // (é o que importa para cobrança). Aqui o filtro olha o valor pago,
        // então ela continua aparecendo também em "Parciais".
        if (num(r.paid_total) <= 0.01 || num(r.balance) <= 0.01) return false;
      } else if (filter !== "TODAS" && r.status !== filter) {
        return false;
      }
      if (!term) return true;
      const name = (r.client_id && data?.clientMap.get(r.client_id)) || "";
      return name.toLowerCase().includes(term);
    });
  }, [data, filter, search]);

  const [visibleCount, setVisibleCount] = useState(50);
  useEffect(() => setVisibleCount(50), [filter, search]);
  const rows = allRows.slice(0, visibleCount);

  const totals = useMemo(
    () => ({
      count: allRows.length,
      open: allRows.reduce((s, r) => s + num(r.balance), 0),
      paid: allRows.reduce((s, r) => s + num(r.paid_total), 0),
    }),
    [allRows],
  );

  function openPay(row: Row) {
    const remainingFee = Math.max(num(row.fee_amount) - num(row.paid_fee), 0);
    const remainingSuccess = Math.max(num(row.success_fee_amount) - num(row.paid_success_fee), 0);
    const remainingClient = Math.max(num(row.client_amount) - num(row.paid_client), 0);
    const remainingCosts = Math.max(
      num(row.cost_reimbursement) - num(row.paid_cost_reimbursement),
      0,
    );
    const remaining = remainingFee + remainingSuccess + remainingClient + remainingCosts;
    setTarget(row);
    if (isCobrancaOnly) {
      // Cobrança só confirma o que a cliente recebeu direto: honorários,
      // sucumbência e reembolso ficam zerados e travados.
      setPay({
        received_on: todayISO(),
        total_amount: remainingClient.toFixed(2),
        fee_amount: "0.00",
        success_fee_amount: "0.00",
        client_amount: remainingClient.toFixed(2),
        cost_reimbursement: "0.00",
        receipt_destination: "cliente_direto",
        client_amount_received_by_firm: "0.00",
        client_amount_received_direct: remainingClient.toFixed(2),
        bank_account_id: "",
        payment_method: "pix",
        reference: "",
        notes: "",
        allocation_override_reason: "",
        shortfall_action: "manter",
        shortfall_installment_id: "",
        shortfall_due_date: todayISO(),
      });
      return;
    }
    setPay({
      received_on: todayISO(),
      total_amount: remaining.toFixed(2),
      fee_amount: remainingFee.toFixed(2),
      success_fee_amount: remainingSuccess.toFixed(2),
      client_amount: remainingClient.toFixed(2),
      cost_reimbursement: remainingCosts.toFixed(2),
      receipt_destination: "conta_escritorio",
      client_amount_received_by_firm: remainingClient.toFixed(2),
      client_amount_received_direct: "0.00",
      bank_account_id: "",
      payment_method: "pix",
      reference: "",
      notes: "",
      allocation_override_reason: "",
      shortfall_action: "manter",
      shortfall_installment_id: "",
      shortfall_due_date: todayISO(),
    });
  }

  /**
   * Mudou o valor recebido: o rateio acompanha, proporcional ao que ainda está
   * em aberto na parcela.
   *
   * Sem isso, digitar um pagamento parcial deixava as partes somando o valor
   * cheio e a baixa era recusada — a pessoa tinha que refazer a divisão na mão
   * a cada parcela paga a menos. Continua dando para digitar por cima de cada
   * campo quando a divisão real foi outra.
   */
  function changeTotal(value: string) {
    const total = num(Number(value));
    const restante = (previsto: number | null, pago: number | null) =>
      Math.max(num(previsto) - num(pago), 0);
    if (!target || total <= 0) {
      setPay({ ...pay, total_amount: value });
      return;
    }
    const remainingFee = restante(target.fee_amount, target.paid_fee);
    const remainingSuccess = restante(target.success_fee_amount, target.paid_success_fee);
    const remainingClient = restante(target.client_amount, target.paid_client);
    const remainingCosts = restante(target.cost_reimbursement, target.paid_cost_reimbursement);
    const remaining = remainingFee + remainingSuccess + remainingClient + remainingCosts;
    if (remaining <= 0) {
      setPay({ ...pay, total_amount: value });
      return;
    }
    const ratio = Math.min(total / remaining, 1);
    const fee = isCobrancaOnly ? 0 : round2(remainingFee * ratio);
    const success = isCobrancaOnly ? 0 : round2(remainingSuccess * ratio);
    const costs = isCobrancaOnly ? 0 : round2(remainingCosts * ratio);
    // A parte da cliente fecha a conta, para o rateio bater com o total no
    // centavo em vez de sobrar arredondamento.
    const client = Math.max(round2(total - fee - success - costs), 0);
    const naConta = pay.receipt_destination === "conta_escritorio";
    setPay({
      ...pay,
      total_amount: value,
      fee_amount: fee.toFixed(2),
      success_fee_amount: success.toFixed(2),
      client_amount: client.toFixed(2),
      cost_reimbursement: costs.toFixed(2),
      client_amount_received_by_firm: naConta ? client.toFixed(2) : "0.00",
      client_amount_received_direct: naConta ? "0.00" : client.toFixed(2),
    });
  }

  function changeDestination(destination: string) {
    const clientAmount = num(Number(pay.client_amount));
    setPay({
      ...pay,
      receipt_destination: destination,
      client_amount_received_by_firm:
        destination === "conta_escritorio" ? clientAmount.toFixed(2) : "0.00",
      client_amount_received_direct:
        destination === "conta_escritorio" ? "0.00" : clientAmount.toFixed(2),
      bank_account_id: destination === "cliente_direto" ? "" : pay.bank_account_id,
    });
  }

  // Quanto está faltando nesta baixa. É o que dispara a pergunta de para onde
  // vai o saldo: sem isso, a parcela ficaria parcial numa data já vencida e
  // ninguém lembraria de cobrar.
  const shortfall = target ? round2(num(target.balance) - num(Number(pay.total_amount))) : 0;

  /** Parcelas do mesmo acordo que ainda podem receber o saldo. */
  const irmasEmAberto = useMemo(() => {
    if (!target) return [];
    return (data?.rows ?? [])
      .filter(
        (r) =>
          r.receivable_id === target.receivable_id &&
          r.id !== target.id &&
          !r.canceled_at &&
          num(r.balance) > 0.01,
      )
      .sort((a, b) => String(a.due_date ?? "").localeCompare(String(b.due_date ?? "")));
  }, [data, target]);

  const register = useMutation({
    mutationFn: async () => {
      if (!target || !profile) throw new Error("Parcela inválida");
      const total = num(Number(pay.total_amount));
      if (total <= 0) throw new Error("Informe o valor recebido");
      if (total - num(target.balance) > 0.01)
        throw new Error("O recebimento não pode ultrapassar o saldo da parcela");
      const feeAmount = num(Number(pay.fee_amount));
      const successAmount = num(Number(pay.success_fee_amount));
      const clientAmount = num(Number(pay.client_amount));
      const costAmount = num(Number(pay.cost_reimbursement));
      const clientReceivedByFirm = num(Number(pay.client_amount_received_by_firm));
      const clientReceivedDirect = num(Number(pay.client_amount_received_direct));
      const parts = feeAmount + successAmount + clientAmount + costAmount;
      if (Math.abs(parts - total) > 0.01)
        throw new Error("A soma do rateio precisa ser igual ao valor total recebido");
      if (Math.abs(clientAmount - clientReceivedByFirm - clientReceivedDirect) > 0.01)
        throw new Error(
          "Informe quanto do valor da cliente entrou no escritório e quanto ela recebeu diretamente",
        );

      const amountReceivedInFirmAccount =
        feeAmount + successAmount + costAmount + clientReceivedByFirm;
      if (amountReceivedInFirmAccount > 0.01 && !pay.bank_account_id)
        throw new Error("Selecione a conta bancária que recebeu o valor");
      if (pay.receipt_destination === "conta_escritorio" && clientReceivedDirect > 0.01)
        throw new Error("No recebimento pelo escritório, o valor direto da cliente deve ser zero");
      if (pay.receipt_destination === "cliente_direto" && amountReceivedInFirmAccount > 0.01)
        throw new Error("Use 'Pagamento dividido' quando parte do valor ficar com o escritório");
      if (
        pay.receipt_destination === "dividido" &&
        (amountReceivedInFirmAccount <= 0.01 || clientReceivedDirect <= 0.01)
      )
        throw new Error(
          "No pagamento dividido, informe valores para o escritório e para a cliente",
        );

      const remainingComponents = [
        Math.max(num(target.fee_amount) - num(target.paid_fee), 0),
        Math.max(num(target.success_fee_amount) - num(target.paid_success_fee), 0),
        Math.max(num(target.client_amount) - num(target.paid_client), 0),
        Math.max(num(target.cost_reimbursement) - num(target.paid_cost_reimbursement), 0),
      ];
      const remainingTotal = remainingComponents.reduce((sum, value) => sum + value, 0);
      const ratio = remainingTotal > 0 ? total / remainingTotal : 0;
      const actualComponents = [feeAmount, successAmount, clientAmount, costAmount];
      const changedAllocation = actualComponents.some(
        (value, index) => Math.abs(value - remainingComponents[index]! * ratio) > 0.02,
      );
      if (changedAllocation && !pay.allocation_override_reason.trim())
        throw new Error("Justifique a divisão diferente da composição prevista da parcela");

      if (shortfall > 0.01 && pay.shortfall_action === "parcela" && !pay.shortfall_installment_id)
        throw new Error("Escolha a parcela que vai receber o valor que faltou");
      if (shortfall > 0.01 && pay.shortfall_action === "nova" && !pay.shortfall_due_date)
        throw new Error("Informe o vencimento da parcela nova");

      const { data: createdReceipt, error } = await supabase
        .from("receipts")
        .insert({
          organization_id: profile.organization_id,
          created_by: profile.id,
          installment_id: target.id,
          received_on: pay.received_on,
          total_amount: total,
          fee_amount: feeAmount,
          success_fee_amount: successAmount,
          client_amount: clientAmount,
          cost_reimbursement: costAmount,
          receipt_destination: pay.receipt_destination,
          client_amount_received_by_firm: clientReceivedByFirm,
          client_amount_received_direct: clientReceivedDirect,
          amount_received_in_firm_account: amountReceivedInFirmAccount,
          allocation_override_reason: pay.allocation_override_reason.trim() || null,
          bank_account_id: pay.bank_account_id || null,
          payment_method: pay.payment_method || null,
          reference: pay.reference.trim() || null,
          notes: pay.notes.trim() || null,
        })
        // Precisa do id do recebimento para a auditoria apontar para a linha
        // certa — antes gravava o id da parcela em table_name "receipts".
        .select("id")
        .single();
      if (error) throw error;
      const receiptId = createdReceipt?.id ?? null;

      await supabase.from("audit_logs").insert({
        organization_id: profile.organization_id,
        user_id: profile.id,
        user_email: profile.email,
        action: "registrar_recebimento",
        table_name: "receipts",
        record_id: createdReceipt?.id ?? null,
        new_values: {
          total,
          parcela: target.number,
          valor_escritorio: feeAmount + successAmount,
          valor_cliente: clientAmount,
          cliente_recebido_pelo_escritorio: clientReceivedByFirm,
          cliente_recebido_diretamente: clientReceivedDirect,
          entrada_na_conta_escritorio: amountReceivedInFirmAccount,
        },
      });

      // O saldo vai para onde a pessoa escolheu: somado em outra parcela ou
      // cobrado numa parcela nova. Esta parcela encolhe para o que entrou de
      // verdade e fica quitada.
      let saldoMovido = 0;
      if (shortfall > 0.01 && pay.shortfall_action !== "manter") {
        const { error: saldoError } = await supabase.rpc(
          "move_installment_balance",
          dropUndefined({
            _installment_id: target.id,
            _destino: pay.shortfall_action,
            _target_installment_id:
              pay.shortfall_action === "parcela" ? pay.shortfall_installment_id : undefined,
            _due_date: pay.shortfall_action === "nova" ? pay.shortfall_due_date : undefined,
          }),
        );
        // O recebimento já está gravado. Se o saldo não puder ser movido, é
        // melhor dizer exatamente isso do que deixar parecer que a baixa falhou.
        if (saldoError)
          throw new Error(
            `Recebimento registrado, mas o saldo não foi movido: ${friendlyError(saldoError)}`,
          );
        saldoMovido = shortfall;
      }

      // O que sobra para a cliente decide se vale oferecer o repasse na sequência.
      return { receiptId, clientReceivedByFirm, clienteNome: clientNameOf(target), saldoMovido };
    },
    onSuccess: (info) => {
      toast.success(
        info?.saldoMovido
          ? `Recebimento registrado e ${money(info.saldoMovido)} passados para outra parcela.`
          : "Recebimento registrado.",
      );
      setTarget(null);
      void qc.invalidateQueries();
      // Dinheiro da cliente que passou pela conta do escritório vira repasse.
      // Em vez de obrigar a ir até a tela de Repasses e digitar tudo de novo,
      // o repasse é oferecido aqui, já com o valor certo.
      if (info?.receiptId && info.clientReceivedByFirm > 0.01) {
        setTransferTarget({
          receiptId: info.receiptId,
          amount: info.clientReceivedByFirm,
          cliente: info.clienteNome,
        });
        setTransferDate(todayISO());
      }
    },
    onError: (e: Error) => toast.error("Erro ao registrar", { description: friendlyError(e) }),
  });

  /** Cria o repasse a partir do recebimento, com o valor que já passou pela conta. */
  const createTransfer = useMutation({
    mutationFn: async () => {
      if (!transferTarget) throw new Error("Recebimento inválido");
      const { error } = await supabase.rpc(
        "create_transfer_from_receipt",
        dropUndefined({
          _receipt_id: transferTarget.receiptId,
          _scheduled_for: transferDate || undefined,
        }),
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Repasse criado em Repasses a Clientes.");
      setTransferTarget(null);
      void qc.invalidateQueries();
    },
    onError: (e: Error) =>
      toast.error("Erro ao criar repasse", { description: friendlyError(e) }),
  });

  return (
    <>
      <PageHeader
        title="Parcelas e Recebimentos"
        description="Acompanhe os vencimentos e registre as baixas com o rateio correto."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="panel p-4">
          <p className="text-xs text-muted-foreground uppercase">Parcelas listadas</p>
          <p className="num mt-1 text-2xl font-semibold">{totals.count}</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs text-muted-foreground uppercase">Saldo em aberto</p>
          <p className="num mt-1 text-2xl font-semibold">{money(totals.open)}</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs text-muted-foreground uppercase">Já recebido</p>
          <p className="num mt-1 text-2xl font-semibold text-success">{money(totals.paid)}</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? "default" : "outline"}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
        <Input
          className="ml-auto w-full sm:w-64"
          placeholder="Buscar por cliente"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
              <th className="p-3">Cliente</th>
              <th>Parcela</th>
              <th>Vencimento</th>
              <th className="text-right">Valor</th>
              <th className="text-right">Escritório</th>
              <th className="text-right">Cliente</th>
              <th className="text-right">Recebido</th>
              <th className="text-right">Saldo</th>
              <th>Situação</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={10} className="p-6 text-center text-muted-foreground">
                  Carregando…
                </td>
              </tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={10} className="p-6 text-center text-muted-foreground">
                  Nenhuma parcela encontrada.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/60 last:border-0">
                <td className="p-3 font-medium">
                  <ClienteLink
                    clientId={r.client_id}
                    name={r.client_id ? data?.clientMap.get(r.client_id) : null}
                  />
                  {r.stream === "sucumbencia" && (
                    <span className="block text-xs text-info">sucumbência — paga direto</span>
                  )}
                  {r.stream === "empresa" && (
                    <span className="block text-xs text-info">a empresa paga direto</span>
                  )}
                </td>
                <td>
                  <span className="font-medium">{r.label || `Parcela ${r.number ?? "—"}`}</span>
                  <span className="block text-xs text-muted-foreground">
                    Item {r.number ?? "—"} de {r.total_count ?? "—"}
                  </span>
                </td>
                <td>{dateBR(r.due_date)}</td>
                <td className="num text-right">{money(r.gross_amount)}</td>
                <td className="num text-right">
                  {money(num(r.fee_amount) + num(r.success_fee_amount))}
                </td>
                <td className="num text-right">{money(r.client_amount)}</td>
                <td className="num text-right">{money(r.paid_total)}</td>
                <td className="num text-right">{money(r.balance)}</td>
                <td>
                  <StatusBadge status={r.status ?? "A_DEFINIR"} />
                </td>
                <td className="p-3 text-right whitespace-nowrap">
                  {(canWrite || isCobrancaOnly) &&
                    r.status !== "PAGA" &&
                    r.status !== "CANCELADA" && (
                      <Button size="sm" variant="outline" onClick={() => openPay(r)}>
                        Registrar
                      </Button>
                    )}
                  {num(r.paid_total) > 0.01 && (
                    <Button size="sm" variant="ghost" onClick={() => setHistoryOf(r)}>
                      Recebimentos
                    </Button>
                  )}
                  {canReverse && r.status !== "CANCELADA" && num(r.paid_total) <= 0.01 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => {
                        setCancelTarget(r);
                        setCancelReason("");
                      }}
                    >
                      Cancelar
                    </Button>
                  )}
                  {isMainAdmin && r.status === "CANCELADA" && num(r.paid_total) <= 0.01 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => setDeleteTarget(r)}
                    >
                      Apagar
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {allRows.length > rows.length && (
        <div className="mt-3 flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setVisibleCount((n) => n + 50)}>
            Mostrar mais ({allRows.length - rows.length} restantes)
          </Button>
        </div>
      )}

      <Dialog open={!!target} onOpenChange={(v) => !v && setTarget(null)}>
        <DialogContent className="max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registrar recebimento</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="on">Data do recebimento</Label>
              <Input
                id="on"
                type="date"
                value={pay.received_on}
                onChange={(e) => setPay({ ...pay, received_on: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tot">Valor total recebido</Label>
              <Input
                id="tot"
                type="number"
                min="0"
                step="0.01"
                value={pay.total_amount}
                onChange={(e) => changeTotal(e.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Onde o dinheiro foi recebido?</Label>
              <Select
                value={pay.receipt_destination}
                onValueChange={changeDestination}
                disabled={isCobrancaOnly}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="conta_escritorio">
                    Todo o valor entrou na conta do escritório
                  </SelectItem>
                  <SelectItem value="cliente_direto">
                    Todo o valor foi recebido diretamente pela cliente
                  </SelectItem>
                  <SelectItem value="dividido">
                    Pagamento dividido entre escritório e cliente
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {isCobrancaOnly
                  ? "Seu perfil só pode confirmar valores que a cliente recebeu diretamente."
                  : "Isso define se o valor entra no caixa do escritório ou não — escolha com atenção."}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fe">Honorários contratuais</Label>
              <Input
                id="fe"
                type="number"
                min="0"
                step="0.01"
                value={pay.fee_amount}
                disabled={isCobrancaOnly}
                onChange={(e) => setPay({ ...pay, fee_amount: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sf">Sucumbência</Label>
              <Input
                id="sf"
                type="number"
                min="0"
                step="0.01"
                value={pay.success_fee_amount}
                disabled={isCobrancaOnly}
                onChange={(e) => setPay({ ...pay, success_fee_amount: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ca">Valor total pertencente à cliente</Label>
              <Input
                id="ca"
                type="number"
                min="0"
                step="0.01"
                value={pay.client_amount}
                onChange={(e) => {
                  const value = num(Number(e.target.value));
                  setPay({
                    ...pay,
                    client_amount: e.target.value,
                    client_amount_received_by_firm:
                      pay.receipt_destination === "conta_escritorio"
                        ? value.toFixed(2)
                        : pay.client_amount_received_by_firm,
                    client_amount_received_direct:
                      pay.receipt_destination === "cliente_direto"
                        ? value.toFixed(2)
                        : pay.receipt_destination === "conta_escritorio"
                          ? "0.00"
                          : pay.client_amount_received_direct,
                  });
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cr">Reembolso de custas</Label>
              <Input
                id="cr"
                type="number"
                min="0"
                step="0.01"
                value={pay.cost_reimbursement}
                disabled={isCobrancaOnly}
                onChange={(e) => setPay({ ...pay, cost_reimbursement: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-firm">Da cliente, quanto entrou no escritório?</Label>
              <Input
                id="client-firm"
                type="number"
                min="0"
                step="0.01"
                value={pay.client_amount_received_by_firm}
                disabled={isCobrancaOnly}
                onChange={(e) => setPay({ ...pay, client_amount_received_by_firm: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Este valor ficará pendente de repasse.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-direct">Quanto a cliente recebeu diretamente?</Label>
              <Input
                id="client-direct"
                type="number"
                min="0"
                step="0.01"
                value={pay.client_amount_received_direct}
                onChange={(e) => setPay({ ...pay, client_amount_received_direct: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">Não entra no caixa nem gera repasse.</p>
            </div>
            <div className="panel grid gap-2 p-3 text-sm sm:col-span-2 sm:grid-cols-2">
              <p>
                Ficou para o escritório:{" "}
                <strong className="num">
                  {money(num(Number(pay.fee_amount)) + num(Number(pay.success_fee_amount)))}
                </strong>
              </p>
              <p>
                Pertence à cliente: <strong className="num">{money(pay.client_amount)}</strong>
              </p>
              <p>
                Entrou na conta do escritório:{" "}
                <strong className="num">
                  {money(
                    num(Number(pay.fee_amount)) +
                      num(Number(pay.success_fee_amount)) +
                      num(Number(pay.cost_reimbursement)) +
                      num(Number(pay.client_amount_received_by_firm)),
                  )}
                </strong>
              </p>
              <p>
                A repassar para a cliente:{" "}
                <strong className="num">{money(pay.client_amount_received_by_firm)}</strong>
              </p>
            </div>
            <div className="space-y-2">
              <Label>Conta bancária</Label>
              <Select
                value={pay.bank_account_id}
                onValueChange={(v) => setPay({ ...pay, bank_account_id: v })}
                disabled={pay.receipt_destination === "cliente_direto"}
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
            <div className="space-y-2">
              <Label>Forma de pagamento</Label>
              <Select
                value={pay.payment_method}
                onValueChange={(v) => setPay({ ...pay, payment_method: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="ted">TED/DOC</SelectItem>
                  <SelectItem value="boleto">Boleto</SelectItem>
                  <SelectItem value="alvara">Alvará judicial</SelectItem>
                  <SelectItem value="dinheiro">Dinheiro</SelectItem>
                  <SelectItem value="outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="ref">Referência / comprovante</Label>
              <Input
                id="ref"
                value={pay.reference}
                onChange={(e) => setPay({ ...pay, reference: e.target.value })}
              />
            </div>
            {shortfall > 0.01 && (
              <div className="space-y-3 rounded-md border border-info/40 bg-info/5 p-3 sm:col-span-2">
                <p className="text-sm font-medium">
                  Faltam <span className="num">{money(shortfall)}</span> nesta parcela. O que
                  fazer com esse valor?
                </p>
                <Select
                  value={pay.shortfall_action}
                  onValueChange={(v) => setPay({ ...pay, shortfall_action: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manter">Deixar em aberto nesta parcela</SelectItem>
                    <SelectItem value="parcela" disabled={irmasEmAberto.length === 0}>
                      Somar em outra parcela deste acordo
                    </SelectItem>
                    <SelectItem value="nova">Cobrar numa parcela nova</SelectItem>
                  </SelectContent>
                </Select>

                {pay.shortfall_action === "parcela" && (
                  <div className="space-y-2">
                    <Label>Parcela que vai receber o saldo</Label>
                    <Select
                      value={pay.shortfall_installment_id}
                      onValueChange={(v) => setPay({ ...pay, shortfall_installment_id: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Escolha a parcela" />
                      </SelectTrigger>
                      <SelectContent>
                        {irmasEmAberto.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.label || `Parcela ${r.number ?? "—"}`} — vence{" "}
                            {r.due_date ? dateBR(r.due_date) : "a definir"} —{" "}
                            {money(num(r.balance))}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {pay.shortfall_installment_id && (
                      <p className="text-xs text-muted-foreground">
                        Ela passa a valer{" "}
                        <strong className="num">
                          {money(
                            num(
                              irmasEmAberto.find((r) => r.id === pay.shortfall_installment_id)
                                ?.gross_amount,
                            ) + shortfall,
                          )}
                        </strong>
                        .
                      </p>
                    )}
                  </div>
                )}

                {pay.shortfall_action === "nova" && (
                  <div className="space-y-2">
                    <Label htmlFor="saldo-venc">Vencimento da parcela nova</Label>
                    <Input
                      id="saldo-venc"
                      type="date"
                      value={pay.shortfall_due_date}
                      onChange={(e) => setPay({ ...pay, shortfall_due_date: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Cria uma parcela de <span className="num">{money(shortfall)}</span> nessa
                      data, com a mesma composição do que ficou faltando.
                    </p>
                  </div>
                )}

                {pay.shortfall_action !== "manter" && (
                  <p className="text-xs text-muted-foreground">
                    Esta parcela passa a valer{" "}
                    <strong className="num">{money(num(Number(pay.total_amount)))}</strong> e fica
                    quitada. O total do acordo não muda — o valor só troca de parcela.
                  </p>
                )}
              </div>
            )}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="obs">Observações</Label>
              <Textarea
                id="obs"
                value={pay.notes}
                onChange={(e) => setPay({ ...pay, notes: e.target.value })}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="allocation-reason">
                Justificativa se a divisão for diferente da parcela prevista
              </Label>
              <Textarea
                id="allocation-reason"
                value={pay.allocation_override_reason}
                onChange={(e) => setPay({ ...pay, allocation_override_reason: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Cancelar
            </Button>
            <Button onClick={() => register.mutate()} disabled={register.isPending}>
              {register.isPending ? "Salvando…" : "Confirmar recebimento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Histórico de recebimentos da parcela, com estorno */}
      <Dialog
        open={!!historyOf}
        onOpenChange={(v) => {
          if (!v) {
            setHistoryOf(null);
            setReversing(null);
            setReversalReason("");
          }
        }}
      >
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Recebimentos da parcela</DialogTitle>
            <DialogDescription>
              {historyOf?.label || `Parcela ${historyOf?.number ?? ""}`} —{" "}
              {(historyOf?.client_id && data?.clientMap.get(historyOf.client_id)) || "cliente"}
            </DialogDescription>
          </DialogHeader>

          {receiptsLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {!receiptsLoading && (receipts?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum recebimento lançado.</p>
          )}

          <div className="space-y-3">
            {(receipts ?? []).map((rc) => (
              <div
                key={rc.id}
                className={`rounded-md border border-border p-3 ${rc.reversed_at ? "opacity-60" : ""}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="num font-medium">{money(rc.total_amount)}</span>
                  <span className="text-xs text-muted-foreground">
                    {dateBR(rc.received_on)}
                    {rc.payment_method ? ` · ${rc.payment_method}` : ""}
                    {rc.reference ? ` · ${rc.reference}` : ""}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Escritório {money(num(rc.fee_amount) + num(rc.success_fee_amount))} · Cliente{" "}
                  {money(rc.client_amount)} · Custas {money(rc.cost_reimbursement)}
                </p>

                {/* Só faz sentido repassar o que passou pela conta do escritório:
                    o que a cliente recebeu direto do banco nunca entrou aqui. */}
                {!rc.reversed_at &&
                  canWrite &&
                  num(rc.client_amount_received_by_firm) > 0.01 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => {
                        setTransferTarget({
                          receiptId: rc.id,
                          amount: num(rc.client_amount_received_by_firm),
                          cliente: clientNameOf(historyOf),
                        });
                        setTransferDate(todayISO());
                      }}
                    >
                      Pagar cliente {money(rc.client_amount_received_by_firm)}
                    </Button>
                  )}

                {rc.reversed_at ? (
                  <p className="mt-2 text-xs font-medium text-destructive">
                    Estornado em {dateBR(rc.reversed_at)}
                    {rc.reversal_reason ? ` — ${rc.reversal_reason}` : ""}
                  </p>
                ) : (
                  canReverse && (
                    <div className="mt-2">
                      {reversing === rc.id ? (
                        <div className="space-y-2">
                          <Label htmlFor={`rev-${rc.id}`}>Motivo do estorno</Label>
                          <Textarea
                            id={`rev-${rc.id}`}
                            placeholder="Ex.: valor lançado errado, pagamento não confirmado pelo banco…"
                            value={reversalReason}
                            onChange={(e) => setReversalReason(e.target.value)}
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setReversing(null);
                                setReversalReason("");
                              }}
                            >
                              Voltar
                            </Button>
                            <Button
                              size="sm"
                              disabled={reverseReceipt.isPending || !reversalReason.trim()}
                              onClick={() => reverseReceipt.mutate(rc.id)}
                            >
                              {reverseReceipt.isPending ? "Estornando…" : "Confirmar estorno"}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => {
                            setReversing(rc.id);
                            setReversalReason("");
                          }}
                        >
                          Estornar
                        </Button>
                      )}
                    </div>
                  )
                )}
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryOf(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancelamento da parcela */}
      <Dialog open={!!cancelTarget} onOpenChange={(v) => !v && setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar parcela</DialogTitle>
            <DialogDescription>
              A parcela deixa de ser cobrada e sai dos totais em aberto. O registro continua no
              histórico com o motivo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">Motivo do cancelamento</Label>
            <Textarea
              id="cancel-reason"
              placeholder="Ex.: parcela renegociada, acordo alterado…"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>
              Voltar
            </Button>
            <Button
              disabled={cancelInstallment.isPending || !cancelReason.trim()}
              onClick={() => cancelInstallment.mutate()}
            >
              {cancelInstallment.isPending ? "Cancelando…" : "Cancelar parcela"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Exclusão definitiva (Administrador Principal) */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apagar parcela cancelada</DialogTitle>
            <DialogDescription>
              A parcela {deleteTarget?.label || `nº ${deleteTarget?.number ?? ""}`} será apagada
              definitivamente do sistema. Esta ação não pode ser desfeita — fica apenas o registro
              na auditoria.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={deleteInstallment.isPending}
              onClick={() => deleteInstallment.mutate()}
            >
              {deleteInstallment.isPending ? "Apagando…" : "Apagar definitivamente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Repasse a partir do recebimento: o valor já vem certo, sem redigitar. */}
      <Dialog open={!!transferTarget} onOpenChange={(v) => !v && setTransferTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pagar cliente</DialogTitle>
            <DialogDescription>
              Deste recebimento,{" "}
              <strong className="num">{money(transferTarget?.amount ?? 0)}</strong> pertencem a{" "}
              {transferTarget?.cliente} e passaram pela conta do escritório.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="rpdt">Data prevista do repasse</Label>
              <Input
                id="rpdt"
                type="date"
                value={transferDate}
                onChange={(e) => setTransferDate(e.target.value)}
              />
            </div>
            <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              O repasse é criado como <strong>pendente</strong> em Repasses a Clientes, já com o
              PIX ou a conta da cliente preenchidos. Quando o dinheiro sair de verdade, você dá a
              baixa por lá — é essa baixa que mexe no caixa.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferTarget(null)}>
              Agora não
            </Button>
            <Button onClick={() => createTransfer.mutate()} disabled={createTransfer.isPending}>
              {createTransfer.isPending ? "Criando…" : "Criar repasse"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
