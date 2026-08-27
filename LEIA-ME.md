# Importar receitas e despesas do Advbox

## Como aplicar

1. No GitHub Desktop: **Fetch origin** → **Pull origin**.
2. Copie as pastas `src` e `supabase` por cima da pasta clonada.
3. Commit + push.

**O banco já está atualizado** — apliquei a migration direto no Lovable Cloud.
Ela vai no pacote só para o repositório ficar completo.

São só 4 arquivos, e nenhum deles conflita com o que você já subiu.

---

## O que foi feito

### A tela de importação agora aceita um terceiro formato

Você joga o arquivo do Advbox na mesma tela **Importar e Exportar** e ele
reconhece sozinho que é o resumo de receitas e despesas — não precisa escolher
nada. Os outros dois formatos (Clientes e Processos) continuam funcionando
igual.

### Testado com o seu arquivo real

`Advbox-2026-08-27_0699822.xlsx`:

| | |
|---|---|
| Linhas lidas | 121 |
| Vão para o Fluxo de Caixa | **94** (2 receitas + 92 despesas) |
| Ficam de fora (honorários/alvarás) | **27** — R$ 78.423,42 |
| Categorias distintas | 28 |
| Linhas sem data de pagamento | 2 → entram como **"a pagar"** |
| Avisos | nenhum |

### Honorários e alvarás não entram pelo caixa

Como você pediu: toda receita de **honorários** (iniciais, finais,
sucumbência, consultoria) e de **alvarás** fica de fora da importação. Elas
nascem do processo e devem entrar pela tela de **Acordos** — viram parcela, e
quando você registra o recebimento o caixa é alimentado sozinho. Se entrassem
também por aqui, o mesmo dinheiro seria contado duas vezes.

Na prévia elas aparecem numa lista à parte, esmaecidas, com data, categoria,
valor e cliente — é a sua lista de trabalho para cadastrar em Acordos.

Das 29 receitas do arquivo, sobraram 2 para o caixa: **aporte de sócio** e
**empréstimo** — que realmente não passam por processo.

### Categorias criadas automaticamente

As 28 categorias do arquivo que ainda não existem são criadas na hora da
importação, com o mesmo nome do Advbox (`5. ALUGUEL`, `8. TIKTOK ADS`,
`2. SALÁRIOS`…), para o histórico continuar batendo com o de lá.

Uma observação: seu sistema já tinha 14 categorias com nomes próprios
("Aluguel", "Salários", "Marketing"). Elas continuam existindo lado a lado com
as do Advbox. Se preferir unificar, me diga quais juntar que eu faço.

Também criei a trava que impede categoria duplicada — comparando sem acento e
sem maiúsculas, para "Alugúel" não virar uma segunda "ALUGUEL".

### Reimportar não duplica

O Advbox não exporta um número de identificação por linha. Então cada linha
ganha uma impressão digital montada a partir do próprio conteúdo (tipo, datas,
categoria, descrição, valor e processo). Se você reimportar o mesmo arquivo —
ou um arquivo maior que repita meses já importados — nada entra em dobro: a
prévia mostra quantos já existiam e foram ignorados.

Os lançamentos importados continuam sendo **lançamentos manuais comuns**: o
Administrador pode editar e excluir normalmente.

### O que mais a importação preenche

- **Conta bancária** — casa pelo nome da planilha ("CONTA PRINCIPAL"); se não
  existir no sistema, é criada.
- **Situação** — com data de pagamento vira "pago"; sem data vira "a pagar",
  aparecendo em "A pagar no período".
- **Competência** — usa a coluna `Competencia` do Advbox (`04/2026` → abril).
- **Observações** — guarda o cliente e o número do processo da linha.

---

## Testado antes de enviar

- Parser rodado contra o seu arquivo real (números da tabela acima)
- `npx tsc --noEmit` → zero erros
- `npm run build` → concluído com sucesso
- Migration aplicada e conferida no banco
