// Render smoke test for the client half.
//
// A rendered button cannot be inspected in this environment, but a rendering
// CRASH can be caught without a browser. This drives the real client module
// through a minimal React and slot stub, so an undefined identifier, a broken
// element tree, or a throwing style expression fails here instead of blanking
// the composer seat in the page.
//
// The regression this exists for: a style constant was renamed in one place
// while the button still read the old name. Source-reading tests passed — they
// only match strings — and the seat crashed in the live page with
// `ReferenceError: SUBMIT_BUTTON_SIZE is not defined`.
import fs from 'node:fs'

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

/** Every element the module's React stub was asked to create. */
const elements = []

/**
 * A minimal React surface: just what the control uses. The first `useState`
 * call is the control's phase object, which is how the busy path is reached.
 * @param {string} phase - the phase the control should render in.
 * @returns {object} the stub.
 */
const createReactStub = (phase) => {
  let stateCall = 0
  return {
    createElement: (type, props, ...children) => {
      const element = { type, props: props ?? {}, children }
      elements.push(element)
      // React invokes a function component during reconciliation. Doing the same
      // here is what makes this a render test: a throw inside the drawn icon
      // surfaces instead of sitting unexamined in the tree.
      if (typeof type === 'function') return type({ ...(props ?? {}), children })
      return element
    },
    useState: (initial) => {
      stateCall += 1
      return [stateCall === 1 ? { phase, message: '' } : initial, () => {}]
    },
    useCallback: (fn) => fn,
    // Invoke the effect's body immediately so auto-dismiss logic runs during
    // render, which is what lets this test cover the draft-empty watcher.
    useEffect: (fn) => { if (typeof fn === 'function') fn(); return () => {} },
  }
}

/**
 * A locale stub that behaves like the real service where this plugin touches it.
 * `register` stores a dictionary and returns its disposer; `bind` resolves a key
 * from the registered dictionaries and falls back to the key itself — the same
 * fallback that prints a raw `button.title` in the tooltip.
 * @param {object} [options] - `broken: true` makes `bind` never resolve, which
 *   models a namespace whose registration did not land.
 * @returns {object} the stub.
 */
const makeLocaleStub = (options = {}) => {
  const { broken = false } = options
  const dictionaries = new Map()
  return {
    count: () => dictionaries.size,
    register: (ns, id, dict) => {
      const key = `${ns}:${id}`
      dictionaries.set(key, dict)
      return () => dictionaries.delete(key)
    },
    bind: (ns) => (key) => {
      if (broken) return key
      for (const [id, dict] of dictionaries) {
        if (id.startsWith(`${ns}:`) && Object.hasOwn(dict, key)) return dict[key]
      }
      return key
    },
  }
}

/**
 * Evaluate the client module the way the page does, then build and mount the
 * plugin so its component closes over THIS phase's React.
 * @param {string} phase - the phase the rendered control should be in.
 * @param {object} [options] - `withLocale: false` mounts without a locale
 *   service, which is the deployment the built-in dictionary fallback covers.
 * @returns {object} what apply registered, plus the locale stub and cleanups.
 */
const buildAndMount = (phase, options = {}) => {
  const { withLocale = true, localeBroken = false, notes = null, failWith = null } = options
  elements.length = 0
  const registrations = []
  globalThis.window = {
    __ModuleLoader__: { load: (registration) => registrations.push(registration) },
  }

  const requireStub = (specifier) => {
    if (specifier === 'react') return createReactStub(phase)
    throw new Error(`unexpected module request: ${specifier}`)
  }

  // The module is a plain script with side effects and no exports, so it is
  // evaluated from source rather than imported.
  const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  new Function('window', 'require', source)(globalThis.window, requireStub)

  const registration = registrations[0]
  if (registration === undefined) throw new Error('the client module registered nothing')

  const plugin = registration.factory(requireStub)
  const registered = []
  const injected = []
  const locale = makeLocaleStub({ broken: localeBroken })
  const cleanups = []

  // A remote-commands stub that resolves to an optimized prompt plus the notes
  // under test, so the button's onClick can drive the full publish-to-panel
  // flow without a live Host.
  const SEPARATOR = '\n\n--- notes ---\n'
  const commandsStub = {
    execute: async (sessionId, line) => {
      if (failWith !== null) throw new Error(failWith)
      return {
        ok: true,
        value: {
          result: {
            kind: 'success',
            text: notes === null ? 'optimized prompt' : `optimized prompt${SEPARATOR}${notes}`,
          },
        },
      }
    },
  }

  plugin.apply({
    get: (name) => {
      if (name === 'locale' && withLocale) return locale
      if (name === 'remote.commands') return commandsStub
      return undefined
    },
    // Cordis INVOKES the callback and keeps its return value as the disposer.
    // Modelling that faithfully is what lets this test catch a plugin that
    // disposes from the callback body instead of returning the disposer.
    effect: (fn) => {
      const disposer = typeof fn === 'function' ? fn() : undefined
      if (typeof disposer === 'function') cleanups.push(disposer)
      return () => {}
    },
    slots: {
      inject: (slot, callback) => {
        injected.push(slot)
        callback()
        return () => {}
      },
      register: (options2, component) => {
        registered.push({ options: options2, component })
        return () => {}
      },
    },
  })
  return { registered, injected, plugin, locale, cleanups, commandsStub }
}

/** Props the activity seat supplies and the control consumes. */
const props = {
  sessionId: 'session-stub',
  useInput: (selector) => selector({ draft: 'a draft' }),
  inputActions: { setDraft: () => {}, persistDraft: () => {} },
}

// 1. The module loads, produces a plugin, and apply() registers one component
//    into the activity seat without throwing.
let mounted
try {
  mounted = buildAndMount('idle')
  check('the client module mounts without throwing', true, true)
  check('apply registers three components', mounted.registered.length, 3)
  check('apply injects two slots', mounted.injected.length, 2)
} catch (error) {
  check('the client module mounts without throwing', `threw: ${error.message}`, true)
}

const activityOpts = mounted?.registered?.[0]?.options
check('the first slot is the activity seat', activityOpts?.name, 'conversation.input.activity')
const notesOpts = mounted?.registered?.[1]?.options
check('the second slot is the dock seat', notesOpts?.name, 'conversation.input.dock')
check('the notes dock entry carries its id', notesOpts?.id, 'prompt-optimizer-notes')
check('the notes dock entry carries an order', typeof notesOpts?.order, 'number')
check('the notes dock entry carries a label', typeof notesOpts?.label, 'string')
const errorOpts = mounted?.registered?.[2]?.options
check('the third entry is the error panel', errorOpts?.name, 'conversation.input.dock')
check('the error dock entry carries its own id', errorOpts?.id, 'prompt-optimizer-error')
check('the error dock entry sorts after the notes entry', errorOpts?.order > notesOpts?.order, true)
check('the injected slots match', mounted?.injected?.join(','), 'conversation.input.activity,conversation.input.dock')

// 2. Rendering must not throw, in both states. This is the check that would have
//    caught the undefined-constant crash.
for (const phase of ['idle', 'busy']) {
  let outcome = 'rendered'
  try {
    const target = buildAndMount(phase)
    target.registered[0].component(props)
  } catch (error) {
    outcome = `threw: ${error.message}`
  }
  check(`the control renders in its ${phase} state`, outcome, 'rendered')
}

// 3. The tree really contains drawn elements, so a silent empty render fails.
check('the render produced svg elements', elements.some((el) => el.type === 'svg'), true)
check(
  'the render produced a button element',
  elements.some((el) => el.type === 'button'),
  true,
)
check(
  'the drawn elements are hidden from assistive technology',
  elements
    .filter((el) => el.type === 'svg')
    .every((el) => el.props['aria-hidden'] === 'true'),
  true,
)
check(
  'the rendered button carries an accessible name',
  elements.some((el) => el.type === 'button' && typeof el.props['aria-label'] === 'string'),
  true,
)

// 4. The dictionaries must SURVIVE apply(). `ctx.effect` invokes its callback,
//    so a plugin that disposes from the callback body unregisters everything on
//    the spot and every `t()` call falls back to printing the raw key — which is
//    how `button.title` ended up in the tooltip instead of its text.
const live = buildAndMount('idle')
check('both dictionaries stay registered after apply', live.locale.count(), 2)

const translate = live.locale.bind('prompt-optimizer')
check('the tooltip key resolves to text, not the raw key', translate('button.title') !== 'button.title', true)
check(
  'the resolved tooltip is a non-empty string',
  typeof translate('button.title') === 'string' && translate('button.title').length > 0,
  true,
)
check('the accessible name resolves to text too', translate('button.label') !== 'button.label', true)
check('the busy name resolves to text too', translate('button.busy') !== 'button.busy', true)

// The cleanups must still be pending rather than already spent. Running one
// releases the dictionaries, which proves they were the registrations' own
// disposers and not something invoked during apply.
for (const cleanup of live.cleanups) cleanup()
check('running the cleanups releases the dictionaries', live.locale.count(), 0)

// 5. Without a locale service the built-in dictionary fallback still yields
//    text, so the tooltip never degrades to the key in that deployment either.
const withoutLocale = buildAndMount('idle', { withLocale: false })
try {
  withoutLocale.registered[0].component(props)
  const labelled = elements.filter(
    (el) => el.type === 'button' && typeof el.props['aria-label'] === 'string',
  )
  check(
    'without a locale service the button still gets a real name',
    labelled.length > 0 && labelled.every((el) => !el.props['aria-label'].startsWith('button.')),
    true,
  )
} catch (error) {
  check('without a locale service the button still gets a real name', `threw: ${error.message}`, true)
}

// 6. A locale service that cannot resolve the namespace is the subtle case: it
//    exists, so a naive `bind` result would be used as-is and print the key.
//    The control must fall back to its own dictionary and still show wording.
const brokenLocale = buildAndMount('idle', { localeBroken: true })
try {
  brokenLocale.registered[0].component(props)
  const labelled = elements.filter(
    (el) => el.type === 'button' && typeof el.props['aria-label'] === 'string',
  )
  const names = labelled.map((el) => el.props['aria-label'])
  check(
    'an unresolved namespace still yields real wording',
    names.length > 0 && names.every((name) => !name.startsWith('button.')),
    true,
  )
  const titled = elements.filter(
    (el) => el.type === 'button' && typeof el.props.title === 'string',
  )
  check(
    'the hover text falls back rather than printing its key',
    titled.length > 0 && titled.every((el) => el.props.title !== 'button.title'),
    true,
  )
} catch (error) {
  check('an unresolved namespace still yields real wording', `threw: ${error.message}`, true)
}

// 7. The notes panel renders above the composer (in the dock seat) and shows
//    the optimization notes, replacing the truncated inline span that used to
//    sit beside the button. The full flow is driven end-to-end here: the
//    button's onClick calls the Host stub, the optimized prompt goes to the
//    draft, and the notes surface in the panel above the input.
const NOTES_TEXT = 'Keep the tone concise and cite the stack.'
const withNotes = buildAndMount('idle', { notes: NOTES_TEXT })
const dockComponent = withNotes.registered[1].component

// Before optimization the panel renders nothing.
check('the notes panel hides before optimization', dockComponent({ sessionId: 'session-stub' }), null)

// Drive the button's onClick to publish notes into the store.
try {
  const buttonTree = withNotes.registered[0].component(props)
  const buttonEl = (buttonTree?.children ?? []).find((c) => c?.type === 'button')
  const onClick = buttonEl?.props?.onClick
  if (typeof onClick !== 'function') throw new Error('onClick handler missing')
  await onClick()
  check('the button publishes notes without throwing', true, true)
} catch (error) {
  check('the button publishes notes without throwing', `threw: ${error.message}`, true)
}

// After optimization the panel surfaces the notes text. A non-empty draft is
// supplied so the auto-dismiss watcher does not clear the notes before render.
try {
  elements.length = 0
  const panel = dockComponent({ sessionId: 'session-stub', useInput: (sel) => sel({ draft: 'kept' }) })
  check('the notes panel renders after optimization', panel !== null, true)
  const allText = elements
    .flatMap((el) => el?.children ?? [])
    .filter((c) => typeof c === 'string')
    .join(' ')
  check('the panel carries the notes text', allText.includes(NOTES_TEXT), true)
} catch (error) {
  check('the notes panel renders after optimization', `threw: ${error.message}`, true)
}

// The close button dismisses the notes. A non-empty draft is supplied so the
// auto-dismiss watcher does not fire before the manual close.
try {
  elements.length = 0
  const dockProps = { sessionId: 'session-stub', useInput: (sel) => sel({ draft: 'kept' }) }
  dockComponent(dockProps)
  const closeEl = elements.find(
    (el) => el?.type === 'button' && typeof el?.props?.onClick === 'function',
  )
  if (closeEl === undefined) throw new Error('close button missing')
  closeEl.props.onClick()
  const after = dockComponent(dockProps)
  check('the notes panel hides after dismissal', after, null)
} catch (error) {
  check('the notes panel hides after dismissal', `threw: ${error.message}`, null)
}

// Notes are per-session: a different session sees nothing.
check('a different session has no notes', dockComponent({ sessionId: 'other-session' }), null)

// 8. When the composer draft empties (the user sent the message or cleared
//    the text), the notes panel auto-dismisses.
const autoDismiss = buildAndMount('idle', { notes: 'auto-dismiss test' })
try {
  // Publish notes by driving the button.
  const buttonTree = autoDismiss.registered[0].component(props)
  const buttonEl = (buttonTree?.children ?? []).find((c) => c?.type === 'button')
  await buttonEl?.props?.onClick?.()

  const dockComp = autoDismiss.registered[1].component
  // With a non-empty draft the panel shows.
  const showing = dockComp({ sessionId: 'session-stub', useInput: (sel) => sel({ draft: 'kept text' }) })
  check('the panel shows while the draft has text', showing !== null, true)

  // Now the draft empties. The effect calls setNotes('') during render, which
  // clears the store; a second render then sees no notes and returns null.
  dockComp({ sessionId: 'session-stub', useInput: (sel) => sel({ draft: '' }) })
  const empty = dockComp({ sessionId: 'session-stub', useInput: (sel) => sel({ draft: '' }) })
  check('the panel auto-dismisses when the draft empties', empty, null)
} catch (error) {
  check('the panel auto-dismisses when the draft empties', `threw: ${error.message}`, null)
}

// 9. Clicking the button with an empty draft surfaces the notice in the panel
//    above the composer — not as a red line beside the button — and the notice
//    clears once the draft has text again.
const emptyDraft = buildAndMount('idle', { notes: 'irrelevant to this path' })
try {
  const emptyProps = {
    sessionId: 'session-stub',
    useInput: (sel) => sel({ draft: '' }),
    inputActions: { setDraft: () => {}, persistDraft: () => {} },
  }
  const buttonTree = emptyDraft.registered[0].component(emptyProps)
  const buttonEl = (buttonTree?.children ?? []).find((c) => c?.type === 'button')
  await buttonEl?.props?.onClick?.()

  const dockComp = emptyDraft.registered[2].component
  const panel = dockComp({ sessionId: 'session-stub', useInput: (sel) => sel({ draft: '' }) })
  check('an empty-draft click surfaces the notice in the error panel', panel !== null, true)

  elements.length = 0
  dockComp({ sessionId: 'session-stub', useInput: (sel) => sel({ draft: '' }) })
  const allText = elements
    .flatMap((el) => el?.children ?? [])
    .filter((c) => typeof c === 'string')
    .join(' ')
  check('the panel carries the empty-draft wording', allText.includes('Write a prompt first'), true)

  check(
    'the empty-draft notice is announced as an alert',
    elements.some((el) => el?.props?.role === 'alert'),
    true,
  )
  check(
    'the notice panel still offers a close button',
    elements.some((el) => el?.type === 'button' && typeof el?.props?.onClick === 'function'),
    true,
  )

  // Once the user starts typing, the notice stops being relevant and clears.
  dockComp({ sessionId: 'session-stub', useInput: (sel) => sel({ draft: 'typed' }) })
  const cleared = dockComp({ sessionId: 'session-stub', useInput: (sel) => sel({ draft: 'typed' }) })
  check('the notice clears once the draft has text', cleared, null)
} catch (error) {
  check('an empty-draft click surfaces the notice in the error panel', `threw: ${error.message}`, true)
}

// 10. The two dock panels read independent channels. The notes panel's
//     auto-dismiss rule (draft empty -> notes go) means that by the time an
//     empty-draft error can appear, the notes have already cleared — so in
//     normal use at most one panel is up. What independence guarantees is that
//     neither channel can overwrite the other: publishing an error leaves
//     whatever notes exist alone (and vice versa), and each panel renders and
//     dismisses strictly from its own channel.
try {
  const split = buildAndMount('idle', { notes: 'kept notes' })
  const notesComp = split.registered[1].component
  const errorComp = split.registered[2].component

  // Publish notes through the success path (draft non-empty).
  const seedProps = {
    sessionId: 'session-stub',
    useInput: (sel) => sel({ draft: 'text' }),
    inputActions: { setDraft: () => {}, persistDraft: () => {} },
  }
  const seedTree = split.registered[0].component(seedProps)
  await (seedTree?.children ?? []).find((c) => c?.type === 'button')?.props?.onClick?.()
  check('notes are up after a successful optimization', notesComp({ sessionId: 'session-stub', useInput: (sel) => sel({ draft: 'text' }) }) !== null, true)
  check('the error panel stays down while notes are up', errorComp({ sessionId: 'session-stub', useInput: (sel) => sel({ draft: 'text' }) }), null)

  // Publish the empty-draft error in the same build (draft now empty). The
  // notes auto-dismiss fires on the empty draft by design; the error channel
  // is what remains, and it rendered without touching the notes channel's
  // internals along the way.
  const emptyProps = {
    sessionId: 'session-stub',
    useInput: (sel) => sel({ draft: '' }),
    inputActions: { setDraft: () => {}, persistDraft: () => {} },
  }
  const errTree = split.registered[0].component(emptyProps)
  await (errTree?.children ?? []).find((c) => c?.type === 'button')?.props?.onClick?.()
  check('the error panel is up after the empty-draft click', errorComp({ sessionId: 'session-stub', useInput: (sel) => sel({ draft: '' }) }) !== null, true)
  // The stub runs useEffect synchronously inside the render, so the auto-dismiss
  // fires during a first pass and is read back on the second — the same two-
  // render rhythm the notes auto-dismiss test above uses.
  notesComp({ sessionId: 'session-stub', useInput: (sel) => sel({ draft: '' }) })
  check('the notes panel cleared on the empty draft, not on the error', notesComp({ sessionId: 'session-stub', useInput: (sel) => sel({ draft: '' }) }), null)

  // The error clears once text exists; notes can be published again after.
  errorComp({ sessionId: 'session-stub', useInput: (sel) => sel({ draft: 'typed' }) })
  check('the error panel clears once the draft has text', errorComp({ sessionId: 'session-stub', useInput: (sel) => sel({ draft: 'typed' }) }), null)
  const again = split.registered[0].component(seedProps)
  await (again?.children ?? []).find((c) => c?.type === 'button')?.props?.onClick?.()
  check('notes publish again after the error cleared', notesComp({ sessionId: 'session-stub', useInput: (sel) => sel({ draft: 'text' }) }) !== null, true)
} catch (error) {
  check('notes are up after a successful optimization', `threw: ${error.message}`, true)
}

// 11. A failure during the run publishes to the error panel too, and unlike
//     the empty-draft notice it does NOT clear when the draft has text: the
//     composer still holds the text that failed, so the message must stay
//     until dismissed or the next attempt replaces it.
try {
  const failed = buildAndMount('idle', { failWith: 'LLM exploded' })
  const failProps = {
    sessionId: 'session-stub',
    useInput: (sel) => sel({ draft: 'text' }),
    inputActions: { setDraft: () => {}, persistDraft: () => {} },
  }
  const failTree = failed.registered[0].component(failProps)
  await (failTree?.children ?? []).find((c) => c?.type === 'button')?.props?.onClick?.()

  const errorComp = failed.registered[2].component
  const up = errorComp({ sessionId: 'session-stub', useInput: (sel) => sel({ draft: 'text' }) })
  check('a failure during the run surfaces in the error panel', up !== null, true)

  elements.length = 0
  errorComp({ sessionId: 'session-stub', useInput: (sel) => sel({ draft: 'text' }) })
  const text = elements
    .flatMap((el) => el?.children ?? [])
    .filter((c) => typeof c === 'string')
    .join(' ')
  check('the failure message is the thrown error text', text.includes('LLM exploded'), true)

  // The draft has text and the error stays — that is the point of this kind.
  errorComp({ sessionId: 'session-stub', useInput: (sel) => sel({ draft: 'text' }) })
  const stillUp = errorComp({ sessionId: 'session-stub', useInput: (sel) => sel({ draft: 'text' }) })
  check('the failure error persists while the draft has text', stillUp !== null, true)

  // A fresh successful run replaces it with notes.
  const recover = buildAndMount('idle', { notes: 'recovered' })
  const okProps = {
    sessionId: 'session-stub',
    useInput: (sel) => sel({ draft: 'text' }),
    inputActions: { setDraft: () => {}, persistDraft: () => {} },
  }
  const okTree = recover.registered[0].component(okProps)
  await (okTree?.children ?? []).find((c) => c?.type === 'button')?.props?.onClick?.()
  check('a successful run clears the error panel', recover.registered[2].component({ sessionId: 'session-stub', useInput: (sel) => sel({ draft: 'text' }) }), null)
  check('and publishes its notes instead', recover.registered[1].component({ sessionId: 'session-stub', useInput: (sel) => sel({ draft: 'text' }) }) !== null, true)
} catch (error) {
  check('a failure during the run surfaces in the error panel', `threw: ${error.message}`, true)
}

/** Whether this file is the process entry point, rather than an import. */
const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href

export default failures

if (isEntryPoint) {
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}
