import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/AppLayout";
import { Tag, ReceivableStatusTag } from "@/components/StatusBadge";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import {
  money,
  num,
  todayISO,
  addMonthsISO,
  RECEIVABLE_TYPE_LABEL,
  RECEIVABLE_STATUS_LABEL,
  FLOW_LABEL,
} from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/acordos")({
  head: () => ({
    meta: [
      { title: "Acordos e Sentenças | Gestão Financeira do Escritório" },
      {
        name: "description",
        content:
          "Acordos, sentenças e execuções com divisão entre honorários do escritório, sucumbência, custos e valor do cliente.",
      },
      { property: "og:title", content: "Acordos e sentenças" },
      {
        property: "og:description",
        content: "Cadastro de recebíveis jurídicos com cronograma de parcelas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AcordosPage,
});

type Step = 1 | 2 | 3 | 4;

type DistributionMode = "proporcional" | "escritorio_primeiro" | "manual";

type ScheduleRow = {
  label: string;
  number: number;
  due_date: string;
  gross_amount: number;
  firm_amount: number;
  client_amount: number;
  cost_reimbursement: number;
};

const cents = (value: number) => Math.max(0, Math.round(num(value) * 100));
const fromCents = (value: number) => value / 100;

function allocateByCapacity(
  capacities: number[],
  totals: { firm: number; client: number; costs: number },
  mode: DistributionMode,
) {
  let remaining = {
    firm: cents(totals.firm),
    client: cents(totals.client),
    costs: cents(totals.costs),
  };

  return capacities.map((capacityValue, index) => {
    const capacity = cents(capacityValue);
    const totalRemaining = remaining.firm + remaining.client + remaining.costs;
    let allocation = { firm: 0, client: 0, costs: 0 };

    if (index === capacities.length - 1 || capacity >= totalRemaining) {
      allocation = { ...remaining };
    } else if (mode === "escritorio_primeiro") {
      let available = capacity;
      allocation.firm = Math.min(available, remaining.firm);
      available -= allocation.firm;
      allocation.costs = Math.min(available, remaining.costs);
      available -= allocation.costs;
      allocation.client = Math.min(available, remaining.client);
    } else {
      const keys = ["firm", "client", "costs"] as const;
      const shares = keys.map((key) => {
        const raw = totalRemaining ? (capacity * remaining[key]) / totalRemaining : 0;
        return { key, value: Math.floor(raw), fraction: raw - Math.floor(raw) };
      });
      let missing = capacity - shares.reduce((sum, share) => sum + share.value, 0);
      shares.sort((a, b) => b.fraction - a.fraction);
      for (const share of shares) {
        if (missing <= 0) break;
        if (share.value < remaining[share.key]) {
          share.value += 1;
          missing -= 1;
        }
      }
      allocation = Object.fromEntries(
        shares.map((share) => [share.key, share.value]),
      ) as typeof allocation;
    }

    remaining = {
      firm: remaining.firm - allocation.firm,
      client: remaining.client - allocation.client,
      costs: remaining.costs - allocation.costs,
    };

    return {
      gross_amount: fromCents(capacity),
      firm_amount: fromCents(allocation.firm),
      client_amount: fromCents(allocation.client),
      cost_reimbursement: fromCents(allocation.costs),
    };
  });
}

function splitFirmComponents(rows: ScheduleRow[], feeTotal: number, successTotal: number) {
  let feeRemaining = cents(feeTotal);
  let successRemaining = cents(successTotal);

  return rows.map((row) => {
    const rowFirm = cents(row.firm_amount);
    const fee = Math.min(rowFirm, feeRemaining);
    feeRemaining -= fee;
    const success = Math.min(rowFirm - fee, successRemaining);
    successRemaining -= success;
    return { fee_amount: fromCents(fee), success_fee_amount: fromCents(success) };
  });
}

const EMPTY = {
  client_id: "",
  case_id: "",
  type: "acordo",
  status: "confirmado",
  description: "",
  gross_amount: "",
  fee_percent: "",
  fee_fixed_amount: "",
  success_fee_amount: "",
  success_fee_included: false,
  cost_reimbursement: "",
  expected_firm_amount: "",
  expected_client_amount: "",
  agreement_date: todayISO(),
  flow: "escritorio_recebe_total",
  is_estimated: false,
  override_reason: "",
  parcels: "1",
  first_due: todayISO(),
  periodicity: "1",
  has_entry: false,
  entry_amount: "",
  entry_due: todayISO(),
  distribution_mode: "proporcional" as DistributionMode,
  no_schedule: false,
  notes: "",
};

function AcordosPage() {
  const { profile, canWrite, can, isMainAdmin } = useAuth();
  const canCancel = can("acordos", "cancel_or_reverse");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState(EMPTY);
  const [editedSchedule, setEditedSchedule] = useState<ScheduleRow[] | null>(null);
  // Campos que mudam o total do acordo. Ao alterar qualquer um deles, o
  // cronograma editado à mão deixa de valer — voltamos para a sugestão
  // recalculada, senão as parcelas continuariam somando o total antigo.
  const TOTALS_FIELDS = [
    "gross_amount",
    "fee_percent",
    "fee_fixed_amount",
    "success_fee_amount",
    "success_fee_included",
    "cost_reimbursement",
    "expected_firm_amount",
    "expected_client_amount",
    "has_entry",
    "entry_amount",
    "entry_due",
    "parcels",
    "first_due",
    "periodicity",
    "distribution_mode",
    "no_schedule",
  ] as const;

  function updateForm(patch: Partial<typeof EMPTY>) {
    setForm((current) => ({ ...current, ...patch }));
    if (Object.keys(patch).some((k) => (TOTALS_FIELDS as readonly string[]).includes(k))) {
      setEditedSchedule(null);
    }
  }

  const [cancelTarget, setCancelTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["acordos"],
    queryFn: async () => {
      const [recv, clients, cases, inst] = await Promise.all([
        supabase
          .from("legal_receivables")
          .select("*, clients(name), cases(case_number)")
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
        supabase.from("clients").select("id, name").is("deleted_at", null).order("name"),
        supabase
          .from("cases")
          .select("id, client_id, case_number, opposing_party")
          .is("deleted_at", null),
        supabase.from("v_installments").select("receivable_id, gross_amount, paid_total"),
      ]);
      if (recv.error) throw recv.error;
      return {
        receivables: recv.data ?? [],
        clients: clients.data ?? [],
        cases: cases.data ?? [],
        installments: (inst.data ?? []) as unknown as {
          receivable_id: string;
          gross_amount: number;
          paid_total: number;
        }[],
      };
    },
  });

  const gross = num(Number(form.gross_amount));
  const feeFromPercent = form.fee_percent ? (gross * num(Number(form.fee_percent))) / 100 : 0;
  const contractualFee = form.fee_percent ? feeFromPercent : num(Number(form.fee_fixed_amount));
  const successFee = num(Number(form.success_fee_amount));
  const costs = num(Number(form.cost_reimbursement));
  // A sucumbência é paga pela parte perdedora, então às vezes vem por fora do
  // valor do acordo e às vezes já está embutida nele. Quem cadastra informa
  // qual é o caso — antes o sistema sempre assumia "por fora" em silêncio, e o
  // cronograma somava mais que o valor bruto sem explicar o motivo.
  const successInsideGross = form.success_fee_included;
  const suggestedFirm = contractualFee + successFee;
  const suggestedClient = Math.max(
    gross - contractualFee - costs - (successInsideGross ? successFee : 0),
    0,
  );
  // Quanto o cronograma inteiro deve somar, partindo do valor bruto.
  const expectedGrossTotal = gross + (successInsideGross ? 0 : successFee);
  const firm = form.expected_firm_amount ? num(Number(form.expected_firm_amount)) : suggestedFirm;
  const client = form.expected_client_amount
    ? num(Number(form.expected_client_amount))
    : suggestedClient;
  const overridden =
    Math.abs(firm - suggestedFirm) > 0.01 || Math.abs(client - suggestedClient) > 0.01;

  const generatedSchedule = useMemo<ScheduleRow[]>(() => {
    if (form.no_schedule) return [];
    const scheduleTotalCents = cents(firm + client + costs);
    if (scheduleTotalCents <= 0) return [];

    const entryRequested = form.has_entry ? cents(Number(form.entry_amount)) : 0;
    const entryCents = Math.min(entryRequested, scheduleTotalCents);
    const remainingCents = scheduleTotalCents - entryCents;
    const remainingCount = remainingCents ? Math.max(1, Math.floor(num(Number(form.parcels)))) : 0;
    const period = Math.max(1, Math.floor(num(Number(form.periodicity))));
    const capacities: number[] = [];
    const labels: string[] = [];
    const dueDates: string[] = [];

    if (entryCents > 0) {
      capacities.push(fromCents(entryCents));
      labels.push("Entrada");
      dueDates.push(form.entry_due);
    }

    if (remainingCount > 0) {
      const base = Math.floor(remainingCents / remainingCount);
      let allocated = 0;
      for (let index = 0; index < remainingCount; index += 1) {
        const value = index === remainingCount - 1 ? remainingCents - allocated : base;
        allocated += value;
        capacities.push(fromCents(value));
        labels.push(`Parcela ${index + 1}`);
        dueDates.push(addMonthsISO(form.first_due, index * period));
      }
    }

    const allocations = allocateByCapacity(
      capacities,
      { firm, client, costs },
      form.distribution_mode,
    );

    return allocations.map((allocation, index) => ({
      ...allocation,
      label: labels[index] ?? `Parcela ${index + 1}`,
      number: index + 1,
      due_date: dueDates[index] ?? form.first_due,
    }));
  }, [form, firm, client, costs]);

  const schedule = editedSchedule ?? generatedSchedule;

  const scheduleTotals = useMemo(
    () =>
      schedule.reduce(
        (total, row) => ({
          gross: total.gross + num(row.gross_amount),
          firm: total.firm + num(row.firm_amount),
          client: total.client + num(row.client_amount),
          costs: total.costs + num(row.cost_reimbursement),
        }),
        { gross: 0, firm: 0, client: 0, costs: 0 },
      ),
    [schedule],
  );

  const scheduleErrors = useMemo(() => {
    if (form.no_schedule) return [];
    const errors: string[] = [];
    const expectedTotal = firm + client + costs;
    const entry = num(Number(form.entry_amount));
    if (form.has_entry && entry <= 0) errors.push("Informe um valor de entrada maior que zero.");
    if (form.has_entry && entry - expectedTotal > 0.01)
      errors.push("A entrada não pode ser maior que o total a receber.");
    if (!schedule.length) errors.push("Crie ao menos uma parcela para o cronograma.");

    schedule.forEach((row, index) => {
      const parts = row.firm_amount + row.client_amount + row.cost_reimbursement;
      if (!row.due_date) errors.push(`${row.label || `Parcela ${index + 1}`}: informe a data.`);
      if (row.gross_amount <= 0)
        errors.push(`${row.label || `Parcela ${index + 1}`}: informe um valor maior que zero.`);
      if (Math.abs(row.gross_amount - parts) > 0.01)
        errors.push(`${row.label || `Parcela ${index + 1}`}: a divisão não fecha com o total.`);
    });

    if (Math.abs(scheduleTotals.gross - expectedTotal) > 0.01)
      errors.push("A soma das parcelas não fecha com o total a receber.");
    if (Math.abs(scheduleTotals.firm - firm) > 0.01)
      errors.push("A soma destinada ao escritório não fecha com o valor esperado.");
    if (Math.abs(scheduleTotals.client - client) > 0.01)
      errors.push("A soma destinada ao cliente não fecha com o valor esperado.");
    if (Math.abs(scheduleTotals.costs - costs) > 0.01)
      errors.push("A soma dos reembolsos não fecha com o valor esperado.");
    if (gross > 0 && Math.abs(expectedTotal - expectedGrossTotal) > 0.01)
      errors.push(
        `O total distribuído (${money(expectedTotal)}) não fecha com o valor bruto` +
          `${successInsideGross ? "" : " + sucumbência"} (${money(expectedGrossTotal)}).`,
      );
    return [...new Set(errors)];
  }, [
    client,
    costs,
    firm,
    gross,
    expectedGrossTotal,
    successInsideGross,
    form.entry_amount,
    form.has_entry,
    form.no_schedule,
    schedule,
    scheduleTotals,
  ]);

  function updateScheduleRow(index: number, patch: Partial<ScheduleRow>) {
    setEditedSchedule((current) =>
      (current ?? generatedSchedule).map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  }

  const create = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Perfil não carregado");
      if (!form.client_id) throw new Error("Selecione o cliente");
      if (overridden && !form.override_reason.trim())
        throw new Error("Justifique a alteração manual dos valores calculados");
      if (scheduleErrors.length) throw new Error(scheduleErrors[0]);

      const successForSchedule = Math.min(successFee, firm);
      const feeForSchedule = Math.max(firm - successForSchedule, 0);
      const firmComponents = schedule.length
        ? splitFirmComponents(schedule, feeForSchedule, successForSchedule)
        : [];

      // Acordo e cronograma são gravados em uma única transação no banco:
      // se a criação das parcelas falhar, o acordo também não é criado —
      // evita um acordo "fantasma" sem nenhuma parcela.
      const { error } = await supabase.rpc("create_agreement_with_schedule", {
        _client_id: form.client_id,
        _case_id: form.case_id || null,
        _type: form.type,
        _status: form.status,
        _description: form.description.trim() || null,
        _notes: form.notes.trim() || null,
        _gross_amount: gross,
        _fee_percent: form.fee_percent ? num(Number(form.fee_percent)) : null,
        _fee_fixed_amount: form.fee_fixed_amount ? num(Number(form.fee_fixed_amount)) : null,
        _success_fee_amount: successFee,
        _cost_reimbursement: costs,
        _expected_firm_amount: firm,
        _expected_client_amount: client,
        _agreement_date: form.agreement_date || null,
        _flow: form.flow,
        _is_estimated: form.is_estimated,
        _manual_override_reason: overridden ? form.override_reason.trim() : null,
        _installments: schedule.map((s, index) => ({
          label: s.label,
          number: s.number,
          total_count: schedule.length,
          due_date: s.due_date,
          gross_amount: s.gross_amount,
          fee_amount: firmComponents[index]?.fee_amount ?? 0,
          success_fee_amount: firmComponents[index]?.success_fee_amount ?? 0,
          client_amount: s.client_amount,
          cost_reimbursement: s.cost_reimbursement,
        })),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Acordo registrado com o cronograma.");
      setForm(EMPTY);
      setEditedSchedule(null);
      setStep(1);
      setOpen(false);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: friendlyError(e) }),
  });

  const cancelReceivable = useMutation({
    mutationFn: async () => {
      if (!cancelTarget) throw new Error("Acordo inválido");
      if (!cancelReason.trim()) throw new Error("Informe o motivo do cancelamento");
      const { error } = await supabase.rpc("cancel_receivable", {
        _receivable_id: cancelTarget.id,
        _reason: cancelReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Acordo cancelado.");
      setCancelTarget(null);
      setCancelReason("");
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao cancelar", { description: friendlyError(e) }),
  });

  const deleteReceivable = useMutation({
    mutationFn: async () => {
      if (!deleteTarget) throw new Error("Acordo inválido");
      const { error } = await supabase.rpc("delete_canceled_receivable", {
        _receivable_id: deleteTarget.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Acordo apagado definitivamente.");
      setDeleteTarget(null);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao apagar", { description: friendlyError(e) }),
  });

  const casesForClient = (data?.cases ?? []).filter((c) => c.client_id === form.client_id);

  const stepValid =
    step === 1
      ? !!form.client_id
      : step === 2
        ? gross > 0
        : step === 3
          ? form.no_schedule || scheduleErrors.length === 0
          : true;

  return (
    <>
      <PageHeader
        title="Acordos e Sentenças"
        description="Recebíveis jurídicos com separação entre o valor do escritório e o valor do cliente."
        action={
          canWrite && (
            <Dialog
              open={open}
              onOpenChange={(v) => {
                setOpen(v);
                if (!v) {
                  setStep(1);
                  setEditedSchedule(null);
                  // Sem limpar o form, o próximo acordo abre com o cliente e
                  // os valores do acordo abandonado ainda preenchidos.
                  setForm(EMPTY);
                }
              }}
            >
              <DialogTrigger asChild>
                <Button>Novo acordo/sentença</Button>
              </DialogTrigger>
              <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Novo acordo/sentença — etapa {step} de 4</DialogTitle>
                </DialogHeader>

                {step === 1 && (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label>Cliente</Label>
                      <Select
                        value={form.client_id}
                        onValueChange={(v) => setForm({ ...form, client_id: v, case_id: "" })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o cliente" />
                        </SelectTrigger>
                        <SelectContent>
                          {(data?.clients ?? []).map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Processo (opcional)</Label>
                      <Select
                        value={form.case_id}
                        onValueChange={(v) => setForm({ ...form, case_id: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o processo" />
                        </SelectTrigger>
                        <SelectContent>
                          {casesForClient.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.case_number || c.opposing_party || "Sem número"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="desc">Descrição</Label>
                      <Input
                        id="desc"
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Tipo</Label>
                      <Select
                        value={form.type}
                        onValueChange={(v) => setForm({ ...form, type: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(RECEIVABLE_TYPE_LABEL).map(([k, v]) => (
                            <SelectItem key={k} value={k}>
                              {v}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Situação</Label>
                      <Select
                        value={form.status}
                        onValueChange={(v) => setForm({ ...form, status: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(RECEIVABLE_STATUS_LABEL).map(([k, v]) => (
                            <SelectItem key={k} value={k}>
                              {v}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="gross">Valor bruto</Label>
                      <Input
                        id="gross"
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.gross_amount}
                        onChange={(e) => updateForm({ gross_amount: e.target.value })}
                      />
                      {gross <= 0 && (
                        <p className="text-xs text-destructive">Informe um valor maior que zero.</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="date">Data do acordo/decisão</Label>
                      <Input
                        id="date"
                        type="date"
                        value={form.agreement_date}
                        onChange={(e) => setForm({ ...form, agreement_date: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pct">% honorários contratuais</Label>
                      <Input
                        id="pct"
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.fee_percent}
                        onChange={(e) => updateForm({ fee_percent: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="fix">Honorários fixos (se sem %)</Label>
                      <Input
                        id="fix"
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.fee_fixed_amount}
                        onChange={(e) => updateForm({ fee_fixed_amount: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="suc">Sucumbência</Label>
                      <Input
                        id="suc"
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.success_fee_amount}
                        onChange={(e) => updateForm({ success_fee_amount: e.target.value })}
                      />
                      {successFee > 0 && (
                        <label className="flex items-start gap-2 pt-1 text-xs">
                          <Checkbox
                            checked={form.success_fee_included}
                            onCheckedChange={(v) =>
                              updateForm({ success_fee_included: v === true })
                            }
                          />
                          <span className="text-muted-foreground">
                            A sucumbência já está dentro do valor bruto.
                            <span className="mt-0.5 block">
                              {form.success_fee_included
                                ? `Total a distribuir: ${money(gross)}.`
                                : `Por fora — total a distribuir: ${money(gross + successFee)}.`}
                            </span>
                          </span>
                        </label>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cst">Reembolso de custas</Label>
                      <Input
                        id="cst"
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.cost_reimbursement}
                        onChange={(e) => updateForm({ cost_reimbursement: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Forma do fluxo</Label>
                      <Select
                        value={form.flow}
                        onValueChange={(v) => setForm({ ...form, flow: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(FLOW_LABEL).map(([k, v]) => (
                            <SelectItem key={k} value={k}>
                              {v}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <label className="flex items-center gap-2 self-end pb-2 text-sm">
                      <Checkbox
                        checked={form.is_estimated}
                        onCheckedChange={(v) => setForm({ ...form, is_estimated: v === true })}
                      />
                      Valor estimado (a confirmar)
                    </label>
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="firm">Valor esperado do escritório</Label>
                        <Input
                          id="firm"
                          type="number"
                          step="0.01"
                          placeholder={String(suggestedFirm.toFixed(2))}
                          value={form.expected_firm_amount}
                          onChange={(e) => updateForm({ expected_firm_amount: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">
                          Sugerido: {money(suggestedFirm)} (honorários + sucumbência)
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="cli">Valor esperado do cliente</Label>
                        <Input
                          id="cli"
                          type="number"
                          step="0.01"
                          placeholder={String(suggestedClient.toFixed(2))}
                          value={form.expected_client_amount}
                          onChange={(e) => updateForm({ expected_client_amount: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">
                          Sugerido: {money(suggestedClient)}
                        </p>
                      </div>
                    </div>
                    {overridden && (
                      <div className="space-y-2">
                        <Label htmlFor="just">Justificativa da alteração manual</Label>
                        <Textarea
                          id="just"
                          value={form.override_reason}
                          onChange={(e) => setForm({ ...form, override_reason: e.target.value })}
                        />
                      </div>
                    )}
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={form.no_schedule}
                        onCheckedChange={(v) => updateForm({ no_schedule: v === true })}
                      />
                      Ainda sem cronograma definido (a definir)
                    </label>
                    {!form.no_schedule && (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label>Como distribuir os valores nas parcelas?</Label>
                          <Select
                            value={form.distribution_mode}
                            onValueChange={(v) =>
                              updateForm({ distribution_mode: v as DistributionMode })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="proporcional">
                                Proporcional entre escritório e cliente
                              </SelectItem>
                              <SelectItem value="escritorio_primeiro">
                                Primeiros valores para o escritório
                              </SelectItem>
                              <SelectItem value="manual">Personalizado manualmente</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            A sugestão poderá ser alterada parcela por parcela na próxima etapa.
                          </p>
                        </div>

                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={form.has_entry}
                            onCheckedChange={(v) => updateForm({ has_entry: v === true })}
                          />
                          O acordo possui entrada
                        </label>

                        {form.has_entry && (
                          <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
                            <div className="space-y-2">
                              <Label htmlFor="entry-value">Valor da entrada</Label>
                              <Input
                                id="entry-value"
                                type="number"
                                min="0"
                                step="0.01"
                                value={form.entry_amount}
                                onChange={(e) => updateForm({ entry_amount: e.target.value })}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="entry-date">Data da entrada</Label>
                              <Input
                                id="entry-date"
                                type="date"
                                value={form.entry_due}
                                onChange={(e) => updateForm({ entry_due: e.target.value })}
                              />
                            </div>
                          </div>
                        )}

                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="space-y-2">
                            <Label htmlFor="par">
                              {form.has_entry ? "Parcelas após a entrada" : "Nº de parcelas"}
                            </Label>
                            <Input
                              id="par"
                              type="number"
                              min="1"
                              value={form.parcels}
                              onChange={(e) => updateForm({ parcels: e.target.value })}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="fst">1º vencimento do saldo</Label>
                            <Input
                              id="fst"
                              type="date"
                              value={form.first_due}
                              onChange={(e) => updateForm({ first_due: e.target.value })}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="per">Periodicidade (meses)</Label>
                            <Input
                              id="per"
                              type="number"
                              min="1"
                              value={form.periodicity}
                              onChange={(e) => updateForm({ periodicity: e.target.value })}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {scheduleErrors.length > 0 && (
                      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                        <p className="text-sm font-medium text-destructive">
                          Corrija antes de continuar:
                        </p>
                        <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-destructive">
                          {scheduleErrors.map((error) => (
                            <li key={error}>{error}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {step === 4 && (
                  <div className="space-y-4">
                    <div className="panel p-4 text-sm">
                      {gross > 0 && (
                        <p className="mb-3 border-b border-border pb-3 text-xs text-muted-foreground">
                          Valor bruto do acordo:{" "}
                          <strong className="num text-foreground">{money(gross)}</strong>
                          {successFee > 0 &&
                            (successInsideGross ? (
                              <> — sucumbência de {money(successFee)} já incluída.</>
                            ) : (
                              <>
                                {" "}
                                + sucumbência de {money(successFee)} por fora ={" "}
                                <strong className="num text-foreground">
                                  {money(expectedGrossTotal)}
                                </strong>
                                .
                              </>
                            ))}
                        </p>
                      )}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <p>
                          Total a receber:{" "}
                          <strong className="num">{money(firm + client + costs)}</strong>
                        </p>
                        <p>
                          Distribuído:{" "}
                          <strong className="num">{money(scheduleTotals.gross)}</strong>
                        </p>
                        <p>
                          Escritório: <strong className="num">{money(scheduleTotals.firm)}</strong>
                          <span className="text-muted-foreground"> de {money(firm)}</span>
                        </p>
                        <p>
                          Cliente: <strong className="num">{money(scheduleTotals.client)}</strong>
                          <span className="text-muted-foreground"> de {money(client)}</span>
                        </p>
                        <p>
                          Reembolsos: <strong className="num">{money(scheduleTotals.costs)}</strong>
                          <span className="text-muted-foreground"> de {money(costs)}</span>
                        </p>
                        <p>
                          Itens do cronograma: <strong>{schedule.length}</strong>
                        </p>
                      </div>
                    </div>

                    {!form.no_schedule && (
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">Composição de cada parcela</p>
                          <p className="text-xs text-muted-foreground">
                            Altere as datas e indique exatamente quanto é do escritório e do
                            cliente.
                          </p>
                          {!editedSchedule && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Recalculado com os valores atuais — as alterações feitas à mão antes
                              de mudar os valores foram descartadas.
                            </p>
                          )}
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setEditedSchedule(generatedSchedule.map((row) => ({ ...row })))
                          }
                        >
                          Regerar sugestão
                        </Button>
                      </div>
                    )}

                    {schedule.length > 0 && (
                      <div className="max-h-80 overflow-auto rounded-md border border-border">
                        <table className="min-w-[860px] w-full text-sm">
                          <thead className="bg-muted text-xs text-muted-foreground uppercase">
                            <tr>
                              <th className="p-2 text-left">Identificação</th>
                              <th className="text-left">Vencimento</th>
                              <th className="text-right">Total</th>
                              <th className="text-right">Escritório</th>
                              <th className="text-right">Cliente</th>
                              <th className="p-2 text-right">Reembolso</th>
                            </tr>
                          </thead>
                          <tbody>
                            {schedule.map((row, index) => (
                              <tr
                                key={`${row.number}-${index}`}
                                className="border-t border-border/60"
                              >
                                <td className="p-2">
                                  <Input
                                    className="min-w-28"
                                    value={row.label}
                                    onChange={(e) =>
                                      updateScheduleRow(index, { label: e.target.value })
                                    }
                                  />
                                </td>
                                <td className="p-2">
                                  <Input
                                    className="min-w-36"
                                    type="date"
                                    value={row.due_date}
                                    onChange={(e) =>
                                      updateScheduleRow(index, { due_date: e.target.value })
                                    }
                                  />
                                </td>
                                <td className="p-2">
                                  <Input
                                    className="min-w-28 text-right"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={row.gross_amount}
                                    onChange={(e) =>
                                      updateScheduleRow(index, {
                                        gross_amount: num(Number(e.target.value)),
                                      })
                                    }
                                  />
                                </td>
                                <td className="p-2">
                                  <Input
                                    className="min-w-28 text-right"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={row.firm_amount}
                                    onChange={(e) =>
                                      updateScheduleRow(index, {
                                        firm_amount: num(Number(e.target.value)),
                                      })
                                    }
                                  />
                                </td>
                                <td className="p-2">
                                  <Input
                                    className="min-w-28 text-right"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={row.client_amount}
                                    onChange={(e) =>
                                      updateScheduleRow(index, {
                                        client_amount: num(Number(e.target.value)),
                                      })
                                    }
                                  />
                                </td>
                                <td className="p-2">
                                  <Input
                                    className="min-w-28 text-right"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={row.cost_reimbursement}
                                    onChange={(e) =>
                                      updateScheduleRow(index, {
                                        cost_reimbursement: num(Number(e.target.value)),
                                      })
                                    }
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {scheduleErrors.length > 0 && (
                      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                        <p className="text-sm font-medium text-destructive">
                          Corrija o cronograma antes de confirmar:
                        </p>
                        <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-destructive">
                          {scheduleErrors.map((error) => (
                            <li key={error}>{error}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                <DialogFooter className="gap-2">
                  {step > 1 && (
                    <Button variant="outline" onClick={() => setStep((s) => (s - 1) as Step)}>
                      Voltar
                    </Button>
                  )}
                  {step < 4 ? (
                    <Button
                      onClick={() => {
                        if (step === 3)
                          setEditedSchedule(generatedSchedule.map((row) => ({ ...row })));
                        setStep((s) => (s + 1) as Step);
                      }}
                      disabled={!stepValid}
                    >
                      Continuar
                    </Button>
                  ) : (
                    <Button
                      onClick={() => create.mutate()}
                      disabled={create.isPending || scheduleErrors.length > 0}
                    >
                      {create.isPending ? "Salvando…" : "Confirmar"}
                    </Button>
                  )}
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )
        }
      />

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
              <th className="p-3">Cliente</th>
              <th>Tipo</th>
              <th>Situação</th>
              <th className="text-right">Bruto</th>
              <th className="text-right">Total a receber</th>
              <th className="text-right">Escritório</th>
              <th className="text-right">Cliente</th>
              <th className="text-right">Recebido</th>
              {(canCancel || isMainAdmin) && <th className="p-3" />}
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
            {!isLoading && (data?.receivables.length ?? 0) === 0 && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-muted-foreground">
                  Nenhum acordo cadastrado.
                </td>
              </tr>
            )}
            {(data?.receivables ?? []).map((r) => {
              // O que será efetivamente cobrado nas parcelas. Pode diferir do
              // valor bruto quando a sucumbência foi cadastrada por fora dele.
              const totalToReceive =
                num(r.expected_firm_amount) +
                num(r.expected_client_amount) +
                num(r.cost_reimbursement);
              const paid = (data?.installments ?? [])
                .filter((i) => i.receivable_id === r.id)
                .reduce((s, i) => s + num(i.paid_total), 0);
              return (
                <tr key={r.id} className="border-b border-border/60 last:border-0">
                  <td className="p-3">
                    <span className="font-medium">
                      {(r.clients as { name: string } | null)?.name ?? "—"}
                    </span>
                    {r.description && (
                      <span className="block text-xs text-muted-foreground">{r.description}</span>
                    )}
                  </td>
                  <td>{RECEIVABLE_TYPE_LABEL[r.type] ?? r.type}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <ReceivableStatusTag status={r.status} />
                      {r.is_estimated && <Tag tone="warning">Estimado</Tag>}
                    </div>
                  </td>
                  <td className="num text-right text-muted-foreground">{money(r.gross_amount)}</td>
                  <td className="num text-right font-medium">
                    {money(totalToReceive)}
                    {Math.abs(totalToReceive - num(r.gross_amount)) > 0.01 && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {totalToReceive > num(r.gross_amount) ? "+" : "−"}
                        {money(Math.abs(totalToReceive - num(r.gross_amount))).replace(
                          "R$",
                          "R$ ",
                        )}{" "}
                        sobre o bruto
                      </span>
                    )}
                  </td>
                  <td className="num text-right">{money(r.expected_firm_amount)}</td>
                  <td className="num text-right">{money(r.expected_client_amount)}</td>
                  <td className="num text-right">{money(paid)}</td>
                   {(canCancel || isMainAdmin) && (
                     <td className="p-3 text-right whitespace-nowrap">
                       {canCancel && r.status !== "cancelado" && paid <= 0.01 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => {
                            setCancelTarget({
                              id: r.id,
                              name: (r.clients as { name: string } | null)?.name ?? "acordo",
                            });
                            setCancelReason("");
                          }}
                        >
                          Cancelar
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={!!cancelTarget} onOpenChange={(v) => !v && setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar acordo</DialogTitle>
            <DialogDescription>
              O acordo de {cancelTarget?.name} e as parcelas em aberto deixam de ser cobrados e saem
              dos totais. O registro continua no histórico com o motivo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-recv-reason">Motivo do cancelamento</Label>
            <Textarea
              id="cancel-recv-reason"
              placeholder="Ex.: acordo desfeito, cadastrado em duplicidade…"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>
              Voltar
            </Button>
            <Button
              disabled={cancelReceivable.isPending || !cancelReason.trim()}
              onClick={() => cancelReceivable.mutate()}
            >
              {cancelReceivable.isPending ? "Cancelando…" : "Cancelar acordo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
