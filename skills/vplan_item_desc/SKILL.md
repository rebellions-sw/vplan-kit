---
name: vplan_item_desc
description: Write the Description / Oracle / Report of a vplan's VERIFICATION ITEM rows from the plan's Input Sources (uArch / Ref-Model / CSR) and the feature each item verifies. Use when the user says "vplan_item_desc <IP>", "<IP> item 설명 채워줘", "verif item oracle 채워줘", or asks to flesh out verification items in a vplan. Not for features.
---

# vplan_item_desc

The user writes the item titles; this skill writes what they mean. It is the items-side twin of
`vplan_feature_desc` and the only other skill allowed to write into rows — here **three fields wide**
(`description`, `oracle`, `report`) on `items[]` alone. `features[]`, `testcases[]` and `coverage`
are out of scope: never written, and read only as described below.

An item is **one judgeable claim**. The three fields answer three different questions, and a good row
keeps them apart:

| field | answers | shape used in this plan |
|---|---|---|
| `description` | what must be true | one sentence, `~해야 한다` / `~하면 안 된다`; details after ` — `, separated by `·` |
| `oracle` | what it is compared against | always ends in `~인지 판단` |
| `report` | how a violation surfaces | `<대상>을 uvm_error로 검출` |

Two rules decide what it may touch:

- **`status: "finalized"` is off limits.** A finalized Definition is a decision; leave the row exactly
  as it is and say in the report that you skipped it.
- **A field that already has text is the user's.** `oracle` and `report` are single lines with no room
  for a marker, so never overwrite them — fill only the empty ones and list the rest in the report.
  `description` follows the marker rule below.

```
<whatever the user already wrote — untouched>
=== AI ===
<your sentence>
```

The marker is exactly `=== AI ===` on a line of its own (`AI_MARK` in the renderer, which shows an
"AI 채움" badge whenever a description contains it). On a re-run, replace everything **from the marker
down** — never stack a second marker. A description with no text at all gets the marker as its first
line.

Read the schema SSOT first: `$KIT/CLAUDE.md`, where `KIT=$(cat ~/.vplan-kit/kit-path)` is the vplan-kit
clone (missing pointer ⇒ the kit was never installed — tell the user to run `./install.sh`).
Plans live at `~/vplans/vplan_<IP>.html`.

## What the three fields say

**`description` — the claim, not the scenario.** One sentence stating what must hold, in the positive
(`…해야 한다`) or as a prohibition (`…하면 안 된다`). Where the claim needs specifics — field names,
encodings, the exact set of legal values — put them after an em dash, `·`-separated:

```
invalidation으로 discard되는, MSHR alloc을 이미 받은 요청에는 dummy response가 발행되어야 한다 —
atq_ip_attribute[15]=0(Fault) · [14:13]=2'd1(Invalidation Drop) · [10:9]=2'd2(POST_ISSUE_DROP)
```

Never describe the stimulus ("…하는 테스트"), never restate the title, never write "TBD".

**`oracle` — what the judgement compares.** It names the two things being held against each other and
ends in `판단`. The plan uses two families; match the one the row belongs to:

- scoreboard rows: `queue of expd <REQ|RSP> to <SOM|IP>와 queue of observed <REQ|RSP> to <SOM|IP>를
  비교해, <무엇이 일치/불일치해야 하는지>인지 판단`. Add `in-order로` only when order is the claim.
- VIP / assertion rows: `<무엇>이 <기준>인지 판단` — e.g. `새 요청의 ID가 해당 방향의 outstanding ID
  목록에 이미 있는지 판단`.

**`report` — what turns red.** `해당 request/response/cmd를 uvm_error로 검출` for VIP rows,
`expd <REQ|RSP>/observed <REQ|RSP> 불일치를 uvm_error로 검출` for scoreboard rows. If a violation is
only detectable later (a model that drifts, say), say so plainly in `report` — when it surfaces and
what it looks like then.

**`judged_by` picks the family, and this skill never sets it.** `SOM-VIP`/`IP-VIP` ⇒ the VIP shapes;
`scoreboard`/`ref-model` ⇒ the queue-comparison shapes; `sva` ⇒ a per-cycle condition; `test/seq` ⇒ a
property the sequence itself decides. **If `judged_by` is empty, fill `description` only**, leave
`oracle`/`report` blank, and say in the report that the row needs a judge before they can be written —
guessing one invents a testbench.

## Procedure

1. **Argument**: the IP name. `~/vplans/vplan_<IP>.html` (case as the file has it).
2. **Ask the user to Save and confirm before editing.** Their unsaved rows live only in the open tab,
   and your writes are lost the moment they Save over them. After you write, they must **reload the tab**.
3. Parse the data block (`rindex` of the tag — the file's header comment cites the same string):

```python
import json, os
tag = '<script id="vplan-data" type="application/json">'
plan = os.path.expanduser('~/vplans/vplan_ATU.html')      # ← the argument
s = open(plan, encoding='utf-8').read()
i = s.rindex(tag); j = s.index('</script>', i)
d = json.loads(s[i+len(tag):j])
```

4. **Pick the rows**: every row in **`items[]`** with a non-empty `name` whose `status` is not
   `finalized`, and which is missing at least one of the three fields (or whose `description` has only
   a marker section you wrote before). A row with no name is not ready; a finalized row is closed.
   Skip both and say so. If nothing qualifies, stop and report that.
5. **Read the inputs, in this order:**
   - the row's **`name`** — its `[family]` prefix says which interface and direction it lives on
     (`[expd REQ to SOM]`, `[Watchdog]`, `[L1 TLB]` …), which is also the shape its oracle takes;
   - the **features in `feature_refs`** — their `name` and `description` say which requirement this
     item is one claim of. This is scope, not evidence: it tells you what to look up, and a claim you
     cannot support from the sources is reported as unsourced even when a feature row implies it;
   - the **Input Sources** from `meta`, skipping blanks silently: `uarch` (URL — Notion tools for a
     Notion URL, else WebFetch), `ref_model` (local path — read the code), `csr` (local .xlsx).
   Nothing else in the plan counts: not `phase`, not neighbouring items, not testcases.
6. **Write each field from the sources.** Where they are silent, say only what the row's own name and
   its features already imply — never invent a signal name, register field, encoding or numeric limit
   no source states, and never borrow one from a sibling item. **List every unsourced row in the
   report.**
7. **Keep the three consistent.** The oracle must be able to decide the description, and the report
   must name what the oracle found. If the description you can defend is weaker than the title claims,
   write the weaker one and say so — a row that overstates its own check is worse than a thin one.
8. **Write nothing else.** No `features[]`, no `testcases[]`, no new rows, no cards, no `judged_by`,
   `phase`, `status`, `implemented`, `notes`, `feature_refs`, no id renumbering. If a row needs more
   than these three fields, that is `vplan_audit`'s job — mention it in the report.
9. **Write and verify.** Re-serialize the data block (indent 2), read the file back, and assert:
   - it parses, and `features[]` / `items[]` / `testcases[]` / `suggestions[]` / `audits[]` lengths are
     unchanged, and `features[]` is byte-identical to before;
   - every row you touched has the fields you meant to fill, and no `oracle`/`report` you did not write
     has changed;
   - **every other field of every row is byte-identical**, and for descriptions, the text **above** the
     marker too — abort rather than save if anything else moved;
   - no row you touched is `finalized`, and no description holds two markers.

```python
MARK = '=== AI ==='

def human_half(desc):                        # what the user owns: everything above the first marker
    return (desc or '').split(MARK)[0].rstrip('\n')

def compose(desc, mine):                     # their text, the marker, then mine
    top = human_half(desc)
    return (top + '\n' if top else '') + MARK + '\n' + mine

def scrub(doc, touched):                     # touched = {3, 7, ...} — indices into items[]
    import copy; c = copy.deepcopy(doc)
    for idx in touched:
        it = c['items'][idx]
        it['description'] = human_half(it.get('description'))
        it['oracle'] = ''; it['report'] = ''          # compare everything EXCEPT what you may write
    return c
assert scrub(after, touched) == scrub(before, touched), 'refusing to save: something else changed'
assert after['features'] == before['features'], 'features are another skill\'s business'
assert all(after['items'][i]['description'].count(MARK) == 1 for i in touched)
assert all(after['items'][i].get('status') != 'finalized' for i in touched)
# an oracle or report you did not write must come back untouched
assert all(before['items'][i][f] in ('', after['items'][i][f]) for i in touched for f in ('oracle','report'))
```

10. **Report**: how many items were filled and which of the three fields each got; which rows were
    skipped and why (finalized, no name, no `judged_by`); which had user text you wrote under or an
    oracle/report you left alone; which features scoped each row; which rows had no source backing;
    and the reminder to **reload the tab**.

## Rules that outlive this skill

- Never edit above the marker, and never overwrite an `oracle` or `report` that already says something.
  If the user's text disagrees with the source, say so under the marker or leave it to `vplan_audit`.
- A `finalized` row is closed. Not "probably fine to touch" — closed.
- One item, one claim. If the sources describe two things that can fail independently, do not write a
  description that covers both — report that the row should be split, and leave it.
- Consistency across the table matters as much as each row: reuse the family's wording rather than
  inventing a new phrasing for the same kind of check. Two rows that say the same thing differently
  read as two different rules.
- No source, no specifics: a modest claim beats a confident invention.
- **Distinguish a specification from an open question.** A source carries both: sections that state how
  the design behaves, and lists of things the designer still means to decide — `추가 고민사항`,
  `앞으로 고민 해야할것`, `코드 변경사항`, red text, and any sentence ending in 확인하기 / 고민 / ?? /
  TBD. Never write an open question as a requirement; say in the row that it is unsettled instead.
- **The quote must support the sentence it sits under.** A quote taken from a different paragraph than
  the claim is a fabrication with a citation attached.
