import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ResultadoSync } from "@/lib/advbox-sync.server";

/**
 * A ponte entre a tela e a Advbox.
 *
 * Tudo aqui roda no servidor. O token fica guardado no banco numa tabela
 * que o navegador não lê, e estas funções são o único caminho até ele —
 * nem o Administrador consegue puxar o valor de volta para a tela, só
 * conferir os quatro últimos caracteres e trocar por outro.
 */

export type StatusAdvbox = {
  configurado: boolean;
  ativo: boolean;
  tokenDica: string | null;
  ultimaSincronizacao: string | null;
  ultimoResultado: string | null;
};

// ============================================================
// Quem pode o quê
// ============================================================

/** Devolve a organização de quem chamou, e se essa pessoa é Administradora. */
async function quemChamou(userId: string): Promise<{ organizationId: string; admin: boolean }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const [{ data: perfil }, { data: papeis }] = await Promise.all([
    supabaseAdmin.from("profiles").select("organization_id, active").eq("id", userId).maybeSingle(),
    supabaseAdmin.from("user_roles").select("role").eq("user_id", userId),
  ]);

  if (!perfil?.organization_id) throw new Error("Seu usuário não está vinculado a um escritório.");
  if (perfil.active === false) throw new Error("Seu acesso está desativado.");

  return {
    organizationId: perfil.organization_id,
    admin: (papeis ?? []).some((p) => p.role === "admin"),
  };
}

async function exigirAdmin(userId: string): Promise<string> {
  const { organizationId, admin } = await quemChamou(userId);
  if (!admin) throw new Error("Só o Administrador Principal configura a integração com a Advbox.");
  return organizationId;
}

// ============================================================
// Configuração
// ============================================================

export const statusAdvbox = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StatusAdvbox> => {
    const organizationId = await exigirAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin
      .from("advbox_integracao")
      .select("token_dica, ativo, ultima_sincronizacao, ultimo_resultado")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (error) {
      throw new Error(
        "Não foi possível ler a configuração da Advbox. Confira se a atualização do banco já foi aplicada.",
      );
    }

    return {
      configurado: Boolean(data),
      ativo: data?.ativo ?? false,
      tokenDica: data?.token_dica ?? null,
      ultimaSincronizacao: data?.ultima_sincronizacao ?? null,
      ultimoResultado: data?.ultimo_resultado ?? null,
    };
  });

const tokenSchema = z.object({
  token: z.string().trim().min(20, "O token parece curto demais — copie o valor inteiro."),
});

export const salvarTokenAdvbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => tokenSchema.parse(d))
  .handler(async ({ data, context }) => {
    const organizationId = await exigirAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { testarToken } = await import("@/lib/advbox-sync.server");

    // Guardar um token que não funciona só adiaria o erro para a hora de
    // atualizar. Testa antes de gravar.
    await testarToken(data.token);

    const { data: perfil } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", context.userId)
      .maybeSingle();

    const { error } = await supabaseAdmin.from("advbox_integracao").upsert(
      {
        organization_id: organizationId,
        token: data.token,
        token_dica: data.token.slice(-4),
        ativo: true,
        updated_at: new Date().toISOString(),
        updated_by: context.userId,
        updated_by_email: perfil?.email ?? null,
      },
      { onConflict: "organization_id" },
    );
    if (error) throw new Error("Não foi possível guardar o token.");

    return { ok: true };
  });

export const ligarDesligarAdvbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ativo: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const organizationId = await exigirAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin
      .from("advbox_integracao")
      .update({ ativo: data.ativo, updated_at: new Date().toISOString() })
      .eq("organization_id", organizationId);
    if (error) throw new Error("Não foi possível mudar a integração.");

    return { ok: true };
  });

export const removerTokenAdvbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const organizationId = await exigirAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin
      .from("advbox_integracao")
      .delete()
      .eq("organization_id", organizationId);
    if (error) throw new Error("Não foi possível apagar o token.");

    return { ok: true };
  });

// ============================================================
// Atualizar
// ============================================================

const atualizarSchema = z.object({ tipo: z.enum(["clientes", "processos"]) });

export const atualizarDaAdvbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => atualizarSchema.parse(d))
  .handler(async ({ data, context }): Promise<ResultadoSync> => {
    const { organizationId, admin } = await quemChamou(context.userId);

    // Atualizar escreve no cadastro, então pede a mesma permissão de quem
    // cadastra à mão. O Administrador passa direto.
    if (!admin) {
      const { data: pode, error } = await context.supabase.rpc("can", {
        _module: data.tipo,
        _action: "create",
      });
      if (error) throw new Error("Não foi possível validar suas permissões.");
      if (!pode) throw new Error(`Você não tem permissão para alterar o cadastro de ${data.tipo}.`);
    }

    const sync = await import("@/lib/advbox-sync.server");
    return data.tipo === "clientes"
      ? sync.sincronizarClientes(organizationId, context.userId)
      : sync.sincronizarProcessos(organizationId, context.userId);
  });
