#!/usr/bin/env bash
set -euo pipefail

UUID="${UUID:-dock-window-preview@quivio}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/share/gnome-shell/extensions/$UUID}"

case "$INSTALL_DIR" in
  */"$UUID") ;;
  *)
    echo "Refusing to remove unexpected path: $INSTALL_DIR" >&2
    exit 1
    ;;
esac

if command -v gnome-extensions >/dev/null 2>&1; then
  if gnome-extensions list --enabled | grep -Fxq "$UUID"; then
    if gnome-extensions disable "$UUID"; then
      echo "Disabled extension: $UUID"
    else
      echo "Could not disable extension automatically: $UUID" >&2
    fi
  fi
fi

if [[ -d "$INSTALL_DIR" ]]; then
  rm -rf "$INSTALL_DIR"
  echo "Removed $INSTALL_DIR"
else
  echo "Nothing to remove at $INSTALL_DIR"
fi