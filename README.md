# Screen Review

Point at a thing on a web page and say what's wrong with it.

Turn on review mode, click any element, type a comment. The tool records which
element you clicked, what that element actually was, and what you wrote — then
asks you one short follow-up question to turn a vague note into something
someone can act on.

```
  click an element  ──►  "make this clearer"
                          │
                          ▼
         AI asks:  "Clearer how — bigger, bolder, or better labelled?"
                          │
                          ▼
         you answer, edit the draft, save

  stored:  .card:nth-child(1) > .stat
           a <p> reading "$12,480", inside a card headed "Revenue"
           "Increase the font weight of the revenue figure to bold."
```

The last part is the point. Review feedback is usually vague, and the cheapest
moment to fix that is while the reviewer is still looking at the thing they
commented on.

## Status

An early version, built to prove the idea works. It runs against a test page in
this repo, not a real application, and it has no backend — comments live in your
own browser and nobody else can see them. [Limitations](#limitations) is the
honest list. Read it before investing time.

## Quick start

Needs [Node.js](https://nodejs.org/) 20+.

```bash
npm install
npm run dev
```

Open the URL it prints. You get a fake dashboard with a **Review mode** pill at
the bottom right. The AI step is optional and stays hidden until you configure
it; everything else works immediately.

## Using it

Click the pill to arm the tool. The cursor becomes a crosshair, and hovering
outlines whatever is underneath with its CSS selector on a label.

Click an element and the page does not react — links don't navigate, buttons
don't submit. You get a comment box instead.

| | |
| --- | --- |
| `Ctrl`/`Cmd` + `Enter` | Save |
| `Esc` | Close the box, or exit review mode |
| Click a pin | Read that comment back, review mode on or off |
| Hover a panel row | Highlight that element |
| Click a panel row | Scroll to that element |

Saving drops a numbered pin on the element. Pins follow their element as the
page scrolls, survive refreshes, and grey out when you resolve them. The panel
on the right lists everything, and **Copy JSON** hands you the lot.

If an element can't be found any more, its comment stays in the panel tagged
**ELEMENT NOT FOUND** rather than disappearing.

## How it works

Two halves, deliberately kept apart:

```
index.html + src/style.css     the page being reviewed
src/review/                    the tool doing the reviewing
```

Nothing in `src/review/` knows anything about the test page. The tool is meant
to be dropped onto any page; the test page is a stand-in for a real app.

### The store is the centre

```
                  ┌──────────────┐
  your click ───► │   store.ts   │ ── notify() ──┬──► panel.ts  redraws the list
                  │  comments[]  │               ├──► pins.ts   redraws the pins
                  └──────────────┘               └──► save()    localStorage
```

Every view reads from the store and subscribes to it. Nothing tells anything
else to update. Press **Resolve** in the panel and the panel doesn't reach over
and recolour the pin — it calls `setStatus()`, the store notifies, and the pins
module redraws itself. Add a third view tomorrow and it works the same way.

| Module | Job |
| --- | --- |
| [`review.ts`](src/review/review.ts) | Toggle, event interception, comment box |
| [`store.ts`](src/review/store.ts) | The comments, and their persistence |
| [`panel.ts`](src/review/panel.ts) | The side list |
| [`pins.ts`](src/review/pins.ts) | Numbered markers |
| [`highlight.ts`](src/review/highlight.ts) | The blue outline |
| [`context.ts`](src/review/context.ts) | What was on screen |
| [`clarify.ts`](src/review/clarify.ts) · [`clarify-ui.ts`](src/review/clarify-ui.ts) | The AI step |
| [`ui.ts`](src/review/ui.ts) | Shared DOM helpers |

### Five decisions worth knowing

**Clicks are caught on the way down.** DOM events travel down to the target
(capture) and back up (bubble). Most code listens on the way up. This listens on
the way *down*, at the document level, so it sees a click before the page does
and can cancel it. On the bubble phase a button's own handler would fire first —
the form submits, the page navigates, and the comment box opens on a page that's
already leaving.

**The tool marks its own DOM.** Everything it creates carries
`data-screen-review-ui`, and the mouse handlers skip anything matching it.
Without that, the tool reviews itself: hovering the panel highlights the panel,
and clicking **Resolve** opens a comment box about the Resolve button.

**The highlight is an overlay, not an outline on the element.** It's a separate
fixed-position box sized to the element's bounding rectangle. The obvious
alternative — adding a CSS class to the hovered element — would poison the data,
because `@medv/finder` builds selectors *from an element's classes*. The tool's
own styling class would end up baked into the captured selector. The page's DOM
is never modified, only drawn over.

**Elements are looked up fresh, never held.** Comments store a selector string.
`findElement()` runs `querySelector()` at the moment it's needed, inside a
`try`/`catch`. A held reference goes stale the instant a framework re-renders
and keeps a detached node alive in memory. Fresh lookups also mean an element
that vanishes and comes back quietly starts working again.

**Everything from outside is data, never markup.** Selectors and comment text go
in with `textContent`, never `innerHTML` — both can contain characters from the
page's own markup. Values read back from `localStorage` are validated field by
field rather than trusted, because storage is plain text that anything could
have written.

### What a comment looks like

```json
{
  "id": 1,
  "selector": ".card:nth-child(1) > .stat",
  "comment": "this number should be bold",
  "url": "http://localhost:5173/",
  "createdAt": "2026-09-22T14:31:07.482Z",
  "status": "open",
  "context": {
    "tagName": "p",
    "text": "$12,480",
    "nearbyText": "Revenue $12,480 View details",
    "viewport": { "width": 1512, "height": 842 }
  },
  "clarified": "Increase the font weight of the revenue figure to bold."
}
```

`id` doubles as the number on the pin, assigned in creation order and never
reused. `context` is the snapshot that makes a comment readable later — its text
comes from `innerText` rather than `textContent`, so it reflects what was
actually visible, and `nearbyText` climbs the ancestors until it finds one
saying more than the element itself. Full reasoning in
[docs/captured-context.md](docs/captured-context.md).

## The AI step

Write a rough comment, press **Ask AI to clarify**. The model gets the comment
plus the element context and returns either "this is already clear" or **one**
question under 20 words, sometimes with two or three quick-pick answers. You
answer, it drafts a combined requirement, and the draft lands in an **editable
box**. Nothing is saved until you press Save.

**The AI asks and drafts. A person always confirms.** There's no path where a
model's output is stored without a human seeing it in an editable field first.

### The key never reaches the browser

```
browser ──POST /api/clarify──► dev server (Node) ──► your model
                                 ▲
                                 └── reads .env here, never passes it on
```

Anything in browser JavaScript is readable by anyone who opens devtools, so an
API key shipped to the client is a published key. The key and endpoint live in
`.env`, read server-side by [`vite.config.ts`](vite.config.ts) through Vite's
`loadEnv`. They're deliberately **not** prefixed `VITE_` — Vite injects those
straight into the client bundle, which is exactly the mistake being avoided.

The browser only ever calls its own origin, and never learns which model
answered or where it lives.

### It fails quietly

| Situation | Behaviour |
| --- | --- |
| Nothing configured | Button hidden |
| Model not running | Button disabled, tooltip explains |
| Fails mid-request | Inline message, comment still savable |
| Model returns junk | Treated as "already clear" |

The rule: **the tool keeps working when the AI doesn't.** A failed clarification
never blocks saving a comment.

## Configuration

Copy [`.env.example`](.env.example) to `.env`. It's gitignored and must never be
committed.

| Variable | Notes |
| --- | --- |
| `CLARIFY_BASE_URL` | Any OpenAI-compatible endpoint, no trailing slash |
| `CLARIFY_MODEL` | Model name as that endpoint spells it |
| `CLARIFY_API_KEY` | Hosted APIs only; leave empty for a local model |

Leave either of the first two empty and the feature hides itself.

**Ollama** — free, local, no key:

```bash
ollama pull llama3.2:3b
```
```ini
CLARIFY_BASE_URL=http://localhost:11434/v1
CLARIFY_MODEL=llama3.2:3b
CLARIFY_API_KEY=
```

**LM Studio** — same idea on `http://localhost:1234/v1`.

**OpenAI** — `https://api.openai.com/v1`, model `gpt-4o-mini`, key `sk-...`.

Restart the dev server after editing `.env`, then reload the page.

## Limitations

None of these crash anything. All of them are real.

**It isn't shared.** No backend, no accounts. Comments live in `localStorage`,
which is per-browser and per-device — switch browser, profile or port and
they're gone, and clearing site data deletes them permanently. For a review
tool, not being able to send a review to anyone is the biggest thing missing.

**Comments aren't scoped to a page.** Every comment loads on whatever page the
tool runs on. `url` is recorded but never read back, so on a multi-page site
every page would show every comment — some tagged not-found, some silently
matching the *wrong* element with the same selector. Fine for one page.

**Selectors are fragile by nature.** `@medv/finder` produces the shortest unique
selector for the DOM as it was. Restructure the page and they stop matching.
Positional ones like `:nth-child(2)` are the weak case: insert something above
and the comment quietly points at a different element rather than failing
visibly.

**Review mode only cancels clicks, not presses.** Native controls that act on
`mousedown` still react — a `<select>` opens its dropdown, inputs take focus,
text selects. And an open dropdown's `<option>`s are drawn by the operating
system rather than laid out in the page, so they can't be hovered or commented
on at all. You can comment on the select itself, not on "the Admin option".

**Some things can't be reached.** Clicks inside an **iframe** belong to a
different document and never arrive. Events crossing a **shadow DOM** boundary
are retargeted to the host, so you capture the web component rather than the
element inside it. **Canvas and WebGL** are one element as far as this is
concerned.

**The AI route is dev-only.** It's a Vite plugin, so a built site has no
`/api/clarify` and the feature disables itself.

**Mouse only.** Hover highlighting depends on `mousemove`, which has no touch
equivalent.

**No tests.** None. Everything here was verified by hand.

**The tool's own UI has had little accessibility work** — no considered focus
management, and the panel isn't announced to screen readers.

## Roadmap

1. A real backend, replacing the `localStorage` internals of `store.ts`. Nothing
   else should need to change — that's what the seam is for.
2. Filter comments by URL, so it works across more than one page.
3. Move `/api/clarify` to that backend so clarification survives a build.
4. Harden selectors with a fallback, so comments survive a re-render.
5. Run it against a real app and see what breaks.
6. Export, handing clarified requirements to an issue tracker or a coding agent.

## Reference

```
screen-review/
├── index.html            the fake dashboard being reviewed
├── vite.config.ts        dev server + the /api/clarify route
├── .env.example          variable names for the AI step
├── docs/
│   └── captured-context.md
└── src/
    ├── main.ts           entry point
    ├── style.css         the test page's styles
    └── review/           the tool, independent of the page
```

| Command | |
| --- | --- |
| `npm run dev` | Dev server, with the AI route |
| `npm run build` | Type-check, then build to `dist/` |
| `npm run preview` | Serve the build (no AI route) |

[`@medv/finder`](https://github.com/antonmedv/finder) is the only runtime
dependency. Vite and TypeScript are dev dependencies.

**Troubleshooting.** Changes not appearing: hard refresh with
`Ctrl`+`Shift`+`R`. Clarify button missing: `.env` isn't set up — restart the
dev server after editing it. Greyed out: the model isn't answering. Comments
vanished: storage is scoped to the exact origin, so a different port counts as a
different site.
