---
name: vplan_fill_description
description: Fill in the Description of vplan rows that have a name but no description, grounded in the plan's Input Sources. Use when the user says "vplan_fill_description <IP>", "<IP> description 채워줘", "제목만 써놨으니 설명 채워줘", or asks to flesh out feature / verification-item descriptions in a vplan.
---

# vplan_fill_description

The user writes the titles; this skill writes the descriptions. It is the one skill allowed to write
into `features[]` / `items[]` directly — and only into `description`, never another field.

Two rules decide what it may touch:

- **`status: "finalized"` is off limits.** A finalized Definition is a decision; leave the row exactly
  as it is and say in the report that you skipped it.
- **Any other row is fair game, even one that already has text.** You never overwrite what the user
  wrote: their text stays where it is, and yours goes **below a marker line**, so the two hands are
  always distinguishable.

```
<whatever the user already wrote — untouched>
=== AI ===
- your line
- your second line
```

The marker is exactly `=== AI ===` on a line of its own (`AI_MARK` in the renderer, which puts an
"AI 채움" badge beside the Description label whenever a description contains it). On a re-run, replace
everything **from the marker down** with your new text — never stack a second marker, never leave two
AI sections in one description. A row with no text at all gets the marker too, as its first line.

Read the schema SSOT first: `$KIT/CLAUDE.md`, where `KIT=$(cat ~/.vplan-kit/kit-path)` is the vplan-kit
clone (missing pointer ⇒ the kit was never installed — tell the user to run `./install.sh`).
Plans live at `~/vplans/vplan_<IP>.html`.

## What a good description says

**Short.** One or two sentences, drawn from the Input Sources — not a restatement of the name, not an
essay. A description answers what must be true:

- **feature** — what the design does and what "correct" means for it.
- **item** — the judgeable claim: the condition, the expected behavior, how it is observed. If `oracle`
  is empty, say what the result is compared against here, but do **not** write into `oracle` — report it.

**`name` and `category` together decide where to look**, and the category sets the shape of the sentence:

| category | read for it | the description states |
|---|---|---|
| `command` | the command / opcode tables and their response rules in the MAS | what the command does, what comes back, and when it does not |
| `behavior` | the operation-flow and corner-case sections; the ref-model's logic | the trigger, the resulting behavior, and the boundary that makes it wrong |
| `parameter` | the CSR/SFR sheet and parameter tables | the field, its legal values or reset value, and what depends on it |

A row whose category is blank is still fair game — take the name's own wording as the search key, and
say in the report that its category was empty.

Language follows the row's own name — Korean name, Korean description; English name, English one; and
a mixed name keeps the source's technical terms as they are. That is the only thing the plan's own text
decides: **the content comes from the sources, never from other rows.** Keep the vocabulary of the
sources — a signal or register named in the MAS is named the same way here.

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

4. **Pick the rows to fill**: every row in `features[]` and `items[]` whose `name` is non-empty and
   whose `status` is not `finalized` — with or without an existing description. A row with no name is
   not ready, and a finalized row is closed; skip both and say so. If nothing qualifies, stop and
   report that.
5. **Read the Input Sources** from `meta`, skipping blanks silently: `uarch` (URL — Notion tools for a
   Notion URL, else WebFetch), `ref_model` (local path — read the code), `csr` (local .xlsx). Search
   them per row by **name + category** (the table above says which source a category points at).
   **Those three are the whole input.** Do not lean on the plan's surroundings — not the row's phase,
   not what it links to, not what neighbouring rows say. A description must be defensible from the
   sources alone, and a plan is not evidence about the design: an inference drawn from a sibling row
   inherits that row's mistakes and reads as if the source had said it.
6. **Write each description from the sources where they cover the row**, and keep it to one or two
   sentences. Where the sources are silent, say only what the row's own name and category already
   imply must hold — never invent a signal name, register field, or numeric limit no source states,
   and never borrow one from another row. **List every unsourced row in the report.** Never write a
   description that only repeats the name, and never leave a placeholder like "TBD" — skip the row
   instead.
7. **Write below the marker, never over the user's text.** Split the existing description at the first
   `=== AI ===`: everything above it is theirs and must come back byte-identical; everything below is
   your own previous run, to be replaced. Then join `their text` + `\n` + `=== AI ===` + `\n` + your
   new lines (drop the leading newline when their half is empty).
8. **Write nothing else.** No new rows, no `suggestions[]` / `audits[]` cards, no `oracle`, `category`,
   `phase`, `status`, `notes`, no id renumbering. If a row needs more than a description, that is
   `vplan_audit`'s job — mention it in the report.
9. **Write and verify.** Re-serialize the data block (indent 2), read the file back, and assert:
   - it parses, and `features[]` / `items[]` / `testcases[]` / `suggestions[]` / `audits[]` lengths are
     unchanged;
   - every row you filled now has a non-empty description;
   - **every other field of every row is byte-identical to before**, and for the rows you touched, the
     text **above** the marker is byte-identical too — abort rather than save if anything else moved;
   - no row you touched has `status: "finalized"`, and no description holds two markers.

```python
MARK = '=== AI ==='

def human_half(desc):                        # what the user owns: everything above the first marker
    return (desc or '').split(MARK)[0].rstrip('\n')

def compose(desc, mine):                     # their text, the marker, then mine
    top = human_half(desc)
    return (top + '\n' if top else '') + MARK + '\n' + mine

# the check that matters: only the AI half of the rows you touched moved
def scrub(doc, touched):                     # touched = {('features', 3), ('items', 0), ...}
    import copy; c = copy.deepcopy(doc)
    for arr, idx in touched:
        c[arr][idx]['description'] = human_half(c[arr][idx].get('description'))
    return c
assert scrub(after, touched) == scrub(before, touched), 'refusing to save: something else changed'
assert all(after[a][i]['description'].count(MARK) == 1 for a, i in touched)
assert all(after[a][i].get('status') != 'finalized' for a, i in touched)
```

10. **Report**: how many descriptions were written per table, which rows were skipped and why
    (finalized, no name), which ones already had user text you wrote under, which had no source
    backing them or no category, and the reminder to **reload the tab**.

## Rules that outlive this skill

- Never edit above the marker. What the user wrote is theirs even when it is wrong — if it disagrees
  with the source, say so under the marker (or leave it to `vplan_audit`), do not correct it in place.
  Reading their half is for not repeating it, never for sourcing your own.
- A `finalized` row is closed. Not "probably fine to touch" — closed.
- Everything you write sits under the marker, so an unmarked line is a human's by definition.
- This skill's licence to write rows is exactly one field wide. Everything else still goes through the
  suggestion / audit inbox.
- No source, no specifics: a modest description beats a confident invention.
