import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/AppLayout";
import { TransferStatusTag } from "@/components/StatusBadge";
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
import { money, num, dateBR, todayISO, TRANSFER_STATUS_LABEL } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/repasses")({
  head: () => ({
    meta: [
      { title: "Repasses a Clientes | Gestão Financeira do Escritório" },
      {
        name: "description",
        content:
          "Repasses de valores de terceiros aos clientes, com saldo disponível, agendamento e baixa de pagamento.",
      },
      { property: "og:title", content: "Repasses a clientes" },
      {
        property: "og:description",
        content: "Controle dos valores de terceiros a repassar por cliente.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RepassesPage,
});

const EMPTY = {
  client_id: "",
  amount: "",
  scheduled_for: todayISO(),
  paid_on: "",
  status: "pendente",
  bank_account_id: "",
  destination_info: "",
  notes: "",
  override_reason: "",
};

function RepassesPage() {
  const { profile, canWrite } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [payTarget, setPayTarget] = useState<{ id: string; bank_account_id: string | null } | null>(
    null,
  );
  const [payBank, setPayBank] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["repasses"],
    queryFn: async () => {
      const [transfers, balances, banks] = await Promise.all([
        supabase
          .from("client_transfers")
          .select("*, clients(name)")
          .order("created_at", { ascending: false }),
        supabase.from("v_client_balances").select("*"),
        supabase.from("bank_accounts").select("id, name").eq("active", true).order("name"),
      ]);
      if (transfers.error) throw transfers.error;
      return {
        transfers: transfers.data ?? [],
        balances: (balances.data ?? []) as unknown as {
          client_id: string;
          name: string;
          received_client: number;
          transferred: number;
          pending_transfer: number;
        }[],
        banks: banks.data ?? [],
      };
    },
  });

  const selectedBalance = useMemo(
    () => (data?.balances ?? []).find((b) => b.client_id === form.client_id),
    [data, form.client_id],
  );
  const available = num(selectedBalance?.pending_transfer);
  const exceeds = num(Number(form.amount)) > available + 0.01;

  const create = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Perfil não carregado");
      if (!form.client_id) throw new Error("Selecione o cliente");
      const amount = num(Number(form.amount));
      if (amount <= 0) throw new Error("Informe o valor do repasse");
      if (exceeds && !form.override_reason.trim())
        throw new Error("Valor acima do saldo disponível: justifique para prosseguir");
      if (form.status === "pago" && !form.bank_account_id)
        throw new Error("Selecione a conta de saída para marcar o repasse como pago");

      const { error } = await supabase.from("client_transfers").insert({
        organization_id: profile.organization_id,
        created_by: profile.id,
        client_id: form.client_id,
        amount,
        status: form.status as never,
        scheduled_for: form.scheduled_for || null,
        paid_on: form.status === "pago" ? form.paid_on || todayISO() : null,
        bank_account_id: form.bank_account_id || null,
        destination_info: form.destination_info.trim() || null,
        notes: form.notes.trim() || null,
        override_reason: exceeds ? form.override_reason.trim() : null,
      });
      if (error) throw error;

      await supabase.from("audit_logs").insert({
        organization_id: profile.organization_id,
        user_id: profile.id,
        user_email: profile.email,
        action: "criar_repasse",
        table_name: "client_transfers",
        record_id: form.client_id,
        new_values: { amount, status: form.status },
      });
    },
    onSuccess: () => {
      toast.success("Repasse registrado.");
      setForm(EMPTY);
      setOpen(false);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: friendlyError(e) }),
  });

  const markPaid = useMutation({
    mutationFn: async ({ id, bankAccountId }: { id: string; bankAccountId: string }) => {
      if (!profile) throw new Error("Perfil não carregado");
      const { error } = await supabase
        .from("client_transfers")
        .update({ status: "pago", paid_on: todayISO(), bank_account_id: bankAccountId })
        .eq("id", id);
      if (error) throw error;

      await supabase.from("audit_logs").insert({
        organization_id: profile.organization_id,
        user_id: profile.id,
        user_email: profile.email,
        action: "repasse_pago",
        table_name: "client_transfers",
        record_id: id,
        new_values: { bank_account_id: bankAccountId },
      });
    },
    onSuccess: () => {
      toast.success("Repasse marcado como pago.");
      setPayTarget(null);
      setPayBank("");
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro", { description: friendlyError(e) }),
  });

  function onMarkPaidClick(t: { id: string; bank_account_id: string | null }) {
    if (t.bank_account_id) {
      markPaid.mutate({ id: t.id, bankAccountId: t.bank_account_id });
      return;
    }
    setPayTarget(t);
    setPayBank("");
  }

  const pendingTotal = (data?.balances ?? []).reduce((s, b) => s + num(b.pending_transfer), 0);

  return (
    <>
      <PageHeader
        title="Repasses a Clientes"
        description="Valores de terceiros recebidos pelo escritório e devidos aos clientes."
        action={
          canWrite && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>Novo repasse</Button>
              </DialogTrigger>
              <DialogContent className="max-h-[88vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Novo repasse</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Cliente</Label>
                    <Select
                      value={form.client_id}
                      onValueChange={(v) => setForm({ ...form, client_id: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o cliente" />
                      </SelectTrigger>
                      <SelectContent>
                        {(data?.balances ?? []).map((b) => (
                          <SelectItem key={b.client_id} value={b.client_id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {form.client_id && (
                      <p className="text-xs text-muted-foreground">
                        Saldo disponível para repasse:{" "}
                        <strong className="num">{money(available)}</strong>
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="amt">Valor</Label>
                    <Input
                      id="amt"
                      type="number"
                      step="0.01"
                      value={form.amount}
                      onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    />
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
                        {Object.entries(TRANSFER_STATUS_LABEL).map(([k, v]) => (
                          <SelectItem key={k} value={k}>
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sch">Previsão</Label>
                    <Input
                      id="sch"
                      type="date"
                      value={form.scheduled_for}
                      onChange={(e) => setForm({ ...form, scheduled_for: e.target.value })}
                    />
                  </div>
                  {form.status === "pago" && (
                    <div className="space-y-2">
                      <Label htmlFor="pd">Data do pagamento</Label>
                      <Input
                        id="pd"
                        type="date"
                        value={form.paid_on || todayISO()}
                        onChange={(e) => setForm({ ...form, paid_on: e.target.value })}
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Conta de saída{form.status === "pago" ? " *" : ""}</Label>
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
                    <Label htmlFor="dst">Dados de destino</Label>
                    <Input
                      id="dst"
                      placeholder="Chave PIX, conta do cliente…"
                      value={form.destination_info}
                      onChange={(e) => setForm({ ...form, destination_info: e.target.value })}
                    />
                  </div>
                  {exceeds && (
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="ovr">Justificativa (valor acima do saldo disponível)</Label>
                      <Textarea
                        id="ovr"
                        value={form.override_reason}
                        onChange={(e) => setForm({ ...form, override_reason: e.target.value })}
                      />
                    </div>
                  )}
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="nts">Observações</Label>
                    <Textarea
                      id="nts"
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>
                    Cancelar
                  </Button>
                  <Button onClick={() => create.mutate()} disabled={create.isPending}>
                    {create.isPending ? "Salvando…" : "Salvar repasse"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )
        }
      />

      <div className="mb-4 panel p-4">
        <p className="text-xs text-muted-foreground uppercase">Total pendente de repasse</p>
        <p className="num mt-1 text-2xl font-semibold text-warning-foreground">
          {money(pendingTotal)}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
                <th className="p-3">Cliente</th>
                <th className="text-right">Valor</th>
                <th>Previsão</th>
                <th>Pago em</th>
                <th>Situação</th>
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
              {!isLoading && (data?.transfers.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    Nenhum repasse registrado.
                  </td>
                </tr>
              )}
              {(data?.transfers ?? []).map((t) => (
                <tr key={t.id} className="border-b border-border/60 last:border-0">
                  <td className="p-3 font-medium">
                    {(t.clients as { name: string } | null)?.name ?? "—"}
                  </td>
                  <td className="num text-right">{money(t.amount)}</td>
                  <td>{dateBR(t.scheduled_for)}</td>
                  <td>{dateBR(t.paid_on)}</td>
                  <td>
                    <TransferStatusTag status={t.status} />
                  </td>
                  <td className="p-3 text-right">
                    {canWrite && t.status !== "pago" && t.status !== "cancelado" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          onMarkPaidClick({ id: t.id, bank_account_id: t.bank_account_id })
                        }
                      >
                        Marcar pago
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel overflow-x-auto">
          <div className="border-b border-border p-3">
            <h2 className="font-display text-sm font-semibold">Saldo por cliente</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
                <th className="p-3">Cliente</th>
                <th className="text-right">Recebido</th>
                <th className="p-3 text-right">A repassar</th>
              </tr>
            </thead>
            <tbody>
              {(data?.balances ?? []).map((b) => (
                <tr key={b.client_id} className="border-b border-border/60 last:border-0">
                  <td className="p-3">{b.name}</td>
                  <td className="num text-right">{money(b.received_client)}</td>
                  <td className="num p-3 text-right font-medium">{money(b.pending_transfer)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!payTarget} onOpenChange={(v) => !v && setPayTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>De qual conta saiu o repasse?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Conta de saída</Label>
            <Select value={payBank} onValueChange={setPayBank}>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayTarget(null)}>
              Cancelar
            </Button>
            <Button
              disabled={!payBank || markPaid.isPending}
              onClick={() =>
                payTarget && markPaid.mutate({ id: payTarget.id, bankAccountId: payBank })
              }
            >
              {markPaid.isPending ? "Salvando…" : "Confirmar pagamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
