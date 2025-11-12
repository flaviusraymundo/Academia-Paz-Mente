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
NEXT_PUBLIC_API_BASE=https://seu-backend.netlify.app
```
em `web/.env.local`.

## Deploy no Netlify (site separado)
- Base directory: `web`
- Build command: `npm run build`
- Publish directory: `.next`
- Env:
  - `NEXT_PUBLIC_API_BASE=https://SEU-BACKEND.NETLIFY.APP`
- O Netlify detecta Next.js automaticamente (Next 14). Se preferir outra plataforma, adapte as variáveis.
