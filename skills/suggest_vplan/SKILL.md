---
name: suggest_vplan
description: Gap analysis for a vplan — read the plan's Input Sources (uArch / Ref-Model / CSR) and propose feature / verification-item suggestion cards. Use when the user says "suggest_vplan <IP>", "<IP> 제안해줘", "<IP> gap analysis", or asks for feature/item suggestions on a vplan.
---

# suggest_vplan

Gap analysis against a plan's own Input Sources, delivered as suggestion cards — never as rows.
The whole point of the inbox is that a human reads the evidence on each card and clicks 수락;
this skill fills the inbox, it never touches the plan itself.

Read `~/vplans/CLAUDE.md` (schema SSOT and the suggestions contract) before touching anything.
The plan lives at `~/vplans/vplan_<IP>.html`.

## `suggest_vplan <IP>` — the run

1. **Refuse politely** if `~/vplans/vplan_<IP>.html` does not exist (offer `create_vplan <IP>`), or
   if its `meta.snapshot` is set — snapshots are frozen exports; suggestions go into the original only.
2. **Ask the user to Save and confirm before editing.** Their unsaved rows exist only in the open
   tab, and your appended cards are wiped the moment they press Save over them. After you write the
   file, they must **reload the tab** to see the cards — say so in the report.
3. Parse the data block (`rindex` of the tag — the header comment cites the same string earlier in
   the file):

```python
import json, os
tag = '<script id="vplan-data" type="application/json">'
plan = os.path.expanduser('~/vplans/vplan_ATU.html')      # ← the argument
s = open(plan, encoding='utf-8').read()
i = s.rindex(tag); j = s.index('</script>', i)
d = json.loads(s[i+len(tag):j])
```

4. **Collect the Input Sources** from `meta` — use the ones that exist, skip blanks silently:
   - `meta.uarch` — a URL. Notion URL → Notion tools; anything else → WebFetch. This is the MAS,
     the primary source of feature-level truth.
   - `meta.ref_model` — a local path. Read the model code; behaviors it implements are candidate
     verification items.
   - `meta.csr` — a local .xlsx path (SFR/register list). Read it (xlsx skill / openpyxl); registers
     and fields are candidate features/items of category `parameter`.
   If **all three are blank**, stop and tell the user: a card without a verifiable source quote is
   worse than no card, and there is nothing to quote from.
5. **Build the exclusion set** before generating anything:
   - every row in `features[]` and `items[]` (id, name, description);
   - every card in `suggestions[]` **regardless of status** — pending (already on the table),
     accepted (already in the plan), rejected (already decided).
   - Rejections are feedback addressed to you. `hallucinated` = the quote did not support the claim;
     `duplicated` = your matching was too loose; `waived` = a project decision. Read each
     `reject_kind` + `reject_reason` and do not re-propose the same thing or repeat the same
     failure mode. Comparison is **by meaning** (name + description), not by string equality — and
     when in doubt whether a candidate duplicates something, either drop it or say explicitly in
     `rationale` what the closest existing row is and why it stops short.
6. **Generate candidates** grounded in the sources. Every card MUST carry a verbatim
   `source.quote` (lint flags cards without one) plus `doc` / `section` / `url` so the human can
   check the claim in one click. Keep a run digestible — a human reviews every card by hand, so
   prefer ~10–15 strong cards and say what ground you did not cover, over an exhaustive dump.
7. **Append to `suggestions[]` only.** Never write into `features[]` / `items[]` / `coverage`,
   never modify or delete existing cards, never renumber anything. `sid` continues from the highest
   existing `S###`. Card shape (mirrors what the 수락 handler expects — it merges `payload` over a
   fresh row, mints a fresh `F##`/`VI###`, and sets status to `editing`):

```json
{
  "sid": "S004",
  "kind": "feature",                    // or "item"
  "status": "pending",
  "created": "YYYY-MM-DD",
  "confidence": "high",                 // high / med / low — your own calibration
  "source": { "doc": "MAS", "section": "5.5", "url": "https://…#5-5", "quote": "verbatim sentence" },
  "rationale": "closest is F01, which stops short of this",
  "payload": { "name": "…", "category": "command|behavior|parameter", "description": "…",
               "phase": "pre-Alpha", "status": "not started", "notes": "" },
  "reject_reason": ""
}
```

   For `kind: "item"` the payload mirrors an `items[]` row instead (minus `id`/`reviewed`):
   `name, category, description, feature_refs, oracle, judged_by, stimulus, status, phase,
   implemented, notes`. `feature_refs` may only cite **existing** `F##` ids (lint checks every
   cross-reference) — cite the feature a card verifies, or leave it `[]`. Enum values come from
   `$enums` in the data block — read them, never invent values.
8. **Write and verify**: re-serialize the data block (same indent-2 style), then read the file back
   and assert it parses, `features[]`/`items[]`/`testcases[]` lengths are unchanged, and the new
   cards are all `status: "pending"` with non-empty `source.quote`.
9. **Report**: how many cards, per kind, from which sources; which sources were blank; and the two
   reminders — reload the tab to see the cards, accept/reject happens in the UI only.

## Rules that outlive this skill

- The 수락 button is the only path from suggestion to plan. Proposing is your job; deciding is not.
- A card whose quote you cannot point to in a source does not get written.
