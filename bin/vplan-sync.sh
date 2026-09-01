#!/bin/zsh
# vplan recovery & mirror tool, two steps in one pass:
#   1) INGEST   ~/Downloads/vplan_<IP>[ (N)].html  →  ~/vplans/vplan_<IP>.html   (move, newest wins)
#   2) MIRROR   ~/vplans/vplan_*.html              →  $1 (optional backup dir)   (copy, newer-only)
#
# INGEST exists for the fallback path: when the vplan-save helper is down, the page's Save downloads
# a copy instead. Run this from YOUR OWN shell to land those onto the real files — a launchd agent
# cannot do it for you (macOS TCC silently denies launchd scripts read access to ~/Downloads).
#
# MIRROR runs only when a backup directory is passed as $1 (typically by a personal launchd agent).
#
# Contract:
#   - ingest only names that already exist in ~/vplans — create_vplan creates the file first, so a
#     random web download named vplan_*.html is never kidnapped
#   - apply Downloads copies oldest→newest so the newest save wins; " (1)"-style dup names collapse
#   - mirror copies only when ~/vplans is strictly newer (cp -p keeps mtimes comparable), never deletes
#   - vplan_template.html is never touched

dl=$HOME/Downloads
src=$HOME/vplans
dst=${1:-}

# -- 1) ingest downloads --------------------------------------------------------------------------
for f in $dl/vplan_*.html(N.Om); do
  b=${f:t}
  core=${b%.html}
  core=${core%\ \(<->\)}                       # "vplan_ATU (2)" → "vplan_ATU"
  tgt=$src/$core.html
  [[ $core == vplan_template ]] && continue
  [[ -e $tgt ]] || continue                    # unknown plan name → leave the download alone
  /usr/bin/xattr -d com.apple.quarantine "$f" 2>/dev/null
  if /bin/mv -f "$f" "$tgt"; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') ingested $b -> ${tgt:t}"
  else
    echo "$(date '+%Y-%m-%d %H:%M:%S') INGEST FAILED $b (mv exit $?)" >&2
  fi
done

# -- 2) mirror to backup dir (optional) ------------------------------------------------------------
[[ -n $dst && -d $dst ]] || exit 0
for f in $src/vplan_*.html(N); do
  b=${f:t}
  [[ $b == vplan_template.html ]] && continue
  if [[ ! -e $dst/$b || $f -nt $dst/$b ]]; then
    if /bin/cp -p "$f" "$dst/$b"; then
      echo "$(date '+%Y-%m-%d %H:%M:%S') synced $b"
    else
      echo "$(date '+%Y-%m-%d %H:%M:%S') SYNC FAILED $b (cp exit $?)" >&2
    fi
  fi
done
