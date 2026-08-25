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
import { friendlyError } from "@/lib/errors";
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
  const [editingId, setEditingId] = useState<string | null>(null);

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
    onError: (e: Error) => toast.error("Erro ao salvar", { description: friendlyError(e) }),
  });

  const update = useMutation({
    mutationFn: async () => {
      if (!editingId) throw new Error("Processo inválido");
      if (!form.client_id) throw new Error("Selecione o cliente");
      const { error } = await supabase
        .from("cases")
        .update({
          client_id: form.client_id,
          case_number: form.case_number.trim() || null,
          opposing_party: form.opposing_party.trim() || null,
          court: form.court.trim() || null,
          practice_area: form.practice_area.trim() || null,
          action_type: form.action_type.trim() || null,
          responsible_lawyer: form.responsible_lawyer.trim() || null,
          notes: form.notes.trim() || null,
        })
        .eq("id", editingId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Processo atualizado.");
      setForm(EMPTY);
      setEditingId(null);
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["processos"] });
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: friendlyError(e) }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("cases")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Processo removido.");
      void qc.invalidateQueries({ queryKey: ["processos"] });
    },
    onError: (e: Error) => toast.error("Erro ao remover", { description: friendlyError(e) }),
  });

  function openEdit(c: {
    id: string;
    client_id: string;
    case_number: string | null;
    opposing_party: string | null;
    court: string | null;
    practice_area: string | null;
    action_type: string | null;
    responsible_lawyer: string | null;
    notes: string | null;
  }) {
    setEditingId(c.id);
    setForm({
      client_id: c.client_id,
      case_number: c.case_number ?? "",
      opposing_party: c.opposing_party ?? "",
      court: c.court ?? "",
      practice_area: c.practice_area ?? "",
      action_type: c.action_type ?? "",
      responsible_lawyer: c.responsible_lawyer ?? "",
      notes: c.notes ?? "",
    });
    setOpen(true);
  }

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
            <Dialog
              open={open}
              onOpenChange={(v) => {
                setOpen(v);
                if (!v) {
                  setEditingId(null);
                  setForm(EMPTY);
                }
              }}
            >
              <DialogTrigger asChild>
                <Button
                  onClick={() => {
                    setEditingId(null);
                    setForm(EMPTY);
                  }}
                >
                  Novo processo
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editingId ? "Editar processo" : "Novo processo"}</DialogTitle>
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
                        onChange={(e) => setForm({ ...form, opposing_party: e.target.value })}
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
                        onChange={(e) => setForm({ ...form, practice_area: e.target.value })}
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
                        onChange={(e) => setForm({ ...form, responsible_lawyer: e.target.value })}
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
                    onClick={() => (editingId ? update.mutate() : create.mutate())}
                    disabled={create.isPending || update.isPending || !form.client_id}
                  >
                    {create.isPending || update.isPending ? "Salvando…" : "Salvar"}
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
              <th>Responsável</th>
              {canWrite && <th className="p-3" />}
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
                <td>{c.responsible_lawyer || "—"}</td>
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
                          <AlertDialogTitle>
                            Excluir o processo {c.case_number || "sem número"}?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            O processo deixa de aparecer nas listas, mas acordos e recebíveis já
                            vinculados a ele são mantidos.
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
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
