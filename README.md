# LMS Demo — Infra + Admin Lite

Projeto em Netlify Functions + Express com Postgres (Neon) para um LMS simples com cursos, módulos, itens (vídeo/texto/quiz), trilhas e pré‑requisitos. Inclui **modo DEV_FAKE** para testes sem Stripe/Mux.

> Produção atual: `https://lifeflourishconsulting.com`

---

## Sumário
- [Arquitetura](#arquitetura)
- [Pré‑requisitos](#pré-requisitos)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Estrutura de pastas](#estrutura-de-pastas)
- [Deploy Netlify](#deploy-netlify)
- [Seed e modo DEV_FAKE](#seed-e-modo-dev_fake)
- [Admin Lite](#admin-lite)
- [Endpoints](#endpoints)
- [Consultas SQL úteis](#consultas-sql-úteis)
- [Fluxos de teste rápidos](#fluxos-de-teste-rápidos)
- [Migração DEV_FAKE → PROD](#migração-dev_fake--prod)
- [Solução de problemas](#solução-de-problemas)

---

## Arquitetura

- **Hosting**: Netlify
  - Frontend estático em `public/`
  - Functions em `netlify/functions/` (Node 22, bundler esbuild)
  - Redirect: `/api/* → /.netlify/functions/api/:splat`
- **Backend**: Express dentro de uma única Function (`api`)
- **Banco**: Postgres **Neon**
- **Vídeo/Stripe**: desativados no DEV_FAKE
- **Admin UI**: página estática `public/admin.html`

---

## Pré‑requisitos

- Node 20+ (produção usa Node 22 no Netlify)
- Conta **Neon** (Postgres 17)
- Netlify site conectado ao repositório

---

## Variáveis de ambiente

Defina no painel do Netlify (todas as *Deploy contexts*).

| VAR | Exemplo | Obrigatória | Descrição |
| --- | --- | :---: | --- |
| `DATABASE_URL` | `postgres://…` | ✓ | String de conexão Neon |
| `PGSSL` | `1` | ✓ | Habilita SSL no `pg` |
| `JWT_SECRET` | `longo_e_aleatório` | ✓ | Segredo para assinar JWT |
| `ADMIN_EMAILS` | `email@dominio.com, outro@dominio.com` | ✓ | Quem pode gerar JWT dev |
| `DEV_FAKE` | `1` | opc. | Liga rotas de seed e JWT de dev |
| `TRACK_PUBLIC` | `1` | opc. | Permite tracking sem JWT |
| `APP_BASE_URL` | `https://lifeflourishconsulting.com` | opc. | Montagem de URLs públicas |

> Produção: desligue `DEV_FAKE` e remova rotas dev.

---

## Estrutura de pastas

```
public/
  index.html
  admin.html
  admin.js
netlify/
  functions/
    api.ts                 # Express embutido
    stripe-webhook.ts      # reservado p/ prod
src/
  server/
    app.ts                 # monta routers sob /api
    middleware/
      auth.ts, admin.ts
    routes/
      catalog.ts
      admin.ts
      quizzes.ts
      progress.ts          # /api/me/items e /api/me/modules
      video.ts, checkout.ts, certificates.ts, events.ts, auth.ts
  lib/
    db.ts                  # pool pg
api/
  openapi.yaml             # docs resumidas
```

---

## Deploy Netlify

`netlify.toml` já define:
- **publish**: `public`
- **functions**: `netlify/functions`
- **build.command**: `npm run build`

Passos:
1. Conecte o repo ao Netlify.
2. Configure as **envs** acima.
3. Deploy. Verifique `GET /api/health` retorna `200`.

---

## Seed e modo DEV_FAKE

Com `DEV_FAKE=1` ficam disponíveis:

- `/.netlify/functions/dev-bootstrap` → cria seed mínimo (curso introdutório com 2 módulos e itens).
- `/.netlify/functions/dev-jwt?email=SEU_EMAIL` → retorna JWT curto. O e‑mail precisa estar em `ADMIN_EMAILS`.

> Esses endpoints são **apenas** para desenvolvimento. Desligue em produção.

IDs do seed úteis para testes (não “congele” em código):
- `courseId`: `90db6f02-205f-43b6-a919-a7c01a559177`
- `moduleId` M1: `17dac000-e7dc-4662-8898-4b7668d3a9b2`
- `moduleId` M2: `b80ed3fe-8222-4827-b66c-9c765d2a22a1`
- `quizId` M1: `54ebc014-ed45-4d3c-9dff-e6b20f5f7f6c`

---

## Admin Lite

Acesse `https://SEU_SITE/admin.html`:

1. Gere um token dev:
   ```
   /.netlify/functions/dev-jwt?email=SEU_EMAIL
   ```
2. Cole o token no topo da página.
3. Use os botões para listar cursos, trilhas, criar módulos, itens e quizzes.

## Stripe Webhook (Entitlements)

- Function: `/.netlify/functions/stripe-webhook` (rota pública: `/webhooks/stripe`)
- ENV obrigatórias:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `DATABASE_URL`
  - `PGSSL=1` (se precisar SSL relaxado no Neon)
  - `ADMIN_EMAILS` (já usado no dev-jwt)

### Metadados lidos (precedência)
1. **Price metadata** → `duration_days`, `course_id`, `track_id`
2. **Product metadata** → `duration_days`, `course_id`, `track_id`
3. **Session/Invoice metadata** → `duration_days`, `course_id`, `track_id`

### Regras
- Se `duration_days` estiver ausente → **vitalício** (sem `ends_at`).
- Se presente → `starts_at = now()`, `ends_at = now() + duration_days`.
- Faz **upsert** em `users` por e-mail e **upsert** em `entitlements` por `(user_id, course_id)` ou `(user_id, track_id)`.

---

## Endpoints

Saúde
```
GET /api/health
```

Catálogo público
```
GET /api/catalog
GET /api/catalog/courses/:id/modules
```

Admin (JWT)
```
GET    /api/admin/courses              # lista crua (inclui created_at)
GET    /api/admin/courses/_summary     # lista com contagens module_count/item_count
POST   /api/admin/courses
POST   /api/admin/modules
POST   /api/admin/modules/:moduleId/items
POST   /api/admin/modules/:moduleId/quiz
POST   /api/admin/quizzes/:quizId/questions
```

Aluno (JWT)
```
GET  /api/me/items?courseId=...        # alias: /api/me/modules?courseId=...
POST /api/quizzes/:quizId/submit
```

## Progresso do Aluno (rotas `/api/me/*`)
> **Importante:** exigem **`courseId` (UUID)** na **query** e respondem erros de validação no padrão Zod Flatten.

- `GET /api/me/items?courseId=UUID`  
  Retorna lista de módulos do curso com itens e progresso agregado por módulo.

- `GET /api/me/modules?courseId=UUID`  
  Variante enxuta por módulo (summary).

**Validação de query (Zod):** erros são **400** com payload:
```json
{
  "error": {
    "formErrors": [],
    "fieldErrors": {
      "courseId": ["Required"] // ou "Invalid uuid"
    }
  }
}
```

### `POST /api/quizzes/:id/submit` — payload tolerante

Aceita qualquer um dos formatos por resposta:
- `{ questionId, choiceIds: [...] }`
- `{ questionId, value: [...] }`
- `{ questionId, choices: [...] }`

Exemplo:
```json
{
  "answers": [
    { "questionId": "Q1", "choiceIds": ["A","C"] },
    { "questionId": "Q2", "choiceIds": ["A"] },
    { "questionId": "Q3", "choiceIds": ["B"] }
  ]
}
```

Resposta:
```json
{ "passed": true, "score": 100 }
```

### `GET /api/me/items?courseId=...`

- Devolve lista de módulos do curso com:
  - `unlocked`: `true` para o primeiro; os demais dependem do anterior estar `passed`.
  - `progress`: `{ status, score, timeSpentSecs }`
  - `items`: itens do módulo (vídeo/texto/quiz).

---

## Consultas SQL úteis

> Regra operacional: **sempre conferir SQL antes de supor bug.**

Ordem dos módulos:
```sql
select id, title, "order"
from modules
where course_id = '90db6f02-205f-43b6-a919-a7c01a559177'
order by "order";
```

Ajustar ordem do M2:
```sql
update modules
set "order" = 2
where id = 'b80ed3fe-8222-4827-b66c-9c765d2a22a1';
```

Quiz e perguntas do módulo 1:
```sql
select id, module_id, pass_score
from quizzes
where module_id = '17dac000-e7dc-4662-8898-4b7668d3a9b2';

select id, kind, body, choices, answer_key
from questions
where quiz_id = '54ebc014-ed45-4d3c-9dff-e6b20f5f7f6c';
```

Progresso do usuário:
```sql
select user_id, module_id, status, score, time_spent_secs, updated_at
from progress
where user_id = (select id from users where email='SEU_EMAIL');
```

---

## Fluxos de teste rápidos

JWT Dev
```bash
curl -s "https://SEU_SITE/.netlify/functions/dev-jwt?email=SEU_EMAIL"
```

Catálogo
```bash
curl -s "https://SEU_SITE/api/catalog"
```

Progresso do aluno
```bash
curl -s "https://SEU_SITE/api/me/items?courseId=COURSE_ID" \
  -H "Authorization: Bearer JWT"
```

Quiz aprovado
```bash
curl -s -X POST "https://SEU_SITE/api/quizzes/QUIZ_ID/submit" \
  -H "Authorization: Bearer JWT" -H "Content-Type: application/json" \
  -d '{"answers":[
        {"questionId":"Q1","choiceIds":["A","C"]},
        {"questionId":"Q2","choiceIds":["A"]},
        {"questionId":"Q3","choiceIds":["B"]}
      ]}'
```

---

## Migração DEV_FAKE → PROD

1. **Desligar** `DEV_FAKE` e remover rotas `/dev-*` do deploy.
2. Configurar **Stripe** (produtos, webhooks) e **Mux/Cloudflare Stream** (playback securitizado).
3. Implementar autenticação real (login + refresh).
4. Fortalecer **CSP** e headers no Netlify.
5. Telemetria de tempo: gravar `video_sessions` e `page_reads` no player e leitura.

---

## Solução de problemas

- **404 em `/api/*`** → confirme redirect do Netlify e que o router está montado sob `"/api"` em `src/server/app.ts`.
- **Score 0 no quiz** → confira `answer_key` no SQL e o formato do payload enviado.
- **Módulo não libera** → verifique `progress.status='passed'` do anterior e a sequência de `"order"`.
- **JWT inválido** → gere novo via `/.netlify/functions/dev-jwt` e confirme e‑mail em `ADMIN_EMAILS`.

---

## Licença

Privado. Uso interno para POC do LMS.
