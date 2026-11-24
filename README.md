# Packaging AI Agent

An agent that automates packaging prepress work in Esko ArtPro 23.11 (Mac):
file checking/preflight, removing unwanted elements, color management, and
trapping — following playbooks captured from real, human-driven sessions,
and asking for help when a case isn't covered yet.

## How this works

1. A human does the work once in ArtPro, in a **local** Claude Code session
   running on the Mac that has ArtPro installed (Computer use only works in
   local, interactive sessions — not in cloud sessions like the one that
   authored this README).
2. That session writes up what it observed — steps, and the reasoning behind
   judgment calls — into `playbooks/`.
3. The agent follows that playbook on new files, asking the human whenever it
   hits something the playbook doesn't cover, then updates the playbook so it
   needs less help next time.

## Repo layout

- `playbooks/` — one doc per task (file check, cleanup, color management,
  trapping), each a step-by-step SOP plus the reasoning behind non-obvious
  decisions.
- `tiff-check/` — a separate, standalone tool (not part of the ArtPro agent
  above): a browser-based app for the engraving department to manually
  check separated TIFF plates against print/proof, replacing the old
  Photoshop channel-merge-and-toggle workflow. Open `tiff-check/index.html`
  directly, no install.
- `tiff-check-desktop/` — the same tool packaged as a standalone Windows/Mac
  app (Electron), with native folder access and reports/colors saved
  straight to disk instead of browser downloads. See its own README for how
  to run it or build installers.

## Status

Scaffolding only so far for the ArtPro agent itself. First real playbook is
pending a live walkthrough of an actual ArtPro file. `tiff-check` and
`tiff-check-desktop` are working tools, independent of that effort.
