import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Acesso restrito | Gestão Financeira do Escritório" },
      {
        name: "description",
        content:
          "Entrada segura no sistema de gestão financeira do escritório: acordos, parcelas, repasses e fluxo de caixa.",
      },
      { property: "og:title", content: "Acesso restrito | Gestão Financeira" },
      {
        property: "og:description",
        content: "Sistema interno de controle financeiro do escritório de advocacia.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) void navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      toast.error("Não foi possível entrar", { description: error.message });
      return;
    }
    void navigate({ to: "/dashboard" });
  }

  async function handleReset() {
    if (!email) {
      toast.error("Informe o e-mail para redefinir a senha.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth`,
    });
    setBusy(false);
    if (error) toast.error("Falha ao enviar", { description: error.message });
    else toast.success("Enviamos as instruções para o seu e-mail.");
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div>
          <p className="font-display text-lg font-semibold">Hoffmann &amp; Tomazzoni</p>
          <p className="text-sm text-sidebar-foreground/60">Gestão Financeira</p>
        </div>
        <div className="max-w-sm">
          <h2 className="font-display text-3xl leading-tight font-semibold">
            Cada real no lugar certo.
          </h2>
          <p className="mt-4 text-sm text-sidebar-foreground/70">
            Controle de acordos, parcelas, honorários e repasses com separação rigorosa
            entre o dinheiro do escritório e o dinheiro do cliente.
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">
          Acesso interno. Cadastro público desabilitado.
        </p>
      </div>

      <div className="flex items-center justify-center p-6">
        <form onSubmit={handleSignIn} className="panel w-full max-w-sm p-8">
          <h1 className="font-display text-xl font-semibold">Entrar</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Use as credenciais fornecidas pelo administrador.
          </p>

          <div className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <Button type="submit" className="mt-6 w-full" disabled={busy}>
            {busy ? "Entrando…" : "Entrar"}
          </Button>

          <button
            type="button"
            className="mt-4 w-full text-sm text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => {
              setRecovering(true);
              void handleReset();
            }}
            disabled={busy}
          >
            {recovering ? "Reenviar instruções de redefinição" : "Esqueci minha senha"}
          </button>
        </form>
      </div>
    </div>
  );
}
