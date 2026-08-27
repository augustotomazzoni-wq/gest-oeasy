# Atualização 2 de 27/08/2026

## Antes de copiar: dê Pull primeiro

No GitHub Desktop, clique em **Fetch origin** e depois **Pull origin**. Foi a
falta disso que gerou o conflito da vez passada.

Depois copie as pastas `src` e `supabase` por cima da pasta clonada e faça
commit + push.

**O banco já está atualizado** — apliquei a migration
`20260827230000_editar_excluir_lancamentos.sql` direto no Lovable Cloud. Ela vai
junto no pacote só para o repositório ficar completo; você não precisa rodar
nada.

---

## O que mudou

### 1. Editar e excluir receitas e despesas

Na tela **Fluxo de Caixa**, cada lançamento ganhou os botões **Editar** e
**Excluir**.

- **Editar** abre o mesmo formulário do lançamento, já preenchido. Dá para
  mudar tipo, valor, descrição, situação, data, forma de pagamento, conta,
  categoria e observações.
- **Excluir** pede confirmação e registra no histórico de auditoria quem
  apagou, quando e com quais valores — nada some sem rastro.

**Só aparece para o Administrador Principal.** Criei duas permissões novas na
matriz (**Usuários e Perfis de Acesso**, módulo *Fluxo de caixa*): a coluna
**Editar** e a coluna nova **Excluir**. Todos os outros perfis nascem
desmarcados; você libera quem quiser, quando quiser.

**Uma trava importante:** lançamento que nasceu de um recebimento ou de um
repasse **não** pode ser editado nem excluído por aqui — ele é espelho da
parcela, e mexer nele por fora deixaria o caixa divergente. Para desfazer esses,
o caminho continua sendo **estornar o recebimento**, que já apaga o lançamento
sozinho. Nesses casos os botões simplesmente não aparecem.

### 2. Dashboard: lucro por cliente

Card novo ao lado dos outros dois:

**Lucro por cliente = Receita por cliente − Custo por cliente**

Ou seja, o que sobra em média de cada cliente que pagou no período. Fica verde
quando positivo e vermelho quando negativo. Respeita todos os filtros de
período, inclusive o personalizado.

Os quatro indicadores por cliente agora ficam juntos: Clientes que pagaram,
Custo por cliente, Receita média por cliente e Lucro por cliente.

### 3. Fluxo de Caixa com o mesmo filtro do Dashboard

O seletor de mês virou o mesmo controle do Dashboard: **Dia / Semana / Mês /
Ano / Personalizado**, com as setas ‹ › para andar no tempo e o intervalo livre
com data de início e fim.

**A competência continua sempre à vista.** No alto do painel aparece fixo
"**Competência: Agosto de 2026**", com o intervalo exato logo abaixo — mesmo
quando você escolhe um dia, uma semana ou um período livre. O padrão ao abrir a
tela continua sendo o mês atual, como antes.

Os totais passaram a acompanhar o período escolhido ("Resultado do período",
"A pagar", "A receber") e a exportação sai com o intervalo no nome do arquivo.

Por baixo, Dashboard e Fluxo de Caixa passaram a usar **o mesmo código de
filtro** (`src/lib/period.ts` + `src/components/PeriodFilter.tsx`) — assim os
dois nunca mais mostram recortes de tempo diferentes.

---

## Testado antes de enviar

- `npx tsc --noEmit` → zero erros
- `npm run build` → concluído com sucesso
- Migration aplicada e conferida no banco

---

## O que continua fora

**Editar um acordo já criado** — só dá para cancelar. Editar mexe no cronograma
e nas parcelas já geradas (o que fazer com parcelas já pagas, se o novo valor
for menor que o recebido). É decisão de negócio: me diga como o escritório quer
que funcione e eu implemento.
