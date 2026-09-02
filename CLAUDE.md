# vplan — working on this repo

**`vplan.html`** is a single-file verification-plan editor: UI + data + renderer in one file, no build step,
no dependencies, opened straight off disk (`file://`). This is the product.

This repo is also **vplan-kit**, the distributable: `install.sh` installs everything under `skills/` as
Claude Code skills and the save helper (`bin/` → `~/.vplan-kit/`), and writes `~/.vplan-kit/kit-path` so
the skills can find this clone from any directory. The template and this file are never copied out — the
skills read them here, so a `git pull` is the update.

The skills, and what each is allowed to touch:

| skill | reads | writes |
|---|---|---|
| `vplan_create` | the template | a new `~/vplans/vplan_<IP>.html` |
| `vplan_suggest` | Input Sources + the plan | `suggestions[]` — proposals for rows that do not exist yet |
| `vplan_audit` | Input Sources + the plan | `audits[]` — findings against rows that do (missing / insufficient / mismatch) |
| `vplan_fill_description` | Input Sources + the plan | **rows, one field wide**: a `description` that is empty, never one a human wrote |

Both inbox skills exclude everything already decided — rows, and pending, accepted or rejected cards
alike. `vplan_fill_description` is the single, deliberate exception to "agents never write rows": it may
fill an empty `description` on `features[]` / `items[]` and nothing else, and must verify before saving
that no other field moved.

`test/` is a Playwright suite that drives the real file in a real browser. There is no unit-test layer —
the whole thing is DOM behaviour, so that is where the tests are.

## Setup

```bash
npm install
npx playwright install chromium     # once
npm test
```

**Ask the user to Save before you edit their plan.** Save overwrites the file it was pointed at, so once
they have saved, the file on disk is what is on their screen — but until they do, whatever they typed
lives only in the open tab, and editing the file underneath them discards it on their next save.

**Plan files live in `~/vplans/`, not here.** A browser page cannot write a file without a picker, and
corporate AV / macOS TCC can block writes into `~/Documents` outright (which is what killed in-place
saves on the first machine this ran on) — so the page's Save is dialog-free by design: it POSTs the
document to the local `com.vplan.save` helper (127.0.0.1:8790, installed by `install.sh`), which writes
`~/vplans/vplan_<IP>.html` in place. Only Save As opens a picker, and what it writes is a dated snapshot
copy — a frozen, read-only fork with the save stamp where its buttons were; originals carry a Load
button to pull a snapshot back. A personal launchd agent may mirror `~/vplans` to a backup directory
(one-way, newer-only) — edit the `~/vplans` file, never a mirror copy.
A plan file carries the page code it was saved with — after changing this template's code, transplant
each plan's data block into a fresh template copy, and have the user reload open tabs.

In a sandbox that already ships a chromium binary, point at it instead of downloading:
`VPLAN_CHROMIUM=/path/to/chromium npm test`.

## Architecture of vplan.html

```
<script id="vplan-data" type="application/json">   ← THE DATA. the only thing agents edit.
<div id="app">                                      ← everything rendered. wiped and rebuilt by render()
<script>                                            ← the renderer
```

- `DATA` is parsed from the JSON block at load and is the single source of truth in memory.
- `render()` rebuilds all of `#app` from `DATA` and the current `TAB`. There is no virtual DOM and no
  partial re-render.
- Editable cells are `contenteditable` divs (or `<select>`) carrying `data-path="features.3.name"`.
  One delegated `input` listener walks that path and writes into `DATA`.
- Buttons carry `data-act="..."`. One delegated `click` listener dispatches on it.
- `serializeDoc()` clones `document.documentElement`, empties `#app`, writes `DATA` back into the JSON
  block, and returns the result. That is how Save works.

### Invariants — breaking these breaks the file

- **Chrome only.** In-place save is the File System Access API (`showSaveFilePicker`), which WebKit does
  not implement; Safari silently falls back to downloading a copy. Do not build anything else on APIs
  the fallback cannot survive, and keep the fallback honest — it says which mode the user is in.
- **Nothing lives in browser storage.** The old save-target store (IndexedDB handles) is gone: Save
  posts the document to the local vplan-save helper under the document's own filename, and Save As
  writes a dated snapshot that follows nothing. The plan lives in the saved file and nowhere else.
  Never add `localStorage` / `sessionStorage` / IndexedDB, and never cache rows, drafts, or filters.
- **A snapshot is frozen.** `meta.snapshot` (`{at: "YYYY-MM-DD HH:MM:SS"}`) exists only in Save As
  copies; a page carrying it removes its Save / Save As buttons, shows the stamp in their place, and
  refuses to save. Only `serializeDoc(at)` may mint the marker — never write it into a working plan.
- **All rendered UI lives inside `#app`.** `serializeDoc()` empties it; anything outside gets baked into
  the saved file permanently.
- **Do not `render()` on every keystroke.** Re-rendering blows away focus and the caret in a
  `contenteditable`. The `input` handler writes to `DATA` and stops. Only structural changes
  (add/delete/accept/tab switch) call `render()`.
- **`esc()` everything interpolated into HTML.** Values are user text and may contain `<`.
- **IDs are stable primary keys.** `nextId()` continues from the highest existing one; nothing renumbers
  on its own. The `Refresh` button is the one exception — it renumbers `F##`/`VI###` to match list order
  and rewrites every reference (`feature_refs`, `accepted_as`, active filters) from a map captured before
  the change. Anything outside this file that cites an id (a ticket, a commit message) will not follow.
- **Module-level UI state (`TAB`, `OPEN`, `SUGOPEN`) is not persisted** — a saved file always reopens
  on the default tab. `test/export.spec.js` asserts this.

### Schema (`vplan/1.0`)

| key | |
|---|---|
| `meta` | IP name, the Input Source block — `uarch` (URL of the spec the plan was written against; the top bar links to it), `ref_model` (path to the reference model) and `csr` (path to the SFR/register spreadsheet) — owner, status, `phase` (the plan's own pre-Alpha/Alpha/Beta stage; per-item targets live on `items[].phase`), last_updated. Edited in the top bar. |
| `features[]` | **what** must be verified — `category`, `name`, `description`, `priority`, `status`, `notes`. `F##` |
| `items[]` | **verification items** — what must hold for a feature to be true, one judgeable claim each, with its `oracle` and the `phase` it is due in (pre-Alpha / Alpha / Beta). `VI###` |
| `testcases[]` | **how** — UVM test class, virtual sequence, per-agent sequences, config, checks. `TC###` |
| `coverage.functional[]` `coverage.assertions[]` `coverage.code` | `CG##`, `SVA##`, targets + sign-off |
| `suggestions[]` | agent inbox — proposals for rows that do not exist yet. **Not the plan.** `S###` |
| `audits[]` | agent inbox — findings against rows that DO exist: `target` (the row id), `finding` (`missing`/`insufficient`/`mismatch`), and `fix`, a patch of only the fields to change. **Not the plan.** `A###` |

Cross-references are ID strings: `testcases[].feature_refs[] → features[].id`,
`items[].feature_refs[] → features[].id`,
`testcases[].coverage_refs[] → CG/SVA ids`, `testcases[].dependencies[] → testcases[].id`,
`coverage.functional[].feature_refs[] → features[].id`. Lint checks all of them.

Enums are declared in `$enums` at the top of the JSON and read from there by the UI — add a value there,
not in the JS.

### The suggestions contract

The inbox is not a tab of its own: feature cards render under the Features table and item cards under
the Verification Items table, each `kind` next to the list it would join.

`suggestions[]` is how an agent proposes work, `audits[]` how it criticises work already done. **An agent
appends to either and never writes into `features[]` / `items[]` / `testcases[]` / `coverage` on the
strength of a card.** The Accept button in the UI is the only path from a card to the plan. Accepting always mints a *fresh* `F##` rather than trusting the
proposed id (`F##` for `kind: "feature"`, `VI###` for `kind: "item"`), so a suggestion can never collide
with or overwrite an existing row.

Accepting an audit card is the one place a card EDITS instead of adds: `fix` is merged key-by-key into
the row named by `target` (`id` stripped, so a card can never rename its target), except for
`finding: "missing"`, which mints a fresh row exactly like a suggestion. Reopening an accepted audit
un-decides the card but leaves the edit — the pre-edit values are not kept anywhere, so the row is the
user's from then on. Renumbering (`Refresh`) carries `target` and `fix.feature_refs` with it.

Accepted and rejected cards are kept for good — they fold into `Accepted` / `Rejected` sections under the
pending list rather than disappearing. Rejections carry a `reject_kind` — `duplicated` / `hallucinated` / `waived` (see `$enums`) — plus an
optional `reject_reason` note. The first two are feedback on the agent's own work (matching too loose,
extraction wrong); the third is a project decision. Read them before proposing anything, so the same thing
is not proposed twice and the next round corrects the failure the label names.
Lint warns on a rejection with no reason, and on a pending suggestion with no `source.quote` — an
unverifiable card is worse than no card.

### What is deliberately NOT in the schema

Read `DECISIONS.md` before adding anything back. Interfaces, TB architecture, regression levels,
milestones, risks and a document overview were all present and were all removed on purpose. The TB
generator is expected to derive what it needs instead — see `DECISIONS.md` §"Derived, not stored".

## Testing

```bash
npm test                        # all
npx playwright test test/lint.spec.js
npx playwright test -g "round-trip"
npm run test:headed             # watch it drive the browser
```

`test/helpers.js` has `openVplan` (fails on any console/page error), `setCell` (edits the way a user does,
firing `input`), `patch` (mutate `DATA` + re-render, for fault injection), `lint`, `captureClipboard`.

When you change behaviour, add the test first — every past bug in this file was a rendering or state bug
that only a real browser would catch.
