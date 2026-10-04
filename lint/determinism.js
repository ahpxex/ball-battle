/**
 * Local oxlint JS plugin: the `**` operator is implementation-approximated in
 * ECMAScript, so simulation code must square with plain multiplication (`sq`,
 * `cube` in core/vec) or call `dm.pow` (core/dmath).
 */
const noExponentOperator = {
  meta: { type: 'problem', docs: { description: 'Disallow the non-reproducible ** operator in simulation code' } },
  create(context) {
    const report = (node) => context.report({ node, message: '`**` is not bit-reproducible across JS engines; use sq()/cube() from core/vec or dm.pow().' })
    return {
      BinaryExpression(node) {
        if (node.operator === '**') report(node)
      },
      AssignmentExpression(node) {
        if (node.operator === '**=') report(node)
      },
    }
  },
}

export default {
  meta: { name: 'determinism' },
  rules: { 'no-exponent-operator': noExponentOperator },
}
