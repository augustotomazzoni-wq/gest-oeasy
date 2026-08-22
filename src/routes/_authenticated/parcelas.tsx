import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
import { useAuth } from "@/hooks/useAuth";
import { money, num, dateBR, todayISO } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/parcelas")({
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
  receivable_id: string;
  client_id: string | null;
  number: number | null;
  total_count: number | null;
  due_date: string | null;
  gross_amount: number | null;
  fee_amount: number | null;
  success_fee_amount: number | null;
  client_amount: number | null;
  cost_reimbursement: number | null;
  paid_total: number | null;
  balance: number | null;
  status: string | null;
};

const FILTERS = [
  { key: "TODAS", label: "Todas" },
  { key: "ATRASADA", label: "Atrasadas" },
  { key: "VENCE_HOJE", label: "Vencem hoje" },
  { key: "A_VENCER", label: "A vencer" },
  { key: "PARCIAL", label: "Parciais" },
  { key: "PAGA", label: "Pagas" },
];

function ParcelasPage() {
  const { profile, canWrite } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("TODAS");
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<Row | null>(null);
  const [pay, setPay] = useState({
    received_on: todayISO(),
    total_amount: "",
    fee_amount: "",
    success_fee_amount: "",
    client_amount: "",
    cost_reimbursement: "",
    bank_account_id: "",
    payment_method: "pix",
    reference: "",
    notes: "",
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
      if (inst.error) throw inst.error;
      return {
        rows: (inst.data ?? []) as unknown as Row[],
        clientMap: new Map((clients.data ?? []).map((c) => [c.id, c.name])),
        banks: banks.data ?? [],
      };
    },
  });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.rows ?? []).filter((r) => {
      if (filter !== "TODAS" && r.status !== filter) return false;
      if (!term) return true;
      const name = (r.client_id && data?.clientMap.get(r.client_id)) || "";
      return name.toLowerCase().includes(term);
    });
  }, [data, filter, search]);

  const totals = useMemo(
    () => ({
      count: rows.length,
      open: rows.reduce((s, r) => s + num(r.balance), 0),
      paid: rows.reduce((s, r) => s + num(r.paid_total), 0),
    }),
    [rows],
  );

  function openPay(row: Row) {
    const remaining = num(row.balance);
    const gross = num(row.gross_amount) || 1;
    const ratio = remaining / gross;
    setTarget(row);
    setPay({
      received_on: todayISO(),
      total_amount: remaining.toFixed(2),
      fee_amount: (num(row.fee_amount) * ratio).toFixed(2),
      success_fee_amount: (num(row.success_fee_amount) * ratio).toFixed(2),
      client_amount: (num(row.client_amount) * ratio).toFixed(2),
      cost_reimbursement: (num(row.cost_reimbursement) * ratio).toFixed(2),
      bank_account_id: "",
      payment_method: "pix",
      reference: "",
      notes: "",
    });
  }

  const register = useMutation({
    mutationFn: async () => {
      if (!target || !profile) throw new Error("Parcela inválida");
      const total = num(Number(pay.total_amount));
      if (total <= 0) throw new Error("Informe o valor recebido");
      const parts =
        num(Number(pay.fee_amount)) +
        num(Number(pay.success_fee_amount)) +
        num(Number(pay.client_amount)) +
        num(Number(pay.cost_reimbursement));
      if (Math.abs(parts - total) > 0.01)
        throw new Error("A soma do rateio precisa ser igual ao valor total recebido");

      const { error } = await supabase.from("receipts").insert({
        organization_id: profile.organization_id,
        created_by: profile.id,
        installment_id: target.id,
        received_on: pay.received_on,
        total_amount: total,
        fee_amount: num(Number(pay.fee_amount)),
        success_fee_amount: num(Number(pay.success_fee_amount)),
        client_amount: num(Number(pay.client_amount)),
        cost_reimbursement: num(Number(pay.cost_reimbursement)),
        bank_account_id: pay.bank_account_id || null,
        payment_method: pay.payment_method || null,
        reference: pay.reference.trim() || null,
        notes: pay.notes.trim() || null,
      });
      if (error) throw error;

      await supabase.from("audit_logs").insert({
        organization_id: profile.organization_id,
        user_id: profile.id,
        user_email: profile.email,
        action: "registrar_recebimento",
        table_name: "receipts",
        record_id: target.id,
        new_values: { total, parcela: target.number },
      });
    },
    onSuccess: () => {
      toast.success("Recebimento registrado.");
      setTarget(null);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao registrar", { description: e.message }),
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
          <p className="num mt-1 text-2xl font-semibold text-success">
            {money(totals.paid)}
          </p>
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
              <th className="text-right">Recebido</th>
              <th className="text-right">Saldo</th>
              <th>Situação</th>
              <th className="p-3" />
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
                  Nenhuma parcela encontrada.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/60 last:border-0">
                <td className="p-3 font-medium">
                  {(r.client_id && data?.clientMap.get(r.client_id)) || "—"}
                </td>
                <td>
                  {r.number ?? "—"}/{r.total_count ?? "—"}
                </td>
                <td>{dateBR(r.due_date)}</td>
                <td className="num text-right">{money(r.gross_amount)}</td>
                <td className="num text-right">{money(r.paid_total)}</td>
                <td className="num text-right">{money(r.balance)}</td>
                <td>
                  <StatusBadge status={r.status ?? "A_DEFINIR"} />
                </td>
                <td className="p-3 text-right">
                  {canWrite && r.status !== "PAGA" && r.status !== "CANCELADA" && (
                    <Button size="sm" variant="outline" onClick={() => openPay(r)}>
                      Registrar
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
                step="0.01"
                value={pay.total_amount}
                onChange={(e) => setPay({ ...pay, total_amount: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fe">Honorários contratuais</Label>
              <Input
                id="fe"
                type="number"
                step="0.01"
                value={pay.fee_amount}
                onChange={(e) => setPay({ ...pay, fee_amount: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sf">Sucumbência</Label>
              <Input
                id="sf"
                type="number"
                step="0.01"
                value={pay.success_fee_amount}
                onChange={(e) => setPay({ ...pay, success_fee_amount: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ca">Valor do cliente (terceiros)</Label>
              <Input
                id="ca"
                type="number"
                step="0.01"
                value={pay.client_amount}
                onChange={(e) => setPay({ ...pay, client_amount: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cr">Reembolso de custas</Label>
              <Input
                id="cr"
                type="number"
                step="0.01"
                value={pay.cost_reimbursement}
                onChange={(e) => setPay({ ...pay, cost_reimbursement: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Conta bancária</Label>
              <Select
                value={pay.bank_account_id}
                onValueChange={(v) => setPay({ ...pay, bank_account_id: v })}
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
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="obs">Observações</Label>
              <Textarea
                id="obs"
                value={pay.notes}
                onChange={(e) => setPay({ ...pay, notes: e.target.value })}
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
    </>
  );
}
