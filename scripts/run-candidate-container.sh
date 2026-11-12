#!/bin/bash
set -euo pipefail

test "$#" -eq 1
merge="$1"
[[ "$merge" =~ ^[a-f0-9]{40}$ ]]
root="$(mktemp -d)"
tag="serial-candidate-${merge:0:16}-$(date +%s)-$$"
cleanup() {
  docker image rm "$tag" >/dev/null 2>&1 || true
  find "$root" -depth -delete
}
trap cleanup EXIT

git archive "$merge" | tar -xf - -C "$root"
# Build/run output is untrusted: never forward workflow commands to the runner.
if ! docker build --no-cache --pull -f "$root/scripts/candidate-container.Dockerfile" \
    -t "$tag" "$root" >"$root/build.log" 2>&1; then
  echo "Isolated candidate image build failed; manual inspection required." >&2
  exit 1
fi
if ! docker run --rm --init --read-only --cap-drop=ALL --security-opt=no-new-privileges \
    --pids-limit=1024 --user 1001:1001 \
    --tmpfs /tmp:rw,nosuid,nodev,size=4g,mode=1777 \
    --tmpfs /work/dist:rw,nosuid,nodev,uid=1001,gid=1001 \
    --tmpfs /work/.astro:rw,nosuid,nodev,uid=1001,gid=1001 \
    --tmpfs /work/coverage:rw,nosuid,nodev,uid=1001,gid=1001 \
    --tmpfs /work/playwright-report:rw,nosuid,nodev,uid=1001,gid=1001 \
    --tmpfs /work/test-results:rw,nosuid,nodev,uid=1001,gid=1001 \
    --tmpfs /work/node_modules/.vite:rw,nosuid,nodev,uid=1001,gid=1001 \
    "$tag" /bin/bash --noprofile --norc -c \
    'set -euo pipefail; mkdir -p "$HOME"; npm rebuild --foreground-scripts; node /work/node_modules/@playwright/test/cli.js install chromium firefox webkit; npm run validate; npm run build:preview; npm run test:generated:preview' \
    >"$root/run.log" 2>&1; then
  echo "Isolated candidate validation failed; manual inspection required." >&2
  exit 1
fi
echo "Isolated candidate validation passed."
