# APM Web (Aluno)

## Rodando local
```bash
npm install
npm run dev
# http://localhost:3000
```
O comando único sobe o Express (API) e o Next (frontend) juntos. Cole seu JWT no topo (TokenBar) e use normalmente. Caso precise apontar o frontend para outra API (ex.: staging), crie `web/.env.local` com:
```
NEXT_PUBLIC_API_BASE=https://API-ALTERNATIVA.exemplo.com
```

## Deploy integrado
- O build único roda `npm run build`, que executa `tsc` + `next build web`.
- `npm run start` serve a API e o Next na mesma origem (ex.: `https://lifeflourishconsulting.com`).
- Variáveis `NEXT_PUBLIC_*` continuam sendo lidas do ambiente do servidor Node antes do build do Next.
