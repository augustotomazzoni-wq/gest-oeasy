# Atualização de 26/08/2026 — versão final

Este pacote inclui **tudo** das rodadas anteriores. Se você não aplicou os zips anteriores, use só este.

## Como aplicar

**1. Banco (Supabase → SQL Editor → Run)**

Confirme primeiro se as migrations anteriores já rodaram:

```sql
select column_name from information_schema.columns
where table_name = 'clients' and column_name = 'payer_names';
```

- **Se voltar vazio:** rode antes, nesta ordem, os arquivos que já estão em `supabase/migrations/`:
  `20260824090000_...`, `20260824120000_...`, `20260825120000_...`
- **Depois** (ou direto, se a consulta retornou a linha), rode **nesta ordem** os dois novos:
  1. `20260826120000_correcoes_varredura.sql`
  2. `20260826150000_estorno_e_cancelamento.sql`

A ordem importa: o segundo arquivo reescreve funções que o primeiro cria.

**2. Código:** copie os arquivos por cima da sua pasta clonada, mantendo os caminhos, e faça commit + push pelo GitHub Desktop.

---

## Novidades desta rodada

### Redefinir senha agora funciona
Antes, o link do e-mail entrava direto no sistema sem nunca pedir a senha nova — a pessoa perdia o acesso quando a sessão expirava. Agora o link abre uma tela **"Definir nova senha"**, com confirmação da senha e mínimo de 8 caracteres. Só depois de salvar é que entra no sistema.

### Sucumbência: agora você escolhe se está dentro ou fora do valor
Este era um erro de dinheiro real. O sistema **sempre somava a sucumbência por cima do valor bruto**, em silêncio: um acordo de R$ 10.000 com R$ 2.000 de sucumbência gerava parcelas somando R$ 12.000, enquanto a coluna "Bruto" mostrava R$ 10.000.

Como a sucumbência é paga pela parte perdedora, ela **legitimamente** pode estar por fora do acordo ou já embutida nele — depende do caso. Então em vez de escolher por você, o sistema agora pergunta:

- Ao informar a sucumbência, aparece a opção **"A sucumbência já está dentro do valor bruto"**;
- Logo abaixo, o total a distribuir é mostrado na hora;
- Na etapa final, aparece a conferência: valor bruto × total distribuído, com a diferença explicada;
- Se as contas não fecharem, o sistema bloqueia e diz exatamente qual é a diferença.

O padrão continua "por fora" (comportamento atual), então nenhum acordo já cadastrado muda de valor.

### Tabelas ajustadas para o valor real

**Lista de Acordos** ganhou a coluna **"Total a receber"** — o que será efetivamente cobrado nas parcelas. Quando difere do valor bruto (sucumbência por fora), a diferença aparece embaixo do número: "+R$ 2.000 sobre o bruto". O "Bruto" continua na tabela, em cinza, como valor de referência do acordo.

**Cronograma da etapa 4** agora se recalcula sozinho quando qualquer valor que muda o total é alterado — valor bruto, honorários, sucumbência (e a opção de dentro/fora), custas, entrada, número de parcelas. Antes, se você editasse as parcelas à mão e depois voltasse e mudasse um valor, o cronograma continuava somando o total antigo. Quando isso acontece, aparece um aviso dizendo que foi recalculado e que as edições manuais anteriores foram descartadas.

### Importação: cliente com dois acordos não perde mais um
A verificação anti-duplicidade era por cliente, então o segundo acordo do mesmo cliente era descartado com a mensagem "já importado". Agora ela identifica cada acordo pelo número do processo (ou parte contrária).

**Ressalva honesta:** a aba de parcelas da planilha só identifica o cliente, não o acordo. Quando o mesmo cliente tem dois acordos, não há como o sistema saber a qual deles cada parcela pertence — então elas ficam no primeiro acordo e aparece um aviso pedindo a conferência manual. Preferi avisar a adivinhar errado.

### Saldo inicial da conta bancária passa a respeitar a data
A "Data do saldo inicial" era preenchida e ignorada: lançamentos anteriores a ela entravam no saldo mesmo assim, inflando o valor sem deixar pista. Agora só entram as movimentações a partir dessa data.

### Auditoria aponta para o registro certo
O log de recebimento gravava o id da parcela, e o de repasse gravava o id do cliente — numa investigação futura a trilha apontava para uma linha inexistente. Corrigido.

---

## Já incluído (rodadas anteriores)

### Estorno e cancelamento
- **Estornar recebimento** — botão "Recebimentos" em cada parcela paga abre o histórico com botão "Estornar" em cada lançamento. Exige motivo. O valor sai do saldo da parcela, do caixa e do saldo a repassar. Nada é apagado: fica riscado no histórico com quem, quando e por quê.
- **Cancelar parcela / acordo / repasse** — com motivo obrigatório. Acordo cancelado cancela junto as parcelas em aberto. Repasse cancelado devolve o valor ao saldo a repassar.
- Usa a permissão "Cancelar/estornar" da matriz de perfis: Administrador Principal, Sócio Gestor e Financeiro.

### Dashboard e clientes
- Filtro Dia / Semana / Mês / Ano com lucro por processo ativo.
- Cadastro de cliente sem nenhum campo obrigatório.
- Campo de pagadores + busca por nome, CPF/CNPJ e quem pagou + exportação em Excel.

### Correções críticas
- Importação de planilha estava quebrada em qualquer parcela paga.
- Mensagens de proteção eram engolidas ("avise o suporte técnico").
- Repasse em dobro passava sem aviso.
- Fluxo de Caixa contava dinheiro da cliente como receita (até 3× de diferença com o Dashboard).
- Parcela vencida com pagamento parcial sumia dos atrasos.
- Formulários guardavam dados do registro anterior.
- Campo "Observações" do Caixa era descartado.
- Duas falhas de permissão (alteração de papéis sem checagem de organização; Sócio Gestor via todos como "Consulta Restrita").
- Menu mostrava telas sem permissão, que abriam zeradas.
- Erros de login em inglês.

---

## O que continua fora

**Editar um acordo já criado** — só dá para cancelar. Editar mexe no cronograma e nas parcelas já geradas: o que fazer com parcelas já pagas, se o novo valor for menor que o já recebido, se as datas mudam. É uma decisão de negócio, não de código — me diga como o escritório quer que funcione e eu implemento.
