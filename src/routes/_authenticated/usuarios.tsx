import { createFileRoute, redirect } from "@tanstack/react-router";

// Esta tela agora é uma aba de Configurações. O endereço antigo continua
// funcionando para quem tinha salvo nos favoritos.
export const Route = createFileRoute("/_authenticated/usuarios")({
  beforeLoad: () => {
    throw redirect({ to: "/configuracoes", search: { aba: "usuarios" } });
  },
  component: () => null,
});
