#!/bin/zsh
# Usage: audit/run.sh <name> <command...>
# Runs a command, keeps the FULL unfiltered log in audit/logs/<name>.log and records start/end/exit.
name=$1; shift
log="audit/logs/$name.log"
start=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "# command: $*" > "$log"
echo "# start: $start" >> "$log"
"$@" >> "$log" 2>&1
code=$?
end=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "# end: $end" >> "$log"
echo "# exit: $code" >> "$log"
echo "$name | $* | $start | $end | exit $code" >> audit/logs/RUNS.txt
echo "exit=$code start=$start end=$end log=$log"
