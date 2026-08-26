import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/AppLayout";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { maskAccount, maskTaxId, money, num, todayISO } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { dropUndefined } from "@/lib/utils";
import { downloadXlsx } from "@/lib/export-xlsx";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/clientes")({
  head: () => ({
    meta: [
      { title: "Clientes | Gestão Financeira do Escritório" },
      {
        name: "description",
        content:
          "Cadastro de clientes do escritório com saldo recebido, valores repassados e pendências de repasse.",
      },
      { property: "og:title", content: "Clientes do escritório" },
      {
        property: "og:description",
        content: "Cadastro e saldos financeiros por cliente.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ClientesPage,
});

const EMPTY_FORM = {
  name: "",
  tax_id: "",
  phone: "",
  email: "",
  notes: "",
  payer_names: [] as string[],
  payment_kind: "nao_informado",
  pix_key_type: "cpf_cnpj",
  pix_key: "",
  bank: "",
  branch: "",
  account: "",
  holder_name: "",
  holder_tax_id: "",
};

function ClientesPage() {
  const { profile, canWrite } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [payerInput, setPayerInput] = useState("");

  function addPayer() {
    const value = payerInput.trim();
    if (!value || form.payer_names.includes(value)) {
      setPayerInput("");
      return;
    }
    setForm({ ...form, payer_names: [...form.payer_names, value] });
    setPayerInput("");
  }

  function removePayer(name: string) {
    setForm({ ...form, payer_names: form.payer_names.filter((p) => p !== name) });
  }

  function exportPayers() {
    const rows: Record<string, unknown>[] = [];
    for (const c of data?.clients ?? []) {
      rows.push({
        Pagador: c.name,
        Cliente: c.name,
        "CPF/CNPJ do cliente": c.tax_id ?? "",
        Telefone: c.phone ?? "",
      });
      for (const payer of c.payer_names ?? []) {
        if (!payer.trim() || payer.trim() === c.name) continue;
        rows.push({
          Pagador: payer,
          Cliente: c.name,
          "CPF/CNPJ do cliente": c.tax_id ?? "",
          Telefone: c.phone ?? "",
        });
      }
    }
    downloadXlsx(`pagadores_${todayISO()}.xlsx`, "Pagadores", rows);
  }

  const { data, isLoading } = useQuery({
    queryKey: ["clientes"],
    queryFn: async () => {
      const [clients, balances, paymentAccounts] = await Promise.all([
        supabase.from("clients").select("*").is("deleted_at", null).order("name"),
        supabase.from("v_client_balances").select("*"),
        supabase
          .from("client_payment_accounts")
          .select(
            "client_id, pix_key_type, pix_key, bank, branch, account, holder_name, holder_tax_id",
          ),
      ]);
      if (clients.error) throw clients.error;
      return {
        clients: clients.data ?? [],
        balances: balances.data ?? [],
        paymentAccounts: paymentAccounts.data ?? [],
      };
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Perfil não carregado");
      const hasPix = form.payment_kind === "pix" || form.payment_kind === "ambos";
      const hasBank = form.payment_kind === "conta" || form.payment_kind === "ambos";

      if (hasPix && !form.pix_key.trim()) throw new Error("Informe a chave PIX");
      if (hasBank && (!form.bank.trim() || !form.account.trim()))
        throw new Error("Informe o banco e o número da conta");

      const { error } = await supabase.rpc(
        "create_client_with_payment_account",
        dropUndefined({
          _name: form.name.trim(),
          _tax_id: form.tax_id.trim() || undefined,
          _phone: form.phone.trim() || undefined,
          _email: form.email.trim() || undefined,
          _notes: form.notes.trim() || undefined,
          _pix_key_type: hasPix ? form.pix_key_type : undefined,
          _pix_key: hasPix ? form.pix_key.trim() : undefined,
          _bank: hasBank ? form.bank.trim() : undefined,
          _branch: hasBank ? form.branch.trim() || undefined : undefined,
          _account: hasBank ? form.account.trim() : undefined,
          _holder_name:
            form.payment_kind !== "nao_informado"
              ? form.holder_name.trim() || form.name.trim()
              : undefined,
          _holder_tax_id:
            form.payment_kind !== "nao_informado"
              ? form.holder_tax_id.trim() || form.tax_id.trim() || undefined
              : undefined,
          _payer_names: form.payer_names,
        }),
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cliente cadastrado.");
      setForm(EMPTY_FORM);
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["clientes"] });
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: friendlyError(e) }),
  });

  const update = useMutation({
    mutationFn: async () => {
      if (!profile || !editingId) throw new Error("Cliente inválido");
      const hasPix = form.payment_kind === "pix" || form.payment_kind === "ambos";
      const hasBank = form.payment_kind === "conta" || form.payment_kind === "ambos";

      if (hasPix && !form.pix_key.trim()) throw new Error("Informe a chave PIX");
      if (hasBank && (!form.bank.trim() || !form.account.trim()))
        throw new Error("Informe o banco e o número da conta");

      const { error } = await supabase
        .from("clients")
        .update({
          name: form.name.trim(),
          tax_id: form.tax_id.trim() || null,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          notes: form.notes.trim() || null,
          payer_names: form.payer_names,
        })
        .eq("id", editingId);
      if (error) throw error;

      if (form.payment_kind === "nao_informado") {
        const { error: delErr } = await supabase
          .from("client_payment_accounts")
          .delete()
          .eq("client_id", editingId);
        if (delErr) throw delErr;
      } else {
        const { data: existing } = await supabase
          .from("client_payment_accounts")
          .select("id")
          .eq("client_id", editingId)
          .maybeSingle();
        const payload = {
          organization_id: profile.organization_id,
          client_id: editingId,
          pix_key_type: hasPix ? form.pix_key_type : null,
          pix_key: hasPix ? form.pix_key.trim() : null,
          bank: hasBank ? form.bank.trim() : null,
          branch: hasBank ? form.branch.trim() || null : null,
          account: hasBank ? form.account.trim() : null,
          holder_name: form.holder_name.trim() || form.name.trim(),
          holder_tax_id: form.holder_tax_id.trim() || form.tax_id.trim() || null,
        };
        const { error: payErr } = existing
          ? await supabase.from("client_payment_accounts").update(payload).eq("id", existing.id)
          : await supabase
              .from("client_payment_accounts")
              .insert({ ...payload, created_by: profile.id });
        if (payErr) throw payErr;
      }

      await supabase.from("audit_logs").insert({
        organization_id: profile.organization_id,
        user_id: profile.id,
        user_email: profile.email,
        action: "editar_cliente",
        table_name: "clients",
        record_id: editingId,
      });
    },
    onSuccess: () => {
      toast.success("Cliente atualizado.");
      setForm(EMPTY_FORM);
      setEditingId(null);
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["clientes"] });
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: friendlyError(e) }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("clients")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      if (profile) {
        await supabase.from("audit_logs").insert({
          organization_id: profile.organization_id,
          user_id: profile.id,
          user_email: profile.email,
          action: "excluir_cliente",
          table_name: "clients",
          record_id: id,
        });
      }
    },
    onSuccess: () => {
      toast.success("Cliente removido.");
      void qc.invalidateQueries({ queryKey: ["clientes"] });
    },
    onError: (e: Error) => toast.error("Erro ao remover", { description: friendlyError(e) }),
  });

  function openEdit(c: {
    id: string;
    name: string;
    tax_id: string | null;
    phone: string | null;
    email: string | null;
    notes: string | null;
    payer_names: string[] | null;
  }) {
    const payment = data?.paymentAccounts.find((p) => p.client_id === c.id) as
      | {
          pix_key_type: string | null;
          pix_key: string | null;
          bank: string | null;
          branch: string | null;
          account: string | null;
          holder_name: string | null;
          holder_tax_id: string | null;
        }
      | undefined;
    const hasPix = !!payment?.pix_key;
    const hasBank = !!payment?.account;
    setEditingId(c.id);
    setForm({
      name: c.name,
      tax_id: c.tax_id ?? "",
      phone: c.phone ?? "",
      email: c.email ?? "",
      notes: c.notes ?? "",
      payer_names: c.payer_names ?? [],
      payment_kind:
        hasPix && hasBank ? "ambos" : hasPix ? "pix" : hasBank ? "conta" : "nao_informado",
      pix_key_type: payment?.pix_key_type ?? "cpf_cnpj",
      pix_key: payment?.pix_key ?? "",
      bank: payment?.bank ?? "",
      branch: payment?.branch ?? "",
      account: payment?.account ?? "",
      holder_name: payment?.holder_name ?? "",
      holder_tax_id: payment?.holder_tax_id ?? "",
    });
    setOpen(true);
  }

  const allRows = (data?.clients ?? []).filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );
  const [visibleCount, setVisibleCount] = useState(50);
  const rows = allRows.slice(0, visibleCount);
  const balanceOf = (id: string) =>
    data?.balances.find((b) => b.client_id === id) as
      { received_client: number; transferred: number; pending_transfer: number } | undefined;
  const paymentOf = (id: string) => data?.paymentAccounts.find((item) => item.client_id === id);

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Cadastro e situação financeira de cada cliente."
        action={
          canWrite && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={exportPayers}>
                Exportar pagadores
              </Button>
              <Dialog
                open={open}
                onOpenChange={(v) => {
                  setOpen(v);
                  if (!v) {
                    setEditingId(null);
                    setForm(EMPTY_FORM);
                  }
                }}
              >
                <DialogTrigger asChild>
                  <Button
                    onClick={() => {
                      setEditingId(null);
                      setForm(EMPTY_FORM);
                    }}
                  >
                    Novo cliente
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>{editingId ? "Editar cliente" : "Novo cliente"}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="name">Nome / Razão social</Label>
                      <Input
                        id="name"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="tax">CPF/CNPJ</Label>
                        <Input
                          id="tax"
                          value={form.tax_id}
                          onChange={(e) => setForm({ ...form, tax_id: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="phone">Telefone</Label>
                        <Input
                          id="phone"
                          value={form.phone}
                          onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email">E-mail</Label>
                      <Input
                        id="email"
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="notes">Observações</Label>
                      <Textarea
                        id="notes"
                        value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="payer">Quem costuma pagar por este cliente</Label>
                      <div className="flex gap-2">
                        <Input
                          id="payer"
                          placeholder="Nome ou empresa que aparece no pagamento"
                          value={payerInput}
                          onChange={(e) => setPayerInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addPayer();
                            }
                          }}
                        />
                        <Button type="button" variant="outline" onClick={addPayer}>
                          Adicionar
                        </Button>
                      </div>
                      {form.payer_names.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {form.payer_names.map((p) => (
                            <span
                              key={p}
                              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-xs"
                            >
                              {p}
                              <button
                                type="button"
                                onClick={() => removePayer(p)}
                                aria-label={`Remover ${p}`}
                                className="text-muted-foreground hover:text-destructive"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Opcional. Use quando o pagamento costuma chegar com um nome diferente do
                        cliente — cônjuge, familiar ou empresa. Ajuda a identificar de quem é um
                        pagamento quando o nome não bate com o cliente.
                      </p>
                    </div>

                    <div className="space-y-3 border-t border-border pt-4">
                      <div>
                        <p className="text-sm font-medium">Dados para recebimento e repasse</p>
                        <p className="text-xs text-muted-foreground">
                          Cadastre a chave PIX, a conta bancária ou ambas.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label>Forma de recebimento</Label>
                        <Select
                          value={form.payment_kind}
                          onValueChange={(v) => setForm({ ...form, payment_kind: v })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="nao_informado">Ainda não informado</SelectItem>
                            <SelectItem value="pix">PIX</SelectItem>
                            <SelectItem value="conta">Conta bancária</SelectItem>
                            <SelectItem value="ambos">PIX e conta bancária</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {(form.payment_kind === "pix" || form.payment_kind === "ambos") && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label>Tipo da chave PIX</Label>
                            <Select
                              value={form.pix_key_type}
                              onValueChange={(v) => setForm({ ...form, pix_key_type: v })}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="cpf_cnpj">CPF/CNPJ</SelectItem>
                                <SelectItem value="telefone">Telefone</SelectItem>
                                <SelectItem value="email">E-mail</SelectItem>
                                <SelectItem value="aleatoria">Chave aleatória</SelectItem>
                                <SelectItem value="outro">Outro</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="pix">Chave PIX</Label>
                            <Input
                              id="pix"
                              value={form.pix_key}
                              onChange={(e) => setForm({ ...form, pix_key: e.target.value })}
                            />
                          </div>
                        </div>
                      )}

                      {(form.payment_kind === "conta" || form.payment_kind === "ambos") && (
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="space-y-2 sm:col-span-1">
                            <Label htmlFor="bank">Banco</Label>
                            <Input
                              id="bank"
                              value={form.bank}
                              onChange={(e) => setForm({ ...form, bank: e.target.value })}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="branch">Agência</Label>
                            <Input
                              id="branch"
                              value={form.branch}
                              onChange={(e) => setForm({ ...form, branch: e.target.value })}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="account">Número da conta</Label>
                            <Input
                              id="account"
                              value={form.account}
                              onChange={(e) => setForm({ ...form, account: e.target.value })}
                            />
                          </div>
                        </div>
                      )}

                      {form.payment_kind !== "nao_informado" && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="holder">Titular</Label>
                            <Input
                              id="holder"
                              placeholder={form.name || "Nome do titular"}
                              value={form.holder_name}
                              onChange={(e) => setForm({ ...form, holder_name: e.target.value })}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="holder-tax">CPF/CNPJ do titular</Label>
                            <Input
                              id="holder-tax"
                              placeholder={form.tax_id || "CPF/CNPJ"}
                              value={form.holder_tax_id}
                              onChange={(e) => setForm({ ...form, holder_tax_id: e.target.value })}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      onClick={() => (editingId ? update.mutate() : create.mutate())}
                      disabled={create.isPending || update.isPending || !form.name.trim()}
                    >
                      {create.isPending || update.isPending ? "Salvando…" : "Salvar"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )
        }
      />

      <div className="mb-4 max-w-sm">
        <Input
          placeholder="Buscar cliente…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
              <th className="p-3">Cliente</th>
              <th>CPF/CNPJ</th>
              <th>Contato</th>
              <th>PIX / Conta</th>
              <th className="text-right">Valor da cliente no escritório</th>
              <th className="text-right">Repassado</th>
              <th className="text-right">A repassar</th>
              {canWrite && <th className="p-3" />}
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
                  Nenhum cliente cadastrado.
                </td>
              </tr>
            )}
            {rows.map((c) => {
              const b = balanceOf(c.id);
              const payment = paymentOf(c.id);
              return (
                <tr key={c.id} className="border-b border-border/60 last:border-0">
                  <td className="p-3 font-medium">
                    {c.name}
                    {(c.payer_names ?? []).length > 0 && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        Também paga: {(c.payer_names ?? []).join(", ")}
                      </span>
                    )}
                  </td>
                  <td>{maskTaxId(c.tax_id)}</td>
                  <td className="text-muted-foreground">{c.phone || c.email || "—"}</td>
                  <td className="text-muted-foreground">
                    {payment?.pix_key
                      ? `PIX ••••${payment.pix_key.slice(-4)}`
                      : payment?.account
                        ? `${payment.bank || "Conta"} ${maskAccount(payment.account)}`
                        : "—"}
                  </td>
                  <td className="num text-right">{money(num(b?.received_client))}</td>
                  <td className="num text-right">{money(num(b?.transferred))}</td>
                  <td className="num text-right font-medium">{money(num(b?.pending_transfer))}</td>
                  {canWrite && (
                    <td className="p-3 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>
                        Editar
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost" className="text-destructive">
                            Excluir
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir {c.name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              O cliente deixa de aparecer nas listas, mas os acordos e recebimentos
                              já registrados são mantidos no histórico.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => remove.mutate(c.id)}>
                              Excluir
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </td>
                  )}
                </tr>
              );
            })}
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
    </>
  );
}
