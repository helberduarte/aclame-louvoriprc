# ROLLBACK — Fase 2 (redesign UX/UI)

Kit de segurança criado antes de qualquer edição:

- **Tag de backup**: `backup-pre-fase2-20260708-1503`
- **Branch de trabalho**: `feature/ux-redesign-fase2`
- **Commit de origem** (estado de produção intocado): `50d7190`

`main` não foi tocada em nenhum momento — produção continua servindo o commit
`50d7190`. Comandos de reversão, do menor para o maior impacto:

## 1. Reverter um arquivo específico (ainda na branch)
```bash
git checkout backup-pre-fase2-20260708-1503 -- public/styles.css
# (ou public/app.js, public/index.html)
```

## 2. Reverter uma etapa inteira (commits independentes)
```bash
git revert 3ac03c1   # desfaz só o tema (etapa B)
git revert f396db0   # desfaz só a navegação (etapa A)
```

## 3. Abandonar toda a Fase 2 e voltar ao estado anterior
```bash
git checkout main
git branch -D feature/ux-redesign-fase2
```

## 4. Se a branch tiver sido enviada ao GitHub
```bash
git push origin --delete feature/ux-redesign-fase2
```

## 5. Restauração total ao snapshot (último recurso; use na branch, nunca em main)
```bash
git reset --hard backup-pre-fase2-20260708-1503
```

Observação: enquanto não houver merge de `feature/ux-redesign-fase2` em `main`,
nenhum destes comandos afeta o site em produção.
