window.__ModuleLoader__.load({
  id: '@local/prompt-optimizer',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Namespace this plugin's visible text is registered under. */
    const LOCALE_NS = 'prompt-optimizer'

    /** English dictionary for the plugin's own namespace. */
    const EN = {
      'button.label': 'Optimize prompt',
      'button.title': 'Upgrade prompt',
      'button.busy': 'Optimizing…',
      'button.empty': 'Write a prompt first',
      'button.failed': 'Prompt optimization failed',
      'button.notes': 'Notes',
      'notes.heading': 'Optimization notes',
      'notes.dismiss': 'Dismiss notes',
    }

    /** Chinese dictionary for the plugin's own namespace. */
    const ZH = {
      'button.label': '优化提示词',
      'button.title': '升级提示词',
      'button.busy': '优化中…',
      'button.empty': '请先输入提示词',
      'button.failed': '提示词优化失败',
      'button.notes': '说明',
      'notes.heading': '优化说明',
      'notes.dismiss': '关闭说明',
    }

    /** Separator the Host uses between the optimized prompt and its notes. */
    const NOTES_SEPARATOR = '\n\n--- notes ---\n'

    /**
     * Fill of the circular control, with its hover step. Yellow carries no
     * counterpart in the host's `--dsw-alias-*` token set, so it is stated as a
     * literal; the value is chosen to read as the same yellow in both themes.
     */
    const ACCENT_FILL = '#facc15'
    const ACCENT_FILL_HOVER = '#eab308'

    /**
     * Ink for the drawn icon. White by request — note that white on the yellow
     * fill measures about 1.5:1, below WCAG's 3:1 floor for non-text graphics,
     * so the bulb reads faintly on the accent rather than crisply.
     */
    const ACCENT_INK = '#ffffff'

    /**
     * The circular button's box. `34px` is the submit button's own size, taken
     * from the host's `.primary` rule (`width:34px; height:34px`), so this
     * control reads as a peer of the send button it sits beside.
     */
    const BUTTON_SIZE = '34px'

    /**
     * A true circle: half of a square box. The host rounds its own button with
     * `border-radius:999px`, which is the same circle while the box stays square
     * but becomes an ellipse as soon as one axis grows. The button below
     * therefore pins both axes, and this states the roundness directly.
     */
    const BUTTON_RADIUS = '50%'

    /** The drawn icon's size in CSS pixels, inside the button's box. */
    const ICON_SIZE = 18

    /**
     * The control's icon: a light bulb with no glow, drawn here rather than
     * loaded.
     *
     * A bundle's browser half has no filesystem access, so no package asset can
     * be read at runtime; the geometry is stated inline. Strokes use
     * `currentColor`, so the bulb takes the button's ink without a second colour
     * to keep in sync.
     *
     * With the glow rays gone the bulb alone must sit centred, so the glass and
     * its stepped socket are placed to leave equal margins top and bottom. The
     * socket's first line starts exactly at the glass's outer edge, so it meets
     * the bulb instead of cutting into it.
     *
     * @returns {object} the React element.
     */
    function OptimizeIcon() {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: ICON_SIZE,
          height: ICON_SIZE,
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block' },
        },
        // The glass. Its stroked outer edge reaches y 3.4 to 15.6.
        h('circle', {
          cx: 12, cy: 9.5, r: 5.1,
          fill: 'none', stroke: 'currentColor', strokeWidth: 2,
        }),
        // The socket, stepped in below the glass.
        h('path', {
          d: 'M10.1 16.6h3.8M10.8 19.4h2.4',
          fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round',
        }),
      )
    }

    /**
     * The in-progress indicator that replaces the icon while the Host works.
     * Rotation rides the SVG's own animation, so no stylesheet or timer is
     * registered and unmounting the control leaves nothing behind.
     *
     * @returns {object} the React element.
     */
    function OptimizeSpinner() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: ICON_SIZE,
          height: ICON_SIZE,
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block' },
        },
        h(
          'circle',
          {
            cx: 8, cy: 8, r: 6,
            fill: 'none', stroke: 'currentColor', strokeWidth: 2,
            strokeLinecap: 'round', strokeDasharray: '10 28',
          },
          h('animateTransform', {
            attributeName: 'transform',
            type: 'rotate',
            from: '0 8 8',
            to: '360 8 8',
            dur: '0.9s',
            repeatCount: 'indefinite',
          }),
        ),
      )
    }

    return {
      inject: ['slots', 'locale', 'remote.commands'],
      apply(ctx) {
        const locale = ctx.get('locale')
        const bound = locale === undefined ? undefined : locale.bind(LOCALE_NS)

        /**
         * Translate one key of this plugin's namespace.
         *
         * The locale service signals "no such key" by handing back the key
         * itself, which would print raw text like `button.title` in the UI. The
         * built-in dictionary is therefore the fallback for every failure mode —
         * no locale service, an unresolved key, or an empty result — so shipped
         * wording always reaches the control.
         * @param {string} key - the dictionary key.
         * @returns {string} the wording to show.
         */
        const t = (key) => {
          const resolved = bound === undefined ? undefined : bound(key)
          if (typeof resolved === 'string' && resolved.length > 0 && resolved !== key) {
            return resolved
          }
          return EN[key] ?? key
        }

        if (locale !== undefined) {
          // `ctx.effect` INVOKES this callback and keeps whatever it returns as
          // the disposer, so the dictionaries are registered inside it and the
          // returned function tears them down. Disposing from the callback body
          // instead would unregister both on the spot, and every `t()` call
          // would fall back to printing the raw key.
          ctx.effect(() => {
            const disposeEn = locale.register(LOCALE_NS, 'en', EN)
            const disposeZh = locale.register(LOCALE_NS, 'zh', ZH)
            return () => {
              disposeEn()
              disposeZh()
            }
          }, 'prompt-optimizer:locale')
        }

        /**
         * A tiny per-session text channel shared between the button (in the
         * activity seat) and a panel above the composer (in the dock seat).
         * Both are session-scoped, so values are keyed by sessionId to avoid
         * leaking across conversations. The plugin keeps two independent
         * channels — notes and errors — so each panel shows, and dismisses, on
         * its own without the other overwriting it.
         * @param {string} what - the channel name, for log labels.
         * @returns {{store: Map, get: (id: string) => string, set: (id: string, text: string) => void, use: (id: string|undefined) => string}} the channel.
         */
        const makeChannel = (what) => {
          const store = new Map()
          const listeners = new Map()
          const notify = (sessionId) => {
            const fns = listeners.get(sessionId)
            if (fns !== undefined) for (const fn of fns) fn()
          }
          const set = (sessionId, value) => {
            if (value === null || value === undefined) store.delete(sessionId)
            else store.set(sessionId, value)
            notify(sessionId)
          }
          const read = (sessionId) =>
            sessionId === undefined ? undefined : store.get(sessionId)
          const use = (sessionId) => {
            const [, force] = React.useState(0)
            React.useEffect(() => {
              if (sessionId === undefined) return () => {}
              let fns = listeners.get(sessionId)
              if (fns === undefined) {
                fns = new Set()
                listeners.set(sessionId, fns)
              }
              const fn = () => force((x) => x + 1)
              fns.add(fn)
              return () => { fns.delete(fn) }
            }, [sessionId])
            return read(sessionId)
          }
          return { store, read, set, use }
        }

        /**
         * Optimization notes, published when an optimization succeeds. The
         * value is the plain notes text; empty text means no entry.
         */
        const notesChannel = (() => {
          const channel = makeChannel('notes')
          return {
            set: (sessionId, text) => channel.set(sessionId, (text ?? '') === '' ? undefined : text),
            use: (sessionId) => channel.use(sessionId) ?? '',
          }
        })()

        /**
         * Error notices, published when an optimization cannot start or fails
         * partway. The value carries the message and whether it should clear
         * once the user types: the empty-draft notice asks for input, so it
         * does; a failure during a run describes the text still sitting in the
         * composer, so it stays until dismissed or replaced.
         */
        const errorChannel = (() => {
          const channel = makeChannel('error')
          return {
            set: (sessionId, text, clearOnInput = false) =>
              channel.set(sessionId, (text ?? '') === '' ? undefined : { text, clearOnInput }),
            use: (sessionId) => channel.use(sessionId) ?? null,
          }
        })()

        /**
         * The shell the two dock panels share: a full-width strip above the
         * composer card, capped to the card's own max-width (the same CSS
         * variable the host's .Q7WfXG_card uses) and centered, so it never
         * reads wider than the input box beneath it, with a close button.
         * @param {object} parts - the per-panel parts.
         * @param {string|null} parts.role - the ARIA role, or null for none.
         * @param {string} parts.color - the text colour.
         * @param {object|null} parts.heading - a heading element, or null.
         * @param {string} parts.text - the body text.
         * @param {string} parts.dismissLabel - the close button's label.
         * @param {() => void} parts.onDismiss - closes this panel's channel.
         * @returns {object} the React element.
         */
        const DockPanelShell = ({ role, color, heading, text, dismissLabel, onDismiss }) =>
          h(
            'div',
            {
              role,
              style: {
                width: '100%',
                maxWidth: 'var(--dsh-composer-card-max-width)',
                marginInline: 'auto',
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: '8px',
                padding: '8px 12px',
                borderRadius: '16px',
                background: 'var(--dsw-alias-bg-layer-1)',
                border: '1px solid #F6F6F6',
                fontSize: '13px',
                lineHeight: '1.5',
                color,
              },
            },
            h(
              'div',
              { style: { flex: '1', minWidth: 0 } },
              heading,
              h(
                'div',
                { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } },
                text,
              ),
            ),
            h(
              'button',
              {
                type: 'button',
                onClick: onDismiss,
                'aria-label': dismissLabel,
                title: dismissLabel,
                style: {
                  flex: 'none',
                  boxSizing: 'border-box',
                  width: '24px',
                  height: '24px',
                  minWidth: '24px',
                  minHeight: '24px',
                  padding: 0,
                  border: 'none',
                  borderRadius: '6px',
                  background: 'transparent',
                  color: 'var(--dsw-alias-label-secondary)',
                  cursor: 'pointer',
                  fontSize: '16px',
                  lineHeight: '1',
                  display: 'grid',
                  placeItems: 'center',
                },
              },
              '×',
            ),
          )

        /**
         * The notes panel: one of this plugin's two dock entries. It shows the
         * optimization notes, and it appears only while notes exist for the
         * session. Notes describe the optimized prompt, so they dismiss when
         * the draft is cleared (the user sent the message or deleted the text).
         * @param {object} props - the slot's standard props.
         * @returns {object|null} the React element, or null when there are no notes.
         */
        function NotesPanel(props) {
          const { sessionId, useInput } = props
          const notes = notesChannel.use(sessionId)
          const draft = useInput === undefined ? '' : (useInput((s) => (s === undefined ? '' : s.draft)) ?? '')
          React.useEffect(() => {
            if (notes.length > 0 && draft.trim().length === 0) {
              notesChannel.set(sessionId, '')
            }
          }, [notes, draft, sessionId])
          if (notes.length === 0) return null
          return h(DockPanelShell, {
            role: 'status',
            color: 'var(--dsw-alias-label-primary)',
            heading: h(
              'div',
              {
                style: {
                  fontWeight: 600,
                  fontSize: '12px',
                  color: 'var(--dsw-alias-label-secondary)',
                  marginBottom: '2px',
                },
              },
              t('notes.heading'),
            ),
            text: notes,
            dismissLabel: t('notes.dismiss'),
            onDismiss: () => notesChannel.set(sessionId, ''),
          })
        }

        /**
         * The error panel: this plugin's second dock entry. It shows why an
         * optimization could not start or failed partway. Only a notice that
         * asks for input — the empty-draft one — clears when the user types;
         * a failure during a run describes the text still sitting in the
         * composer, so it stays until dismissed or replaced by the next
         * attempt. It is a separate entry from the notes panel, so neither
         * displaces the other.
         * @param {object} props - the slot's standard props.
         * @returns {object|null} the React element, or null when there is no error.
         */
        function ErrorPanel(props) {
          const { sessionId, useInput } = props
          const entry = errorChannel.use(sessionId)
          const draft = useInput === undefined ? '' : (useInput((s) => (s === undefined ? '' : s.draft)) ?? '')
          React.useEffect(() => {
            if (entry === null) return
            if (entry.clearOnInput && draft.trim().length > 0) {
              errorChannel.set(sessionId, '')
            }
          }, [entry, draft, sessionId])
          if (entry === null) return null
          // The error line is short enough to read as itself and needs no
          // heading above it; it is announced assertively.
          return h(DockPanelShell, {
            role: 'alert',
            color: 'var(--dsw-alias-state-error-primary)',
            heading: null,
            text: entry.text,
            dismissLabel: t('notes.dismiss'),
            onDismiss: () => errorChannel.set(sessionId, ''),
          })
        }

        /**
         * The composer tool-row control that optimizes the current draft against
         * the project and writes the result back into the composer. It renders as
         * an icon button; its accessible name and hover hint carry the wording.
         * @param {object} props - the slot's standard props.
         * @returns {object} the React element.
         */
        function OptimizePromptControl(props) {
          const { sessionId, useInput, inputActions } = props
          const [state, setState] = React.useState({ phase: 'idle', message: '' })
          const [hover, setHover] = React.useState(false)

          const draft = useInput((s) => (s === undefined ? '' : s.draft)) ?? ''
          const busy = state.phase === 'busy'

          const onClick = React.useCallback(async () => {
            if (busy) return
            const text = (draft ?? '').trim()
            if (text.length === 0) {
              // The empty-draft notice goes to this plugin's error panel above
              // the composer — its own dock entry, independent of the notes
              // panel, so both can be up at once.
              errorChannel.set(sessionId, t('button.empty'), true)
              return
            }
            if (sessionId === undefined) {
              errorChannel.set(sessionId, t('button.failed'))
              return
            }
            setState({ phase: 'busy', message: '' })
            try {
              const commands = ctx.get('remote.commands')
              if (commands === undefined) throw new Error('The Host connection is unavailable.')
              const result = await commands.execute(sessionId, `/optimize ${text}`, [])
              if (result === undefined || result.ok !== true) {
                const detail = result !== undefined && result.error !== undefined
                  ? result.error.message
                  : 'the command was rejected'
                throw new Error(detail)
              }
              const outcome = result.value === undefined ? undefined : result.value.result
              if (outcome === undefined || outcome.kind !== 'success') {
                throw new Error(
                  outcome !== undefined && outcome.text !== undefined
                    ? outcome.text
                    : 'optimization failed',
                )
              }
              const body = outcome.text === undefined ? '' : outcome.text
              const notesAt = body.indexOf(NOTES_SEPARATOR)
              const optimized = notesAt < 0 ? body : body.slice(0, notesAt)
              const notes = notesAt < 0 ? '' : body.slice(notesAt + NOTES_SEPARATOR.length)
              if (optimized.trim().length === 0) throw new Error('the Host returned an empty prompt')

              if (inputActions !== undefined) {
                inputActions.setDraft(optimized)
                inputActions.persistDraft()
              }
              notesChannel.set(sessionId, notes)
              setState({ phase: 'idle', message: '' })
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              // Failures during an optimization run surface in the error panel
              // too. The draft still holds the text that failed, so the message
              // must stay until dismissed or the next attempt replaces it.
              errorChannel.set(sessionId, message)
              setState({ phase: 'idle', message: '' })
            }
          }, [busy, draft, sessionId, inputActions, t])

          return h(
            'div',
            {
              style: {
                display: 'inline-flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: '6px',
              },
            },
            h(
              'button',
              {
                type: 'button',
                style: {
                  boxSizing: 'border-box',
                  display: 'grid',
                  placeItems: 'center',
                  // A circle needs a square box, so both axes are pinned, and
                  // min-width/min-height keep the flex row from stretching
                  // either one back out.
                  width: BUTTON_SIZE,
                  height: BUTTON_SIZE,
                  minWidth: BUTTON_SIZE,
                  minHeight: BUTTON_SIZE,
                  aspectRatio: '1 / 1',
                  alignSelf: 'center',
                  flex: 'none',
                  padding: 0,
                  border: 'none',
                  borderRadius: BUTTON_RADIUS,
                  background: hover && !busy ? ACCENT_FILL_HOVER : ACCENT_FILL,
                  color: ACCENT_INK,
                  cursor: busy ? 'progress' : 'pointer',
                  opacity: busy ? 0.6 : 1,
                  transition: 'background-color .1s',
                },
                onClick,
                onMouseEnter: () => setHover(true),
                onMouseLeave: () => setHover(false),
                disabled: busy,
                title: t('button.title'),
                'aria-label': busy ? t('button.busy') : t('button.label'),
                'aria-busy': busy ? 'true' : undefined,
              },
              busy ? h(OptimizeSpinner) : h(OptimizeIcon),
            ),
          )
        }

        // The entry takes the toolbar seat the host renders directly before the
        // send button. `conversation.composer.bar` orders the trailing cluster's
        // children as: `standardControls` (the input.right and model seats), then
        // this `conversation.input.activity` seat, then the primary submit
        // action — so an occupant here sits immediately left of send.
        // It is a single seat: one occupant, and its registration catalog is
        // empty, so it takes no id or order. It is unfilled in this build, so
        // nothing shipped is shadowed.
        ctx.slots.inject('conversation.input.activity', () =>
          ctx.slots.register(
            { name: 'conversation.input.activity' },
            OptimizePromptControl,
          ),
        )

        // The two panels take dock entries the host renders as a full-width
        // strip above the composer card. The dock is a list seat (additive, no
        // shadowing), so each registration carries an id and order. Notes come
        // first, the error notice under them; each panel renders only while its
        // own channel holds text, so zero, one, or both can be up at a time.
        ctx.slots.inject('conversation.input.dock', () => {
          const disposeNotes = ctx.slots.register(
            { name: 'conversation.input.dock', id: 'prompt-optimizer-notes', order: 0, label: t('notes.heading') },
            NotesPanel,
          )
          const disposeError = ctx.slots.register(
            { name: 'conversation.input.dock', id: 'prompt-optimizer-error', order: 1, label: t('button.failed') },
            ErrorPanel,
          )
          return () => {
            disposeNotes()
            disposeError()
          }
        })
      },
    }
  },
})
