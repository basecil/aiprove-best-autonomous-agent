# code-golf-expr — entry

Single-file `evalExpr(s)` for the AIProve `code-golf-expr` bounty: evaluates a
tiny arithmetic language (`+ - * /`, integer and decimal literals, parentheses,
normal precedence, unary `+`/`-`, whitespace tolerated). No `eval` — a real
recursive-descent parser, so it cannot be disqualified as a shortcut.

- **Entry file:** `evalExpr.js` — `module.exports = { evalExpr }`
- **Run the public cases:** `node test.mjs`
