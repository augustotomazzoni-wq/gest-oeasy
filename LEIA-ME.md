# Atualização de 27/08/2026

Inclui tudo das rodadas anteriores. Se você não aplicou os zips anteriores, use só este.

## Como aplicar

**1. Banco (Supabase → SQL Editor → Run)** — nesta ordem:

Confirme primeiro o que já rodou:

```sql
select column_name from information_schema.columns
where table_name = 'clients' and column_name = 'payer_names';
```

- **Se voltar vazio:** rode antes `20260824090000_...`, `20260824120000_...`, `20260825120000_...`
- **Depois**, rode os três novos **nesta ordem**:
  1. `20260826120000_correcoes_varredura.sql`
  2. `20260826150000_estorno_e_cancelamento.sql`
  3. `20260827100000_campos_advbox.sql`

**2. Código:** copie os arquivos por cima da pasta clonada e faça commit + push.

**3. Importe seus dados:** abra a tela **Importar e Exportar** e envie os dois arquivos do Advbox (um de cada vez). Não precisa mais de script SQL.

---

## Novidades desta rodada

### Campos novos, iguais aos do Advbox

**Clientes** ganharam: RG, data de nascimento, estado civil, PIS/PASEP, CTPS, CID, profissão, sexo, telefone fixo, país, estado, cidade, endereço, bairro, CEP, nome da mãe e origem.

**Processos** ganharam: grupo de ação, fase judicial, etapa, número do protocolo, processo originário, pasta/caso, ano, data do requerimento, segmento, comarca, vara, data do fechamento, data do trânsito em julgado, data do arquivamento, resultado, valor da causa, valor dos honorários, % de honorários, contingenciamento e último andamento.

Todos são opcionais — preencha só o que interessar.

### Importação que entende o formato do Advbox

A tela reconhece sozinha qual planilha você enviou, sem precisar escolher nada:

- **Clientes do Advbox** — cria os novos e **atualiza os que já existem**, casando pelo CPF/CNPJ (ou pelo nome, quando não há CPF).
- **Processos do Advbox** — casa pelo número do processo; sem número, casa por cliente + parte contrária. Se o cliente ainda não existir, é criado a partir do nome e CPF que vêm no próprio arquivo, com um aviso para completar depois.
- **Planilha de controle de recebíveis** (a antiga, com abas "Clientes" e "Parcelas a Receber") continua funcionando como antes.

Antes de gravar, mostra uma prévia com a contagem, os avisos e as primeiras linhas. Nada é gravado até você confirmar.

**Testado com seus arquivos reais:**
- Clientes: 206 linhas → 205 importáveis (avisou 1 cadastro repetido: MIRIAM FUSCO DE SOUZA)
- Processos: 170 linhas → 169 importáveis (avisou 1 número de processo repetido)
- Avisa também: 8 clientes sem CPF e 50 processos sem número

### Exportação no mesmo formato

Dois botões no topo da tela: **Exportar clientes** e **Exportar processos**. Geram um `.xlsx` com exatamente as mesmas colunas do Advbox, na mesma ordem — então o arquivo que você baixa daqui pode ser reimportado aqui (ou levado para o Advbox) sem ajuste nenhum.

Valores saem formatados como no Advbox (`R$39.111,96`), datas em `dd/mm/aaaa`, e o cliente do processo sai como `NOME (CPF)`.

---

## Já incluído (rodadas anteriores)

- **Estorno e cancelamento** de recebimento, parcela, acordo e repasse — com motivo obrigatório e histórico preservado.
- **Redefinir senha** funcionando de verdade.
- **Sucumbência**: você escolhe se está dentro ou fora do valor bruto; o total aparece antes de confirmar.
- **Tabela de acordos** com a coluna "Total a receber" e o cronograma que se recalcula sozinho.
- **Dashboard** com filtro Dia/Semana/Mês/Ano e lucro por processo ativo.
- **Cadastro de cliente** sem nenhum campo obrigatório, com campo de pagadores e busca por quem pagou.
- Correções: importação quebrada, mensagens de erro engolidas, repasse em dobro, caixa contando dinheiro da cliente como receita, parcela vencida sumindo dos atrasos, formulários com dados antigos, duas falhas de permissão.

---

## O que continua fora

**Editar um acordo já criado** — só dá para cancelar. Editar mexe no cronograma e nas parcelas já geradas (o que fazer com parcelas já pagas, se o novo valor for menor que o recebido). É decisão de negócio: me diga como o escritório quer que funcione e eu implemento.
