#!/usr/bin/env bash
# Universal Go execution helper that works across:
# 1. Native host environments (Pop!_OS with Go in /usr/local/go/bin or ~/go/bin)
# 2. Flatpak sandboxes (Visual Studio Code, etc. using flatpak-spawn)
# 3. Custom PATH setups

set -e

# 1. If go is in PATH directly:
if command -v go >/dev/null 2>&1; then
    exec go "$@"
fi

# 2. Check standard Go installation paths on the host/filesystem
for cand in /usr/local/go/bin/go /usr/bin/go "$HOME/go/bin/go" /opt/go/bin/go; do
    if [ -x "$cand" ]; then
        export PATH="$(dirname "$cand"):$PATH"
        exec "$cand" "$@"
    fi
done

# 3. If inside Flatpak container, spawn host Go binary
if command -v flatpak-spawn >/dev/null 2>&1; then
    # Flatten arguments safely for host bash invocation
    cmd_args=""
    for arg in "$@"; do
        cmd_args="$cmd_args $(printf '%q' "$arg")"
    done
    exec flatpak-spawn --host bash -c "export PATH=\"/usr/local/go/bin:\$PATH\"; cd $(printf '%q' "$PWD") && exec go $cmd_args"
fi

echo "[run-go] ERROR: Go binary could not be found in PATH or /usr/local/go/bin/go." >&2
exit 1
