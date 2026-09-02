# vplan-kit

단일 HTML 파일 기반 검증 계획(vplan) 편집기 + Claude Code 스킬 세트.
플랜 하나 = HTML 파일 하나: UI·데이터·렌더러가 한 파일이라 브라우저에서 바로 열리고,
Claude Code가 데이터 블록을 읽고 써서 플랜 생성과 gap analysis를 도와줍니다.

```
vplan_template.html   # the product: editable UI + its own data (single file)
CLAUDE.md             # schema + editing rules — the SSOT agents read first
skills/               # Claude Code skills: create_vplan, suggest_vplan, audit_vplan
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
| plan home | `~/vplans/` | every `vplan_<IP>.html` lives here — plans only, nothing else |
| `create_vplan` skill | `~/.claude/skills/` | `/create_vplan <IP>` — start a plan from the template |
| `suggest_vplan` skill | `~/.claude/skills/` | `/suggest_vplan <IP>` — gap analysis → suggestion cards |
| `audit_vplan` skill | `~/.claude/skills/` | `/audit_vplan <IP>` — 기존 행 검토 → 누락/불충분/미스매치 카드 |
| save helper | launchd `com.vplan.save` | localhost process that makes the page's Save dialog-free |
| runtime | `~/.vplan-kit/` | helper + recovery scripts, and `kit-path` pointing back at this clone |

스킬은 어느 디렉토리에서 실행해도 `~/.vplan-kit/kit-path`로 이 클론을 찾아 템플릿을 읽습니다 —
템플릿과 CLAUDE.md는 복사되지 않으므로 `git pull`이 곧 업데이트입니다. 클론을 옮겼다면
`./install.sh`만 다시 실행하세요.

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

`/audit_vplan <IP>`는 반대 방향입니다 — **이미 적힌 행**을 같은 소스에 비추어 판정해서
`누락 / 불충분 / 미스매치` 카드를 **Audit from AI** 패널에 쌓습니다. Accept를 누르면 카드가 가리키는
행이 그 자리에서 수정됩니다(`missing`만 새 행 추가).

Nothing an agent writes enters the plan on its own. `suggestions[]`/`audits[]` are inboxes; the Accept
button is the only path into the plan.

## Saving, snapshots, sharing

- **Save (Cmd+S)** — no dialog, ever: the page posts itself to the local helper, which overwrites
  `~/vplans/vplan_<IP>.html` in place. If the helper is down the save falls back to a download;
  recover those with `zsh ~/.vplan-kit/vplan-sync.sh` (헬퍼 상태: `curl -s 127.0.0.1:8790/ping`).
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

Rules and schema live in [CLAUDE.md](CLAUDE.md). A `git pull` is enough for new plans to pick up a
template change (skills read the clone directly); re-run `./install.sh` only when the skills, the
helper, or the clone's location changed. Existing plans keep the page code they were saved with —
ask Claude Code to transplant their data block into the new template.
