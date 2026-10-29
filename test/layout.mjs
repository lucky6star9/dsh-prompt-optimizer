// Layout and rendering contract for the composer entry.
//
// The entry must render immediately LEFT OF THE SEND BUTTON. The host owns that
// order: `conversation.composer.bar` gives the composer tool row's trailing
// cluster these children in sequence — `standardControls` (which renders
// `conversation.input.right` then `conversation.input.model`), then
// `conversation.input.activity`, then the primary submit action. So the seat
// adjacent to send is `conversation.input.activity`.
//
// The two seats this entry has moved away from are both wrong for that goal:
// `conversation.composer.dock` renders below the composer card, and
// `conversation.input.right` renders before the model selector, which leaves
// the model selector and the toolbar activity seat between it and send.
//
// These assertions read the real client source, so a regression in the slot
// choice or in the registration shape fails the test.
import fs from 'node:fs'

const clientSrc = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')

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

/** The slot the client injects its registration into. */
const injectedSlot = clientSrc.match(/ctx\.slots\.inject\('([^']+)'/)?.[1]

// 1. The entry takes the seat the host renders directly before the send button:
//    `conversation.composer.bar` places `conversation.input.activity` and the
//    primary submit action back to back in the composer tool row.
check('registers into conversation.input.activity', injectedSlot, 'conversation.input.activity')

// 2. The two seats this entry has moved away from are no longer used. The dock
//    renders below the composer card; input.right renders before the model
//    selector, which is not adjacent to send.
check(
  'no longer registers into conversation.composer.dock',
  clientSrc.includes("ctx.slots.inject('conversation.composer.dock'"),
  false,
)
check(
  'no longer registers into conversation.input.right',
  clientSrc.includes("ctx.slots.inject('conversation.input.right'"),
  false,
)

// 3. The registered slot name matches the injected slot (the registration
//    options must name the slot they are injected into).
check(
  'registration options name the injected slot',
  clientSrc.includes("name: 'conversation.input.activity'"),
  true,
)

// 4. This is a single seat: its registration catalog is empty, so the options
//    carry the slot name alone. An id or order belongs to a list seat and would
//    mean the entry had drifted back to one.
check(
  'registers without list-seat options',
  /ctx\.slots\.register\(\s*\{ name: 'conversation\.input\.activity' \}/.test(clientSrc),
  true,
)

// 4b. The notes panel registers into the dock seat above the composer card —
//     `conversation.input.dock` — which is a list seat, so its registration
//     carries an id and order, unlike the single activity seat above.
check(
  'registers the notes panel above the composer',
  clientSrc.includes("ctx.slots.inject('conversation.input.dock'"),
  true,
)
check('the dock registration carries an id', clientSrc.includes("id: 'prompt-optimizer-notes'"), true)
check('the dock registration carries an order', /order: 0,/.test(clientSrc), true)
check('defines the NotesPanel component', clientSrc.includes('function NotesPanel('), true)
check('the done phase is no longer used', clientSrc.includes("phase: 'done'"), false)
check(
  'the panel is capped to the composer-card width',
  clientSrc.includes("maxWidth: 'var(--dsh-composer-card-max-width)'"),
  true,
)
check('the panel is centered in the dock strip', clientSrc.includes("marginInline: 'auto'"), true)

// The notes panel watches the composer draft: when it empties (the user sent
// the message or cleared the text), the notes above no longer apply and are
// auto-dismissed.
check(
  'the panel reads the draft to watch for it emptying',
  /function NotesPanel\(props\)[\s\S]*?useInput/.test(clientSrc),
  true,
)
check(
  'the notes panel dismisses when the draft is empty',
  clientSrc.includes('draft.trim().length === 0') && clientSrc.includes("notesChannel.set(sessionId, ''"),
  true,
)

// The dock holds two independent entries — the notes panel and the error
// panel — each backed by its own channel, so one being up tells you nothing
// about the other and both can show at once.
check('registers the error panel as its own dock entry', clientSrc.includes("id: 'prompt-optimizer-error'"), true)
check('defines the ErrorPanel component', clientSrc.includes('function ErrorPanel('), true)
check(
  'the error entry sorts after the notes entry',
  /id: 'prompt-optimizer-notes', order: 0/.test(clientSrc) &&
    /id: 'prompt-optimizer-error', order: 1/.test(clientSrc),
  true,
)
check(
  'the two panels share one shell so their geometry matches',
  clientSrc.includes('DockPanelShell'),
  true,
)

// The empty-draft notice surfaces in the plugin's error panel above the
// composer rather than as a red line squeezed into the toolbar beside the
// button, and it clears once text exists.
check(
  'the empty-draft notice is published to the error channel',
  clientSrc.includes("errorChannel.set(sessionId, t('button.empty'), true)"),
  true,
)
check(
  'the empty-draft notice no longer sets the button error phase',
  clientSrc.includes("message: t('button.empty')"),
  false,
)
check(
  'only the input-seeking notice clears when the user types',
  clientSrc.includes('entry.clearOnInput && draft.trim().length > 0'),
  true,
)
check(
  'a failure during a run is published to the error panel too',
  /catch \(error\) \{[\s\S]*?errorChannel\.set\(sessionId, message\)/.test(clientSrc),
  true,
)
check(
  'no error line is rendered beside the button any more',
  /state\.phase === 'error'[\s\S]*?h\(\s*'span'/.test(clientSrc),
  false,
)
check(
  'the error panel renders in the error colour',
  /function ErrorPanel[\s\S]*?--dsw-alias-state-error-primary/.test(clientSrc),
  true,
)
check(
  'the error panel is announced assertively',
  /function ErrorPanel[\s\S]*?role: 'alert'/.test(clientSrc),
  true,
)

// 5. The control reads the draft through useInput and writes through
//    inputActions, which are the props the composer tool row provides.
check('reads the draft with useInput', clientSrc.includes('useInput('), true)
check('writes the draft with inputActions.setDraft', clientSrc.includes('inputActions.setDraft('), true)

// 6. The control is an inline row: the tool row lays its children out
//    horizontally, so a column layout would push the row out of shape.
check(
  'lays the control out as a row',
  clientSrc.includes("flexDirection: 'row'"),
  true,
)
check(
  'no longer lays the control out as a column',
  clientSrc.includes("flexDirection: 'column'"),
  false,
)

// 7. The trigger still calls the Host through the command Remote channel.
check(
  'still calls the Host through remote.commands.execute',
  clientSrc.includes('commands.execute(sessionId'),
  true,
)

// 8. The control renders as an icon, not as a text button. The button's child
//    is one of the two drawn elements; the previous text child is gone.
check(
  'button renders the icon instead of text',
  clientSrc.includes('busy ? h(OptimizeSpinner) : h(OptimizeIcon)'),
  true,
)
check(
  'the label expression is used only as the accessible name',
  (clientSrc.match(/busy \? t\('button\.busy'\) : t\('button\.label'\)/g) ?? []).length,
  1,
)
check(
  'that single use is the aria-label',
  clientSrc.includes("'aria-label': busy ? t('button.busy') : t('button.label'),"),
  true,
)
check(
  'both drawn states are svg elements',
  (clientSrc.match(/return h\(\s*'svg',/g) ?? []).length,
  2,
)

// 9. The icon is decorative and the button carries the accessible name, so a
//    screen reader announces the action once rather than twice.
check(
  'the drawn elements are hidden from assistive technology',
  (clientSrc.match(/'aria-hidden': 'true'/g) ?? []).length,
  2,
)
check(
  'the button carries an aria-label',
  clientSrc.includes("'aria-label': busy ? t('button.busy') : t('button.label')"),
  true,
)
check(
  'the button still carries a hover hint',
  clientSrc.includes("title: t('button.title')"),
  true,
)

// 10. Locale coverage. The UI strings live in the inline dictionaries in
//     client.js, and the display metadata lives in locale/*.json. Both pairs
//     must stay in sync, and every key the control reads must exist.
const dictKeys = (name) => {
  const block = clientSrc.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n    \\}`))?.[1] ?? ''
  return [...block.matchAll(/'([^']+)':/g)].map((m) => m[1]).sort()
}
const enKeys = dictKeys('EN')
const zhKeys = dictKeys('ZH')
check('the inline dictionaries are non-empty', enKeys.length > 0, true)
check('inline dictionaries stay in sync', enKeys.join(','), zhKeys.join(','))

// The leading word boundary keeps this from also matching the `t('...')` tail
// of an unrelated call such as `ctx.get('locale')`.
const usedKeys = [...new Set([...clientSrc.matchAll(/\bt\('([^']+)'\)/g)].map((m) => m[1]))].sort()
check(
  'every key the control reads exists in the dictionary',
  usedKeys.filter((key) => !enKeys.includes(key)).join(','),
  '',
)

/** The values of an inline dictionary literal, for the blank-string guard. */
const dictValues = (name) => {
  const block = clientSrc.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n    \\}`))?.[1] ?? ''
  return [...block.matchAll(/'[^']+': '([^']*)'/g)].map((match) => match[1])
}
check(
  'no dictionary string is blank',
  dictValues('EN').every((value) => value.length > 0) &&
    dictValues('ZH').every((value) => value.length > 0),
  true,
)
check(
  'the dictionaries carry as many values as keys',
  dictValues('EN').length === enKeys.length && dictValues('ZH').length === zhKeys.length,
  true,
)
check(
  'the notes-heading key exists in both dicts',
  enKeys.includes('notes.heading') && zhKeys.includes('notes.heading'),
  true,
)
check(
  'the notes-dismiss key exists in both dicts',
  enKeys.includes('notes.dismiss') && zhKeys.includes('notes.dismiss'),
  true,
)

const localeMetaKeys = (lang) =>
  Object.keys(
    JSON.parse(fs.readFileSync(new URL(`../locale/${lang}.json`, import.meta.url), 'utf8')).meta,
  ).sort()
check(
  'locale/en.json and locale/zh.json stay in sync',
  localeMetaKeys('en').join(','),
  localeMetaKeys('zh').join(','),
)

// 11. The control is a circular yellow button sized like the send button it
//     sits beside. `34px` is the host's own `.primary` size
//     (`width:34px; height:34px`), so the two circles match.
//
//     The roundness is `50%` of a square box rather than the host's
//     `border-radius:999px`. Those agree while the box stays square, but a large
//     px radius turns into an ellipse the moment one axis grows, which is the
//     failure this asserts against: a circle needs BOTH a percentage radius and
//     a box pinned square on both axes.
const styleConst = (name) => clientSrc.match(new RegExp(`const ${name} = '([^']+)'`))?.[1]

check('the button takes the submit button size', styleConst('BUTTON_SIZE'), '34px')
check('the button is rounded by half its box', styleConst('BUTTON_RADIUS'), '50%')
check(
  'the box is pinned square on both axes',
  clientSrc.includes('width: BUTTON_SIZE') &&
    clientSrc.includes('height: BUTTON_SIZE') &&
    clientSrc.includes('minWidth: BUTTON_SIZE') &&
    clientSrc.includes('minHeight: BUTTON_SIZE') &&
    clientSrc.includes("aspectRatio: '1 / 1'") &&
    clientSrc.includes("alignSelf: 'center'"),
  true,
)
/** A numeric constant, stated without quotes. */
const numberConst = (name) => Number(clientSrc.match(new RegExp(`const ${name} = (\\d+)`))?.[1])

const iconSize = numberConst('ICON_SIZE')
const buttonSize = Number((styleConst('BUTTON_SIZE') ?? '').replace('px', ''))
check(
  'the drawn icon fits inside the circular button',
  iconSize > 0 && iconSize < buttonSize,
  true,
)

/** Whether a hex colour reads as yellow: strong red and green, weak blue. */
const isYellow = (hex) => {
  const parts = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? '')
  if (parts === null) return false
  const [r, g, b] = parts.slice(1).map((pair) => parseInt(pair, 16))
  return r > 180 && g > 150 && b < 120
}
check('the fill reads as yellow', isYellow(styleConst('ACCENT_FILL')), true)
check('the hover step also reads as yellow', isYellow(styleConst('ACCENT_FILL_HOVER')), true)

/** Relative luminance, for the ink-on-fill contrast check below. */
const luminance = (hex) => {
  const parts = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? '')
  if (parts === null) return NaN
  const [r, g, b] = parts
    .slice(1)
    .map((pair) => parseInt(pair, 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
check('the ink is white', styleConst('ACCENT_INK'), '#ffffff')

// White on this yellow measures about 1.5:1, below WCAG's 3:1 floor for
// non-text graphics. That is the requested appearance, so it is recorded rather
// than asserted away: the bound below only catches a change that would make the
// bulb harder to see still (a near-white fill, for instance), and the note
// reports the real figure instead of implying the icon is comfortably legible.
const inkOnFill = contrast(styleConst('ACCENT_INK'), styleConst('ACCENT_FILL'))
check('the ink is not lost against the fill', inkOnFill > 1.3, true)
console.log(`   note: ink-on-fill contrast is ${inkOnFill.toFixed(2)}:1, below the WCAG 3:1 floor`)
// 12. The icon is a light bulb with no glow: a glass circle and a socket
//     stepped in below it. It replaces both the package artwork and the rayed
//     version this control drew before.
const iconBody = clientSrc.slice(
  clientSrc.indexOf('function OptimizeIcon()'),
  clientSrc.indexOf('function OptimizeSpinner()'),
)
check('the icon draws the bulb glass', iconBody.includes('cx: 12, cy: 9.5, r: 5.1'), true)
check('the icon draws the socket', iconBody.includes('M10.1 16.6h3.8'), true)
check('the icon takes the button ink', iconBody.includes("stroke: 'currentColor'"), true)
check(
  'the icon no longer draws the package artwork',
  iconBody.includes("viewBox: '4 8 51 40'"),
  false,
)
// The glow rays are gone. Each ray was a lone vertical or horizontal run, so
// their absence is checked by shape rather than by a coordinate that would
// reappear the moment someone reintroduces one.
check(
  'the icon no longer draws glow rays',
  /d: 'M12 [\d.]+v[\d.]+/.test(iconBody) || /M1\.7 [\d.]+h/.test(iconBody),
  false,
)

// 13. The drawing is checked arithmetically, because a rendered bulb cannot be
//     inspected in this environment. Two failures that would show as a broken
//     glyph are ruled out here: strokes bleeding past the canvas (clipping), and
//     the socket cutting into the glass instead of meeting its outer edge.
const HALF_STROKE = 1
const CANVAS = 24

const viewBox = iconBody.match(/viewBox: '([^']+)'/)?.[1]
check('the icon declares its own square canvas', viewBox, '0 0 24 24')

const glass = /cx: ([\d.]+), cy: ([\d.]+), r: ([\d.]+)/.exec(iconBody)
check('the icon declares the glass as a circle', glass !== null, true)

const [, glassCx, glassCy, glassR] = (glass ?? []).map(Number)
const glassOuterBottom = glassCy + glassR + HALF_STROKE
check(
  'the glass plus its stroke fits the canvas',
  glassCx - glassR - HALF_STROKE >= 0 &&
    glassCx + glassR + HALF_STROKE <= CANVAS &&
    glassCy - glassR - HALF_STROKE >= 0 &&
    glassOuterBottom <= CANVAS,
  true,
)

// The socket is the last path, so it is read on its own rather than by scanning
// the whole icon body, which would pick up any other path's runs too.
const pathData = [...iconBody.matchAll(/d: '([^']+)'/g)].map((match) => match[1])
const socketLines = [...(pathData.at(-1) ?? '').matchAll(/M[\d.]+ ([\d.]+)h/g)].map((match) =>
  Number(match[1]),
)
check('the socket is two stepped lines', socketLines.length, 2)
check(
  'the socket meets the glass instead of cutting into it',
  socketLines.length > 0 &&
    Math.min(...socketLines) - HALF_STROKE >= glassOuterBottom - 1e-9 &&
    Math.max(...socketLines) + HALF_STROKE <= CANVAS,
  true,
)

// Without the glow rays nothing balances the bulb above it any more, so the
// drawing must sit centred on its own. Lopsided margins are what the removed
// rays would otherwise leave behind.
const drawnTop = glassCy - glassR - HALF_STROKE
const drawnBottom = Math.max(...socketLines) + HALF_STROKE
check(
  'the bulb is centred in its canvas',
  Math.abs(drawnTop - (CANVAS - drawnBottom)) <= 1,
  true,
)
check(
  'the fill and ink are applied to the button',
  clientSrc.includes('background: hover && !busy ? ACCENT_FILL_HOVER : ACCENT_FILL') &&
    clientSrc.includes('color: ACCENT_INK'),
  true,
)

/** Whether this file is the process entry point, rather than an import. */
const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href

// Exported so the bundle's test runner can chain this file and report one
// combined result; running it directly prints this file's own summary.
export default failures

if (isEntryPoint) {
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}
