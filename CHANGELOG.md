# Changelog

Notable changes to Dock Window Preview are documented here.

## Unreleased

## 7 - 2026-11-05

- Added an optional setting to close a window by middle-clicking its preview, contributed by [@plugo1](https://github.com/plugo1).
- Reused the existing close animation and popup refresh behavior for middle-clicked previews.

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
