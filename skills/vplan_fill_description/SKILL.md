---
name: vplan_fill_description
description: Fill in the Description of vplan rows that have a name but no description, grounded in the plan's Input Sources. Use when the user says "vplan_fill_description <IP>", "<IP> description 채워줘", "제목만 써놨으니 설명 채워줘", or asks to flesh out feature / verification-item descriptions in a vplan.
---

# vplan_fill_description

The user writes the titles; this skill writes the descriptions. It is the one skill allowed to write
into `features[]` / `items[]` directly — and only into a `description` that is **empty**. Text a human
already wrote is never touched, and no other field is ever written.

Read the schema SSOT first: `$KIT/CLAUDE.md`, where `KIT=$(cat ~/.vplan-kit/kit-path)` is the vplan-kit
clone (missing pointer ⇒ the kit was never installed — tell the user to run `./install.sh`).
Plans live at `~/vplans/vplan_<IP>.html`.

## What a good description says

Not a restatement of the name — the name is already there. A description answers **what must be true**:

- **feature** — what the design does, and what "correct" means for it. One or two sentences, concrete
  enough that someone can tell a passing run from a failing one.
- **item** — the single judgeable claim: the condition, the expected behavior, and how it is observed.
  If the row's `oracle` is empty, the description still says what the result is compared against, but
  do **not** write into `oracle` — say so in the report and let the user fill it.

Match the plan's own voice: if existing descriptions are Korean, write Korean; if English, English; if
the plan is empty, follow the language of the row names. Keep to the vocabulary of the sources — a
signal or register named in the MAS is named the same way here.

## The run

1. **Refuse politely** if `~/vplans/vplan_<IP>.html` does not exist (offer `vplan_create <IP>`), or if
   `meta.snapshot` is set — snapshots are frozen exports.
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

4. **Pick the rows to fill**: every row in `features[]` and `items[]` whose `name` is non-empty and whose
   `description` is empty or whitespace. A row with no name is not ready — skip it and say so. If nothing
   qualifies, stop and report that; do not "improve" descriptions that already exist.
5. **Read the Input Sources** from `meta`, skipping blanks silently: `uarch` (URL — Notion tools for a
   Notion URL, else WebFetch), `ref_model` (local path — read the code), `csr` (local .xlsx). Also read
   the row's own context — its category, phase, `feature_refs`, and the descriptions of neighbouring
   rows — so the wording lands consistently.
6. **Write each description from the sources where they cover the row.** Where they do not, still draft
   from the row name and the surrounding plan, but keep it modest — say what the name implies must hold,
   never invent a signal name, register field, or numeric limit that no source states. **List every
   unsourced row in the report** so the user knows which ones to check. Never write a description that
   only repeats the name, and never leave a placeholder like "TBD" — skip the row instead.
7. **Write nothing else.** No new rows, no `suggestions[]` / `audits[]` cards, no `oracle`, `category`,
   `phase`, `status`, `notes`, no id renumbering. If a row needs more than a description, that is
   `vplan_audit`'s job — mention it in the report.
8. **Write and verify.** Re-serialize the data block (indent 2), read the file back, and assert:
   - it parses, and `features[]` / `items[]` / `testcases[]` / `suggestions[]` / `audits[]` lengths are
     unchanged;
   - every row you filled now has a non-empty description;
   - **every other field of every row is byte-identical to before** — diff the before/after JSON with
     the filled descriptions removed, and abort rather than save if anything else moved.

```python
# the check that matters: nothing but the empty descriptions moved
def scrub(doc, filled):                      # filled = {('features', 3), ('items', 0), ...}
    import copy; c = copy.deepcopy(doc)
    for arr, idx in filled: c[arr][idx]['description'] = ''
    return c
assert scrub(after, filled) == before, 'refusing to save: something other than the descriptions changed'
```

9. **Report**: how many descriptions were filled per table, which rows were skipped and why (no name,
   already described), which ones had no source backing them, and the reminder to **reload the tab**.

## Rules that outlive this skill

- An empty description is an invitation; a written one is the user's. Never overwrite, never "polish".
- This skill's licence to write rows is exactly one field wide. Everything else still goes through the
  suggestion / audit inbox.
- No source, no specifics: a modest description beats a confident invention.
