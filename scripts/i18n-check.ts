/**
 * Translation consistency check (the type system already enforces that every
 * locale has the same keys and array lengths as the Chinese source):
 *  - every string uses exactly the same `{{placeholders}}` in every language;
 *  - each character's rule text uses exactly the keys of its `ruleValues`, so
 *    no number is missing from the text and no tuning constant goes unshown.
 *
 *   bun run check:i18n
 */
import { CHARACTERS } from '../src/game/characters/registry'
import { resources } from '../src/i18n/resources'

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g
const placeholders = (s: string): string[] => [...new Set([...s.matchAll(PLACEHOLDER)].map((m) => m[1]))].sort()

/** Flattens a resource tree into `path -> string`. */
function flatten(node: unknown, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (typeof node === 'string') out.set(prefix, node)
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) flatten(v, prefix ? `${prefix}.${k}` : k, out)
  return out
}

const problems: string[] = []
const [source, ...others] = Object.keys(resources) as (keyof typeof resources)[]

for (const ns of Object.keys(resources[source]) as (keyof (typeof resources)[typeof source])[]) {
  const base = flatten(resources[source][ns])
  for (const lng of others) {
    const other = flatten(resources[lng][ns])
    for (const [key, text] of base) {
      const translated = other.get(key)
      if (translated === undefined) {
        problems.push(`${lng}:${ns}:${key} is missing`)
        continue
      }
      const want = placeholders(text).join(',')
      const got = placeholders(translated).join(',')
      if (want !== got) problems.push(`${lng}:${ns}:${key} uses {${got}} but ${source} uses {${want}}`)
    }
    for (const key of other.keys()) if (!base.has(key)) problems.push(`${lng}:${ns}:${key} does not exist in ${source}`)
  }
}

for (const def of CHARACTERS) {
  const rules = resources[source].characters[def.id].rules as readonly string[]
  const used = new Set(rules.flatMap(placeholders))
  const given = new Set(Object.keys(def.ruleValues ?? {}))
  for (const k of used) if (!given.has(k)) problems.push(`characters.${def.id}: rule text uses {{${k}}} but ruleValues has no "${k}"`)
  for (const k of given) if (!used.has(k)) problems.push(`characters.${def.id}: ruleValues.${k} is never shown in the rule text`)
}

if (problems.length > 0) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'))
  process.exit(1)
}
console.log(`✓ ${Object.keys(resources).join(' / ')} consistent; ${CHARACTERS.length} characters' rule values all shown`)
