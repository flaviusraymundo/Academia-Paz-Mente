# Diagnóstico Rápido de Login / Cookie Mode

Variáveis necessárias para login por cookie em DEV/Staging:

```
COOKIE_MODE=1
JWT_SECRET=seu_segredo_forte
NEXT_PUBLIC_USE_COOKIE_MODE=1
NEXT_PUBLIC_DEBUG=1              # opcional (ativa painel de diagnóstico em /login)
```

Para fluxo dev-jwt (Bearer):
```
DEV_JWT_ENABLED=1
NEXT_PUBLIC_DEV_FAKE=1
JWT_SECRET=mesmo_segredo
DEV_USER_NAMESPACE_UUID=11111111-2222-3333-4444-555555555555
NEXT_PUBLIC_DEV_USER_NAMESPACE_UUID=11111111-2222-3333-4444-555555555555
```

## Endpoints e comportamentos

| Endpoint | Cookie Mode OFF | Cookie Mode ON |
|----------|-----------------|----------------|
| `POST /api/auth/login` | 403 JSON (COOKIE_MODE_DISABLED) | 200 + Set-Cookie |
| `GET /api/auth/session` | `{ authenticated:false, reason:"COOKIE_MODE_DISABLED" }` | `{ authenticated:true/false ... }` |
| `GET /api/auth/flags` | JSON com serverCookieMode:false | JSON com serverCookieMode:true |

## Diagnóstico pelo painel (/login com NEXT_PUBLIC_DEBUG=1)

Campos exibidos:
- `serverCookieMode`: se false mas você esperava true → faltou definir `COOKIE_MODE=1` no ambiente do build.
- `publicUseCookieMode`: flag do cliente (não ativa rota por si só).
- `jwtSecretPresent`: garante que o secret foi lido; se false, usar fallback inseguro.
- Status de `/api/auth/login`: 
  - 403: cookie mode desativado.
  - 400: ativo (email inválido usado no teste).
  - 404: rota ausente (arquivo não incluído ou output export).

## Motivos comuns de 404 ou falha
1. `COOKIE_MODE` não definido → login responde 403 (antes era 404).
2. Pasta `web/` não é a base do build → rota não compilada.
3. `next.config.js` com `output: "export"` → API routes não existem.
4. Variáveis definidas em Production mas não em Deploy Preview.

## Checklist rápido
- [ ] Ver se `/api/auth/flags` mostra `serverCookieMode: true`
- [ ] Ver se `/api/auth/login` responde 400 aos testes (painel) e 200 ao POST válido.
- [ ] Conferir `jwtSecretPresent: true`
- [ ] Em dev-jwt: `/api/dev-jwt` status 200 em Preview, 404 em Production (sem override).

> Remover `NEXT_PUBLIC_DEBUG` e `README-auth-debug.md` antes de ir para produção final.
