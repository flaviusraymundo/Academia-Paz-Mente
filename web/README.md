# APM Web (Aluno)

## Rodando local
Os scripts agora vivem no `package.json` da raiz. Após `npm install` na raiz, execute:

```bash
npm run dev
# http://localhost:3000
```

Isso levanta o Express e o Next no mesmo servidor. Para iniciar apenas o Next (útil para CI ou para
testar o App Router isolado), rode `npm run web:dev`.

Caso a API esteja em outra origem durante testes, defina `NEXT_PUBLIC_API_BASE` dentro de `web/.env.local`.

## Deploy (site raiz)
- Build command: `npm run build` (gera `dist/` e `web/.next`)
- Publish directory: `public` (Netlify reescreve `/*` para `/.netlify/functions/api/:splat`)
- Env principal: `NEXT_PUBLIC_API_BASE=https://lifeflourishconsulting.com`

Não existe mais deploy separado em `profound-seahorse-147612.netlify.app`. O domínio
`lifeflourishconsulting.com` serve as páginas do Next e as rotas `/api` via o mesmo bundle.
