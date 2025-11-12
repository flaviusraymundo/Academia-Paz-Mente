# APM Web (Aluno)

## Rodando local
```bash
cd web
npm i
npm run dev
# http://localhost:4000
```
Cole seu JWT no topo (TokenBar). Se a API estiver em outra origem, defina:
```
NEXT_PUBLIC_API_BASE=https://SEU-BACKEND.NETLIFY.APP
```
no arquivo `.env.local`.

## Deploy no Netlify (site separado)
- Base directory: `web`
- Build command: `npm run build`
- Publish directory: `.next`
- Env:
  - `NEXT_PUBLIC_API_BASE=https://SEU-BACKEND.NETLIFY.APP`

Opcional — acessar via site principal:
- No site principal (marketing), adicione em `_redirects`:
```
/app/*  https://SEU-APP-NEXT.netlify.app/:splat  200
```
Assim `https://seu-site.netlify.app/app/` serve o app Next.
