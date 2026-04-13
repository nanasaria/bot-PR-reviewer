# PR Review Bot

Aplicação **backend-only** em NestJS que recebe a URL de um Pull Request do GitHub, analisa o PR usando o **Claude Code CLI local** (sem Anthropic API) e publica uma **review geral** no GitHub.

> Uso pessoal / local. Requer o `claude` CLI já autenticado na máquina.

## Requisitos

- **Node.js 20+** (a versão exata está pinada em [`.nvmrc`](.nvmrc))
- `claude` CLI instalado, autenticado e disponível no `PATH`
- Um Personal Access Token do GitHub com permissão para ler o PR alvo e publicar reviews (escopo `repo` para repositórios privados; `public_repo` para públicos)

## Instalação

```bash
nvm use            # lê .nvmrc
npm install
cp .env.example .env
```

Edite o `.env` e preencha o `GITHUB_TOKEN`.

## Variáveis de ambiente

| Variável              | Default                    | Descrição                                             |
| --------------------- | -------------------------- | ----------------------------------------------------- |
| `PORT`                | `3081`                     | Porta HTTP da aplicação.                              |
| `GITHUB_TOKEN`        | _(obrigatório)_            | Token pessoal do GitHub para ler PRs e criar reviews. |
| `GITHUB_API_BASE_URL` | `https://api.github.com`   | Base URL da API (útil para GitHub Enterprise).        |
| `CLAUDE_COMMAND`      | `claude`                   | Comando do Claude Code CLI.                           |

## Execução

```bash
npm run start:dev
```

A aplicação sobe em `http://localhost:3081`.

## API

### `POST /pr-review`

Recebe a URL de um PR, analisa e publica a review.

#### Request

```http
POST /pr-review
Content-Type: application/json

{
  "prUrl": "https://github.com/owner/repo/pull/123"
}
```

#### Response (200)

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
    "htmlUrl": "https://github.com/owner/repo/pull/123#pullrequestreview-1234567"
  }
}
```

#### Exemplo via curl

```bash
curl -X POST http://localhost:3081/pr-review \
  -H 'Content-Type: application/json' \
  -d '{"prUrl":"https://github.com/owner/repo/pull/123"}'
```

## Como funciona

1. Valida e parseia a URL do PR (`owner`, `repo`, `pullNumber`).
2. Busca metadados e arquivos alterados via Octokit.
3. Monta um prompt técnico de revisão e executa `claude -p "<prompt>"` via `child_process`.
4. Valida o JSON retornado com **Zod**.
5. Aplica as regras extras de decisão:
   - `APPROVE` com issue `high` **ou** `medium` → convertido para `REQUEST_CHANGES`.
   - `APPROVE` com `confidence = low` e sem issues obrigatórias → convertido para `COMMENT`.
   - `REQUEST_CHANGES` sem issues obrigatórias → convertido para `COMMENT`.
   - Caso contrário, mantém a decisão do Claude.
6. Publica review geral (`POST /repos/{owner}/{repo}/pulls/{n}/reviews`) com o corpo em português do Brasil. Sem comentários em linha.

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
      services/
        pr-review.service.ts
      models/
        review-pr-request.model.ts
        review-outcome.model.ts
        claude-review.model.ts
        pull-request-reference.model.ts
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
      models/
        pull-request-review-prompt.model.ts
```

## Troubleshooting

- **`Configuração de ambiente inválida: ... GITHUB_TOKEN`** → preencha o token no `.env`.
- **`Claude CLI retornou código ...`** → confirme que `claude --version` funciona no seu shell e que você está autenticado.
- **`Não foi possível extrair JSON da resposta do Claude CLI`** → a saída não continha JSON parseável; rode manualmente `claude -p "..."` para diagnosticar.
