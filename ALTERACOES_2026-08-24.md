# Alterações específicas — clientes, acordos e recebimentos

## O que foi implementado

- cadastro de PIX, conta bancária ou ambos junto com o novo cliente;
- exibição mascarada do PIX ou da conta na relação de clientes;
- criação atômica do cliente e dos dados de pagamento no banco;
- entrada separada no acordo, com valor e data próprios;
- número de parcelas do saldo restante;
- distribuição proporcional, com prioridade para o escritório ou manual;
- edição individual da data, do valor total e das partes do escritório, cliente e reembolso em cada parcela;
- validação do fechamento do cronograma com tolerância de R$ 0,01;
- identificação da entrada e das parcelas na tela de recebimentos;
- baixa detalhada com valor do escritório, valor da cliente, valor recebido pelo escritório e valor recebido diretamente pela cliente;
- recebimento direto pela cliente sem entrada indevida no caixa do escritório;
- cálculo do valor da cliente que entrou no escritório e permanece pendente de repasse;
- justificativa e auditoria quando a composição recebida for diferente da composição prevista.

## Migração obrigatória

Antes de utilizar as novas telas, aplique a migration:

`supabase/migrations/20260824090000_client_payment_schedule_receipts.sql`

Ela acrescenta os campos de destino do recebimento, corrige a sincronização do caixa, atualiza as views financeiras e cria a função transacional usada no cadastro do cliente.

## Verificações realizadas

- build de produção concluído com sucesso;
- arquivos alterados aprovados pelo ESLint;
- tipos do Supabase atualizados para os novos campos e função.
