#!/bin/sh
# The cloud session's gate (docs/ANSWERS.md "Claude in the cloud", "One
# session per piece"). The Mac mini keeps a copy at the top of the
# answers-work branch of veitch123/deslam (script/lib/retry.js); the routine's
# prompt copies it to /tmp and runs it, so that whether a session answers a
# piece, and how its answers are pushed, is decided here and not by the model.
#
#   sh gate.sh start <Head SHA>   GO <name>             answer queue/<name>.json
#                                 STOP <why>            nothing to do
#   sh gate.sh push <name>        PUSHED <name>         done
#                                 STOP <why>            another session was first: nothing pushed
#                                 FIX <why>             mend answers/<name>.json and run it again
#
# Why (30 September 2026): every push to the branch starts a session, the
# sessions' own "Answers for queue/<name>.json" pushes included, and on 30
# September five of those sessions answered the piece their trigger's
# message named all over again and pushed over the first answers.
set -u
branch=answers-work
say() { printf '%s\n' "$*"; }
fetch() { git fetch -q origin "$branch" 2>/dev/null || { sleep 3; git fetch -q origin "$branch"; }; }
remote_has() { git cat-file -e "origin/$branch:$1" 2>/dev/null; }
valid_name() { printf '%s\n' "$1" | grep -Eq '^[0-9]{8}T[0-9]{6}Z-[0-9]{2}$'; }

case "${1:-}" in
start)
  sha="${2:-}"
  [ -n "$sha" ] || { say "STOP no Head SHA: not started by a push"; exit 0; }
  fetch || { say "STOP could not fetch $branch"; exit 0; }
  git checkout -q -B "$branch" "origin/$branch" || { say "STOP could not check out $branch"; exit 0; }
  subject=$(git log -1 --format=%s "$sha" 2>/dev/null) || { say "STOP commit $sha is not on $branch"; exit 0; }
  # Only the Mac mini's own request starts work: exactly "Answer queue/<name>.json".
  name=$(printf '%s\n' "$subject" | sed -n -E 's#^Answer queue/([0-9]{8}T[0-9]{6}Z-[0-9]{2})\.json$#\1#p')
  [ -n "$name" ] || { say "STOP the push was \"$subject\", not a request to answer a piece"; exit 0; }
  remote_has "queue/$name.json" || { say "STOP queue/$name.json is gone: a new round has started"; exit 0; }
  if remote_has "answers/$name.json"; then say "STOP answers/$name.json already exists: another session answered it"; exit 0; fi
  say "GO $name"
  ;;
push)
  name="${2:-}"
  valid_name "$name" || { say "FIX \"$name\" is not a piece name (it looks like 20260930T190851Z-02)"; exit 1; }
  file="answers/$name.json"
  [ -f "$file" ] || { say "FIX $file has not been written"; exit 1; }
  # The same check as step 6 of the prompt, so nothing half-written goes up.
  problem=$(python3 - "$name" <<'EOF'
import json, sys
name = sys.argv[1]
try:
    r = json.load(open(f"answers/{name}.json"))
except Exception as e:
    print(f"answers/{name}.json is not valid JSON: {e}"); sys.exit()
try:
    q = json.load(open(f"queue/{name}.json"))
except Exception:
    q = None  # a new round took the piece away: still pushed (the Mini takes it in)
if not isinstance(r.get("answers"), list) or not r["answers"]:
    print("it has no answers"); sys.exit()
if q is not None:
    if [i["key"] for i in q["items"]] != [a.get("key") for a in r["answers"]]:
        print(f"its keys are not the piece's keys in the piece's order ({len(r['answers'])} answers for {len(q['items'])} items)"); sys.exit()
    if r.get("instructions") != q.get("instructions"):
        print("its \"instructions\" is not a copy of the piece's"); sys.exit()
EOF
) || problem="python3 failed"
  [ -z "$problem" ] || { say "FIX $problem"; exit 1; }
  keep="${TMPDIR:-/tmp}/deslam-answers-$name.json"
  cp "$file" "$keep"
  tries=0
  while [ "$tries" -lt 8 ]; do
    tries=$((tries + 1))
    fetch || continue
    # Never over another session's answers: if the file is there, stop.
    if remote_has "$file"; then say "STOP $file was pushed by another session first: yours is not pushed, nothing was overwritten"; exit 0; fi
    # One commit on top of the branch as it is now, holding this file only.
    git checkout -q -B "$branch" "origin/$branch" 2>/dev/null || git reset -q --hard "origin/$branch"
    mkdir -p answers && cp "$keep" "$file"
    git add -- "$file"
    git -c user.name='DeSlammatory answers' -c user.email='dm@giantveitch.com' commit -q -m "Answers for queue/$name.json" -- "$file" || { say "FIX could not commit $file"; exit 1; }
    # Not forced: if anyone pushed meanwhile it is refused, and the loop looks again.
    if git push -q origin "HEAD:refs/heads/$branch" 2>/dev/null; then say "PUSHED $name"; exit 0; fi
    sleep $((tries * 2))
  done
  say "STOP could not push after $tries tries (the branch kept moving); nothing was overwritten"
  exit 0
  ;;
*)
  say "usage: sh gate.sh start <Head SHA> | sh gate.sh push <name>"
  exit 1
  ;;
esac
