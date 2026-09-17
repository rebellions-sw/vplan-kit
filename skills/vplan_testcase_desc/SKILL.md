---
name: vplan_testcase_desc
description: Write a vplan TESTCASE's Description / Sequences / TB generation hints, taking its mapped features, its derived verification items and its type as fixed, confirmed input. Use when the user says "vplan_testcase_desc <IP>", "<IP> testcase 설명 채워줘", "testcase 시퀀스 채워줘", or asks to flesh out testcases whose features and type are already decided. Does not group or re-link testcases — that is vplan_testcase_group.
---

# vplan_testcase_desc

`vplan_testcase_group` decides *which* features a test covers. This skill writes *what the test is* —
and it treats the grouping as settled. Three things are **confirmed input, never output**:

| given | what it tells you |
|---|---|
| `feature_refs[]` | the scope: exactly what this test must exercise, and nothing else |
| the derived **verification items** (`tcItems()` — the union of those features' items) | the checks that must be *reachable*: the stimulus has to produce the traffic each oracle compares |
| `type` (`directed` / `constrained random` / `full random`) | the shape of the stimulus, so the sequences follow from it rather than argue with it |

Disagree with any of them in the report, never in the data. If the features are wrong the user re-links
them or re-runs `vplan_testcase_group`; if the type is wrong the user changes it. A skill that "fixes"
its own inputs makes the plan unreviewable.

It writes **`testcases[]`, three fields wide**: `description`, `uvm.sequences[]`, `tb_gen_hints`.

- **`status: "finalized"` is off limits** — skip the row and say so.
- **`description`** follows the marker rule: the user's text stays, yours goes below `=== AI ===` on its
  own line, a re-run replaces everything from the marker down, and there is never a second marker. The
  Description label shows an "AI 채움" badge whenever the text contains it — features, items and
  testcases alike.
- **`uvm.sequences[]` and `tb_gen_hints`** carry no marker (a table and a hint line have nowhere to put
  one), so they are filled **only when empty** and never overwritten. A testcase that already has one
  sequence is a testcase the user started: leave the table alone and say so.

Read the schema SSOT first: `$KIT/CLAUDE.md`, where `KIT=$(cat ~/.vplan-kit/kit-path)`.
Plans live at `~/vplans/vplan_<IP>.html`.

## What the three fields say

**`description` — what this test builds and what passing it means.** Two or three sentences in the
plan's voice: the traffic it drives, the state it puts the DUT in, and what the run demonstrates.
Name the mechanism, not the feature list — a description that reads as "F10, F18을 검증한다" says
nothing the links do not already say. No "TBD", no restating the title.

**`uvm.sequences[]` — one row per driving agent**, `{agent, seq_class, params}`:

- `agent` **must be a name the plan already uses.** Read the other testcases' sequences and reuse them
  exactly; the plan's own lint flags agent names that differ by a keystroke, so `som_agent` next to
  `som_agt` is a defect you introduced. If the plan has no sequence to borrow a name from, leave `uvm`
  untouched and say so in the report — an invented agent is a testbench nobody is building.
- `seq_class` follows the house convention visible in the existing rows (`<if>_<what>_seq`).
- `params` is what makes this run different from the same sequence elsewhere: the randomization space,
  the fixed field, the ordering. One line, concrete.
- **Background traffic counts.** A test whose checks need responses coming back needs the responding
  agent's sequence listed too, not just the stimulus side.

**`tb_gen_hints` — what a generator would otherwise get wrong.** The state to reach before the
interesting part, the corner to include, what must *not* be waited on (a request that never answers),
the collision the stream has to actually hit. Not a restatement of the description, and not a checklist
of the items — the oracles live on the items.

## Type is the shape of the stimulus

- `directed` — one exact ordering, written step by step. The sequence itself is often the judge here
  (an item judged by `test/seq`), so `params` says what is fixed, not what is random.
- `constrained random` — a stream with the constraints named: what is randomized, what is pinned, and
  which weighting makes the interesting case likely instead of hoped for.
- `full random` — no ordering may be assumed; say what the randomization space is, and put anything the
  run must still guarantee into `tb_gen_hints` rather than into a constraint the type forbids.

## Procedure

1. **Argument**: the IP name → `~/vplans/vplan_<IP>.html`. An optional second argument is a testcase id
   or name — with it, only that row; without it, every row that qualifies.
2. **Ask the user to Save and confirm before you edit**, and to **reload the tab** afterwards.
3. Parse the data block (`rindex` of the tag):

```python
import json, os
tag = '<script id="vplan-data" type="application/json">'
plan = os.path.expanduser('~/vplans/vplan_ATU.html')
s = open(plan, encoding='utf-8').read()
i = s.rindex(tag); j = s.index('</script>', i)
d = json.loads(s[i+len(tag):j])
```

4. **Pick the rows**: `testcases[]` with a `name`, `status` not `finalized`, at least one `feature_ref`,
   and at least one of the three fields empty (or a `description` whose marker section is yours).
   A testcase with **no feature link has no scope** — skip it, and report it: it is
   `vplan_testcase_group`'s job, and the plan already lints it as an error.
5. **Read, in this order**: the linked `features[]` (name + description — this is the scope); their
   `items[]` (name prefixes say which interface and direction the traffic rides, `judged_by` says who
   watches, `oracle` says what must be observable); the row's `type` and `phase`; the other testcases,
   for agent names, `seq_class` conventions and house phrasing. Input Sources only when a feature's
   description does not say enough to write the stimulus.
6. **Write so every derived item is reachable.** Walk the items one by one and ask what traffic its
   oracle needs. An item no sequence you wrote can ever exercise is a finding, not something to paper
   over: report it as *unreachable under this grouping and type* and let the user re-link, split or
   re-type the testcase.
7. **Write nothing else.** Not `feature_refs`, not `item_refs` (derived — `tcItems()` unions the
   features' items), not `type`, `phase`, `status`, `implemented`, `name` or `id`, and not one field of
   `features[]` or `items[]`.
8. **Write and verify.** Re-serialize (indent 2), read back, and assert:

```python
MARK = '=== AI ==='
def human_half(desc): return (desc or '').split(MARK)[0].rstrip('\n')
def compose(desc, mine):
    top = human_half(desc)
    return (top + '\n' if top else '') + MARK + '\n' + mine

assert after['features'] == before['features'] and after['items'] == before['items']
old = {t['id']: t for t in before['testcases']}
assert [t['id'] for t in after['testcases']] == [t['id'] for t in before['testcases']]   # no row added or dropped
for t in after['testcases']:
    o = old[t['id']]
    assert o.get('status') != 'finalized' or t == o
    assert {k: v for k, v in t.items() if k not in ('description', 'uvm', 'tb_gen_hints')} == \
           {k: v for k, v in o.items() if k not in ('description', 'uvm', 'tb_gen_hints')}
    assert human_half(t.get('description')) == human_half(o.get('description'))          # their half is theirs
    assert str(t.get('description', '')).count(MARK) <= 1
    for f in ('uvm', 'tb_gen_hints'):                                                    # filled only when empty
        assert not o.get(f) or t.get(f) == o.get(f)
    assert 'item_refs' not in t
seqs = lambda doc: {q['agent'] for t in doc['testcases'] for q in (t.get('uvm') or {}).get('sequences', [])}
had = seqs(before)
assert not had or seqs(after) <= had          # borrow agent names, never coin one
```

9. **Report**: each testcase filled and which of the three fields it got; rows skipped and why
   (finalized, no features, already written); for each row the features and items you wrote against;
   any item **unreachable** under the given grouping and type; any place the given `type` fought the
   stimulus you had to write; and the reminder to **reload the tab**.

## Rules that outlive this skill

- The inputs are confirmed. Argue in the report; never edit `feature_refs`, `type` or the tables the
  items come from.
- A sequence list is a promise someone will write that sequence. Only agents the plan already names,
  only sequences this test really needs.
- The description says what the run *does*; the oracles say what passing means and live on the items.
  Do not copy the checks into the testcase — two copies of a check drift apart.
- Never overwrite a `uvm.sequences` table or a hint the user already wrote, even a thin one.
- A testcase you cannot write without inventing a mode, a register value or an agent is a testcase the
  plan is not ready for. Say that instead.
