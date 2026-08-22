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
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/processos")({
  head: () => ({
    meta: [
      { title: "Processos | Gestão Financeira do Escritório" },
      {
        name: "description",
        content:
          "Cadastro de processos com cliente, parte contrária, vara, área do direito e advogado responsável.",
      },
      { property: "og:title", content: "Processos do escritório" },
      {
        property: "og:description",
        content: "Processos vinculados a clientes e recebíveis.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProcessosPage,
});

const EMPTY = {
  client_id: "",
  case_number: "",
  opposing_party: "",
  court: "",
  practice_area: "",
  action_type: "",
  responsible_lawyer: "",
  notes: "",
};

function ProcessosPage() {
  const { profile, canWrite } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(EMPTY);

  const { data, isLoading } = useQuery({
    queryKey: ["processos"],
    queryFn: async () => {
      const [cases, clients] = await Promise.all([
        supabase
          .from("cases")
          .select("*, clients(name)")
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
        supabase.from("clients").select("id, name").is("deleted_at", null).order("name"),
      ]);
      if (cases.error) throw cases.error;
      return { cases: cases.data ?? [], clients: clients.data ?? [] };
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Perfil não carregado");
      if (!form.client_id) throw new Error("Selecione o cliente");
      const { error } = await supabase.from("cases").insert({
        organization_id: profile.organization_id,
        created_by: profile.id,
        client_id: form.client_id,
        case_number: form.case_number.trim() || null,
        opposing_party: form.opposing_party.trim() || null,
        court: form.court.trim() || null,
        practice_area: form.practice_area.trim() || null,
        action_type: form.action_type.trim() || null,
        responsible_lawyer: form.responsible_lawyer.trim() || null,
        notes: form.notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Processo cadastrado.");
      setForm(EMPTY);
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["processos"] });
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: e.message }),
  });

  const rows = (data?.cases ?? []).filter((c) => {
    const term = search.toLowerCase();
    return (
      !term ||
      (c.case_number ?? "").toLowerCase().includes(term) ||
      (c.opposing_party ?? "").toLowerCase().includes(term) ||
      ((c.clients as { name: string } | null)?.name ?? "").toLowerCase().includes(term)
    );
  });

  return (
    <>
      <PageHeader
        title="Processos"
        description="Processos e casos vinculados aos clientes do escritório."
        action={
          canWrite && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>Novo processo</Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Novo processo</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label>Cliente</Label>
                    <Select
                      value={form.client_id}
                      onValueChange={(v) => setForm({ ...form, client_id: v })}
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
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="num">Nº do processo</Label>
                      <Input
                        id="num"
                        value={form.case_number}
                        onChange={(e) => setForm({ ...form, case_number: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rec">Reclamado / parte contrária</Label>
                      <Input
                        id="rec"
                        value={form.opposing_party}
                        onChange={(e) =>
                          setForm({ ...form, opposing_party: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="court">Tribunal / vara</Label>
                      <Input
                        id="court"
                        value={form.court}
                        onChange={(e) => setForm({ ...form, court: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="area">Área do direito</Label>
                      <Input
                        id="area"
                        value={form.practice_area}
                        onChange={(e) =>
                          setForm({ ...form, practice_area: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="acao">Tipo de ação</Label>
                      <Input
                        id="acao"
                        value={form.action_type}
                        onChange={(e) => setForm({ ...form, action_type: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="adv">Advogado responsável</Label>
                      <Input
                        id="adv"
                        value={form.responsible_lawyer}
                        onChange={(e) =>
                          setForm({ ...form, responsible_lawyer: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="obs">Observações</Label>
                    <Textarea
                      id="obs"
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={() => create.mutate()}
                    disabled={create.isPending || !form.client_id}
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
          placeholder="Buscar por processo, cliente ou parte contrária…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
              <th className="p-3">Cliente</th>
              <th>Nº do processo</th>
              <th>Parte contrária</th>
              <th>Área</th>
              <th className="p-3">Responsável</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  Carregando…
                </td>
              </tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  Nenhum processo cadastrado.
                </td>
              </tr>
            )}
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-border/60 last:border-0">
                <td className="p-3 font-medium">
                  {(c.clients as { name: string } | null)?.name ?? "—"}
                </td>
                <td className="num">{c.case_number || "—"}</td>
                <td>{c.opposing_party || "—"}</td>
                <td>{c.practice_area || "—"}</td>
                <td className="p-3">{c.responsible_lawyer || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
