---
name: vplan_testcase_group
description: Group a vplan's features into testcases — every feature covered, and features that one stimulus stream can drive together in one testcase. Use when the user says "vplan_testcase_group <IP>", "<IP> testcase 묶어줘", "testcase 정의해줘", "uncovered feature 없게 testcase 만들어줘", or asks which testcases the plan needs. Writes testcases[] only.
---

# vplan_testcase_group

The features say what the DUT must do; the testcases say what the testbench will actually run. This
skill turns the first list into the second under two rules the user set:

1. **Every feature is covered.** A feature no testcase links is a hole in the plan — the plan's own
   lint says so in its `uncovered features` section, and that section must come back empty.
2. **One stimulus, one testcase.** Features that the same stream of traffic exercises belong together;
   splitting them into a testcase each buys nothing and costs a regression slot.

It writes **`testcases[]` and nothing else**. `features[]` and `items[]` are read-only here — if the
grouping shows a feature is wrong, say so in the report and leave it for the user or `vplan_audit`.

Read the schema SSOT first: `$KIT/CLAUDE.md`, where `KIT=$(cat ~/.vplan-kit/kit-path)`.
Plans live at `~/vplans/vplan_<IP>.html`.

## What may be written

| | |
|---|---|
| **new rows** | `id`, `name`, `type`, `phase`, `status`, `implemented`, `feature_refs[]`, `description`, `uvm.sequences[]`, `tb_gen_hints` |
| **existing rows** | `feature_refs[]` — **additive only**, and only on rows whose `status` is not `finalized` |
| **never** | any other field of an existing row, any row's `item_refs` (verification items are **derived** — `tcItems()` unions the items of the linked features; storing them would let the table and lint disagree), `features[]`, `items[]`, `coverage`, `comments[]`, the inboxes |

A `status: "finalized"` testcase is a decision the user already made: not re-grouped, not re-linked, not
renamed. New rows are born `status: "draft"`, `implemented: "todo"` — the skill proposes a test, it does
not certify one.

## What "one stimulus" means

Two features group when the same running sequence set drives both without either changing the setup:

- the same **agent / interface and direction** drives them (the row titles carry this — `[expd REQ to IP]`,
  `[Watchdog]`, an agent name in an existing testcase's `uvm.sequences`);
- the same **traffic kind** reaches them (a fetch stream, an invalidation stream, a CSR access stream);
- they need the same **DUT configuration and mode** — a feature that needs a register programmed
  differently is a different test, however similar it reads.

Split them when any of these is true, even if the interface matches:

- a feature needs **error or fault injection** that would mask the others' checks;
- a feature needs a **specific ordering or a rare collision** a random stream cannot be relied on to hit;
- a feature is judged by **`test/seq`** — the sequence itself is the checker, so it owns its testcase;
- a feature is about a **mode the rest of the stream must not be in** (single vs multi-master, a drained
  vs a full queue).

Two failure shapes to check yourself against before writing: a testcase naming more than about six
features is usually a kitchen sink rather than a stimulus, and a plan where testcases and features come
out one-to-one means the grouping never happened.

**The derived-items trap.** Because the items shown under a testcase are the union of its features'
items, linking a broad feature drags in items the test's stimulus never produces — the testcase then
claims a check it does not run. When you hit this, do not quietly link it anyway and do not edit the
feature: **report that the feature covers more than one stimulus and should be split**, and group what
is left.

## Procedure

1. **Argument**: the IP name → `~/vplans/vplan_<IP>.html`.
2. **Ask the user to Save and confirm before you edit**, and to **reload the tab** after — their open
   tab overwrites the file on its next Save.
3. Parse the data block (`rindex` of the tag):

```python
import json, os
tag = '<script id="vplan-data" type="application/json">'
plan = os.path.expanduser('~/vplans/vplan_ATU.html')
s = open(plan, encoding='utf-8').read()
i = s.rindex(tag); j = s.index('</script>', i)
d = json.loads(s[i+len(tag):j])
```

4. **Read, in this order**: every named `features[]` row (name, description, phase); the `items[]` linked
   to each feature (their `judged_by` sets the type, their `name` prefixes say which interface the
   stimulus rides); the existing `testcases[]` — what they already cover, and the house conventions for
   `name` (`tc_<snake_case>`), agent names and `seq_class` names. The Input Sources are optional here
   and worth opening only when a feature's description does not say enough to place it.
5. **Cover first, then group.** List the features no existing testcase links. Put each into an existing
   non-finalized testcase whose stimulus already matches, or into a new one with the features that share
   its stimulus. Never create a second testcase for something an existing row already exercises.
6. **Fill each new row:**
   - `type` — `directed` when any derived item is judged by `test/seq` or the test turns on one exact
     ordering, otherwise `constrained random`. Never assign `full random`: that is the user's call.
   - `phase` — the earliest phase among its features (`pre-Alpha` < `Alpha` < `Beta`). A test is due when
     the first thing it covers is due.
   - `description` — what the test drives and what its passing shows, in the plan's voice: two or three
     sentences, present tense, no "TBD", no restating the title.
   - `uvm.sequences[]` — `{agent, seq_class, params}`, **reusing agent names that already appear in the
     plan**. If the plan has no testcase to borrow agent names from, leave `uvm` out and say so in the
     report; an invented agent name is a testbench nobody is building.
   - `tb_gen_hints` — the things a generator would otherwise get wrong: the corner to include, the state
     to reach first, what must not be waited on.
   - `id` — the next free `TC###`. Refresh renumbers anyway; do not renumber anything yourself.
7. **Write and verify.** Re-serialize (indent 2), read back, and assert:

```python
assert after['features'] == before['features']          # the other tables are not this skill's business
assert after['items']    == before['items']
assert after.get('coverage') == before.get('coverage') and after.get('comments') == before.get('comments')

old = {t['id']: t for t in before['testcases']}
for t in after['testcases']:
    o = old.get(t['id'])
    if o is None:                                       # a new row
        assert t['feature_refs'] and 'item_refs' not in t
        assert t['status'] == 'draft' and t['implemented'] == 'todo'
        continue
    assert o.get('status') != 'finalized' or t == o     # finalized rows are untouchable
    assert t['feature_refs'][:len(o['feature_refs'])] == o['feature_refs']   # additive, order kept
    assert {k: v for k, v in t.items() if k != 'feature_refs'} == \
           {k: v for k, v in o.items() if k != 'feature_refs'}               # nothing else moved

ids = [t['id'] for t in after['testcases']]
assert len(ids) == len(set(ids))
fids = {f['id'] for f in after['features']}
linked = {r for t in after['testcases'] for r in t['feature_refs']}
assert linked <= fids                                   # no link to a row that does not exist
uncovered = {f['id'] for f in after['features'] if f.get('name')} - linked   # rule 1, and it is reported
```

8. **Report**: every testcase you added or extended, the features under it and **the one stimulus that
   justifies the grouping**; the `type` and `phase` you chose and why; any feature still uncovered and
   the reason (a feature that needs a decision first is reported, never covered by a vague test); any
   feature you recommend splitting because it spans two stimuli; the reminder to **reload the tab and
   press Refresh** so ids renumber.

## Rules that outlive this skill

- Coverage is the floor, not the goal: a testcase that links a feature it does not actually exercise is
  worse than an uncovered feature, because lint goes quiet and the hole stays.
- Group by what the testbench *drives*, never by what the table looks like — features sharing a
  prefix, a category or a spec chapter are not thereby one test.
- Never remove or re-point an existing link. A grouping that needs a link taken away is a proposal for
  the user, not an edit.
- One testcase, one reason to fail. If you cannot say in a sentence what a test would mean by failing,
  it is two tests.
- Say when a feature is not testable yet. An honest gap in the report beats a testcase written around
  a question nobody has answered.
