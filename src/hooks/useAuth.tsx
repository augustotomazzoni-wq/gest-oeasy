import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole =
  | "admin"
  | "socio_gestor"
  | "financeiro"
  | "lancador"
  | "cobranca"
  | "advogado"
  | "consulta";

export const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Administrador Principal",
  socio_gestor: "Sócio Gestor",
  financeiro: "Financeiro",
  lancador: "Lançador Financeiro",
  cobranca: "Cobrança e Recebíveis",
  advogado: "Advogado",
  consulta: "Consulta Restrita",
};

export type PermAction =
  | "view"
  | "create"
  | "edit"
  | "cancel_or_reverse"
  | "approve"
  | "export";

export type GlobalAction =
  | "manage_categories"
  | "manage_users"
  | "manage_roles"
  | "view_sensitive_financials"
  | "confirm_direct_receipt"
  | "manage_collections";

type Profile = {
  id: string;
  organization_id: string;
  full_name: string;
  email: string;
  active: boolean;
};

type AuthState = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  roles: AppRole[];
  isAdmin: boolean;
  isMainAdmin: boolean;
  canWrite: boolean;
  can: (module: string, action: PermAction) => boolean;
  allows: (action: GlobalAction) => boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);


  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) {
        setProfile(null);
        setRoles([]);
        setLoading(false);
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const [{ data: prof }, { data: roleRows }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, organization_id, full_name, email, active")
          .eq("id", userId)
          .maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", userId),
      ]);
      if (cancelled) return;
      setProfile((prof as Profile) ?? null);
      setRoles((roleRows ?? []).map((r) => r.role as AppRole));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user.id]);

  const isAdmin = roles.includes("admin");
  const canWrite = isAdmin || roles.includes("financeiro");

  return (
    <AuthContext.Provider
      value={{
        loading,
        session,
        user: session?.user ?? null,
        profile,
        roles,
        isAdmin,
        canWrite,
        signOut: async () => {
          await supabase.auth.signOut();
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de AuthProvider");
  return ctx;
}
