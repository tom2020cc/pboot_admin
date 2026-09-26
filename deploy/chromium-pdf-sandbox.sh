#!/usr/bin/env bash
set -euo pipefail
BASE=/www/server/pboot-pdf-browser
CHROME=$(readlink -f "$BASE/current/chrome-linux64/chrome")
[[ "$CHROME" == "$BASE"/chromium-*/chrome-linux64/chrome && -x "$CHROME" ]]
if [ "$(id -u)" = 0 ]; then
  for arg in "$@"; do
    case "$arg" in
      --user-data-dir=*)
        profile=${arg#--user-data-dir=}
        [[ "$profile" == /tmp/playwright_chromiumdev_profile-* && ! -L "$profile" && -d "$profile" ]]
        [[ "$(realpath "$profile")" == "$profile" && "$(stat -c %u "$profile")" = 0 ]]
        chown pbootpdf:pbootpdf "$profile"
        chmod 700 "$profile"
        ;;
    esac
  done
  # Keep the DevTools pipe descriptors; do not leak API environment secrets.
  exec /usr/bin/setpriv --reuid=pbootpdf --regid=pbootpdf --init-groups /usr/bin/env -i HOME="$BASE/home" PATH=/usr/bin:/bin LANG=C.UTF-8 "$CHROME" "$@"
fi
exec "$CHROME" "$@"
