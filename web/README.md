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
  - `NEXT_PUBLIC_API_BASE=https://lifeflourishconsulting.com`

O site principal (`lifeflourishconsulting.com`) já reescreve todas as rotas que não começam com `/api`
para `https://profound-seahorse-147612.netlify.app/:splat`, então o usuário sempre vê o Next
no domínio final.
