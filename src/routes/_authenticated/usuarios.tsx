import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/AppLayout";
import { Tag } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth, type AppRole } from "@/hooks/useAuth";
import { dateBR } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/usuarios")({
  head: () => ({
    meta: [
      { title: "Usuários e Acessos | Gestão Financeira do Escritório" },
      {
        name: "description",
        content:
          "Gestão de usuários do escritório: perfis de acesso administrador, financeiro, advogado e consulta.",
      },
      { property: "og:title", content: "Usuários e acessos" },
      {
        property: "og:description",
        content: "Controle de permissões dos usuários do sistema financeiro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: UsuariosPage,
});

const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Administrador",
  financeiro: "Financeiro",
  advogado: "Advogado",
  consulta: "Somente consulta",
};

function UsuariosPage() {
  const { isAdmin, profile } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["usuarios"],
    queryFn: async () => {
      const [profiles, roles] = await Promise.all([
        supabase.from("profiles").select("*").order("full_name"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (profiles.error) throw profiles.error;
      const map = new Map<string, AppRole[]>();
      for (const r of roles.data ?? []) {
        map.set(r.user_id, [...(map.get(r.user_id) ?? []), r.role as AppRole]);
      }
      return { profiles: profiles.data ?? [], roles: map };
    },
    enabled: isAdmin,
  });

  const setRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const del = await supabase.from("user_roles").delete().eq("user_id", userId);
      if (del.error) throw del.error;
      const { error } = await supabase
        .from("user_roles")
        .insert({ user_id: userId, role: role as never });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Perfil de acesso atualizado.");
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  const setActive = useMutation({
    mutationFn: async ({ userId, active }: { userId: string; active: boolean }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ active })
        .eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Situação do usuário atualizada.");
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Usuários e Acessos" />
        <div className="panel p-6 text-sm text-muted-foreground">
          Apenas administradores podem gerenciar usuários.
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Usuários e Acessos"
        description="Defina o perfil de cada pessoa do escritório e ative ou desative acessos."
      />

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
              <th className="p-3">Usuário</th>
              <th>Perfil</th>
              <th>Último acesso</th>
              <th className="p-3 text-right">Ativo</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-muted-foreground">
                  Carregando…
                </td>
              </tr>
            )}
            {(data?.profiles ?? []).map((p) => {
              const roles = data?.roles.get(p.id) ?? [];
              const current = roles[0] ?? "consulta";
              const isSelf = p.id === profile?.id;
              return (
                <tr key={p.id} className="border-b border-border/60 last:border-0">
                  <td className="p-3">
                    <span className="font-medium">{p.full_name || p.email}</span>
                    <span className="block text-xs text-muted-foreground">{p.email}</span>
                  </td>
                  <td>
                    {isSelf ? (
                      <Tag tone="info">{ROLE_LABEL[current as AppRole]}</Tag>
                    ) : (
                      <Select
                        value={current}
                        onValueChange={(v) =>
                          setRole.mutate({ userId: p.id, role: v as AppRole })
                        }
                      >
                        <SelectTrigger className="w-48">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(ROLE_LABEL) as AppRole[]).map((r) => (
                            <SelectItem key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                  <td>{dateBR(p.last_sign_in_at)}</td>
                  <td className="p-3 text-right">
                    <Switch
                      checked={p.active}
                      disabled={isSelf}
                      onCheckedChange={(v) =>
                        setActive.mutate({ userId: p.id, active: v })
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Novos usuários recebem o perfil "Somente consulta" ao criar a conta; um
        administrador deve promovê-los aqui.
      </p>
    </>
  );
}
