# vplan-kit

단일 HTML 파일 기반 검증 계획(vplan) 편집기 + Claude Code 스킬 세트.
플랜 하나 = HTML 파일 하나: UI·데이터·렌더러가 한 파일이라 브라우저에서 바로 열리고,
Claude Code가 데이터 블록을 읽고 써서 플랜 생성과 gap analysis를 도와줍니다.

```
vplan_template.html   # the product: editable UI + its own data (single file)
CLAUDE.md             # schema + editing rules — the SSOT agents read first
skills/               # Claude Code skills: create_vplan, suggest_vplan
bin/                  # save helper + recovery script
install.sh            # one-shot setup (macOS)
test/                 # Playwright suite driving the real file in a real browser
```

## Install (macOS)

```bash
./install.sh
```

| what | where | role |
|---|---|---|
| plan home | `~/vplans/` | every `vplan_<IP>.html` lives here (+ template & CLAUDE.md copies) |
| `create_vplan` skill | `~/.claude/skills/` | `/create_vplan <IP>` — start a plan from the template |
| `suggest_vplan` skill | `~/.claude/skills/` | `/suggest_vplan <IP>` — gap analysis → suggestion cards |
| save helper | launchd `com.vplan.save` | localhost process that makes the page's Save dialog-free |

Connect the Notion (or Atlassian) MCP connector so Claude Code can reach the MAS.

## The loop

```
  Claude Code                          you, in the browser
  ───────────                          ───────────────────
  /suggest_vplan <IP>
      │  reads Input Sources (uArch MAS / ref-model / CSR)
      │  reads existing rows + past rejections
      ▼
  appends to suggestions[]  ──────►  카드마다 MAS 인용문 + 근거
                                         │
                                         ├─ 수락 → features[]/items[] 에 fresh ID로 추가
                                         └─ 거절 → 사유 기록
                                                     │
                                     Claude가 다음 실행 때 읽고 재제안하지 않음
```

Nothing an agent writes enters the plan on its own. `suggestions[]` is an inbox; the 수락 button is
the only path into the plan.

## Saving, snapshots, sharing

- **Save (Cmd+S)** — no dialog, ever: the page posts itself to the local helper, which overwrites
  `~/vplans/vplan_<IP>.html` in place. If the helper is down the save falls back to a download;
  recover those with `zsh ~/vplans/.kit/vplan-sync.sh` (헬퍼 상태: `curl -s 127.0.0.1:8790/ping`).
- **Save As (Cmd+Shift+S)** — writes a dated **snapshot**: a frozen, read-only copy that shows when
  it was saved where its buttons would be. **공유는 스냅샷 파일로** — 받는 사람은 아무 브라우저에서
  열립니다. `file://` URL은 링크가 아니므로 파일 자체를 첨부해서 보내세요.
- **Load** (originals only) — pull a snapshot's data back onto the screen; press Save to make it real.

**One discipline point:** Save before you ask Claude Code for anything, and reload the tab after it
edits. Save puts your screen on disk; reload puts the disk back on your screen.

## Reviewing a suggestion

Each card carries the verbatim source sentence that motivated it and a link to that section. Check
the quote against the source — that is the point of the card, and it takes seconds.

- **수락** — copies the payload in with a fresh ID. Edit the fields on the card first if you want.
- **거절** — always pick a label (`hallucinated`/`duplicated`/`waived`) and give a reason. It is what
  stops the same suggestion coming back next month.

Scope suggestion runs tight — a section or a source at a time beats "read everything and list
features": section-scoped runs are the single biggest lever on quality. After accepting, run
**Lint** — a newly accepted P0 feature with no testcase is reported as an error; that is the next
piece of work, not a bug in the plan.

## Development

```bash
npm install && npx playwright install chromium && npm test
```

Rules and schema live in [CLAUDE.md](CLAUDE.md). Template updates reach users via `./install.sh`
re-run; existing plans need their data block transplanted into the new template (ask Claude Code).
