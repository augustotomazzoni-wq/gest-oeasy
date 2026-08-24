# Correções da auditoria — segurança, financeiro e usabilidade

Este documento resume as correções aplicadas a partir da auditoria técnica de 24/08/2026 (segurança, integridade financeira e experiência de uso).

## Migração obrigatória

Antes de usar o app com estas mudanças, aplique a migration:

`supabase/migrations/20260824120000_correcoes_auditoria.sql`

Ela ajusta políticas de acesso (RLS), acrescenta travas de valor negativo e de sobrepagamento, e cria a função transacional de criação de acordo. As novas constraints de valor entram como `NOT VALID` (não travam a migration por causa de dado antigo) — depois de confirmar que os lançamentos atuais estão corretos, valide-as com os comandos `VALIDATE CONSTRAINT` comentados no início do arquivo da migration.

**Recomendação:** aplique primeiro em um ambiente de teste/staging antes de produção.

## Segurança

- a leitura da chave PIX/conta de destino dos clientes (tela de Repasses) e dos dados bancários do escritório agora exige permissão financeira, não basta estar logado;
- o perfil Sócio Gestor (e qualquer perfil com a permissão "administrar usuários") agora consegue de fato alterar o papel de um usuário — antes a ação falhava sempre por falta de permissão no banco;
- a dependência `xlsx`, usada na importação de planilhas, foi atualizada para uma versão sem as vulnerabilidades conhecidas da anterior.

## Integridade financeira

- honorários, sucumbência, valor da cliente e reembolso de custas não podem mais ser gravados como número negativo, nem pela tela nem por fora dela;
- criar um acordo e o cronograma de parcelas agora acontece em uma única operação no banco — se algo falhar no meio, nada fica gravado pela metade;
- duas pessoas não conseguem mais registrar recebimento da mesma parcela ao mesmo tempo além do valor devido;
- os perfis **Lançador Financeiro** (lançamentos de caixa) e **Cobrança e Recebíveis** (confirmação de recebimento direto pela cliente) agora conseguem de fato usar as telas para as quais foram criados;
- marcar um repasse como pago e cadastrar um cliente com dados de pagamento agora ficam registrados na auditoria, como as demais ações financeiras;
- lançar dinheiro no caixa do escritório ou marcar um repasse como pago passa a exigir a conta bancária, evitando saldo por conta divergente do resultado do mês.

## Uso do dia a dia

- clientes, processos, contas bancárias e categorias agora podem ser editados e excluídos (com confirmação) — antes só era possível cadastrar;
- mensagens de erro do banco de dados foram trocadas por avisos em português que dizem o que fazer, em vez do texto técnico original;
- a tela de Usuários ganhou o botão "Novo usuário", que já existia pronto no sistema mas não estava conectado a nada;
- reimportar uma planilha depois de uma falha no meio do caminho não duplica mais acordos e parcelas já importados;
- as telas de erro e "página não encontrada" agora estão em português;
- os cartões do painel ("Parcelas atrasadas", "Vencem em 7/30 dias") levam direto para a lista já filtrada;
- o assistente de novo acordo avisa o problema assim que ele acontece, sem esperar o último passo;
- listas grandes (clientes, parcelas) carregam as primeiras 50 linhas e têm um botão "Mostrar mais", em vez de tudo de uma vez;
- acordos e repasses agora usam a mesma cor por situação em toda a tela.

## O que foi avaliado e mantido como está

- o mascaramento de PIX/conta na lista de clientes é só visual — quem tem permissão para editar o cliente já vê o valor completo em outros pontos da tela, então isso não é uma falha de segurança, e sim uma limitação conhecida da máscara;
- a tolerância de R$ 0,01 no fechamento do cronograma de parcelas foi conferida e está consistente com o restante do sistema — não havia inconsistência real a corrigir ali;
- edição/exclusão de acordos já criados não foi incluída nesta rodada: ao contrário de cliente/processo/conta/categoria, um acordo tem cronograma e recebimentos vinculados, e mexer nisso depois de criado merece um desenho próprio (o que fazer com parcelas já pagas, por exemplo) em vez de um editar genérico.

## Verificações realizadas

- build de produção concluído com sucesso;
- checagem de tipos (`tsc --noEmit`) sem erros;
- ESLint sem erros nos arquivos alterados;
- tipos do Supabase atualizados para a nova função `create_agreement_with_schedule`.
