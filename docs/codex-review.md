# Solicitando novo review do Codex

Para pedir que o bot Codex volte a revisar um pull request, adicione um comentário no PR com o seguinte conteúdo em uma linha isolada:

```
@codex review
```

O Codex responderá com um novo parecer, desde que o PR ainda esteja aberto e que as verificações obrigatórias tenham sido executadas. Caso existam comentários pendentes marcados como "Changes requested", descreva no mesmo comentário o que foi resolvido desde a última rodada.

## Boas práticas

- Reaplique o comando apenas depois de atualizar o PR com novos commits.
- Inclua um breve resumo das alterações e, se possível, links para testes executados.
- Certifique-se de que o comentário contenha somente a menção `@codex review` em uma linha exclusiva para evitar confusão com outros comandos automatizados.
