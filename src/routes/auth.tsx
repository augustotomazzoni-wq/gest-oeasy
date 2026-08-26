import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { friendlyError } from "@/lib/errors";
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

const MIN_PASSWORD = 8;

/**
 * O link de redefinição que o Supabase manda por e-mail volta para esta tela
 * com `type=recovery` no fragmento da URL. Lemos isso já na primeira
 * renderização porque o supabase-js limpa a URL assim que processa o token —
 * se dependêssemos só do evento, um recarregamento perderia o estado e a
 * pessoa cairia direto no sistema sem nunca definir a senha nova.
 */
function hashHasRecovery(): boolean {
  if (typeof window === "undefined") return false;
  return /(^|[#&])type=recovery(&|$)/.test(window.location.hash);
}

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const [recoveryMode, setRecoveryMode] = useState(hashHasRecovery);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // Em recuperação existe uma sessão válida, mas ela serve só para trocar a
    // senha — entrar direto aqui é o bug que fazia o fluxo nunca se completar.
    if (recoveryMode) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) void navigate({ to: "/dashboard" });
    });
  }, [navigate, recoveryMode]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      toast.error("Não foi possível entrar", { description: friendlyError(error) });
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
    if (error) {
      toast.error("Falha ao enviar", { description: friendlyError(error) });
      return;
    }
    setResetSent(true);
    toast.success("Enviamos as instruções para o seu e-mail.");
  }

  async function handleNewPassword(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (newPassword.length < MIN_PASSWORD) {
      toast.error(`A senha deve ter ao menos ${MIN_PASSWORD} caracteres.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("As duas senhas não são iguais.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setBusy(false);
    if (error) {
      toast.error("Não foi possível alterar a senha", { description: friendlyError(error) });
      return;
    }
    toast.success("Senha alterada. Você já está conectado.");
    setRecoveryMode(false);
    void navigate({ to: "/dashboard" });
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
            Controle de acordos, parcelas, honorários e repasses com separação rigorosa entre o
            dinheiro do escritório e o dinheiro do cliente.
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">
          Acesso interno. Cadastro público desabilitado.
        </p>
      </div>

      <div className="flex items-center justify-center p-6">
        {recoveryMode ? (
          <form onSubmit={handleNewPassword} className="panel w-full max-w-sm p-8">
            <h1 className="font-display text-xl font-semibold">Definir nova senha</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Escolha a senha que você vai usar a partir de agora.
            </p>

            <div className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">Nova senha</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Mínimo de {MIN_PASSWORD} caracteres.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Repita a nova senha</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
                {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                  <p className="text-xs text-destructive">As duas senhas não são iguais.</p>
                )}
              </div>
            </div>

            <Button type="submit" className="mt-6 w-full" disabled={busy}>
              {busy ? "Salvando…" : "Salvar nova senha"}
            </Button>
          </form>
        ) : (
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
              onClick={() => void handleReset()}
              disabled={busy}
            >
              {resetSent ? "Reenviar instruções de redefinição" : "Esqueci minha senha"}
            </button>

            {resetSent && (
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Abra o link que enviamos por e-mail para escolher a nova senha.
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
