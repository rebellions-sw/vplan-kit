---
name: create_vplan
description: Start a verification plan for an IP from vplan_template.html. Use when the user says "create_vplan <IP>", "make a vplan for <IP>", or "<IP> vplan 만들어줘".
---

# create_vplan

File plumbing around a vplan document's data block. Never hand-edit the rendered DOM — the only thing
that changes is the JSON inside `<script id="vplan-data" type="application/json">`.

**Plans live in `~/vplans/`**, alongside runtime copies of the template and `CLAUDE.md` (the schema
SSOT) that the installer put there. Read that `CLAUDE.md` before touching any data block.

## How Save works (no dialogs)

The page's **Save** never opens a file picker: it POSTs the serialized document to the local
**vplan-save helper** (`http://127.0.0.1:8790/save?name=vplan_<IP>.html`, launchd label
`com.vplan.save`), which writes `~/vplans/vplan_<IP>.html` in place. The helper is localhost-only and
refuses web origins, path escapes, unknown plan names, and non-vplan bodies. **Save As** writes a
dated **snapshot** — `meta.snapshot = {at}` baked into the copy — which reopens read-only: no
Save/Save As/Load buttons (the stamp sits in their place), no editing. Originals carry a **Load**
button that pulls a snapshot's data back onto the screen (marker stripped, marked dirty; Save makes
it real). If the helper is down, Save falls back to downloading a copy into `~/Downloads`; recover
those by running `zsh ~/vplans/.kit/vplan-sync.sh` **in a user shell** (a launchd agent cannot read
`~/Downloads` — macOS TCC denies it silently).

## `create_vplan <IP name>` — start a plan

1. Refuse politely if `~/vplans/vplan_template.html` is missing (run the kit's `install.sh` first),
   or if `~/vplans/vplan_<IP>.html` already exists (do not overwrite someone's plan; offer to open it
   or to pick another name).
2. Copy the template → `~/vplans/vplan_<IP>.html`.
3. In the copy, set in the data block:
   - `meta.ip_name` = the IP name exactly as given
   - `meta.last_updated` = today, `YYYY-MM-DD`
   - `meta.owner` = the user's name if you know it, otherwise leave empty
   Leave everything else as the template has it (`$enums`, `coverage.code`, empty arrays).
4. Verify before reporting: the file parses as JSON, `meta.ip_name` reads back, and the arrays are
   still empty. Then tell the user the path and that Input Source (uArch / Ref-Model / CSR) is theirs
   to fill. Keep the report short — no save instructions needed: they open it in Chrome and Save
   just works.

```bash
# the shape of the edit — do it with a script, not by hand
python3 - <<'PY'
import json, datetime, os
ip   = 'ATU'                                   # ← the argument
home = os.path.expanduser('~/vplans')
src, dst = os.path.join(home, 'vplan_template.html'), os.path.join(home, f'vplan_{ip}.html')
s = open(src, encoding='utf-8').read()
tag = '<script id="vplan-data" type="application/json">'
i = s.rindex(tag); j = s.index('</script>', i)
d = json.loads(s[i+len(tag):j])
d['meta']['ip_name'] = ip
d['meta']['last_updated'] = datetime.date.today().isoformat()
open(dst, 'w', encoding='utf-8').write(s[:i+len(tag)] + '\n' + json.dumps(d, ensure_ascii=False, indent=2) + '\n' + s[j:])
PY
```

## After the template's code changes

A plan file carries the page code it was saved with, so a template update does not reach existing
plans on its own — and an open tab keeps running old code until reloaded. To upgrade a plan:
transplant its data block into a fresh copy of the template (read the plan's JSON, write it into the
template's data block, save over the plan file), then tell the user to reload the tab. Never
regenerate a plan from the template alone — that throws its content away. Never "upgrade" a snapshot
(`meta.snapshot` set): snapshots are frozen exports.

## Before you edit an existing plan

Ask the user to Save first. Their save lands on `~/vplans/vplan_<IP>.html`, so once they have saved,
the file is what is on their screen — but until they do, their unsaved rows exist only in the open
tab, and your edit to the file on disk is gone the moment they press Save.

## Rules that outlive this skill

- IDs (`F##`, `VI###`) are stable primary keys. Never renumber them here — the page's `Refresh`
  button does that, and rewrites every reference in the same pass.
- `suggestions[]` is an inbox: you may append to it, never write into `features[]` / `items[]` on the
  strength of a suggestion. The user accepts cards in the UI.
- `~/vplans/CLAUDE.md` is the schema's SSOT. Read it before touching the data block.
