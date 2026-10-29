// Unit test for the optimizer's reply parser, run against the real module source.
import fs from 'node:fs'
import path from 'node:path'

const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8')

// Extract the parser pieces we want to exercise, without importing the whole plugin
// (which would need a live Cordis context).
const grab = (name) => {
  const start = src.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`missing ${name}`)
  // find the matching closing brace at column 0
  const end = src.indexOf('\n}\n', start)
  return src.slice(start, end + 3)
}

/** Extract one top-level `const NAME = /.../` declaration from the source. */
const grabConst = (name) => {
  const pattern = new RegExp(`^const ${name} = .*$`, 'mu')
  const match = src.match(pattern)
  if (match === null) throw new Error(`missing const ${name}`)
  return match[0]
}

const mod = await import(
  'data:text/javascript,' +
  encodeURIComponent(
    [
      "const OPTIMIZED_MARKER = '<<<OPTIMIZED_PROMPT>>>'",
      "const NOTES_MARKER = '<<<OPTIMIZATION_NOTES>>>'",
      grabConst('PROMPT_LABELS'),
      grabConst('NOTES_LABELS'),
      grab('cleanSection'),
      grab('parseReply'),
      'export { parseReply }',
    ].join('\n'),
  )
)

const { parseReply } = mod

let failures = 0
const check = (name, actual, expected) => {
  const ok = actual === expected
  if (!ok) failures += 1
  console.log(ok ? 'PASS' : 'FAIL', name)
  if (!ok) {
    console.log('   actual  :', JSON.stringify(actual))
    console.log('   expected:', JSON.stringify(expected))
  }
}

// 1. The exact shape the subagent observed: model echoed a label line.
check(
  'strips the echoed "Optimized prompt:" label',
  parseReply(
    '<<<OPTIMIZED_PROMPT>>>\nOptimized prompt:\n\nFix the bug.\n\n<<<OPTIMIZATION_NOTES>>>\nNotes: Specified files.',
  ).optimized,
  'Fix the bug.',
)

// 2. Clean reply parses normally.
check(
  'parses a clean reply',
  parseReply(
    '<<<OPTIMIZED_PROMPT>>>\nDo the thing.\n<<<OPTIMIZATION_NOTES>>>\nI made it specific.',
  ).optimized,
  'Do the thing.',
)

// 3. Notes are parsed and their label stripped.
check(
  'parses and strips the notes label',
  parseReply(
    '<<<OPTIMIZED_PROMPT>>>\nDo the thing.\n<<<OPTIMIZATION_NOTES>>>\nNotes: I made it specific.',
  ).notes,
  'I made it specific.',
)

// 4. The template placeholder is not echoed back.
check(
  'drops an echoed template placeholder',
  parseReply(
    '<<<OPTIMIZED_PROMPT>>>\n<the optimized prompt, ready to send as-is>\n\nReal content.\n<<<OPTIMIZATION_NOTES>>>\n<one or two short sentences>\n\nReal notes.',
  ).optimized,
  'Real content.',
)

// 5. A reply with no markers at all still yields a prompt.
check(
  'falls back to the whole reply when markers are missing',
  parseReply('Just a plain answer.').optimized,
  'Just a plain answer.',
)

// 6. A reply with no markers and no notes yields empty notes.
check(
  'yields empty notes when there is no notes section',
  parseReply('Just a plain answer.').notes,
  '',
)

// 7. Multi-line optimized prompt is preserved.
check(
  'preserves multi-line optimized prompts',
  parseReply(
    '<<<OPTIMIZED_PROMPT>>>\nLine one.\nLine two.\n<<<OPTIMIZATION_NOTES>>>\nNotes ok.',
  ).optimized,
  'Line one.\nLine two.',
)

// 8. A prompt that legitimately begins with the word "Prompt:" keeps its body.
check(
  'keeps body text after a leading label',
  parseReply(
    '<<<OPTIMIZED_PROMPT>>>\nPrompt:\nWrite a release note.\n<<<OPTIMIZATION_NOTES>>>\nNotes ok.',
  ).optimized,
  'Write a release note.',
)

// The client half's contracts live in their own files, so a failure names the
// layer that broke rather than the parser. Both run from here so one command
// covers the whole bundle.
const layoutFailures = (await import('./layout.mjs')).default
failures += layoutFailures
const renderFailures = (await import('./render.mjs')).default
failures += renderFailures

console.log(
  failures === 0
    ? '\nALL PASS (reply parser + composer layout + client render)'
    : `\n${failures} FAILURE(S)`,
)
process.exit(failures === 0 ? 0 : 1)
