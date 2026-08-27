# Backup, exclusões e receita total no caixa

## Como aplicar — 2 passos

### Passo 1: o banco (faça primeiro)

Desta vez **preciso que você cole o SQL** — o editor do Lovable começou a
embaralhar os comandos quando eu digitava por automação, e não quis arriscar
deixar meio aplicado.

Abra **Lovable → More → Cloud → SQL editor** e rode, **nesta ordem**, os dois
arquivos da pasta `SQL-para-colar`:

1. `1-tabela-de-backups-e-exclusoes.sql`
2. `2-funcoes-de-backup.sql`

Para cada um: abra o arquivo, Ctrl+A, Ctrl+C, cole no editor, **Run**. Se
aparecer "Confirm destructive operation", clique em **Run anyway**.

> Dica: se o editor não aceitar o texto colado, clique antes no botão
> **Clear** — foi o que funcionou aqui.

**Parte disso eu já apliquei**: as permissões de exclusão e a limpeza dos
nomes de categoria. Os arquivos são seguros de rodar de novo — tudo usa
`IF NOT EXISTS` / `ON CONFLICT DO NOTHING`.

### Passo 2: o código

**Fetch origin** → **Pull origin**, copie `src` e `supabase` por cima, commit
e push.

---

## O que mudou

### 1. Dashboard: total que entrou no caixa

Card novo ao lado de "Receita do escritório":

- **Receita do escritório** — só honorários + sucumbência (como antes, sem
  mudança).
- **Total que entrou no caixa** — tudo que entrou como dinheiro do escritório,
  incluindo **empréstimos e aportes de sócio**. Embaixo aparece quanto do total
  veio de fora dos honorários.

Dinheiro de terceiros continua fora dos dois: passa pela conta, mas é da
cliente.

### 2. Categorias sem o número na frente

"6. INDENIZAÇÃO" virou "INDENIZAÇÃO". Vale para as que já estão no banco e
para as próximas importações.

**Já apliquei**: das 28 categorias importadas, 26 foram renomeadas. Duas
ficaram como estavam de propósito:

- `2. SALÁRIOS` — porque já existe a categoria "Salários"
- `5. ALUGUEL` — porque já existe a categoria "Aluguel"

Renomear essas duas criaria categorias repetidas. Elas ainda não têm nenhum
lançamento, então dá para simplesmente **excluir** as duas na tela de
Configurações (com o botão novo) e reclassificar o que for preciso para as
originais. Se preferir o contrário — apagar as antigas e ficar com as do
Advbox — me diga que eu faço.

### 3. Excluir conta bancária e categoria: só o Administrador

Botão **Excluir** novo em Configurações, ao lado de Desativar. Aparece só para
o Administrador Principal — é uma permissão própria na matriz de perfis
(módulos *Contas bancárias* e *Categorias*, coluna **Excluir**), que você pode
liberar para outros perfis quando quiser. Os demais continuam só com
**Desativar**.

**Uma trava que coloquei**: se a conta ou a categoria já tiver qualquer
lançamento, a exclusão é recusada com uma mensagem explicando. Apagar nesse
caso deixaria lançamentos antigos sem classificação e mudaria relatórios já
fechados. Nesses casos o certo é desativar. Se você preferir que o
Administrador possa apagar mesmo assim, me avise que eu solto a trava.

### 4. Backup completo com histórico de versões

Seção nova no fim de **Configurações**, visível só para o Administrador.

**Gerar backup** — copia clientes, processos, acordos, parcelas, recebimentos,
repasses, fluxo de caixa, categorias e contas. Você pode dar um nome à versão
("antes de importar o Advbox"). Cada backup fica guardado no histórico, com
data, quem gerou, quantos registros e o tamanho.

**Baixar** — salva a versão como arquivo `.json` no seu computador, para
guardar fora do sistema.

**Restaurar** — de uma versão do histórico ou de um arquivo que você tenha
guardado. Três proteções:

1. Só o Administrador vê e usa.
2. Antes de restaurar, o sistema grava sozinho uma versão do estado atual no
   histórico — se restaurar a errada, dá para voltar.
3. Você precisa escrever **RESTAURAR** à mão para confirmar.

Tudo acontece de uma vez só: ou restaura inteiro, ou não mexe em nada.

**O que o backup NÃO inclui, de propósito:**

- **Usuários e senhas** — pertencem ao serviço de login. Restaurá-los
  derrubaria o acesso de todo mundo.
- **Histórico de auditoria** — é o livro de registro do escritório; nunca se
  sobrescreve.

---

## Testado antes de enviar

- `npx tsc --noEmit` → zero erros
- `npm run build` → concluído com sucesso
- Permissões e limpeza de categorias já aplicadas e conferidas no banco

Depois de rodar os dois SQL, faça um teste rápido: gere um backup, veja
aparecer na lista, baixe o arquivo. Aí você já tem uma cópia guardada antes de
qualquer coisa maior.
