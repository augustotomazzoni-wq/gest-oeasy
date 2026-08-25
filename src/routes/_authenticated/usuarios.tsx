import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { createAppUser } from "@/lib/users.functions";
import { PageHeader } from "@/components/layout/AppLayout";
import { Tag } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth, ROLE_LABEL, type AppRole } from "@/hooks/useAuth";
import { dateBR } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/usuarios")({
  head: () => ({
    meta: [
      { title: "Usuários e Perfis de Acesso | Gestão Financeira do Escritório" },
      {
        name: "description",
        content:
          "Gestão de usuários e matriz de permissões do escritório: administrador principal, sócio gestor, financeiro, lançador, cobrança e consulta restrita.",
      },
      { property: "og:title", content: "Usuários e perfis de acesso" },
      {
        property: "og:description",
        content: "Controle de perfis e permissões do sistema financeiro do escritório.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: UsuariosPage,
});

const MODULES: { key: string; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "clientes", label: "Clientes" },
  { key: "processos", label: "Processos" },
  { key: "acordos", label: "Acordos e sentenças" },
  { key: "parcelas", label: "Parcelas e recebimentos" },
  { key: "cobrancas", label: "Cobranças" },
  { key: "repasses", label: "Repasses a clientes" },
  { key: "caixa", label: "Fluxo de caixa" },
  { key: "categorias", label: "Categorias" },
  { key: "contas", label: "Contas bancárias" },
  { key: "relatorios", label: "Relatórios" },
  { key: "importacao", label: "Importação" },
  { key: "usuarios", label: "Usuários" },
  { key: "perfis", label: "Perfis e permissões" },
];

const ACTIONS: { key: string; label: string }[] = [
  { key: "view", label: "Ver" },
  { key: "create", label: "Incluir" },
  { key: "edit", label: "Editar" },
  { key: "cancel_or_reverse", label: "Cancelar/estornar" },
  { key: "approve", label: "Aprovar" },
  { key: "export", label: "Exportar" },
];

const GLOBAL_ACTIONS: { key: string; label: string }[] = [
  { key: "manage_categories", label: "Administrar categorias" },
  { key: "manage_users", label: "Administrar usuários" },
  { key: "manage_roles", label: "Administrar perfis" },
  { key: "view_sensitive_financials", label: "Ver dados financeiros sensíveis" },
  { key: "confirm_direct_receipt", label: "Confirmar recebimento direto" },
  { key: "manage_collections", label: "Gerir cobranças" },
];

const EMPTY_NEW_USER = { email: "", full_name: "", password: "", role: "consulta" as AppRole };

function UsuariosPage() {
  const { isMainAdmin, allows, profile } = useAuth();
  const canManageUsers = allows("manage_users");
  const [tab, setTab] = useState<"usuarios" | "perfis">("usuarios");
  const [newUserOpen, setNewUserOpen] = useState(false);
  const [newUser, setNewUser] = useState(EMPTY_NEW_USER);
  const qc = useQueryClient();
  const runCreateAppUser = useServerFn(createAppUser);

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
    enabled: canManageUsers,
  });

  const { data: matrix } = useQuery({
    queryKey: ["role-matrix"],
    queryFn: async () => {
      const [defs, perms] = await Promise.all([
        supabase.from("role_definitions").select("*").order("name"),
        supabase.from("role_permissions").select("*"),
      ]);
      if (defs.error) throw defs.error;
      if (perms.error) throw perms.error;
      const set = new Set(
        (perms.data ?? [])
          .filter((p) => p.allowed)
          .map((p) => `${p.role_code}|${p.module}|${p.action}`),
      );
      return { defs: defs.data ?? [], set };
    },
    enabled: canManageUsers,
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
    onError: (e: Error) => toast.error("Erro", { description: friendlyError(e) }),
  });

  const setActive = useMutation({
    mutationFn: async ({ userId, active }: { userId: string; active: boolean }) => {
      const { error } = await supabase.from("profiles").update({ active }).eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Situação do usuário atualizada.");
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Erro", { description: friendlyError(e) }),
  });

  const createUser = useMutation({
    mutationFn: async () => {
      if (!newUser.email.trim()) throw new Error("Informe o e-mail");
      if (!newUser.full_name.trim()) throw new Error("Informe o nome completo");
      if (newUser.password.length < 8) throw new Error("A senha deve ter ao menos 8 caracteres");
      await runCreateAppUser({
        data: {
          email: newUser.email.trim(),
          full_name: newUser.full_name.trim(),
          password: newUser.password,
          role: newUser.role,
        },
      });
    },
    onSuccess: () => {
      toast.success("Usuário criado.");
      setNewUser(EMPTY_NEW_USER);
      setNewUserOpen(false);
      void qc.invalidateQueries({ queryKey: ["usuarios"] });
    },
    onError: (e: Error) =>
      toast.error("Não foi possível criar o usuário", { description: friendlyError(e) }),
  });

  const togglePerm = useMutation({
    mutationFn: async (p: {
      role_code: string;
      module: string;
      action: string;
      allowed: boolean;
    }) => {
      if (!profile) throw new Error("Sem organização");
      const { error } = await supabase.from("role_permissions").upsert(
        {
          organization_id: profile.organization_id,
          role_code: p.role_code,
          module: p.module,
          action: p.action,
          allowed: p.allowed,
        },
        { onConflict: "organization_id,role_code,module,action" },
      );
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["role-matrix"] }),
    onError: (e: Error) =>
      toast.error("Não foi possível alterar a permissão", { description: friendlyError(e) }),
  });

  if (!canManageUsers) {
    return (
      <>
        <PageHeader title="Usuários e Perfis de Acesso" />
        <div className="panel p-6 text-sm text-muted-foreground">
          Apenas o Administrador Principal e o Sócio Gestor podem gerenciar usuários.
        </div>
      </>
    );
  }

  const assignableRoles = (Object.keys(ROLE_LABEL) as AppRole[]).filter(
    (r) => isMainAdmin || r !== "admin",
  );

  return (
    <>
      <PageHeader
        title="Usuários e Perfis de Acesso"
        description="Defina o perfil de cada pessoa do escritório e o que cada perfil pode fazer."
        action={
          <Dialog
            open={newUserOpen}
            onOpenChange={(v) => {
              setNewUserOpen(v);
              if (!v) setNewUser(EMPTY_NEW_USER);
            }}
          >
            <DialogTrigger asChild>
              <Button>Novo usuário</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo usuário</DialogTitle>
                <DialogDescription>
                  A pessoa poderá entrar imediatamente com o e-mail e a senha definidos aqui.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="nu-name">Nome completo</Label>
                  <Input
                    id="nu-name"
                    value={newUser.full_name}
                    onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nu-email">E-mail</Label>
                  <Input
                    id="nu-email"
                    type="email"
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nu-pass">Senha provisória</Label>
                  <Input
                    id="nu-pass"
                    type="password"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">Mínimo de 8 caracteres.</p>
                </div>
                <div className="space-y-2">
                  <Label>Perfil de acesso</Label>
                  <Select
                    value={newUser.role}
                    onValueChange={(v) => setNewUser({ ...newUser, role: v as AppRole })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {assignableRoles.map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setNewUserOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={() => createUser.mutate()} disabled={createUser.isPending}>
                  {createUser.isPending ? "Criando…" : "Criar usuário"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="mb-5 flex gap-2">
        {(
          [
            ["usuarios", "Usuários"],
            ["perfis", "Perfis e permissões"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              tab === key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "usuarios" && (
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
                const current = (roles[0] ?? "consulta") as AppRole;
                const isSelf = p.id === profile?.id;
                const isProtected = current === "admin";
                const locked = isSelf || isProtected;
                return (
                  <tr key={p.id} className="border-b border-border/60 last:border-0">
                    <td className="p-3">
                      <span className="font-medium">{p.full_name || p.email}</span>
                      <span className="block text-xs text-muted-foreground">{p.email}</span>
                    </td>
                    <td>
                      {locked ? (
                        <Tag tone="info">{ROLE_LABEL[current]}</Tag>
                      ) : (
                        <Select
                          value={current}
                          onValueChange={(v) =>
                            setRole.mutate({ userId: p.id, role: v as AppRole })
                          }
                        >
                          <SelectTrigger className="w-56">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {assignableRoles.map((r) => (
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
                        disabled={locked}
                        onCheckedChange={(v) => setActive.mutate({ userId: p.id, active: v })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-border p-3 text-xs text-muted-foreground">
            O Administrador Principal é protegido: não pode ser desativado, rebaixado nem ter o
            e-mail alterado. Novos usuários entram como “Consulta Restrita”.
          </p>
        </div>
      )}

      {tab === "perfis" && (
        <div className="space-y-5">
          {!isMainAdmin && (
            <div className="panel p-4 text-sm text-muted-foreground">
              Somente o Administrador Principal pode alterar a matriz de permissões. Você está
              visualizando em modo leitura.
            </div>
          )}
          {(matrix?.defs ?? []).map((def) => {
            const readOnly = !isMainAdmin || def.code === "admin";
            return (
              <div key={def.id} className="panel overflow-x-auto">
                <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
                  <span className="font-medium">{def.name}</span>
                  {def.protected && <Tag tone="info">Protegido</Tag>}
                  {!def.active && <Tag tone="danger">Inativo</Tag>}
                  <span className="text-xs text-muted-foreground">{def.description}</span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
                      <th className="p-3">Módulo</th>
                      {ACTIONS.map((a) => (
                        <th key={a.key} className="p-2 text-center font-medium">
                          {a.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {MODULES.map((m) => (
                      <tr key={m.key} className="border-b border-border/60 last:border-0">
                        <td className="p-3">{m.label}</td>
                        {ACTIONS.map((a) => {
                          const checked = matrix?.set.has(`${def.code}|${m.key}|${a.key}`) ?? false;
                          return (
                            <td key={a.key} className="p-2 text-center">
                              <input
                                type="checkbox"
                                className="size-4 accent-[var(--primary)]"
                                checked={checked}
                                disabled={readOnly}
                                onChange={(e) =>
                                  togglePerm.mutate({
                                    role_code: def.code,
                                    module: m.key,
                                    action: a.key,
                                    allowed: e.target.checked,
                                  })
                                }
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    <tr className="bg-muted/40">
                      <td className="p-3 text-xs text-muted-foreground uppercase" colSpan={7}>
                        Permissões gerais
                      </td>
                    </tr>
                    {GLOBAL_ACTIONS.map((g) => {
                      const checked = matrix?.set.has(`${def.code}|global|${g.key}`) ?? false;
                      return (
                        <tr key={g.key} className="border-b border-border/60 last:border-0">
                          <td className="p-3">{g.label}</td>
                          <td className="p-2 text-center" colSpan={6}>
                            <input
                              type="checkbox"
                              className="size-4 accent-[var(--primary)]"
                              checked={checked}
                              disabled={readOnly}
                              onChange={(e) =>
                                togglePerm.mutate({
                                  role_code: def.code,
                                  module: "global",
                                  action: g.key,
                                  allowed: e.target.checked,
                                })
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
