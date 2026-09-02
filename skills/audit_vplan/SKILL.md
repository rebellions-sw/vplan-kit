---
name: audit_vplan
description: Audit a vplan's existing rows against its Input Sources (uArch / Ref-Model / CSR) and file Audit from AI cards for what is 누락 / 불충분 / 미스매치. Use when the user says "audit_vplan <IP>", "<IP> 검토해줘", "<IP> 감사", or asks whether the plan's features/items hold up against the spec.
---

# audit_vplan

`suggest_vplan` asks *what is the plan missing*. This skill asks *does what the plan already says hold
up* — every row judged against the Input Sources, and every finding filed as an **Audit from AI** card.
Same contract as the suggestion inbox: an agent appends, only the human's Accept changes a row.

Read the schema SSOT first: `$KIT/CLAUDE.md`, where `KIT=$(cat ~/.vplan-kit/kit-path)` is the vplan-kit
clone (missing pointer ⇒ the kit was never installed — tell the user to run `./install.sh`).
Plans live at `~/vplans/vplan_<IP>.html`.

## The three findings

| finding | means | Accept does |
|---|---|---|
| `missing` | the source states something **no row covers** | adds a new row (fresh id) |
| `insufficient` | a row is right but **too thin to verify against** — no oracle, vague description, no measurable claim | edits the named row |
| `mismatch` | a row **contradicts** the source, or drifted from it (wrong value, renamed signal, superseded behavior) | edits the named row |

`missing` overlaps `suggest_vplan` on purpose: there it is a proposal, here it is a finding that came out
of auditing coverage. Prefer `insufficient`/`mismatch` — judging what exists is this skill's job. File a
`missing` card only when auditing an existing row exposed the hole (e.g. a feature whose stated behavior
has no verification item at all).

## The run

1. **Refuse politely** if `~/vplans/vplan_<IP>.html` does not exist (offer `create_vplan <IP>`), or if
   `meta.snapshot` is set — snapshots are frozen exports.
2. **Ask the user to Save and confirm before editing.** Unsaved rows live only in the open tab, and your
   cards are wiped the moment they Save over them. After you write, they must **reload the tab**.
3. Parse the data block (`rindex` of the tag — the file's header comment cites the same string):

```python
import json, os
tag = '<script id="vplan-data" type="application/json">'
plan = os.path.expanduser('~/vplans/vplan_ATU.html')      # ← the argument
s = open(plan, encoding='utf-8').read()
i = s.rindex(tag); j = s.index('</script>', i)
d = json.loads(s[i+len(tag):j])
```

4. **Read the Input Sources** from `meta`, skipping blanks silently: `uarch` (URL — Notion tools for a
   Notion URL, else WebFetch; the MAS, primary truth), `ref_model` (local path — read the code),
   `csr` (local .xlsx — read it; registers and fields are `parameter`-category truth). If all three are
   blank, stop: with nothing to quote, no finding can be checked.
5. **Audit every row in `features[]` and `items[]`** — the whole plan, whatever its Confirmed state.
   For each row ask, in this order:
   - Does the source support it at all? (no → `mismatch`, or `hallucinated`-worthy)
   - Does the source say something different — a value, a name, a condition? (→ `mismatch`)
   - Could a verification engineer act on it as written? An item needs a judgeable claim and a real
     `oracle`; a feature needs a description that says what correct means. (no → `insufficient`)
   - For a feature: is any item actually verifying it? (no → `missing` item card)
6. **Respect what was already decided.** Read `audits[]` **and** `suggestions[]` before writing: never
   re-file a finding that is pending, accepted, or rejected. A rejection is feedback addressed to you —
   `hallucinated` = your claim did not hold, `duplicated` = your matching was too loose, `waived` = a
   project decision. Do not repeat the finding or the failure mode.
7. **Append to `audits[]` only.** Never write into `features[]` / `items[]` / `coverage` /
   `suggestions[]`. `aid` continues from the highest existing `A###`. Card shape:

```json
{
  "aid": "A001",
  "kind": "feature",                    // or "item" — which table the card renders under
  "target": "F03",                      // the row being judged; "" only for finding "missing"
  "finding": "insufficient",            // missing | insufficient | mismatch
  "status": "pending",
  "created": "YYYY-MM-DD",
  "confidence": "high",                 // high | med | low
  "source": { "doc": "MAS", "section": "5.5", "url": "https://…#5-5", "quote": "verbatim sentence" },
  "rationale": "F03 says the request is merged; the MAS merges only when CMD matches too",
  "fix": { "description": "…" },        // ONLY the fields to change
  "reject_reason": ""
}
```

   **`fix` is a patch, not a row.** Put in it only the fields you are actually changing — Accept merges
   exactly those keys into the row, so an extra empty key blanks real content. Never include `id`
   (Accept strips it anyway). For a `missing` card, `fix` is the whole new row's payload, minus `id`.
   Field names and enum values come from the row schema and `$enums` in the data block — read them,
   never invent values. `feature_refs` may only cite existing `F##` ids (lint checks every reference).
8. **Every card carries a verbatim `source.quote`** plus `doc`/`section`/`url` — a finding a human
   cannot check in one click is worse than no finding (lint flags quoteless cards). Keep a run
   digestible: ~10–15 findings, ordered worst first, and say in your report what you did not cover.
9. **Write and verify**: re-serialize the data block (indent 2), read it back, and assert it parses,
   `features[]`/`items[]`/`testcases[]`/`suggestions[]` lengths are unchanged, every new card is
   `pending` with a non-empty quote, and every non-`missing` card's `target` matches an existing row id.
10. **Report**: counts per finding and per kind, which sources you used and which were blank, the rows
    that came out clean, and the two reminders — reload the tab; Accept/Reject happens in the UI only.

## Rules that outlive this skill

- Accept is the only path from a finding to the plan. Judging is your job; deciding is not.
- Never lower a finding to fit what the plan already says — quote the source and let the human choose.
- A row you cannot fault is not a finding. Silence about a good row is the correct output.
