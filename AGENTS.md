# Diretrizes do Projeto & Instruções de Desenvolvimento (Data CoLAB)

## 📌 Regra Obrigatória: Atualização Contínua do Histórico de Alterações (Changelog)

Sempre que forem introduzidas novas funcionalidades, melhorias, alterações de design, correções de bugs, ajustes legais ou modificações em módulos existentes na aplicação:

1. **Atualizar o Histórico Global de Alterações**:
   - Localização: `src/utils/userGuides.ts`
   - Constante / Documento: `DEFAULT_CHANGELOG_HISTORY_GUIDE` (id: `'changelog_history'`).
   - Ação: Adicionar uma nova entrada/secção com a descrição detalhada das mudanças efetuadas, módulo afetado, data da intervenção e impacto funcional.
   - Manter a data de `lastUpdated` atualizada no objeto correspondente em `getInitialGuides()`.

2. **Garantir Consistência Institucional**:
   - A designação da entidade deve manter-se sempre padronizada como **`Data CoLAB`**.

3. **Norma Linguística Obrigatória: Português de Portugal (PT-PT) & Terminologia do Código do Trabalho**:
   - É **estritamente proibido** o uso de termos do Português do Brasil.
   - **Termo "Turno" Proibido**: É expressamente interdito utilizar a palavra "turno". Deve usar-se sempre **"horário"**, **"horário de trabalho"** ou **"período de trabalho"** (ex.: "Horário em Curso", "Fora do Horário", "Horário Normal de Trabalho").
   - **Substituições Terminológicas Obrigatórias**:
     - ❌ "turno" / "turnos" ➔ ✅ **"horário"** / **"horários"** ou **"período de trabalho"**
     - ❌ "jornada" ➔ ✅ **"horário de trabalho"** / **"período normal de trabalho"**
     - ❌ "excluir" / "exclusão" ➔ ✅ **"eliminar"** / **"eliminação"**
     - ❌ "buscar" ➔ ✅ **"pesquisar"** / **"procurar"**
     - ❌ "digite" ➔ ✅ **"escreva"** / **"introduza"**
     - ❌ "celular" ➔ ✅ **"telemóvel"**
     - ❌ "tela" ➔ ✅ **"ecrã"**
     - ❌ "arquivo" ➔ ✅ **"ficheiro"**
     - ❌ "usuário" ➔ ✅ **"utilizador"**
     - ❌ "logar" / "deslogar" ➔ ✅ **"iniciar sessão"** / **"terminar sessão"**
