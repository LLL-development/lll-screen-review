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

An early version, built to prove the idea works. It runs on a test page in this
repo, or on a real website loaded through a dev-only proxy. There is no backend:
comments live in your own browser and nobody else can see them.
[Limitations](#limitations) is the honest list — read it before investing time.

## Quick start

Needs [Node.js](https://nodejs.org/) 20+.

```bash
npm install
npm run dev
```

Open the address it prints. You get a start screen: paste the address of a real
page and press **Load page**, or follow the link to the local test page, a fake
dashboard that always works offline. Either way there's a **Review mode** pill
at the bottom right.

The AI step is optional and stays hidden until you
[configure it](#configuration). Everything else works straight away.

## Using it

Click the pill to arm the tool. The cursor becomes a crosshair, and hovering
outlines whatever is underneath, with its CSS selector on a label.

Click an element and the page doesn't react — links don't navigate, buttons
don't submit, menus don't open, inputs don't take focus. You get a comment box
instead. Clicking somewhere else while you're partway through a comment won't
throw it away: the box shakes until you save or cancel it.

| | |
| --- | --- |
| `Ctrl`/`Cmd` + `Enter` | Save |
| `Esc` | Close the box, or leave review mode |
| Click a pin | Read that comment back, review mode on or off |
| Hover a panel row | Outline that comment's element |
| Click a panel row | Scroll to that element |

Saving drops a numbered pin on the element. Pins stay on their element as the
page scrolls, animates or re-renders, survive a refresh, and grey out when you
resolve them. The panel on the right lists every comment, and **Copy JSON**
hands you the lot.

If an element can't be found any more, its comment stays in the panel tagged
**ELEMENT NOT FOUND** rather than disappearing — and picks up again if the
element comes back.

## Reviewing a real website

Browsers won't let a script from one site read or draw over a page from
another. That rule is what stops any site you visit from reading your email in a
hidden frame, and no permission switches it off. So the dev server fetches the
page for you and serves it from its own address:

```
browser ──/proxy?url=…──► dev server ──fetch──► the real site
   ▲                           │
   └── HTML + <base> + tool ◄──┘
```

### How a page gets here

[`server/proxy.ts`](server/proxy.ts) fetches the page and adds two things to it:
a `<base>` tag, so the page's stylesheets, images and scripts still load from
the real site, and a script tag for [`src/proxy/inject.ts`](src/proxy/inject.ts),
which starts the review tool. Redirects — `http` to `https`, `example.com` to
`www.example.com` — are passed back to your browser to follow, so the address
bar always names the page you're really on.

### Files the browser would refuse

Most of a page's files load from the real site without its say-so. A few kinds
don't: module scripts, fonts and `fetch()` calls get a CORS check, which the
site's server passes for its own pages and usually fails for a page on
localhost. Plenty of modern sites — anything built with Astro or Vite, for a
start — ship all their code as modules, so without help their menus, animations
and fonts would all be missing.

A service worker, [`server/proxy-worker.js`](server/proxy-worker.js), catches
those requests and fetches them through the dev server instead:

```
page ──module / font / fetch()──► service worker ──/proxy-asset?url=…──► dev server ──► real site
```

The first page you load installs it, so you'll see a brief "Loading the page…"
and a reload. The same happens after a hard refresh, which skips the worker on
purpose.

The proxy also removes integrity hashes that can no longer be checked. A
stylesheet tagged with one but no `crossorigin` attribute only passes the check
on its own site; on localhost the browser would refuse it outright. Many Hugo
themes tag their main stylesheet this way, which would leave the page unstyled.

### Moving around the site

Everything on the page points at the real site, so leaving it would normally
be one click away. Outside review mode, [`inject.ts`](src/proxy/inject.ts)
sends each of these through the proxy instead:

- links, including ones opened in a new tab
- searches and other forms that fetch a page
- a script moving the page on by itself, in browsers with the Navigation API,
  such as Chrome and Edge (see [Limitations](#limitations))

Forms that *send* data, like a login or a contact form, can't be replayed
through the proxy and go to the real site. Each page you visit keeps its own
list of comments.

### What works, and what doesn't

**Works:** static and server-rendered pages — blogs, docs, marketing sites,
news, Wikipedia, GitHub's public pages — including ones built with Astro, Hugo
or Vite, scripts and web fonts included.

**Doesn't:**

- **Single-page apps** that build everything in the browser. Their scripts now
  run on localhost: their calls home go out without your cookies, anything but
  a plain read (`GET`) is blocked, and their routers are lost.
- **Anything behind a login.** The server fetches without your cookies, so you
  see the logged-out page.
- **Files on another domain that only the real site may use**, like fonts on a
  site's own CDN subdomain. The worker only fetches from the page's own origin.
- **Sites that block automated fetching.** You get a "Couldn't load this page"
  screen with the reason.

### Site scripts, and what you trust them with

**Run the site's own scripts**, on the start screen, is on by default because it
makes more pages look right. Turn it off if a page jumps away, goes blank or
keeps changing. Either way, expect the site's own errors in the console; the
tool logs a line saying so.

A site's scripts run on the same origin as the tool. They can read your saved
comments, and fetch files through the dev server from any site you've loaded
through the proxy since it started. **Only load sites you trust with scripts
on.** The dev server listens on your machine only; starting it with `--host`
would open all of this to your network.

The proper route for arbitrary live sites is a browser extension, which is
allowed to run inside any page — on the real site, logged in, nothing re-hosted.
See the [roadmap](#roadmap).

## How it works

Two halves, deliberately kept apart:

```
test-page.html + src/style.css     the page being reviewed
src/review/                        the tool doing the reviewing
```

Nothing in `src/review/` knows about the test page, the start screen or the
proxy. The tool is meant to be dropped onto any page — which is exactly what the
proxy does. The only thing it can be told is the page's real address, through
`startReviewTool({ pageUrl })`.

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
Another tab open on the same page hears about each save and reloads the list,
so two tabs never write over each other.

| Module | Job |
| --- | --- |
| [`review.ts`](src/review/review.ts) | The toggle, catching clicks, the comment box |
| [`store.ts`](src/review/store.ts) | The comments, and keeping them |
| [`panel.ts`](src/review/panel.ts) | The list on the right |
| [`pins.ts`](src/review/pins.ts) | The numbered markers |
| [`highlight.ts`](src/review/highlight.ts) | The blue outline |
| [`context.ts`](src/review/context.ts) | What was on screen |
| [`clarify.ts`](src/review/clarify.ts) · [`clarify-ui.ts`](src/review/clarify-ui.ts) | The AI step |
| [`ui.ts`](src/review/ui.ts) | Putting the tool on the page, finding elements |

### Five decisions worth knowing

**Clicks are caught on the way down.** DOM events travel down to their target
(capture) and back up (bubble). Most code listens on the way up. This listens on
the way *down*, at the window, so it sees a click — and the press before it,
which menus and `<select>`s act on — before the page does, and can cancel it. On
the way up, a button's own handler would fire first: the form submits, the page
navigates, and the comment box opens on a page that's already leaving. Clicks
the page's own scripts make are left alone.

**The tool marks its own DOM, and lives beside the page.** Everything it creates
carries `data-screen-review-ui`, and the mouse handlers skip anything with it.
Without that, the tool reviews itself: hovering the panel outlines the panel,
and clicking **Resolve** opens a comment box about the Resolve button. It also
sits beside `<body>` rather than inside it, so a page that swaps its body out as
it navigates — plenty do — doesn't take the tool with it. Keys typed into the
tool stay in the tool, so an "s" in a comment doesn't set off the site's search
shortcut.

**The outline is an overlay, not a style on the element.** It's a separate
fixed-position box sized to the element's rectangle. The obvious alternative —
adding a CSS class to the hovered element — would poison the data, because
`@medv/finder` builds selectors *from an element's classes*, and the tool's own
class would end up in the captured selector. The page's DOM is never changed,
only drawn over.

**Elements are looked up fresh, never held.** Comments store a selector string,
and `findElement()` runs it at the moment it's needed. A held reference goes
stale the instant a framework re-renders, and keeps a removed node alive in
memory. Pins and the outline are redrawn every frame, so they follow an element
however it moves, and pins look their element up again twice a second, so they
follow one the page re-rendered.

**Everything from outside is data, never markup.** Selectors and comment text go
in with `textContent`, never `innerHTML` — both can contain characters from the
page's own markup. Values read back from `localStorage` are checked field by
field rather than trusted, because storage is plain text that anything could
have written.

### What a comment looks like

```json
{
  "id": 1,
  "selector": ".card:nth-child(1) > .stat",
  "comment": "this number should be bold",
  "url": "http://localhost:5173/test-page.html",
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

`id` doubles as the number on the pin. It's handed out in creation order and
never reused, even after the newest comment is deleted. `url` is the real page's
address, including for pages loaded through the proxy. `context` is the snapshot
that makes a comment readable later: its text comes from `innerText` rather than
`textContent`, so it reflects what was actually visible, and `nearbyText` climbs
the ancestors until it finds one saying more than the element itself. Full
reasoning in [docs/captured-context.md](docs/captured-context.md).

## The AI step

Write a rough comment and press **Ask AI to clarify**. The model gets the
comment plus the element's context, and returns either "this is already clear"
or **one** question under 20 words, sometimes with two or three quick-pick
answers. You answer, it drafts a combined requirement, and the draft lands in an
**editable box**. Nothing is saved until you press Save.

**The AI asks and drafts. A person always confirms.** There's no path where a
model's output is stored without a person seeing it in an editable field first.
Asking again throws the previous draft away rather than saving it unseen.

### The key never reaches the browser

```
browser ──POST /api/clarify──► dev server (Node) ──► your model
                                 ▲
                                 └── reads .env here, never passes it on
```

Anything in browser JavaScript is readable by anyone who opens devtools, so an
API key shipped to the browser is a published key. The key and endpoint live in
`.env`, read server-side by [`vite.config.ts`](vite.config.ts) through Vite's
`loadEnv`. They're deliberately **not** prefixed `VITE_`: Vite puts those
straight into the browser code, which is exactly the mistake being avoided.

The browser only ever calls its own origin, and never learns which model
answered or where it lives.

### It fails quietly

| Situation | Behaviour |
| --- | --- |
| Nothing configured | Button hidden |
| Model not running | Button disabled, tooltip explains |
| Fails mid-request | Message in the box, comment still savable |
| Model returns junk | Treated as "already clear" |

The rule: **the tool keeps working when the AI doesn't.** A failed clarification
never blocks saving a comment.

## Configuration

Copy [`.env.example`](.env.example) to `.env`. It's gitignored and must never be
committed.

| Variable | Notes |
| --- | --- |
| `CLARIFY_BASE_URL` | Any OpenAI-compatible endpoint, no trailing slash |
| `CLARIFY_MODEL` | The model's name as that endpoint spells it |
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

**LM Studio** — the same, on `http://localhost:1234/v1`.

**OpenAI** — `https://api.openai.com/v1`, model `gpt-4o-mini`, key `sk-...`.

Restart the dev server after editing `.env`, then reload the page.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| Changes to the tool don't appear | Hard refresh: `Ctrl`+`Shift`+`R` |
| "Loading the page…" before *every* proxied page | The browser isn't running the service worker — a private window in some browsers, or DevTools' **Bypass for network**. Pages still load, but without module scripts or fonts |
| A real site looks broken | Load it again with **Run the site's own scripts** off, or accept its cookie banner before turning on review mode |
| A page jumps to the real site | Turn **Run the site's own scripts** off; in a browser without the Navigation API, a script moving the page on isn't caught |
| **Ask AI to clarify** is missing | `.env` isn't set up; restart the dev server after editing it |
| **Ask AI to clarify** is greyed out | The model isn't answering; start it and reload |
| Comments vanished | Storage belongs to the exact address, so a different port counts as a different site |

## Limitations

None of these crash anything. All of them are real.

**It isn't shared.** No backend, no accounts. Comments live in `localStorage`,
which is per-browser and per-device — switch browser, profile or port and
they're gone, and clearing site data deletes them for good. For a review tool,
not being able to send a review to anyone is the biggest thing missing.

**Comments are only kept per page through the proxy.** Each proxied page gets
its own list. A page reviewed where it lives, like the test page, uses one
shared list — on a multi-page site every page would show every comment, some
tagged not-found, some quietly matching the *wrong* element with the same
selector.

**The proxy is limited, and dev-only.** See
[What works, and what doesn't](#what-works-and-what-doesnt). A built site has no
`/proxy`, and the start screen says so. A site's own CSS also reaches the tool's
UI, so on some sites its buttons or text box look a little off.

**Scripts can sometimes walk the page off the proxy.** Links and forms are kept
inside it in every browser. A script that moves the page on by itself is only
caught where the browser has the Navigation API, as Chrome and Edge do. A script
opening a new window isn't caught anywhere.

**Selectors are fragile by nature.** `@medv/finder` produces the shortest
unique selector for the page as it was. Restructure the page and they stop
matching. Positional ones like `:nth-child(2)` are the weak case: insert
something above and the comment quietly points at a different element rather
than failing visibly.

**A dropdown's options can't be commented on.** An open `<select>`'s `<option>`s
are drawn by the operating system rather than laid out in the page, and review
mode keeps the dropdown shut anyway. You can comment on the select itself, not
on "the Admin option".

**Some things can't be reached.** Clicks inside an **iframe** belong to a
different document and never arrive. Events crossing a **shadow DOM** boundary
are retargeted to the host, so you capture the web component rather than the
element inside it. A **canvas** is one element as far as this is concerned. A
site's modal `<dialog>` makes everything outside it unclickable, the tool
included.

**The AI route is dev-only.** It's part of the dev server, so a built site has
no `/api/clarify` and the feature switches itself off.

**Mouse only.** Hover outlining depends on `mousemove`, which has no touch
equivalent.

**No automated tests.** Everything here has been checked in a real browser, by
hand or with throwaway scripts, but nothing in the repo runs checks for you.

**The tool's own UI has had little accessibility work** — no considered focus
management, and the panel isn't announced to screen readers.

## Roadmap

1. A real backend, replacing the `localStorage` internals of `store.ts`. Nothing
   else should need to change — that's what the seam is for.
2. A browser extension, so the tool runs on any live site, logged in, without
   the proxy's limits.
3. Move `/api/clarify` to that backend so clarification survives a build.
4. Sturdier selectors: store more than one way to find each element, so a
   comment survives the page being restructured.
5. Run it against a real app and see what breaks.
6. Export, handing clarified requirements to an issue tracker or a coding agent.

## Reference

```
screen-review/
├── index.html              start screen: paste an address
├── test-page.html          the fake dashboard, for offline testing
├── vite.config.ts          the dev server, the /api/clarify route, the proxy
├── .env.example            variable names for the AI step
├── server/
│   ├── proxy.ts            loads real pages; serves the worker and its files
│   └── proxy-worker.js     fetches the files a proxied page would be refused
├── docs/
│   └── captured-context.md
└── src/
    ├── main.ts             test page entry point
    ├── style.css           the test page's styles
    ├── start/              the start screen
    ├── proxy/              runs inside a proxied page
    │   ├── inject.ts       starts the tool, keeps you inside the proxy
    │   └── address.ts      builds /proxy addresses
    └── review/             the tool, independent of the page
```

| Dev server route | |
| --- | --- |
| `/proxy?url=…` | A real page, with the tool added |
| `/proxy-asset?url=…` | One of that page's files, fetched for the worker |
| `/proxy-worker.js` | The service worker itself |
| `/api/clarify` | The AI step |

| Command | |
| --- | --- |
| `npm run dev` | Dev server, with the AI and proxy routes |
| `npm run build` | Type-check, then build to `dist/` |
| `npm run preview` | Serve the build (no AI or proxy routes) |

[`@medv/finder`](https://github.com/antonmedv/finder) is the only runtime
dependency. Vite and TypeScript are dev dependencies.
