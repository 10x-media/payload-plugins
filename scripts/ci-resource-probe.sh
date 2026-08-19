#!/usr/bin/env bash
# Samples runner memory, disk, and process counts while a long CI step runs.
#
# Two jobs at once: it gives a heartbeat so a step that produces no output for
# minutes (turbo buffers each task's log until the task ends) is visibly alive,
# and it leaves a resource trace behind when a step dies with no error of its
# own. Run it backgrounded from inside the step whose stdout you want it on.
set -uo pipefail

interval="${1:-10}"

while sleep "$interval"; do
	printf '[probe %s] mem_avail=%sMB swap_used=%sMB disk_avail=%sMB load=%s node=%s mongod=%s\n' \
		"$(date -u +%H:%M:%S)" \
		"$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo)" \
		"$(free -m | awk '/^Swap:/ { print $3 }')" \
		"$(df -m --output=avail / | tail -1 | tr -d ' ')" \
		"$(cut -d' ' -f1-3 /proc/loadavg)" \
		"$(pgrep -c node || echo 0)" \
		"$(pgrep -c mongod || echo 0)"
done
