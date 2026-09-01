# Design decisions

Why the plan is as small as it is, and what was tried and dropped. Read this before "helpfully" adding
something back — most of it was in the file at some point and was removed on purpose.

## Derived, not stored

The plan does not store testbench structure. A generator reconstructs it:

| needed | derived from |
|---|---|
| agent list | the set of `testcases[].uvm.sequences[].agent` names used anywhere |
| checking components | `testcases[].checks[].ref` where `type` ∈ scoreboard, reference_model, register, sideband, protocol_vip |
| base tests | `testcases[].uvm.base_test` |
| config_db knobs | union of `testcases[].config` keys |

Storing these separately means two places to update and one of them silently goes stale. Deriving them
means a typo shows up as a phantom agent, which lint catches — see the edit-distance check.

## Removed sections

**`interfaces[]`** — protocol, widths, clock/reset names, agent config per DUT port.
Removed. Signal-level truth lives in the RTL; a copy in a planning document goes stale and then actively
misleads. Cost: the TB prompt can no longer emit accurate interface files, so it now instructs the
generator to take pin detail from the RTL and mark every inferred signal `// TODO(vplan): confirm against
RTL`. Second cost: a purely passive agent that runs no sequence becomes invisible (`irq_agent` did). It
survives only via `checks[].ref`. If passive agents need first-class representation, the cheap fix is a
convention on sideband `ref` names, not a new section.

**`tb_architecture`** — env class, agents, scoreboards, RAL, config knobs, bind probes.
Removed; see "Derived, not stored". Bind-probe information moved into the `notes` of the covergroups that
need it (CG06, CG08), which is where someone reads it anyway.

**`regression.levels[]`** — smoke / nightly / weekly test lists.
Removed. `testcases[].seeds` and `priority` survive, and the TB prompt now groups by priority
(P0 = commit gate, P1 = nightly, P2/P3 = weekly). If a team's real grouping differs, that is one line in
the prompt, not a schema section.

**`Open…` button** — loaded a different `vplan.html`/`.json` into the current page.
Removed on request (2026-08-28), along with `openFile()`. A plan is opened by opening its file in the
browser; a second in-page way to swap the document only competed with the save target below — after an
in-page Open, "the same path" would have meant the path of a document no longer on screen.

**`Copy TB Context` button** — copied the plan plus a ready-made UVM generation prompt to the clipboard.
Removed on request (2026-08-28), along with `tbContext()`. §"Derived, not stored" still holds as a schema
principle — it is why `interfaces[]` and `tb_architecture` stay out, and lint still derives the agent
inventory the same way — but this file no longer ships a generator prompt. `Export JSON` hands the plan to
a model instead, and the prompt lives wherever the generator does.

**Timestamped snapshot saves** — `vplan_<IP>_YYYY-MM-DD_HHMMSS.html` on every Save, open file untouched.
Removed on request (2026-08-31). Save now picks a file once (`showSaveFilePicker`) and overwrites it in
place from then on, with the `FileSystemFileHandle` kept in IndexedDB so the picker does not come back
after a reload. Snapshots had been chosen over exactly this on 2026-08-28, on the grounds that nothing
should be overwritten and that "no browser storage" could then stand unqualified. What that cost showed
up in use: the document an agent edits and the file the browser writes were two different files, every
save left a dated copy behind, and rows a user had typed looked like they had vanished because their
edits were sitting in a download nobody folded back in. `scripts/sync-latest.mjs` and `npm run sync`
existed only to do that folding, and went with the snapshots.

**`meta.ip_version`** — the IP's own version (`r1p2`-style), shown as `ip ver` in the top bar.
Removed on request (2026-08-28). It sat empty for the first IP we tried: its uArch document does not state an IP version, so
the field asked for a fact the only input could not supply. What a reader actually needs to know is which
spec revision the plan tracks, and `uarch` now carries that as a link. If an IP version is needed later it
belongs next to the RTL it describes, not in a planning document.

**`meta.revision`** — the plan document's own revision, shown as `doc rev` in the top bar.
Removed on request (2026-08-28). The top bar now carries one document identity instead of two: `uArch`
holds the URL of the spec the plan was written against, and the strip links straight to it. Plan-side
history was the weaker of the two — `last_updated` survives, and file history is git's job, not a
hand-maintained string. `test/export.spec.js` edited this field to prove JSON export tracks live DATA; it
now edits `meta.uarch`.

**`meta.methodology`** — the top-bar field holding "UVM 1.2 / SystemVerilog".
Removed on request (2026-08-28), field and all. The value was never a per-plan decision: every consumer
already hardcodes it — the TB prompt opens with "You are a UVM/SystemVerilog testbench generator" and the
schema is UVM-shaped throughout (`uvm.test_class`, `uvm.base_test`, covergroups, SVA). A field that only
ever holds one value is a second place to keep in sync, so the TB context payload stopped emitting it too.
If a plan ever needs a non-UVM methodology, that is a prompt change, not a schema field.

**JSON 탭 (raw editor)** — the `data` tab: a textarea holding the whole document, with Apply / Copy.
Removed on request (2026-08-28). Nothing became unreachable: `Export JSON` / `Export YAML` still emit the
document, and the `<script id="vplan-data">` block in the saved file is still editable in any text editor.
What went with it is the one path that could replace `DATA` wholesale from pasted text — bypassing the
suggestions contract and lint. `Export JSON` remains the way to hand the plan to a model.

**`milestones[]`, `risks[]`** — project management. Removed; belongs in the tracker, not the vplan.

**`overview`** — DUT description, in/out of scope, assumptions, reference documents.
Removed. `meta` shrank to what earns its place (ip_name, owner, status, last_updated) and moved into
the top bar. Cost: the TB prompt lost the DUT description and
spec links, and now leans on `features[].description` / `spec_ref` instead.

## The AI loop: two attempts

**Attempt 1 — clipboard round-trip.** A button copied a prompt (schema + existing feature list); you
pasted it into Claude with the spec attached and pasted the JSON back to merge. Built, worked, removed.

It failed for reasons that were not about the clipboard:

- The unit of work was wrong. "Here is a 100-page MAS, produce the feature list" is the task LLMs do
  worst — output is shallow, uneven, and skips whole sections silently.
- The spec had to be re-attached every iteration.
- Results arrived as one blob. No way to redo a single item.
- The merge was blind — paste and it applies.

**Attempt 2 — suggestions inbox (current).** Claude Code reads the MAS (Notion/Confluence MCP) and
appends to `suggestions[]`. Each card carries a *verbatim* quote from the source, a deep link, and a
rationale naming the closest existing feature and what it stops short of. A human accepts or rejects per
card. Rejections keep a reason and are fed back so the same suggestion does not return.

The properties that matter: the agent cannot write into the plan; every claim is checkable in seconds
against the quote; and the gap analysis is scoped to one MAS section per run, which is the single biggest
lever on output quality. (It lived in `.claude/commands/vplan-gap.md` for a while; removed 2026-08-28 —
the work is a judgement-heavy conversation, and a prompt file added a second place to keep in sync with
the schema without making the conversation any better.)

## Smaller calls

- **Near-duplicate agent names**, not rare ones, indicate a typo. An early version warned on any agent
  used once and cried wolf on `clkrst_agent` (legitimately used once). Now it is Levenshtein ≤ 2 between
  two names, reported once per pair, naming the rarer one as the suspect.
- **Accepting a suggestion mints a fresh ID** rather than using the proposed one. An agent cannot
  overwrite an existing feature by guessing an id that is already taken.
- **The JSON parser for pasted AI output was deliberately lenient** (code fences, surrounding prose,
  `{"features":[...]}` wrappers) while *value* validation stayed strict (enum coercion reported, not
  silent). That code went away with attempt 1, but the principle applies to anything that ingests model
  output: forgive the envelope, check the contents.
- **No browser storage.** The saved `.html` file is the only persistence. This keeps the document
  git-friendly and means "what you see" and "what is in the file" cannot diverge.

## Known rough edges

- **Concurrent edit.** If the browser has unsaved changes while Claude Code writes the same file, one
  side loses. Current answer is discipline: Ctrl+S before running a command, refresh after. A real fix
  is splitting data into `vplan.json` with the HTML as a bound viewer — deliberately not done, the
  single-file property is worth more today.
- **`.claude/` is not writable by Cowork's remote device tools**, so installing the command file needs a
  local `cp`. Only affects installation, not use.
