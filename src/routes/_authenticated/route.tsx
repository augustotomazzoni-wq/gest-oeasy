import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { AppLayout, NAV } from "@/components/layout/AppLayout";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function Guard() {
  const { loading, session, profile, can, allows, isAdmin } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // O menu já esconde o que a pessoa não pode ver, mas o endereço da tela
  // continuava abrindo se fosse digitado. Aqui a mesma regra do menu vale
  // para a rota — e o banco aplica a mesma coisa na leitura dos dados.
  const liberada = (() => {
    if (pathname.startsWith("/usuarios")) return allows("manage_users");
    if (pathname.startsWith("/auditoria")) return isAdmin;
    const item = NAV.find((n) => pathname.startsWith(n.to));
    return item ? can(item.module, "view") : true;
  })();

  useEffect(() => {
    if (!loading && !session) void navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </div>
    );
  }

  if (profile && !profile.active) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="panel max-w-md p-6 text-center">
          <h1 className="font-display text-lg font-semibold">Acesso desativado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Seu acesso está desativado. Procure o administrador do escritório.
          </p>
        </div>
      </div>
    );
  }

  return (
    <AppLayout>
      {liberada ? (
        <Outlet />
      ) : (
        <div className="panel max-w-md p-6">
          <h1 className="font-display text-lg font-semibold">Sem acesso a esta tela</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Seu perfil não tem permissão para ver esta parte do sistema. Se você precisa dela, peça
            ao Administrador para liberar em Usuários e Acessos.
          </p>
        </div>
      )}
    </AppLayout>
  );
}

function AuthenticatedLayout() {
  return (
    <AuthProvider>
      <Guard />
    </AuthProvider>
  );
}
