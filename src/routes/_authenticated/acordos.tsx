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
  dateBR,
  todayISO,
  addMonthsISO,
  RECEIVABLE_TYPE_LABEL,
  RECEIVABLE_STATUS_LABEL,
  FLOW_LABEL,
} from "@/lib/format";
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
  no_schedule: false,
  notes: "",
};

function AcordosPage() {
  const { profile, canWrite } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState(EMPTY);

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
  const feeFromPercent = form.fee_percent
    ? (gross * num(Number(form.fee_percent))) / 100
    : 0;
  const contractualFee = form.fee_percent
    ? feeFromPercent
    : num(Number(form.fee_fixed_amount));
  const successFee = num(Number(form.success_fee_amount));
  const costs = num(Number(form.cost_reimbursement));
  const suggestedFirm = contractualFee + successFee;
  const suggestedClient = Math.max(gross - contractualFee - costs, 0);
  const firm = form.expected_firm_amount
    ? num(Number(form.expected_firm_amount))
    : suggestedFirm;
  const client = form.expected_client_amount
    ? num(Number(form.expected_client_amount))
    : suggestedClient;
  const overridden =
    Math.abs(firm - suggestedFirm) > 0.01 || Math.abs(client - suggestedClient) > 0.01;

  const schedule = useMemo(() => {
    if (form.no_schedule) return [];
    const count = Math.max(1, Math.floor(num(Number(form.parcels))));
    const step = Math.max(1, Math.floor(num(Number(form.periodicity))));
    const totalGross = firm + client + costs;
    const per = Math.round((totalGross / count) * 100) / 100;
    const rows = [];
    let acc = 0;
    for (let i = 0; i < count; i++) {
      const value = i === count - 1 ? Math.round((totalGross - acc) * 100) / 100 : per;
      acc += value;
      const share = totalGross > 0 ? value / totalGross : 0;
      rows.push({
        number: i + 1,
        due_date: addMonthsISO(form.first_due, i * step),
        gross_amount: value,
        fee_amount: Math.round(contractualFee * share * 100) / 100,
        success_fee_amount: Math.round(successFee * share * 100) / 100,
        client_amount: Math.round(client * share * 100) / 100,
        cost_reimbursement: Math.round(costs * share * 100) / 100,
      });
    }
    return rows;
  }, [form, firm, client, costs, contractualFee, successFee]);

  const create = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Perfil não carregado");
      if (!form.client_id) throw new Error("Selecione o cliente");
      if (overridden && !form.override_reason.trim())
        throw new Error("Justifique a alteração manual dos valores calculados");

      const { data: created, error } = await supabase
        .from("legal_receivables")
        .insert({
          organization_id: profile.organization_id,
          created_by: profile.id,
          client_id: form.client_id,
          case_id: form.case_id || null,
          type: form.type as never,
          status: form.status as never,
          description: form.description.trim() || null,
          notes: form.notes.trim() || null,
          gross_amount: gross,
          fee_percent: form.fee_percent ? num(Number(form.fee_percent)) : null,
          fee_fixed_amount: form.fee_fixed_amount
            ? num(Number(form.fee_fixed_amount))
            : null,
          success_fee_amount: successFee,
          cost_reimbursement: costs,
          expected_firm_amount: firm,
          expected_client_amount: client,
          agreement_date: form.agreement_date || null,
          flow: form.flow as never,
          is_estimated: form.is_estimated,
          manual_override_reason: overridden ? form.override_reason.trim() : null,
        })
        .select("id")
        .single();
      if (error) throw error;

      if (schedule.length) {
        const { error: e2 } = await supabase.from("installments").insert(
          schedule.map((s) => ({
            organization_id: profile.organization_id,
            created_by: profile.id,
            receivable_id: created.id,
            number: s.number,
            total_count: schedule.length,
            due_date: s.due_date,
            gross_amount: s.gross_amount,
            fee_amount: s.fee_amount,
            success_fee_amount: s.success_fee_amount,
            client_amount: s.client_amount,
            cost_reimbursement: s.cost_reimbursement,
          })),
        );
        if (e2) throw e2;
      }

      await supabase.from("audit_logs").insert({
        organization_id: profile.organization_id,
        user_id: profile.id,
        user_email: profile.email,
        action: "criar_recebivel",
        table_name: "legal_receivables",
        record_id: created.id,
        new_values: { firm, client, gross, parcelas: schedule.length },
      });
    },
    onSuccess: () => {
      toast.success("Acordo registrado com o cronograma.");
      setForm(EMPTY);
      setStep(1);
      setOpen(false);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: e.message }),
  });

  const casesForClient = (data?.cases ?? []).filter(
    (c) => c.client_id === form.client_id,
  );

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
                if (!v) setStep(1);
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
                        onValueChange={(v) =>
                          setForm({ ...form, client_id: v, case_id: "" })
                        }
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
                        onChange={(e) =>
                          setForm({ ...form, description: e.target.value })
                        }
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
                        onChange={(e) =>
                          setForm({ ...form, gross_amount: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="date">Data do acordo/decisão</Label>
                      <Input
                        id="date"
                        type="date"
                        value={form.agreement_date}
                        onChange={(e) =>
                          setForm({ ...form, agreement_date: e.target.value })
                        }
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
                        onChange={(e) => setForm({ ...form, fee_percent: e.target.value })}
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
                        onChange={(e) =>
                          setForm({ ...form, fee_fixed_amount: e.target.value })
                        }
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
                        onChange={(e) =>
                          setForm({ ...form, success_fee_amount: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cst">Reembolso de custas</Label>
                      <Input
                        id="cst"
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.cost_reimbursement}
                        onChange={(e) =>
                          setForm({ ...form, cost_reimbursement: e.target.value })
                        }
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
                        onCheckedChange={(v) =>
                          setForm({ ...form, is_estimated: v === true })
                        }
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
                          onChange={(e) =>
                            setForm({ ...form, expected_firm_amount: e.target.value })
                          }
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
                          onChange={(e) =>
                            setForm({ ...form, expected_client_amount: e.target.value })
                          }
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
                          onChange={(e) =>
                            setForm({ ...form, override_reason: e.target.value })
                          }
                        />
                      </div>
                    )}
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={form.no_schedule}
                        onCheckedChange={(v) =>
                          setForm({ ...form, no_schedule: v === true })
                        }
                      />
                      Ainda sem cronograma definido (a definir)
                    </label>
                    {!form.no_schedule && (
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="space-y-2">
                          <Label htmlFor="par">Nº de parcelas</Label>
                          <Input
                            id="par"
                            type="number"
                            min="1"
                            value={form.parcels}
                            onChange={(e) => setForm({ ...form, parcels: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="fst">1º vencimento</Label>
                          <Input
                            id="fst"
                            type="date"
                            value={form.first_due}
                            onChange={(e) =>
                              setForm({ ...form, first_due: e.target.value })
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="per">Periodicidade (meses)</Label>
                          <Input
                            id="per"
                            type="number"
                            min="1"
                            value={form.periodicity}
                            onChange={(e) =>
                              setForm({ ...form, periodicity: e.target.value })
                            }
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {step === 4 && (
                  <div className="space-y-4">
                    <div className="panel p-4 text-sm">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <p>Valor bruto: <strong className="num">{money(gross)}</strong></p>
                        <p>Honorários contratuais: <strong className="num">{money(contractualFee)}</strong></p>
                        <p>Sucumbência: <strong className="num">{money(successFee)}</strong></p>
                        <p>Custos: <strong className="num">{money(costs)}</strong></p>
                        <p>Total do escritório: <strong className="num">{money(firm)}</strong></p>
                        <p>Total do cliente: <strong className="num">{money(client)}</strong></p>
                      </div>
                      <p className="mt-3 text-xs text-muted-foreground">
                        Soma do cronograma: {money(schedule.reduce((s, r) => s + r.gross_amount, 0))}
                      </p>
                    </div>
                    {schedule.length > 0 && (
                      <div className="max-h-52 overflow-y-auto rounded-md border border-border">
                        <table className="w-full text-sm">
                          <thead className="bg-muted text-xs text-muted-foreground uppercase">
                            <tr>
                              <th className="p-2 text-left">#</th>
                              <th className="text-left">Vencimento</th>
                              <th className="text-right">Valor</th>
                              <th className="p-2 text-right">Cliente</th>
                            </tr>
                          </thead>
                          <tbody>
                            {schedule.map((s) => (
                              <tr key={s.number} className="border-t border-border/60">
                                <td className="p-2">{s.number}</td>
                                <td>{dateBR(s.due_date)}</td>
                                <td className="num text-right">{money(s.gross_amount)}</td>
                                <td className="num p-2 text-right">
                                  {money(s.client_amount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                <DialogFooter className="gap-2">
                  {step > 1 && (
                    <Button
                      variant="outline"
                      onClick={() => setStep((s) => (s - 1) as Step)}
                    >
                      Voltar
                    </Button>
                  )}
                  {step < 4 ? (
                    <Button
                      onClick={() => setStep((s) => (s + 1) as Step)}
                      disabled={step === 1 && !form.client_id}
                    >
                      Continuar
                    </Button>
                  ) : (
                    <Button
                      onClick={() => create.mutate()}
                      disabled={create.isPending}
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
              <th className="text-right">Escritório</th>
              <th className="text-right">Cliente</th>
              <th className="p-3 text-right">Recebido</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">
                  Carregando…
                </td>
              </tr>
            )}
            {!isLoading && (data?.receivables.length ?? 0) === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">
                  Nenhum acordo cadastrado.
                </td>
              </tr>
            )}
            {(data?.receivables ?? []).map((r) => {
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
                      <span className="block text-xs text-muted-foreground">
                        {r.description}
                      </span>
                    )}
                  </td>
                  <td>{RECEIVABLE_TYPE_LABEL[r.type] ?? r.type}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <Tag tone={r.status === "confirmado" ? "success" : "neutral"}>
                        {RECEIVABLE_STATUS_LABEL[r.status] ?? r.status}
                      </Tag>
                      {r.is_estimated && <Tag tone="warning">Estimado</Tag>}
                    </div>
                  </td>
                  <td className="num text-right">{money(r.gross_amount)}</td>
                  <td className="num text-right">{money(r.expected_firm_amount)}</td>
                  <td className="num text-right">{money(r.expected_client_amount)}</td>
                  <td className="num p-3 text-right">{money(paid)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
