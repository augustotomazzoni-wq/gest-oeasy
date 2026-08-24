import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ROLES = [
  "admin",
  "socio_gestor",
  "financeiro",
  "lancador",
  "cobranca",
  "advogado",
  "consulta",
] as const;

const createUserSchema = z.object({
  email: z.string().email("Informe um e-mail válido"),
  full_name: z.string().min(2, "Informe o nome completo"),
  password: z.string().min(8, "A senha deve ter ao menos 8 caracteres"),
  role: z.enum(ROLES),
});

export const createAppUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createUserSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: canManage, error: permError } = await context.supabase.rpc("can", {
      _module: "global",
      _action: "manage_users",
    });
    if (permError) throw new Error("Não foi possível validar suas permissões.");
    if (!canManage) throw new Error("Você não tem permissão para criar usuários.");

    const { data: me } = await context.supabase
      .from("profiles")
      .select("email, organization_id")
      .eq("id", context.userId)
      .maybeSingle();

    const isMainAdmin = (me?.email ?? "").toLowerCase() === "augusto.tomazzoni@gmail.com";
    if (data.role === "admin" && !isMainAdmin) {
      throw new Error("Somente o Administrador Principal pode conceder esse perfil.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email.trim().toLowerCase(),
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name.trim() },
    });
    if (created.error || !created.data.user) {
      throw new Error(created.error?.message ?? "Não foi possível criar o usuário.");
    }

    const userId = created.data.user.id;

    await supabaseAdmin
      .from("profiles")
      .update({ full_name: data.full_name.trim() })
      .eq("id", userId);

    if (data.role !== "consulta") {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
      const { error } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: userId, role: data.role });
      if (error) throw new Error("Usuário criado, mas o perfil não pôde ser aplicado.");
    }

    return { id: userId, email: data.email };
  });
