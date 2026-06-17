---
'@10x-media/form-builder': minor
---

Calculations and scoring: a safe serializable expression engine (no `eval`), the `calculation` field type, dual live/authoritative compute (authoritative for storage, conditions, and validation), quiz scoring via option weights, and scored results via recall.

- **`CalcExpression` AST** (`lit | ref | op | neg | fn | weight`): plain JSON expression trees, no code execution at any level.
- **`evaluateCalc`**: pure, total evaluator (division/modulo by zero returns 0; missing ref returns 0; depth-guarded at 64 levels) that runs on the public submit path.
- **`calculation` field type**: a read-only numeric field whose value is derived from a `CalcExpression` over sibling answers. `calcDisplay: false` computes without rendering (hidden score).
- **Dual compute**: computed live client-side for immediate display, re-computed authoritatively on the server at submit; client value is never trusted.
- **Authoritative for conditions and validation**: the server-computed value can be referenced in `visibleWhen`/`validateWhen` and validation rules like any other field.
- **Quiz scoring via `weight`**: maps a multiple-choice option answer to a numeric score; chain multiple weight nodes and sum them for a total score.
- **Scored results via recall**: pipe a computed score into the success message with `{{score}}` tokens, reusing the existing recall feature.
- **Exported API**: `evaluateCalc`, `computeCalcFields`, `calcExpressionOf`, `normalizeCalc`, and `CalcExpression` exported from both the root entry and `@10x-media/form-builder/react`.
