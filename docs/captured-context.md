# Captured context

Every Screen Review comment stores a small snapshot of what was on screen at
the element it was left on. This note explains what is captured, why, and how
to see it for yourself.

The code is in [`src/review/context.ts`](../src/review/context.ts).

## The problem it solves

Before this existed, a comment stored only a CSS selector. That is enough to
put a pin back on the page, but it is close to useless to read:

> `.card:nth-child(2) > .stat` — "this should be bold"

Which element is that? You would have to open the page and hunt for it. With
context attached, the same comment reads:

> a `<p>` reading **"$12,480"**, inside a card that says
> **"Revenue $12,480 View details"** — "this should be bold"

Same note, now actionable. The same snapshot is what the AI clarification step
uses to ask a question grounded in the actual element rather than offering
generic UX advice.

## What gets captured

| Field | Example | Why it is there |
| --- | --- | --- |
| `name` | `{ kind: "Text", label: "$12,480", place: "Revenue" }` | What the tool shows: the element as a person would call it |
| `tagName` | `"p"`, `"button"` | Says whether this is text, a control, an image |
| `text` | `"$12,480"` | Identifies the element to a person |
| `nearbyText` | `"Revenue $12,480 View details"` | Orientation when the element alone says little |
| `viewport` | `{ width: 1512, height: 842 }` | "This wraps badly" depends on screen size |

Captured when the comment is saved, not when it is read: the page may look
completely different by the time anyone opens the comment again.

## Two decisions worth knowing

### Visible text comes from `innerText`, not `textContent`

`textContent` returns everything in the markup, including what is not on
screen — collapsed menus, screen-reader-only labels, hidden templates.
`innerText` returns what a person actually sees, because it respects
rendering.

The comment is about what the reviewer saw, so `innerText` is the honest
choice. Elements without it (SVG internals) fall back to `textContent`.

### Nearby text climbs until the surroundings say something

Commenting on a bare `2.1%` tells you nothing on its own. So `nearbyText`
walks up the ancestors until it finds one whose text is meaningfully longer
than the element's own, then stops:

- Comment on `2.1%` → climbs one level → `"Churn 2.1% View details"`
- Comment on a table cell → the row is barely longer, so it climbs again to
  the table body

It stops as soon as the surroundings add something, so a comment never ends up
storing the whole page.

Both text fields are collapsed to single spaces and length-capped (200 and 300
characters). That keeps stored comments small and keeps the AI prompt cheap.

## The name

The fields above are raw material. `name` is the same information turned into
something a person would say, and it's what the hover label, the comment box
and the panel show instead of the selector:

| Clicked | Name |
| --- | --- |
| The `$12,480` figure | Text “$12,480” in Revenue |
| A card's button | Button “View details” in Active users |
| A cell in the signups table | Table cell “Pro” in Recent signups, Plan column |
| The email input | Text field “Email address” in Invite a teammate |
| A nav link | Link “Reports” in the navigation |

It has three parts, all read off the page by
[`src/review/describe.ts`](../src/review/describe.ts):

- **kind**: what sort of thing it is. An ARIA `role` wins, then the tag, then
  a guess for `<div>`s: one holding a heading is a Section, one holding only
  text is Text, one with a background image and no text is an Image.
- **label**: what it's called, looked for where a screen reader would look:
  `aria-labelledby` and `aria-label`, then a field's `<label>`, an image's
  `alt`, a placeholder, then the visible text. An icon on a button goes by the
  button: Icon “Close”.
- **place**: the heading leading the nearest section around it, a named region
  (`<nav aria-label="Breadcrumb">`), or the part of the page it's in: the
  navigation, the page header, the footer, a dialog. Table cells add their
  column.

The place is guessed cautiously. Only a heading that is a direct child of the
section, or sits in a wrapper with nothing else in it, counts. A heading inside
a sibling card is that card's title, not this element's, so the second card's
heading isn't "in Revenue". When nothing qualifies the name has no place,
which is better than a wrong one.

Unlike `text`, the name keeps the words as they're written in the page. CSS
puts plenty of headings in capitals, and `innerText` copies that, so "in
REVENUE" becomes "in Revenue".

## Seeing it yourself

Run the dev server and open the test page:

```bash
npm run dev
```

Open the browser console (F12), turn on review mode, and try these three.

**1. An element whose own text says everything.** Click the `$12,480` figure,
write anything, save:

```
element : <p> $12,480
nearby  : Revenue $12,480 View details
```

The element knows it is `$12,480`; the nearby text says *which* figure.

**2. An element whose own text says almost nothing.** Click a name in the
Recent signups table:

```
element : <td> Dana Reyes
nearby  : Dana Reyes Pro Sep 18 Sam Okafor Free Sep 19 Lee Brandt Pro Sep 21
```

The row was not different enough from the cell, so the climb went up to the
table body. Now you know which table it was.

**3. A control.** Click the Send invite button:

```
element : <button> Send invite
nearby  : Email address Role Viewer Send invite
```

`<button>` says it is a control; the nearby text says which form it belongs to.

### The whole stored object

Press **Copy JSON** in the comments panel and paste it anywhere:

```json
{
  "id": 1,
  "selector": ".card:nth-child(1) > .stat",
  "comment": "too small",
  "status": "open",
  "context": {
    "name": { "kind": "Text", "label": "$12,480", "place": "Revenue" },
    "tagName": "p",
    "text": "$12,480",
    "nearbyText": "Revenue $12,480 View details",
    "viewport": { "width": 1512, "height": 842 }
  }
}
```

### Proving the viewport is live

Drag the browser window much narrower, leave another comment, and copy the
JSON again. The new comment's `viewport.width` reflects the narrow window; the
earlier one does not.

Exact selectors and nearby text vary with the DOM — `@medv/finder` picks the
shortest unique selector it can, and how far the climb goes depends on how much
surrounding text there is.

## Comments on several elements

A comment can cover several elements at once, every card in a grid, say. The
snapshot above is taken of the first, the one clicked. Each of the others
keeps its selector and name, under `others`:

```json
"others": [
  {
    "selector": "article:nth-of-type(2)",
    "name": { "kind": "Section", "label": "Active users", "place": "" }
  },
  {
    "selector": "article:nth-of-type(3)",
    "name": { "kind": "Section", "label": "Churn", "place": "" }
  }
]
```

That is enough to pin and list them. The AI step gets the first element's
context, as for any comment, plus the names of the rest, so it knows the
request is about all of them.

## The screenshot

In the browser extension, saving a comment also takes a picture of the window:
the page as the reviewer saw it, with the comment's elements outlined and the
tool's own box, panel and pins hidden. The text above says *what* the element
was; the picture shows what it looked like, which is what "this looks off"
was about.

The comment stores only an id, `"screenshot": "38083fad1a043bb46bc66cbb"`. The
picture itself, a JPEG of a few hundred KB, is kept in the browser's IndexedDB,
because `localStorage` holds about 5 MB for the whole site and a few dozen
pictures would fill it. Deleting the comment deletes its picture. See
[`src/review/screenshots.ts`](../src/review/screenshots.ts).

## Older comments

Comments saved before context existed load with an empty context rather than
being discarded. Ones saved before names existed get the best name their tag
and text allow, with no place: Button “Send invite”. A comment with no context
at all can only be called "Element". See `toContext` in
[`src/review/store.ts`](../src/review/store.ts).
