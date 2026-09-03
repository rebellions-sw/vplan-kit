#!/bin/bash
# vplan-kit installer (macOS). Safe to re-run — it updates in place and never touches your plans.
#
# What it sets up:
#   ~/vplans/                       your plans live here — nothing but plans
#   ~/.vplan-kit/                   runtime: save helper, recovery script, pointer back to this clone
#   ~/.claude/skills/*              every skill under skills/ in this clone
#   com.vplan.save (launchd)        localhost:8790 helper that makes the page's Save dialog-free
set -euo pipefail

KIT="$(cd "$(dirname "$0")" && pwd)"
PLANS="$HOME/vplans"
RUNTIME="$HOME/.vplan-kit"
SKILLS="$HOME/.claude/skills"
AGENTS="$HOME/Library/LaunchAgents"
UID_NUM="$(id -u)"

echo "vplan-kit: installing from $KIT"

mkdir -p "$PLANS" "$RUNTIME" "$SKILLS" "$AGENTS" "$HOME/Library/Logs"

# The template and CLAUDE.md are NOT copied anywhere: they are repo files, and a copy would go stale
# the moment someone pulls. The skills read them straight out of this clone, found via this pointer.
printf '%s\n' "$KIT" > "$RUNTIME/kit-path"

# Runtime scripts, however, ARE copied out of the clone: launchd cannot read or execute anything under
# ~/Documents, ~/Desktop or ~/Downloads (macOS TCC denies it silently), and clones land in those often.
cp "$KIT/bin/vplan-save-server.py" "$KIT/bin/vplan-sync.sh" "$RUNTIME/"
chmod +x "$RUNTIME/vplan-sync.sh"

# Claude Code skills — whatever the clone ships, so a new skill needs no installer edit.
# The manifest lets a re-run remove skills this kit installed but no longer ships (a rename, say),
# without ever touching a skill the user wrote themselves.
MANIFEST="$RUNTIME/installed-skills"
if [ -f "$MANIFEST" ]; then
  while read -r old; do
    [ -n "$old" ] || continue
    [ -d "$KIT/skills/$old" ] || { rm -rf "${SKILLS:?}/$old"; echo "vplan-kit: removed stale skill $old"; }
  done < "$MANIFEST"
fi
: > "$MANIFEST"
for d in "$KIT"/skills/*/; do
  s="$(basename "$d")"
  rm -rf "$SKILLS/$s"
  cp -R "$d" "$SKILLS/$s"
  echo "$s" >> "$MANIFEST"
  echo "vplan-kit: skill $s"
done

# save helper (launchd, KeepAlive)
sed -e "s|__RUNTIME__|$RUNTIME|g" -e "s|__HOME__|$HOME|g" \
  "$KIT/bin/com.vplan.save.plist.in" > "$AGENTS/com.vplan.save.plist"
launchctl bootout "gui/$UID_NUM/com.vplan.save" 2>/dev/null || true
# A re-run races the outgoing instance: launchd reports "Input/output error" while the old service is
# still tearing down, so retry rather than leaving the user with no helper and a confusing message.
for attempt in 1 2 3 4 5; do
  if launchctl bootstrap "gui/$UID_NUM" "$AGENTS/com.vplan.save.plist" 2>/dev/null; then break; fi
  [ "$attempt" = 5 ] && { echo "vplan-kit: could not start the save helper" >&2; exit 1; }
  sleep 1
done

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
  1. In Claude Code, run:  /vplan_create <IP>     → makes ~/vplans/vplan_<IP>.html
  2. Open that file in Chrome. Save just works — no dialogs.
  3. Save As writes a dated read-only snapshot (share those, not the original).
  4. /vplan_suggest <IP> proposes what the plan is missing; /vplan_audit <IP> judges what it
     already says against the same sources (누락 / 불충분 / 미스매치);
     /vplan_feature_desc <IP> fills the description of feature rows you only titled.
The skills work from any directory — they find this clone via ~/.vplan-kit/kit-path.
Moved or re-cloned the kit? Just run ./install.sh again from the new location.
If Save ever says the helper is down, saves land in ~/Downloads — recover them with:
  zsh ~/.vplan-kit/vplan-sync.sh
EOF
