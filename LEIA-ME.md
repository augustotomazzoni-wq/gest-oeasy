# Atualização de 27/08/2026

## Como aplicar — 2 passos

### Passo 1: o banco (faça primeiro)

Abra o **Lovable → botão "More" → Cloud → SQL editor** (é o de dentro do
Lovable mesmo, **não** o site supabase.com).

Cole o conteúdo do arquivo:

```
supabase/migrations/20260827200000_recorrencia_pagamentos_e_exportacao.sql
```

e clique em **Run**. Se aparecer o aviso "Confirm destructive operation",
clique em **Run anyway** — é só porque o texto contém a palavra DELETE dentro
de uma função; nada é apagado.

### Passo 2: o código

Copie as pastas `src` e `supabase` deste pacote por cima da sua pasta clonada
do GitHub (substituindo os arquivos) e faça commit + push.

O build voltou a funcionar (veja "Correção do build" no fim).

---

## O que mudou

### 1. Dashboard: período personalizado

Além de Dia / Semana / Mês / Ano, agora existe o botão **Personalizado**, com
data de início e data de fim. Se você inverter as datas por engano, o sistema
corrige sozinho em vez de zerar tudo.

### 2. Dashboard: custo por cliente e receita média por cliente

Três indicadores novos, que respeitam o filtro de período:

| Indicador | Como é calculado |
|---|---|
| **Clientes que pagaram** | Clientes distintos com algum recebimento no período (quem pagou 5 parcelas conta 1 vez) |
| **Custo por cliente** | Despesas do período ÷ clientes que pagaram |
| **Receita média por cliente** | Receita do escritório ÷ clientes que pagaram |

> **Atenção a uma coisa que você escreveu ao contrário:** você pediu "número
> de clientes dividido pela despesa total", mas descreveu como "custo de cada
> lead". Custo por lead é **despesa ÷ clientes**. Implementei assim. Se você
> quiser mesmo a divisão invertida, me avise que troco.

### 3. Clientes e Processos: filtrar por qualquer campo

Em cima da lista tem um seletor de campo + a caixa de busca:

- **Clientes** — nome, CPF/CNPJ, pagadores, RG, celular, telefone fixo,
  e-mail, cidade, estado, bairro, endereço, CEP, profissão, estado civil,
  nome da mãe, nascimento, PIS/PASEP, CTPS, CID, sexo, origem e observações.
- **Processos** — cliente, nº do processo, parte contrária, tribunal/vara,
  área, tipo de ação, responsável, grupo de ação, fase judicial, etapa,
  protocolo, processo originário, pasta, ano, segmento, comarca, vara,
  resultado, contingenciamento, último andamento, situação e observações.

Deixando em **"Todos os campos"** ele procura em tudo de uma vez. A busca
ignora acento (procurar "Sao" acha "São").

### 4. Despesas e receitas: recorrência

No **Novo lançamento** tem a opção **"Repetir todo mês"**, onde você informa
por quantos meses repetir (2 a 120).

Cada mês vira um lançamento próprio — dá para pagar, editar ou apagar um mês
sem mexer nos outros. E tem o botão **"Apagar série"**, que apaga os meses
ainda não pagos de uma vez (os já pagos ficam, porque são histórico do caixa).

Se você marcar como "já pago", só o **primeiro** mês nasce pago; os seguintes
nascem como a pagar — ninguém paga em agosto a conta de dezembro.

### 5. Contas a pagar com data futura e baixa

O lançamento agora tem **Situação**: "Já pago / Já recebido" ou
"A pagar / A receber".

- Escolhendo "A pagar", você informa a **data de vencimento** e ele aparece na
  lista sem mexer no saldo da conta.
- Quando pagar, clique em **"Marcar como pago"**. Abre uma janelinha com a
  data de hoje já preenchida — **e você pode trocar** se o pagamento aconteceu
  em outro dia. É essa data que entra no caixa e no saldo.

A lista ganhou os filtros **Todos / Pagos / A pagar**, e dois indicadores
novos: "A pagar no mês" e "A receber no mês".

### 6. Forma de pagamento

Campo novo no lançamento: Dinheiro, PIX, Cartão de crédito, Cartão de débito,
Transferência, Boleto e Outro. Em **receita** aparece também **Alvará**
(alvará não paga despesa, então não aparece em saída).

A forma de pagamento sai na tabela e na exportação.

### 7. Exportação controlada por permissão

Antes qualquer pessoa logada — **inclusive a Consulta Restrita** — baixava a
base inteira com CPF, endereço e telefone num clique.

Agora exportar é uma permissão como qualquer outra. Vá em **Usuários e Perfis
de Acesso → aba de permissões**, coluna **"Exportar"**, e ligue/desligue por
perfil nas linhas Clientes, Processos, Fluxo de caixa e Importação.

Já vem configurado assim (você muda quando quiser):

| Perfil | Pode exportar? |
|---|---|
| Administrador Principal | Sim |
| Sócio Gestor | Sim |
| Financeiro | Sim |
| Lançador, Cobrança, Advogado, Consulta | Não |

O Fluxo de Caixa também ganhou um botão **Exportar** (respeitando a mesma
permissão), que gera a planilha do mês com situação, forma de pagamento,
vencimento, pagamento e recorrência.

---

## Correção do build

O Lovable estava marcando seus dois últimos envios como **"Build unsuccessful"**.
A causa era um erro de tipagem em `acordos.tsx` (a chamada de
`create_agreement_with_schedule` passava campos opcionais como `undefined`, o
que a configuração estrita do projeto não aceita). Corrigi usando o mesmo
padrão `dropUndefined` que já existia na tela de Clientes.

Rodei aqui `npx tsc --noEmit` (zero erros) e `npm run build` (concluído com
sucesso) antes de te mandar.

---

## O que continua fora

**Editar um acordo já criado** — só dá para cancelar. Editar mexe no
cronograma e nas parcelas já geradas (o que fazer com parcelas já pagas, se o
novo valor for menor que o recebido). É decisão de negócio: me diga como o
escritório quer que funcione e eu implemento.
