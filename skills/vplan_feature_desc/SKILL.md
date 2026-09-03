---
name: vplan_feature_desc
description: Write the Description of a vplan's FEATURE rows from the plan's Input Sources (uArch / Ref-Model / CSR). Use when the user says "vplan_feature_desc <IP>", "<IP> feature description 채워줘", "제목만 써놨으니 설명 채워줘", or asks to flesh out feature descriptions in a vplan. Not for verification items.
---

# vplan_feature_desc

The user writes the feature titles; this skill writes their descriptions. It is the one skill allowed
to write into `features[]` directly — and only into `description`, never another field. **Features
only**: `items[]` is out of scope here, untouched, and gets its own skill later.

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

What the design does, and what "correct" means for it — concrete enough that someone can tell a
passing run from a failing one.

**`name`, `category` and `related_refs` decide where to look**, and the category sets the shape of
the sentence:

| category | read for it | the description states |
|---|---|---|
| `command` | the command / opcode tables and their response rules in the MAS | what the command does, what comes back, and when it does not |
| `behavior` | the operation-flow and corner-case sections; the ref-model's logic | the trigger, the resulting behavior, and the boundary that makes it wrong |
| `parameter` | the CSR/SFR sheet and parameter tables | the field, its legal values or reset value, and what depends on it |

A row whose category is blank is still fair game — take the name's own wording as the search key, and
say in the report that its category was empty.

**`related_refs` narrows the search to a command.** A behavior row linked to a command feature is
about that command's flow, so resolve the link to the command row's **name** and read the sources
under that command — "handling invalidated request" alone is ambiguous, the same words under the
Invalidation command are not. Take the linked row's **identity**, never its text: the content still
comes from the sources, so a wrong sibling description cannot leak into this one. Say in the report
which command each description was scoped to.

Language follows the row's own name — Korean name, Korean description; English name, English one; and
a mixed name keeps the source's technical terms as they are. That, and which command a link points at,
are the only things the plan decides: **the content comes from the sources, never from other rows.** Keep the vocabulary of the
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

4. **Pick the rows to fill**: every row in **`features[]`** whose `name` is non-empty and whose
   `status` is not `finalized` — with or without an existing description. A row with no name is not
   ready, and a finalized row is closed; skip both and say so. If nothing qualifies, stop and report
   that. `items[]` is not yours: never read it for content, never write to it.
5. **Read the Input Sources** from `meta`, skipping blanks silently: `uarch` (URL — Notion tools for a
   Notion URL, else WebFetch), `ref_model` (local path — read the code), `csr` (local .xlsx). Search
   them per row by **name + category** (the table above says which source a category points at).
   `related_refs` joins them as a search key: resolve each id to that command row's name and read the
   sources under that command. **That is the whole input** — the row's name, category and links, plus
   the sources themselves. Nothing else in the plan counts: not the row's phase, not what neighbouring
   rows say, and not the linked row's own description. A description must be defensible from the
   sources alone, because a plan is not evidence about the design: an inference drawn from a sibling
   row's text inherits its mistakes and reads as if the source had said it.
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
8. **Write nothing else.** No `items[]`, no new rows, no `suggestions[]` / `audits[]` cards, no
   `category`, `phase`, `status`, `notes`, no id renumbering. If a row needs more than a description,
   that is `vplan_audit`'s job — mention it in the report.
9. **Write and verify.** Re-serialize the data block (indent 2), read the file back, and assert:
   - it parses, and `features[]` / `items[]` / `testcases[]` / `suggestions[]` / `audits[]` lengths are
     unchanged, and `items[]` is byte-identical to before;
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
def scrub(doc, touched):                     # touched = {3, 7, ...} — indices into features[]
    import copy; c = copy.deepcopy(doc)
    for idx in touched:
        c['features'][idx]['description'] = human_half(c['features'][idx].get('description'))
    return c
assert scrub(after, touched) == scrub(before, touched), 'refusing to save: something else changed'
assert after['items'] == before['items'], 'items are another skill\'s business'
assert all(after['features'][i]['description'].count(MARK) == 1 for i in touched)
assert all(after['features'][i].get('status') != 'finalized' for i in touched)
```

10. **Report**: how many feature descriptions were written, which rows were skipped and why
    (finalized, no name), which ones already had user text you wrote under, which command each
    `related_refs` link scoped a description to, which had no source backing them or no category,
    and the reminder to **reload the tab**.

## Rules that outlive this skill

- Never edit above the marker. What the user wrote is theirs even when it is wrong — if it disagrees
  with the source, say so under the marker (or leave it to `vplan_audit`), do not correct it in place.
  Reading their half is for not repeating it, never for sourcing your own.
- A `finalized` row is closed. Not "probably fine to touch" — closed.
- Everything you write sits under the marker, so an unmarked line is a human's by definition.
- This skill's licence to write rows is exactly one field wide, on one table. Everything else still
  goes through the suggestion / audit inbox.
- No source, no specifics: a modest description beats a confident invention.
