/**
 * Host half of the Prompt Optimizer bundle.
 *
 * One operation, two callers: `optimizePrompt` is the single implementation.
 * The agent tool (`optimize_prompt`) and the slash command (`/optimize`) both
 * call it, and the Web UI reaches it through the command's Remote endpoint.
 */

/** Files whose presence identifies a project's stack and conventions. */
const STACK_MARKERS = [
  'package.json',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'composer.json',
  'Gemfile',
  'CMakeLists.txt',
  'Makefile',
  'Dockerfile',
  'docker-compose.yml',
]

/** Project documents worth reading for conventions and purpose. */
const CONTEXT_DOCS = [
  'README.md',
  'readme.md',
  'AGENTS.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'ARCHITECTURE.md',
]

/** Directories that never carry project signal and only slow a listing down. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.gradle',
  '.idea',
  '.vscode',
  'vendor',
])

/** Extension counts that identify a project's primary language. */
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte',
  '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.cs', '.swift',
  '.c', '.h', '.cc', '.cpp', '.hpp', '.scala', '.ex', '.exs', '.dart',
])

/** Config files that reveal the project's toolchain and conventions. */
const TOOLCH_FILES = [
  'eslint.config.js',
  'eslint.config.mjs',
  '.eslintrc.js',
  '.eslintrc.json',
  '.prettierrc',
  '.prettierrc.json',
  'biome.json',
  'tsconfig.json',
  'pyproject.toml',
  '.editorconfig',
  'rustfmt.toml',
  '.golangci.yml',
]

/** Upper bound on the project context handed to the model, in characters. */
const CONTEXT_BUDGET = 6000

/** Upper bound on a single project's document excerpt, in characters. */
const DOC_BUDGET = 1200

/** Upper bound on the prompt length accepted by the optimizer, in characters. */
const MAX_PROMPT_LENGTH = 8000

/**
 * Brand a string as a command definition id. The id is the identity the
 * registering plugin owns; it is how a host command adapter tells two
 * same-named commands apart.
 * @param {string} id - the owning package's identity.
 * @returns {string} the same string, branded.
 */
function CommandDefinitionId(id) {
  return id
}

/** Marker that separates the model's optimized prompt from its commentary. */
const OPTIMIZED_MARKER = '<<<OPTIMIZED_PROMPT>>>'

/** Marker that separates the model's commentary from its optimized prompt. */
const NOTES_MARKER = '<<<OPTIMIZATION_NOTES>>>'

/**
 * Read a file as text, returning undefined when it cannot be read.
 * @param {string} path - absolute path to read.
 * @param {number} maxBytes - upper bound on the bytes read.
 * @returns {Promise<string | undefined>} the file text, or undefined.
 */
async function readTextFile(path, maxBytes) {
  const { readFile } = await import('node:fs/promises')
  try {
    const buffer = await readFile(path)
    return buffer.subarray(0, maxBytes).toString('utf8')
  } catch {
    return undefined
  }
}

/**
 * List one directory, returning an empty list when it cannot be read.
 * @param {string} path - absolute directory path.
 * @returns {Promise<Array<{ name: string, isDirectory: boolean }>>} the entries.
 */
async function listDirectory(path) {
  const { readdir } = await import('node:fs/promises')
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.map(entry => ({ name: entry.name, isDirectory: entry.isDirectory() }))
  } catch {
    return []
  }
}

/**
 * Count the project's source files per extension, shallow but broad.
 * @param {string} root - absolute project root.
 * @returns {Promise<Record<string, number>>} extension to file count.
 */
async function countSourceExtensions(root) {
  const { extname, join } = await import('node:path')
  /** @type {Map<string, number>} */
  const counts = new Map()
  const queue = [root]
  let visited = 0
  while (queue.length > 0 && visited < 400) {
    const dir = queue.shift()
    if (dir === undefined) break
    visited += 1
    const entries = await listDirectory(dir)
    for (const entry of entries) {
      if (entry.isDirectory) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          queue.push(join(dir, entry.name))
        }
        continue
      }
      const ext = extname(entry.name)
      if (!SOURCE_EXTENSIONS.has(ext)) continue
      counts.set(ext, (counts.get(ext) ?? 0) + 1)
    }
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]))
}

/**
 * Build the shallow directory tree of the project, skipping noise directories.
 * @param {string} root - absolute project root.
 * @returns {Promise<string>} a printable tree.
 */
async function buildDirectoryTree(root) {
  const { join } = await import('node:path')
  /** @type {string[]} */
  const lines = []
  /**
   * Walk one directory and append its entries.
   * @param {string} dir - absolute directory path.
   * @param {string} prefix - printable indentation prefix.
   * @param {number} depth - remaining recursion depth.
   */
  const walk = async (dir, prefix, depth) => {
    if (depth <= 0 || lines.length > 120) return
    const entries = await listDirectory(dir)
    const visible = entries
      .filter(entry => !(entry.isDirectory && (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.'))))
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    for (const [index, entry] of visible.entries()) {
      if (lines.length > 120) return
      const last = index === visible.length - 1
      lines.push(`${prefix}${last ? '└─ ' : '├─ '}${entry.name}${entry.isDirectory ? '/' : ''}`)
      if (entry.isDirectory) await walk(join(dir, entry.name), `${prefix}${last ? '   ' : '│  '}`, depth - 1)
    }
  }
  await walk(root, '', 3)
  return lines.join('\n')
}

/**
 * Gather the project context the optimizer grounds its rewrite in.
 * @param {string} root - absolute project root.
 * @returns {Promise<string>} a printable context summary.
 */
async function gatherProjectContext(root) {
  const { join } = await import('node:path')
  const { basename } = await import('node:path')

  /** @type {string[]} */
  const parts = []
  parts.push(`Project root: ${root}`)
  parts.push(`Project name: ${basename(root)}`)

  const entries = await listDirectory(root)
  const names = new Set(entries.map(entry => entry.name))

  const stack = STACK_MARKERS.filter(marker => names.has(marker))
  if (stack.length > 0) parts.push(`Build/stack manifests present: ${stack.join(', ')}`)

  const extensions = await countSourceExtensions(root)
  const top = Object.entries(extensions).slice(0, 6)
  if (top.length > 0) {
    parts.push(`Source files by extension: ${top.map(([ext, count]) => `${ext} (${count})`).join(', ')}`)
  }

  const tree = await buildDirectoryTree(root)
  if (tree.length > 0) parts.push(`Directory structure:\n${tree}`)

  for (const doc of CONTEXT_DOCS) {
    if (!names.has(doc)) continue
    const text = await readTextFile(join(root, doc), DOC_BUDGET)
    if (text === undefined) continue
    parts.push(`--- ${doc} (excerpt) ---\n${text.slice(0, DOC_BUDGET)}`)
  }

  for (const tool of TOOLCH_FILES) {
    if (!names.has(tool)) continue
    if (CONTEXT_DOCS.includes(tool)) continue
    const text = await readTextFile(join(root, tool), 600)
    if (text === undefined) continue
    parts.push(`--- ${tool} (excerpt) ---\n${text.slice(0, 600)}`)
  }

  return parts.join('\n\n').slice(0, CONTEXT_BUDGET)
}

/**
 * Build the instruction that asks the model for an optimized prompt.
 * @param {string} prompt - the prompt to optimize.
 * @param {string} context - the gathered project context.
 * @param {string} goal - an optional extra goal stated by the caller.
 * @returns {string} the model instruction.
 */
function buildInstruction(prompt, context, goal) {
  return [
    'You rewrite a user prompt so that an AI coding agent working inside a specific project can act on it without further clarification.',
    '',
    'Project context:',
    '"""',
    context,
    '"""',
    '',
    goal.length > 0 ? `Additional goal the caller stated:\n${goal}` : '',
    'Original prompt:',
    '"""',
    prompt,
    '"""',
    '',
    'Rewrite the original prompt. Keep the caller\'s intent, language, and any explicit values (paths, names, commands) exactly as written — improve structure and completeness, never the meaning. Make it specific to the project context above: name the real files, modules, tools, and conventions that the project actually uses. Resolve vague references ("the config file", "that bug") against the project structure. State the expected deliverable and the acceptance criteria. Keep it dense and actionable: remove pleasantries and filler.',
    '',
    'Ground every claim in the project context. Only name files, directories, modules, frameworks, or features that the context actually shows. If the context does not contain the thing the original prompt refers to, keep the caller\'s wording for it and say in the notes that the context does not show it, rather than inventing a location or a feature.',
    '',
    'Reply in exactly this format and nothing else:',
    OPTIMIZED_MARKER,
    '<the optimized prompt, ready to send as-is>',
    NOTES_MARKER,
    '<one or two short sentences on what you changed and why>',
  ].filter(line => line !== undefined).join('\n')
}

/** Labels a model may add on its own line inside the optimized-prompt section. */
const PROMPT_LABELS = /^(?:optimized\s+prompt|rewritten\s+prompt|the\s+optimized\s+prompt|prompt)\s*:\s*$/i

/** Labels a model may add on its own line inside the notes section. */
const NOTES_LABELS = /^(?:notes?|changes?|rationale|explanation)\s*:\s*$/i

/**
 * Strip the angle-bracket placeholder and any label the model echoed.
 * @param {string} section - one parsed section of the reply.
 * @param {RegExp} labelPattern - the label pattern for that section.
 * @returns {string} the cleaned section text.
 */
function cleanSection(section, labelPattern) {
  let text = section.trim()
  // The model sometimes echoes the template's placeholder verbatim.
  text = text.replace(/^<[^>\n]{0,80}>\s*/u, '')
  const lines = text.split('\n')
  // A label may stand alone on its line, or prefix the text on the same line.
  while (lines.length > 0) {
    const first = lines[0].trim()
    if (labelPattern.test(first)) {
      lines.shift()
      continue
    }
    const inline = first.match(/^(?:optimized\s+prompt|rewritten\s+prompt|the\s+optimized\s+prompt|prompt|notes?|changes?|rationale|explanation)\s*:\s*(.*)$/iu)
    if (inline !== null) {
      lines[0] = inline[1]
      continue
    }
    break
  }
  return lines.join('\n').trim()
}

/**
 * Split the model reply into the optimized prompt and its notes.
 * @param {string} reply - the raw model text.
 * @returns {{ optimized: string, notes: string }} the parsed parts.
 */
function parseReply(reply) {
  const text = reply.trim()
  const start = text.lastIndexOf(OPTIMIZED_MARKER)
  const notesAt = text.lastIndexOf(NOTES_MARKER)
  /** Remove every marker echo from one extracted section. */
  const stripMarkers = (section) =>
    section.split(OPTIMIZED_MARKER).join('').split(NOTES_MARKER).join('')
  if (start < 0) {
    // The model ignored the markers: treat the whole reply as the prompt.
    return { optimized: cleanSection(stripMarkers(text), PROMPT_LABELS), notes: '' }
  }
  const promptEnd = notesAt > start ? notesAt : text.length
  const optimized = cleanSection(
    stripMarkers(text.slice(start + OPTIMIZED_MARKER.length, promptEnd)),
    PROMPT_LABELS,
  )
  const notes = notesAt >= 0
    ? cleanSection(stripMarkers(text.slice(notesAt + NOTES_MARKER.length)), NOTES_LABELS)
    : ''
  return { optimized, notes }
}

/**
 * Resolve the provider/model the optimizer calls, preferring the session's own.
 * @param {object} ctx - the plugin context.
 * @param {object | undefined} agent - the calling agent, when there is one.
 * @returns {{ provider: string, model: string } | undefined} the route, when resolvable.
 */
function resolveRoute(ctx, agent) {
  const selection = ctx.get('agentDefaultModel')
  const current = selection?.currentSelection?.()
  if (current !== undefined && current.provider !== undefined && current.model !== undefined) {
    return { provider: current.provider, model: current.model }
  }
  const header = agent?.session?.requestHeader?.()
  if (header?.config?.provider !== undefined && header.config.model !== undefined) {
    return { provider: header.config.provider, model: header.config.model }
  }
  return undefined
}

/**
 * Run one model call and collect its text.
 * @param {object} ctx - the plugin context.
 * @param {string} instruction - the model instruction.
 * @param {object | undefined} agent - the calling agent.
 * @param {AbortSignal | undefined} signal - cancellation.
 * @returns {Promise<string>} the model reply text.
 */
async function callModel(ctx, instruction, agent, signal) {
  const llm = ctx.get('llm')
  if (llm === undefined) throw new Error('No LLM service is available in this profile.')
  const route = resolveRoute(ctx, agent)
  if (route === undefined) {
    throw new Error('No model route is available. Select a model in the composer and try again.')
  }
  /** @type {string} */
  let text = ''
  const options = {
    provider: route.provider,
    model: route.model,
    system: 'You are a precise prompt engineering assistant. You output only the requested format.',
    messages: [{ role: 'user', content: [{ type: 'text', text: instruction }] }],
    ...(signal === undefined ? {} : { signal }),
    ...(agent?.id === undefined ? {} : { sessionId: agent.id }),
  }
  for await (const chunk of llm.stream(options)) {
    if (chunk.type === 'text-delta') text += chunk.text
  }
  if (text.trim().length === 0) throw new Error('The model returned an empty response.')
  return text
}

/**
 * Optimize one prompt against the current project.
 * @param {object} ctx - the plugin context.
 * @param {string} prompt - the prompt to optimize.
 * @param {object} [options] - the call options.
 * @param {string} [options.goal] - an extra goal stated by the caller.
 * @param {object} [options.agent] - the calling agent.
 * @param {AbortSignal} [options.signal] - cancellation.
 * @returns {Promise<{ optimized: string, notes: string, context: string }>} the result.
 */
async function optimizePrompt(ctx, prompt, options = {}) {
  const text = typeof prompt === 'string' ? prompt.trim() : ''
  if (text.length === 0) throw new Error('The prompt is empty.')
  if (text.length > MAX_PROMPT_LENGTH) {
    throw new Error(`The prompt is ${text.length} characters; the optimizer accepts up to ${MAX_PROMPT_LENGTH}.`)
  }

  const workingDirectory = ctx.get('workingDirectory')
  let root = workingDirectory?.defaultDirectory
  const agent = options.agent
  if (agent !== undefined && workingDirectory !== undefined) {
    try {
      root = await workingDirectory.ensure(agent, options.signal)
    } catch {
      // Fall back to the deployment default when the session directory is unavailable.
    }
  }
  if (root === undefined) throw new Error('No working directory is available for this session.')

  const context = await gatherProjectContext(root)
  const reply = await callModel(ctx, buildInstruction(text, context, options.goal ?? ''), agent, options.signal)
  const parsed = parseReply(reply)
  if (parsed.optimized.length === 0) throw new Error('The model did not return an optimized prompt.')
  return { optimized: parsed.optimized, notes: parsed.notes, context }
}

/**
 * Register the plugin's service, tool, and command.
 * @param {object} ctx - the plugin context.
 */
export function apply(ctx) {
  const tools = ctx.get('tools')
  const commands = ctx.get('commands')

  if (tools !== undefined) {
    const dispose = tools.register({
      name: 'optimize_prompt',
      description:
        'Rewrite a prompt so an AI coding agent can act on it without clarification, grounded in the current project\'s stack, structure, and conventions. Use when the user asks to improve, enhance, sharpen, or complete a prompt, or when a request is vague about which files, tools, or conventions apply. Returns the optimized prompt and a short note on what changed.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'The prompt to optimize.',
          },
          goal: {
            type: 'string',
            description: 'An optional extra goal to fold into the optimized prompt.',
          },
        },
        required: ['prompt'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            optimized: { type: 'string' },
            notes: { type: 'string' },
          },
          required: ['optimized', 'notes'],
          additionalProperties: false,
        },
        render: (_args, value) => [
          { type: 'text', text: `<optimized_prompt>\n${value.optimized}\n</optimized_prompt>` },
          ...(value.notes.length > 0
            ? [{ type: 'text', text: `<optimization_notes>\n${value.notes}\n</optimization_notes>` }]
            : []),
        ],
      },
      async execute(args, exec) {
        const input = args ?? {}
        if (typeof input.prompt !== 'string' || input.prompt.trim().length === 0) {
          throw new Error('optimize_prompt requires a non-empty "prompt" string.')
        }
        const result = await optimizePrompt(ctx, input.prompt, {
          goal: typeof input.goal === 'string' ? input.goal : '',
          agent: exec.agent,
          signal: exec.signal,
        })
        return { optimized: result.optimized, notes: result.notes }
      },
      presentCall(args) {
        const input = args ?? {}
        const prompt = typeof input.prompt === 'string' ? input.prompt : ''
        const headline = prompt.split('\n')[0] ?? ''
        return {
          card: 'generic',
          title: 'Optimize prompt',
          kind: 'other',
          rawInput: { prompt },
          ...(headline.length > 0 ? { content: [{ type: 'text', text: headline }] } : {}),
        }
      },
    })
    ctx.effect(() => dispose, 'prompt-optimizer:tool')
  }

  if (commands !== undefined) {
    const dispose = commands.register({
      definitionId: CommandDefinitionId('@luckystar6/prompt-optimizer'),
      name: 'optimize',
      description: 'Optimize the current prompt against this project.',
      input: { hint: '<prompt text>' },
      async handler(invocation) {
        try {
          const result = await optimizePrompt(ctx, invocation.rawInput, {
            agent: invocation.agent,
            signal: invocation.signal,
          })
          const notes = result.notes.length > 0 ? `\n\n--- notes ---\n${result.notes}` : ''
          return { kind: 'success', text: `${result.optimized}${notes}` }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return { kind: 'error', text: `Prompt optimization failed: ${message}` }
        }
      },
    })
    ctx.effect(() => dispose, 'prompt-optimizer:command')
  }
}

export const inject = ['tools', 'commands']
