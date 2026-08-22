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
import { useAuth } from "@/hooks/useAuth";
import { maskTaxId, money, num } from "@/lib/format";
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

function ClientesPage() {
  const { profile, canWrite } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    tax_id: "",
    phone: "",
    email: "",
    notes: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["clientes"],
    queryFn: async () => {
      const [clients, balances] = await Promise.all([
        supabase
          .from("clients")
          .select("*")
          .is("deleted_at", null)
          .order("name"),
        supabase.from("v_client_balances").select("*"),
      ]);
      if (clients.error) throw clients.error;
      return { clients: clients.data ?? [], balances: balances.data ?? [] };
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Perfil não carregado");
      const { error } = await supabase.from("clients").insert({
        organization_id: profile.organization_id,
        created_by: profile.id,
        name: form.name.trim(),
        tax_id: form.tax_id.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        notes: form.notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cliente cadastrado.");
      setForm({ name: "", tax_id: "", phone: "", email: "", notes: "" });
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["clientes"] });
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: e.message }),
  });

  const rows = (data?.clients ?? []).filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );
  const balanceOf = (id: string) =>
    data?.balances.find((b) => b.client_id === id) as
      | { received_client: number; transferred: number; pending_transfer: number }
      | undefined;

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Cadastro e situação financeira de cada cliente."
        action={
          canWrite && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>Novo cliente</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Novo cliente</DialogTitle>
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
                </div>
                <DialogFooter>
                  <Button
                    onClick={() => create.mutate()}
                    disabled={create.isPending || !form.name.trim()}
                  >
                    {create.isPending ? "Salvando…" : "Salvar"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
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
              <th className="text-right">Recebido do cliente</th>
              <th className="text-right">Repassado</th>
              <th className="p-3 text-right">A repassar</th>
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
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  Nenhum cliente cadastrado.
                </td>
              </tr>
            )}
            {rows.map((c) => {
              const b = balanceOf(c.id);
              return (
                <tr key={c.id} className="border-b border-border/60 last:border-0">
                  <td className="p-3 font-medium">{c.name}</td>
                  <td>{maskTaxId(c.tax_id)}</td>
                  <td className="text-muted-foreground">{c.phone || c.email || "—"}</td>
                  <td className="num text-right">{money(num(b?.received_client))}</td>
                  <td className="num text-right">{money(num(b?.transferred))}</td>
                  <td className="num p-3 text-right font-medium">
                    {money(num(b?.pending_transfer))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
