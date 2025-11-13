## Plano de Migração para Autenticação com Cookie HttpOnly

### Objetivo
Remover uso de JWT em `localStorage` (risco de exposição / incompatibilidade com ambientes restritos) e adotar:
- Cookie HttpOnly, Secure, SameSite=Lax ou Strict
- Refresh token rotacionado no backend
- Middleware no Next para proteger rotas, evitando UI ler diretamente o JWT

### Etapas
1. **Backend**
   - Endpoint `/api/auth/login` retorna:
     - Set-Cookie: `apm_access=<JWT>; HttpOnly; Secure; Path=/; Max-Age=900`
     - Body com dados do usuário (id, nome, roles).
   - Endpoint `/api/auth/refresh` rotaciona token (usa refresh cookie separado).
   - Endpoint `/api/auth/logout` limpa ambos cookies.

2. **Next.js (Frontend)**
   - Criar `middleware.ts` verificando presença de cookie `apm_access`; se ausente, redirect para `/login`.
   - Remover leitura central do JWT em `AuthContext`; contexto passa a só carregar dados do usuário via `/api/me`.
   - Chamadas `fetch` sempre enviam cookies automaticamente (mesmo domínio).

3. **Login Flow**
   - Página `/login`: form email/senha → POST `/api/auth/login`.
   - Após sucesso, redirect para `/`.

4. **Renovação**
   - `middleware` pode negar se token expirado; frontend faz fallback silencioso tentando `/api/auth/refresh` (se refresh cookie válido) antes do redirect.

5. **Debug / Desenvolvimento**
   - Em dev (`NEXT_PUBLIC_DEBUG=1`), exibir seção que mostra claims decodificadas (decodificando somente cliente após receber resposta de /api/me).
   - NÃO exibir raw token.

6. **Limpeza**
   - Remover dependência de `localStorage` completamente.
   - Atualizar documentação de `README`.

### Considerações de Segurança
| Aspecto | Ação |
|---------|------|
| XSS | HttpOnly impede JS de ler token |
| CSRF | SameSite=Lax + validação de origem em endpoints sensíveis |
| Fixation | Refresh rotacionado e invalidação em logout |
| Replay | Expiração curta + jti opcional |

### Rollout
1. Implementar backend de login + refresh.
2. Criar middleware e página `/login` no Next.
3. Testar fluxo local (login, refresh, logout).
4. Habilitar em staging com variável FEATURE_COOKIE_AUTH=1.
5. Remover lógica antiga (localStorage) após validação.

### Reversão
Manter por um tempo o AuthContext capaz de ler cookie OU localStorage caso FEATURE_COOKIE_AUTH não esteja ativa.

### Próximos Passos
- Gerar tipos da API (OpenAPI / Zod) para padronizar respostas.
- Adicionar verificação de expiração antecipada (clock skew).

---
Última atualização: (preencher na aprovação do PR)
