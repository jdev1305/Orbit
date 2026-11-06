# Orbit v3.2 — Interface cleanup

Based on v3.1 privacy-first local-only version.

## Changes
- Removed the graph's top information bar entirely.
- Inspector now groups each property in a distinct graphite panel with clearly separated label and value. Attributes also separate ID and value.
- Removed the inspector's ambiguous copy button.
- Added a **Copy ID** button (copy icon) to every object row in the left explorer, in both modes. Its tooltip identifies the exact ID; the icon becomes a check on success.
- Preserved existing STEPXML local-only loading, parsing, graph interactions, theme, and focus behavior.

## Install
Replace `src/App.tsx` and `src/App.css` in your existing Orbit project.
Run `npm.cmd run lint` and `npm.cmd run build` on Windows.

This package has not been validated against your local npm dependencies.
