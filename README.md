# PR Review Bot

 Aplicação **backend-only** em NestJS que recebe a URL de um Pull Request do GitHub, analisa o PR usando o **Claude Code CLI local** e, quando o Claude retorna erro de limite de uso, faz fallback local para **Ollama com `qwen3-coder:30b`**, publicando uma **review geral** no GitHub.

> Uso pessoal / local. Requer o `claude` CLI já autenticado na máquina e o `Ollama` disponível para o fallback local.

## Requisitos

- **Node.js 20+** (a versão exata está pinada em [`.nvmrc`](.nvmrc))
- `claude` CLI instalado, autenticado e disponível no `PATH`
- `Ollama` instalado localmente
- Modelo de fallback baixado localmente: `ollama pull qwen3-coder:30b`
- Um Personal Access Token do GitHub com acesso ao repositório alvo e permissão para ler PRs e publicar reviews

## Instalação

```bash
nvm use            # lê .nvmrc
npm install
cp .env.example .env
```

Edite o `.env` e preencha o `GITHUB_TOKEN`.

## Variáveis de ambiente

| Variável                     | Default                       | Descrição                                                            |
| ---------------------------- | ----------------------------- | -------------------------------------------------------------------- |
| `PORT`                       | `3081`                        | Porta HTTP da aplicação.                                             |
| `GITHUB_TOKEN`               | _(obrigatório)_               | Token pessoal do GitHub para ler PRs e criar reviews.                |
| `GITHUB_API_BASE_URL`        | `https://api.github.com`      | Base URL da API (útil para GitHub Enterprise).                       |
| `REVIEWER_LOGIN`             | _(vazio)_                     | Username GitHub (sem `@`) cujos comentários ativam o re-review.      |
| `CLAUDE_COMMAND`             | `claude`                      | Comando do Claude Code CLI.                                          |
| `CLAUDE_MODEL`               | `haiku`                       | Modelo do Claude CLI para o review inicial. O re-review sempre usa `haiku`, o alias econômico. |
| `CLAUDE_TIMEOUT_MS`          | `300000`                      | Timeout do Claude em milissegundos. Mínimo suportado: `1000`.        |
| `OLLAMA_API_BASE_URL`        | `http://localhost:11434/api`  | Base URL da API local do Ollama.                                     |
| `OLLAMA_COMMAND`             | `ollama`                      | Comando usado para executar `ollama serve` no auto-start.            |
| `OLLAMA_MODEL`               | `qwen3-coder:30b`             | Modelo local usado no fallback.                                      |
| `OLLAMA_TIMEOUT_MS`          | `180000`                      | Timeout das chamadas ao Ollama em milissegundos.                     |
| `OLLAMA_AUTO_START`          | `true`                        | Tenta subir `ollama serve` automaticamente se a API local não responder. |
| `OLLAMA_STARTUP_TIMEOUT_MS`  | `30000`                       | Tempo máximo para aguardar o Ollama responder após o auto-start.     |
| `OLLAMA_WARMUP_ON_BOOT`      | `true`                        | Faz warm-up do modelo configurado durante a inicialização da API.    |
| `OLLAMA_WARMUP_KEEP_ALIVE`   | `10m`                         | Tempo para manter o modelo carregado após o warm-up (`-1` mantém sempre). |

## Execução

```bash
npm run start:dev
```

A aplicação sobe em `http://localhost:3081`.

Ao iniciar, a aplicação tenta preparar o fallback local automaticamente:

1. verifica se o endpoint do Ollama responde
2. se estiver indisponível e o endpoint for local, tenta executar `ollama serve`
3. faz um warm-up do `qwen3-coder:30b` via API para reduzir a latência da primeira análise

Se você preferir desabilitar esse comportamento, ajuste no `.env`:

```env
OLLAMA_AUTO_START=false
OLLAMA_WARMUP_ON_BOOT=false
```

## API

A API é exposta em duas rotas independentes: uma para o **review inicial** e outra para o **re-review**. A documentação interativa está disponível via Swagger UI em `http://localhost:3081/docs`.

### Swagger / OpenAPI

Com a aplicação rodando, acesse:

- **Swagger UI:** `http://localhost:3081/docs`
- **JSON OpenAPI:** `http://localhost:3081/docs-json`

A documentação inclui o schema de cada rota, exemplos de request/response e os possíveis códigos de erro (`400`, `500`).

### `POST http://localhost:3081/pr-review`

Executa o **review inicial** do PR. Sempre dispara a análise completa (não tenta detectar re-review automaticamente).

**Request:**

```http
POST http://localhost:3081/pr-review
Content-Type: application/json

{
  "prUrl": "https://github.com/owner/repo/pull/123"
}
```

**Response (200):**

```json
{
  "prUrl": "https://github.com/owner/repo/pull/123",
  "event": "REQUEST_CHANGES",
  "body": "...corpo da review em PT-BR...",
  "confidence": "high",
  "issues": [
    { "severity": "high", "file": "src/foo.ts", "reason": "..." }
  ],
  "review": {
    "id": 1234567,
    "htmlUrl": "https://github.com/owner/repo/pull/123#pullrequestreview-1234567",
    "event": "REQUEST_CHANGES"
  }
}
```

**Exemplo via curl:**

```bash
curl -X POST http://localhost:3081/pr-review \
  -H 'Content-Type: application/json' \
  -d '{"prUrl":"https://github.com/owner/repo/pull/123"}'
```

### `POST http://localhost:3081/re-review`

Executa o **re-review automatizado** do PR, limitado ao escopo dos comentários anteriores feitos pelo reviewer configurado em `REVIEWER_LOGIN`.

Falha com `400 Bad Request` quando:

- `REVIEWER_LOGIN` não está configurado;
- não há comentários válidos do reviewer no PR;
- o PR não tem arquivos alterados ou a URL é inválida.

**Request:**

```http
POST http://localhost:3081/re-review
Content-Type: application/json

{
  "prUrl": "https://github.com/owner/repo/pull/123"
}
```

**Response (200):**

```json
{
  "prUrl": "https://github.com/owner/repo/pull/123",
  "event": "REQUEST_CHANGES",
  "body": "## Re-review automatizada\n...",
  "confidence": "medium",
  "reReview": {
    "analyzed": 3,
    "corrigido": 1,
    "parcialmente_corrigido": 1,
    "nao_corrigido": 1,
    "nao_aplicavel": 0,
    "impossivel_validar": 0
  },
  "review": {
    "id": 7654321,
    "htmlUrl": "https://github.com/owner/repo/pull/123#pullrequestreview-7654321",
    "event": "REQUEST_CHANGES"
  }
}
```

**Exemplo via curl:**

```bash
curl -X POST http://localhost:3081/re-review \
  -H 'Content-Type: application/json' \
  -d '{"prUrl":"https://github.com/owner/repo/pull/123"}'
```

## Como funciona

### Fluxo do `/pr-review`

1. Valida e parseia a URL do PR (`owner`, `repo`, `pullNumber`).
2. Busca metadados, arquivos alterados e issue comments via Octokit.
3. Monta o prompt técnico para o review inicial.
4. Executa `claude -p "<prompt>"` via `child_process`.
5. Se o Claude retornar erro de limite de uso como `you've hint limit` ou `you've hit limit`, faz fallback local para o Ollama com `qwen3-coder:30b`.
6. Valida o JSON retornado com **Zod**.
7. Aplica as regras extras de decisão:
   - `APPROVE` com issue `high` **ou** `medium` → convertido para `REQUEST_CHANGES`.
   - `APPROVE` com `confidence = low` e sem issues obrigatórias → convertido para `COMMENT`.
   - `REQUEST_CHANGES` sem issues obrigatórias → convertido para `COMMENT`.
   - PR sem descrição → forçado a `REQUEST_CHANGES` com issue `medium`.
   - Alteração de back-end sem testes automatizados no diff → forçado a `REQUEST_CHANGES`.
   - Caso contrário, mantém a decisão do Claude.
8. Publica review geral (`POST /repos/{owner}/{repo}/pulls/{n}/reviews`) com o corpo em português do Brasil. Sem comentários em linha.

### Fluxo do `/re-review`

1. Exige `REVIEWER_LOGIN` configurado, caso contrário retorna `400`.
2. Valida e parseia a URL do PR; busca metadados, arquivos, issue comments, review comments e reviews anteriores.
3. Coleta os comentários válidos do reviewer configurado (ver critérios abaixo). Se nenhum, retorna `400`.
4. Monta o prompt técnico restrito ao escopo desses comentários e força `--model haiku` para manter o fluxo no modelo econômico.
5. Executa `claude -p "<prompt>"`; em caso de limite de uso, faz fallback para Ollama.
6. Valida o JSON retornado com **Zod**.
7. Decide o evento publicado a partir dos status agregados (ver seção [Re-review](#re-review)).
8. Publica a re-review no GitHub.

## Re-review

A rota `POST /re-review` re-analisa o PR limitando-se ao escopo dos comentários anteriores feitos pelo reviewer configurado.

Para usar o re-review:

1. Configure `REVIEWER_LOGIN` no `.env` com o **username do GitHub** (o `login` do usuário, exatamente como aparece em `github.com/<login>` ou no campo `user.login` da API — sem o `@`, sem URL, sem nome de exibição). Exemplos: `nanasaria`, `octocat`, `dependabot[bot]`. Pode apontar para um humano (você ou um colega de time), para a conta usada pelo `GITHUB_TOKEN` do próprio bot, ou para qualquer outra conta — o que importa é bater 1:1 com o autor dos comentários no GitHub. A comparação é case-insensitive.
2. Chame `POST /re-review` quando quiser re-avaliar os comentários anteriores. A rota `POST /pr-review` continua executando apenas o review inicial e nunca dispara o re-review automaticamente.

> Para descobrir o username de uma conta, abra o perfil no GitHub: o trecho final da URL (`github.com/<login>`) é o valor que vai em `REVIEWER_LOGIN`. Não use o nome real ("Nayara Soares"), o e-mail nem o ID numérico.

Critérios usados para coletar comentários do reviewer:

- são considerados review comments (linha), issue comments (gerais) e o corpo de reviews anteriores (`pulls.listReviews`);
- comentários de outros usuários ou bots são ignorados;
- comentários vazios ou que parecem corpo auto-gerado pelo próprio bot (ex: contendo `**Visão Geral**` ou `## Re-review automatizada`) são descartados para evitar laços;
- duplicidade é evitada via chave composta de arquivo, linha, trecho e conteúdo do comentário.

No re-review, o bot:

- avalia somente os pontos previamente levantados, classificando cada um como `corrigido`, `parcialmente_corrigido`, `nao_corrigido`, `nao_aplicavel` ou `impossivel_validar`;
- identifica no comentário publicado que o resultado é um re-review automático;
- não procura problemas novos fora desse escopo;
- mapeia comentários para o novo caminho do arquivo quando o arquivo foi renomeado e sinaliza explicitamente quando o trecho original não existe mais;
- escolhe o evento publicado a partir dos status agregados:
  - qualquer `nao_corrigido` ou `parcialmente_corrigido` → `REQUEST_CHANGES`;
  - apenas `impossivel_validar` (sem pendências) → `COMMENT`;
  - somente `corrigido`/`nao_aplicavel` → `APPROVE`.
- inclui no corpo da review um resumo com `modo executado`, quantidade de comentários analisados e contagens por status, além de cada item formatado com `Comentário original`, `Arquivo`, `Status`, `Análise` e `Ação recomendada`.

## Testes

```bash
npm test            # unitários (parse de URL, decisão final, schema Zod)
npm run test:cov    # cobertura
```

## Estrutura

```text
src/
  main.ts
  app.module.ts
  config/
    env.validation.ts
  modules/
    pr-review/
      pr-review.module.ts
      controllers/
        pr-review.controller.ts
        re-review.controller.ts
      services/
        pr-review.service.ts
        re-review.service.ts
      models/
        review-pr-request.model.ts
        review-outcome.model.ts
        re-review-outcome.model.ts
        published-review.response.ts
        claude-review.model.ts
        re-review.model.ts
        reviewer-comment.model.ts
        pull-request-review-prompt.model.ts
        pull-request-reference.model.ts
      utils/
        review-prompt.util.ts
        re-review-prompt.util.ts
        reviewer-comments.util.ts
        change-set-analysis.util.ts
    github/
      github.module.ts
      services/
        github.service.ts
      models/
        github-pull-request.model.ts
        review-event.model.ts
    claude-cli/
      claude-cli.module.ts
      services/
        claude-cli.service.ts
      utils/
        claude-limit-error.util.ts
    ollama/
      ollama.module.ts
      services/
        ollama.service.ts
      models/
        ollama-chat.model.ts
```

## Troubleshooting

- **`Configuração de ambiente inválida: ... GITHUB_TOKEN`** → preencha o token no `.env`.
- **`Não foi possível buscar o PR no GitHub: Not Found...`** → normalmente indica uma destas causas:
  1. a URL ou o número do PR está incorreto
  2. o token não tem acesso ao repositório alvo
  3. o token ainda não foi autorizado na organização via SSO
  4. em token fine-grained, o repositório alvo não foi incluído ou a permissão de Pull Requests não cobre leitura/escrita
- **`Claude CLI retornou código ...`** → confirme que `claude --version` funciona no seu shell e que você está autenticado.
- **`Não foi possível extrair JSON da resposta do Claude CLI`** → a saída não continha JSON parseável; rode manualmente `claude -p "..."` para diagnosticar.
- **`Falha ao conectar ao Ollama ...`** → confirme que o `ollama` está instalado e acessível no `PATH`. Se não quiser auto-start, desabilite `OLLAMA_AUTO_START`.
- **`Ollama retornou HTTP 404/503: model not found`** → rode `ollama pull qwen3-coder:30b` para baixar o modelo localmente antes do fallback.

## Licença

Este projeto é licenciado sob a [GNU General Public License v3.0](LICENSE).
