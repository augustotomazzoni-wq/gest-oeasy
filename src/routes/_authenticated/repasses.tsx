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
import { ClienteLink } from "@/components/ClienteDetalhe";
import { useAuth } from "@/hooks/useAuth";
import { money, num, dateBR, todayISO, TRANSFER_STATUS_LABEL } from "@/lib/format";
import { dropUndefined } from "@/lib/utils";
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
  const { profile, canWrite, can } = useAuth();
  const canCancel = can("repasses", "cancel_or_reverse");
  // Editar repasse é permissão à parte: nasce só para o Administrador e pode
  // ser liberada por perfil na tela Usuários e Perfis de Acesso.
  const canEdit = can("repasses", "edit");
  const [editTarget, setEditTarget] = useState<{ id: string; name: string } | null>(null);
  const [editForm, setEditForm] = useState({
    amount: "",
    scheduled_for: todayISO(),
    bank_account_id: "",
    destination_info: "",
    notes: "",
    status: "pendente",
    paid_on: "",
  });
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [payTarget, setPayTarget] = useState<{ id: string; bank_account_id: string | null } | null>(
    null,
  );
  const [payBank, setPayBank] = useState("");
  const [cancelTarget, setCancelTarget] = useState<{ id: string; name: string } | null>(null);
  const [cancelReason, setCancelReason] = useState("");

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

  // Repasses já registrados mas ainda não pagos (pendente/agendado) também
  // comprometem o saldo do cliente. A view v_client_balances só desconta os
  // pagos — sem isto, registrar dois repasses do mesmo valor passa sem aviso
  // e a cliente acaba recebendo em dobro.
  const scheduledByClient = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of data?.transfers ?? []) {
      if (t.status !== "pendente" && t.status !== "agendado") continue;
      const key = t.client_id as string;
      map.set(key, (map.get(key) ?? 0) + num(t.amount));
    }
    return map;
  }, [data]);

  const alreadyScheduled = form.client_id ? (scheduledByClient.get(form.client_id) ?? 0) : 0;
  const available = num(selectedBalance?.pending_transfer) - alreadyScheduled;
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

      const { data: createdTransfer, error } = await supabase
        .from("client_transfers")
        .insert({
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
        })
        // A auditoria precisa apontar para o repasse, não para o cliente.
        .select("id")
        .single();
      if (error) throw error;

      await supabase.from("audit_logs").insert({
        organization_id: profile.organization_id,
        user_id: profile.id,
        user_email: profile.email,
        action: "criar_repasse",
        table_name: "client_transfers",
        record_id: createdTransfer?.id ?? null,
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

  const updateTransfer = useMutation({
    mutationFn: async () => {
      if (!editTarget) throw new Error("Repasse inválido");
      const amount = num(Number(editForm.amount));
      if (amount <= 0) throw new Error("Informe um valor maior que zero");
      const { error } = await supabase.rpc(
        "update_transfer",
        dropUndefined({
          _id: editTarget.id,
          _amount: amount,
          _scheduled_for: editForm.scheduled_for || undefined,
          _bank_account_id: editForm.bank_account_id || undefined,
          _destination_info: editForm.destination_info.trim() || undefined,
          _notes: editForm.notes.trim() || undefined,
          _status: editForm.status || undefined,
          _paid_on: editForm.status === "pago" ? editForm.paid_on || undefined : undefined,
        }),
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Repasse atualizado.");
      setEditTarget(null);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao editar", { description: friendlyError(e) }),
  });

  const cancelTransfer = useMutation({
    mutationFn: async () => {
      if (!cancelTarget) throw new Error("Repasse inválido");
      if (!cancelReason.trim()) throw new Error("Informe o motivo do cancelamento");
      const { error } = await supabase.rpc("cancel_transfer", {
        _transfer_id: cancelTarget.id,
        _reason: cancelReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Repasse cancelado.");
      setCancelTarget(null);
      setCancelReason("");
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro ao cancelar", { description: friendlyError(e) }),
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
  // Só quem o escritório ainda deve. Cliente já quitada polui a lista e
  // esconde justamente quem precisa ser pago, então sai daqui.
  const devedores = (data?.balances ?? [])
    .filter((b) => num(b.pending_transfer) > 0.01)
    .sort((a, b) => num(b.pending_transfer) - num(a.pending_transfer));

  return (
    <>
      <PageHeader
        title="Repasses a Clientes"
        description="Valores de terceiros recebidos pelo escritório e devidos aos clientes."
        action={
          canWrite && (
            <Dialog
              open={open}
              onOpenChange={(v) => {
                setOpen(v);
                if (!v) setForm(EMPTY);
              }}
            >
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
                        {alreadyScheduled > 0.01 && (
                          <>
                            {" "}
                            — já descontados{" "}
                            <strong className="num">{money(alreadyScheduled)}</strong> de repasses
                            registrados e ainda não pagos.
                          </>
                        )}
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
                <th className="px-4 text-right">Valor</th>
                <th className="px-3">Previsão</th>
                <th className="px-3">Pago em</th>
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
                  <td className="num px-4 text-right whitespace-nowrap">{money(t.amount)}</td>
                  <td className="px-3 whitespace-nowrap">{dateBR(t.scheduled_for)}</td>
                  <td className="px-3 whitespace-nowrap">{dateBR(t.paid_on)}</td>
                  <td>
                    <TransferStatusTag status={t.status} />
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
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
                    {/* Editar também depois de pago: o gatilho do caixa
                        reespelha o lançamento sozinho a cada alteração. Só
                        repasse cancelado fica fora. */}
                    {canEdit && t.status !== "cancelado" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditTarget({
                            id: t.id,
                            name: (t.clients as { name: string } | null)?.name ?? "cliente",
                          });
                          setEditForm({
                            amount: String(num(t.amount)),
                            scheduled_for: t.scheduled_for ?? todayISO(),
                            bank_account_id: t.bank_account_id ?? "",
                            destination_info: t.destination_info ?? "",
                            notes: t.notes ?? "",
                            status: t.status,
                            paid_on: t.paid_on ?? "",
                          });
                        }}
                      >
                        Editar
                      </Button>
                    )}
                    {canCancel && t.status !== "cancelado" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => {
                          setCancelTarget({
                            id: t.id,
                            name: (t.clients as { name: string } | null)?.name ?? "cliente",
                          });
                          setCancelReason("");
                        }}
                      >
                        Cancelar
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
            <h2 className="font-display text-sm font-semibold">Clientes a quem ainda devemos</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Quem já quitou sai da lista. {devedores.length} cliente(s) — {money(pendingTotal)} a
              repassar.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
                <th className="p-3">Cliente</th>
                <th className="text-right">Total que vai receber</th>
                <th className="text-right">Já repassado</th>
                <th className="p-3 text-right">Falta receber</th>
              </tr>
            </thead>
            <tbody>
              {devedores.map((b) => (
                <tr key={b.client_id} className="border-b border-border/60 last:border-0">
                  <td className="p-3">
                    <ClienteLink clientId={b.client_id} name={b.name} />
                  </td>
                  <td className="num text-right">{money(b.received_client)}</td>
                  <td className="num text-right text-muted-foreground">{money(b.transferred)}</td>
                  <td className="num p-3 text-right font-medium">
                    {money(b.pending_transfer)}
                  </td>
                </tr>
              ))}
              {devedores.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-muted-foreground">
                    Nenhum repasse pendente — todas as clientes estão em dia.
                  </td>
                </tr>
              )}
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

      <Dialog open={!!editTarget} onOpenChange={(v) => !v && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar repasse</DialogTitle>
            <DialogDescription>Repasse para {editTarget?.name}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ev">Valor</Label>
              <Input
                id="ev"
                type="number"
                step="0.01"
                value={editForm.amount}
                onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ed">Previsto para</Label>
              <Input
                id="ed"
                type="date"
                value={editForm.scheduled_for}
                onChange={(e) => setEditForm({ ...editForm, scheduled_for: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Situação</Label>
              <Select
                value={editForm.status}
                onValueChange={(v) => setEditForm({ ...editForm, status: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pendente">Pendente</SelectItem>
                  <SelectItem value="agendado">Agendado</SelectItem>
                  <SelectItem value="pago">Pago</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Conta de saída</Label>
              <Select
                value={editForm.bank_account_id}
                onValueChange={(v) => setEditForm({ ...editForm, bank_account_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
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
            {editForm.status === "pago" && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="epago">Pago em</Label>
                <Input
                  id="epago"
                  type="date"
                  value={editForm.paid_on}
                  onChange={(e) => setEditForm({ ...editForm, paid_on: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  É esta data que vale no fluxo de caixa e no saldo da conta.
                </p>
              </div>
            )}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="edest">PIX / conta da cliente</Label>
              <Input
                id="edest"
                value={editForm.destination_info}
                onChange={(e) => setEditForm({ ...editForm, destination_info: e.target.value })}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="enot">Observações</Label>
              <Textarea
                id="enot"
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              Cancelar
            </Button>
            <Button onClick={() => updateTransfer.mutate()} disabled={updateTransfer.isPending}>
              {updateTransfer.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cancelTarget} onOpenChange={(v) => !v && setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar repasse</DialogTitle>
            <DialogDescription>
              O repasse para {cancelTarget?.name} é cancelado e o valor volta para o saldo a
              repassar. Se já estava marcado como pago, o lançamento sai do caixa.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-tr-reason">Motivo do cancelamento</Label>
            <Textarea
              id="cancel-tr-reason"
              placeholder="Ex.: valor errado, repasse registrado em duplicidade…"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>
              Voltar
            </Button>
            <Button
              disabled={cancelTransfer.isPending || !cancelReason.trim()}
              onClick={() => cancelTransfer.mutate()}
            >
              {cancelTransfer.isPending ? "Cancelando…" : "Cancelar repasse"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
