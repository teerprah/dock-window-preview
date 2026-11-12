# Changelog

Notable changes to Dock Window Preview are documented here.

## 10 - 2026-11-11

- Added an optional Skip Focused Window setting for enriched previews, contributed by [@hoisel](https://github.com/hoisel). Disabled by default, it skips the focused window and hides any enriched preview already open when hovering that window.
- Fixed hover previews stopping after the pointer encounters an actor without style-class support.
- Recompiled the GSettings schema to include all current settings.
- Updated timer cancellation to use `GLib.Source.remove()` and made the enriched-preview timeout callback explicitly return `GLib.SOURCE_REMOVE`.
- Simplified extension cleanup, tooltip type checks, and preview imports to address static-analysis warnings.
- Added a donation link to the extension metadata.
- Updated contribution guidelines and documented validation steps, including outdated validators flagging GNOME 51 support.

## 9 - 2026-11-08

- Added GNOME Shell 48 support, courtesy of [devl34n](https://github.com/devl34n)
- Added an optional larger window preview when hovering a dock window preview.
- Added an optional Peek effect that fades other windows while a preview is hovered.
- Added fade animations to the dock preview popup.
- Split preview effects into focused modules and removed redundant compatibility wrappers.
- Avoided racing GNOME's automatic cleanup of dynamic workspaces.
- Fixed extension cleanup so disabling removes the dock hover tracker and its resources.
- Cancelled pending enriched-preview hover work before rebuilding popup contents.
- Applied the maximize-to-new-workspace behavior to windows that are already maximized.

## 8 - 2026-11-07

- Fixed loading and packaging of the maximize-to-new-workspace tracker.

## 7 - 2026-11-05

- Added an optional setting to close a window by middle-clicking its preview, contributed by [@plugo1](https://github.com/plugo1).
- Reused the existing close animation and popup refresh behavior for middle-clicked previews.
- Split the preview UI and hover tracking into focused modules and removed redundant compatibility wrappers.

## 6 - 2026-10-08

- Simplified `St.BoxLayout` orientation feature detection across supported GNOME versions.
- Added the project repository URL to extension metadata.

## 5 - 2026-09-28

- Added GNOME Shell 46 support.
- Added GNOME Shell 51 support.
- Kept preview layout orientation compatible with older and newer `St.BoxLayout` APIs.

## 4 - 2026-04-30

- Added optional close buttons to window previews.
- Added a preference for placing close buttons on the left or right.
- Added a close animation and refreshed previews after windows close.

## 2 - 2026-04-22

- Added preferences for truncating or wrapping long window titles.
- Hid the dock's default tooltip when an application has open windows.
- Cleaned up the extension package for GNOME Extensions review.

## 1 - 2026-03-06

- Added hover previews for open application windows.
- Added window activation from preview thumbnails.
- Added configurable hover delay, preview layout, and thumbnail dimensions.
- Added local installation, packaging, and uninstallation targets.
