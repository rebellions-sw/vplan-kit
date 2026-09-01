#!/bin/bash
# vplan-kit installer (macOS). Safe to re-run — it updates in place and never touches your plans.
#
# What it sets up:
#   ~/vplans/                       your plans live here (+ a copy of the template and CLAUDE.md)
#   ~/.claude/skills/create_vplan   Claude Code skill: start a plan from the template
#   ~/.claude/skills/suggest_vplan  Claude Code skill: gap analysis → suggestion cards
#   com.vplan.save (launchd)        localhost:8790 helper that makes the page's Save dialog-free
set -euo pipefail

KIT="$(cd "$(dirname "$0")" && pwd)"
PLANS="$HOME/vplans"
SKILLS="$HOME/.claude/skills"
AGENTS="$HOME/Library/LaunchAgents"
UID_NUM="$(id -u)"

echo "vplan-kit: installing from $KIT"

RUNTIME="$PLANS/.kit"

mkdir -p "$PLANS" "$RUNTIME" "$SKILLS" "$AGENTS" "$HOME/Library/Logs"

# runtime copies of the template and the schema SSOT (plans are never touched)
cp "$KIT/vplan_template.html" "$PLANS/vplan_template.html"
cp "$KIT/CLAUDE.md" "$PLANS/CLAUDE.md"

# runtime scripts are COPIED out of the clone: launchd cannot execute anything under TCC-protected
# folders (~/Documents, ~/Desktop, ~/Downloads) — a clone there would leave the helper unable to start
cp "$KIT/bin/vplan-save-server.py" "$KIT/bin/vplan-sync.sh" "$RUNTIME/"
chmod +x "$RUNTIME/vplan-sync.sh"

# Claude Code skills
for s in create_vplan suggest_vplan; do
  rm -rf "$SKILLS/$s"
  cp -R "$KIT/skills/$s" "$SKILLS/$s"
done

# save helper (launchd, KeepAlive)
sed -e "s|__RUNTIME__|$RUNTIME|g" -e "s|__HOME__|$HOME|g" \
  "$KIT/bin/com.vplan.save.plist.in" > "$AGENTS/com.vplan.save.plist"
launchctl bootout "gui/$UID_NUM/com.vplan.save" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$AGENTS/com.vplan.save.plist"

sleep 1
if curl -sf --max-time 3 http://127.0.0.1:8790/ping >/dev/null; then
  echo "vplan-kit: save helper is up (127.0.0.1:8790)"
else
  echo "vplan-kit: WARNING — save helper did not answer; check ~/Library/Logs/vplan-save.log" >&2
  echo "           (is another process using port 8790?)" >&2
  exit 1
fi

cat <<EOF

vplan-kit installed.
  1. In Claude Code, run:  /create_vplan <IP>     → makes ~/vplans/vplan_<IP>.html
  2. Open that file in Chrome. Save just works — no dialogs.
  3. Save As writes a dated read-only snapshot (share those, not the original).
  4. /suggest_vplan <IP> reads the plan's Input Sources and files suggestion cards.
If Save ever says the helper is down, saves land in ~/Downloads — recover them with:
  zsh ~/vplans/.kit/vplan-sync.sh
EOF
