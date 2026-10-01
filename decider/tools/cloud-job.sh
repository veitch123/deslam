#!/bin/sh
# Runs one Decider job inside a Claude cloud session and pushes the result to the `decider` branch of
# veitch123/deslam. The session's own model only runs this script; every model call is a print-mode
# `claude -p` made by tools/cli.js, billed to the cloud session credits.
#   sh decider/tools/cloud-job.sh next     the next job not yet done (repair first, then the five judge runs)
#   sh decider/tools/cloud-job.sh status   what is done
set -eu
HERE="$(cd "$(dirname "$0")/.." && pwd)"   # …/decider
REPO="$(cd "$HERE/.." && pwd)"
cd "$REPO"
git fetch -q origin decider
git checkout -q -B decider origin/decider
cd "$HERE"
say() { printf '%s\n' "$*"; }
done_file() { [ -s "$1" ]; }
job=""
if [ "${1:-next}" = "status" ]; then ls -la gate; exit 0; fi
if ! done_file gate/checks.json; then say "STOP no gate/checks.json on the branch"; exit 0; fi
if ! done_file gate/repaired.json; then job="repair";
elif ! done_file gate/repaired.gated; then say "STOP repaired.json exists but the gate has not been re-run on the Mac yet (gate/repaired.gated missing)"; exit 0;
elif ! done_file gate/judge-v1-claude-haiku-4-5-r1.json; then job="v1 claude-haiku-4-5 1";
elif ! done_file gate/judge-v3-claude-haiku-4-5-r1.json; then job="v3 claude-haiku-4-5 1";
elif ! done_file gate/judge-v3-claude-haiku-4-5-r2.json; then job="v3 claude-haiku-4-5 2";
elif ! done_file gate/judge-v3-claude-sonnet-5-r1.json; then job="v3 claude-sonnet-5 1";
elif ! done_file gate/judge-v3-claude-sonnet-5-r2.json; then job="v3 claude-sonnet-5 2";
else say "STOP every job is done"; exit 0; fi
say "JOB $job"
claude auth status | head -3 || true
if [ "$job" = "repair" ]; then
  node tools/judge.js --repair --model claude-haiku-4-5 --workers 8
else
  set -- $job
  node tools/judge.js --judge "$1" --model "$2" --run "$3" --workers 8
fi
cd "$REPO"
git add decider/gate
git -c user.name='Decider runner' -c user.email='dm@giantveitch.com' commit -q -m "Decider: $job" || say "nothing to commit"
tries=0
until git push -q origin HEAD:decider; do
  tries=$((tries + 1)); [ "$tries" -lt 6 ] || { say "STOP could not push"; exit 1; }
  sleep 3; git pull -q --rebase origin decider || true
done
say "DONE $job"
