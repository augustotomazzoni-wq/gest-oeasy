import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  Users,
  Briefcase,
  Handshake,
  CalendarClock,
  Send,
  Wallet,
  Landmark,
  Settings,
  ShieldCheck,
  LogOut,
  Menu,
  Upload,
  X,
} from "lucide-react";
import { useAuth, ROLE_LABEL, type AppRole } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// `module` é o módulo da matriz de permissões que libera a tela. Quem não tem
// a permissão não vê o item: antes o menu mostrava tudo e as telas abriam
// zeradas (o RLS filtra as linhas em vez de dar erro), o que fazia "R$ 0,00"
// parecer um fato em vez de falta de acesso.
const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, module: "dashboard" },
  { to: "/clientes", label: "Clientes", icon: Users, module: "clientes" },
  { to: "/processos", label: "Processos", icon: Briefcase, module: "processos" },
  { to: "/acordos", label: "Acordos e Sentenças", icon: Handshake, module: "acordos" },
  { to: "/parcelas", label: "Parcelas e Recebimentos", icon: CalendarClock, module: "parcelas" },
  { to: "/repasses", label: "Repasses a Clientes", icon: Send, module: "repasses" },
  { to: "/caixa", label: "Fluxo de Caixa", icon: Wallet, module: "caixa" },
  { to: "/emprestimos", label: "Empréstimos", icon: Landmark, module: "caixa" },
  { to: "/importar", label: "Importar Planilha", icon: Upload, module: "importacao" },
  { to: "/configuracoes", label: "Configurações", icon: Settings, module: "contas" },
] as const;

export function AppLayout({ children }: { children: ReactNode }) {
  const { profile, roles, allows, can, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const visible = NAV.filter((item) => can(item.module, "view"));
  const items = allows("manage_users")
    ? [
        ...visible,
        { to: "/usuarios", label: "Usuários e Acessos", icon: ShieldCheck, module: "usuarios" },
      ]
    : visible;

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-sidebar text-sidebar-foreground transition-transform lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between border-b border-sidebar-border px-5 py-4">
          <div>
            <p className="font-display text-sm font-semibold tracking-tight">
              Hoffmann &amp; Tomazzoni
            </p>
            <p className="text-xs text-sidebar-foreground/60">Gestão Financeira</p>
          </div>
          <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Fechar menu">
            <X className="size-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {items.map((item) => {
            const active = pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <item.icon className="size-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-4">
          <p className="truncate text-sm font-medium">{profile?.full_name || profile?.email}</p>
          <p className="text-xs text-sidebar-foreground/60">
            {roles.map((r) => ROLE_LABEL[r as AppRole] ?? r).join(", ") || "sem perfil"}
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3 w-full"
            onClick={() => void signOut()}
          >
            <LogOut className="size-4" /> Sair
          </Button>
        </div>
      </aside>

      {open && (
        <button
          aria-label="Fechar menu"
          className="fixed inset-0 z-30 bg-foreground/40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="Abrir menu">
            <Menu className="size-5" />
          </button>
          <span className="font-display text-sm font-semibold">Gestão Financeira</span>
        </header>
        <main className="min-w-0 flex-1 p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-semibold">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
