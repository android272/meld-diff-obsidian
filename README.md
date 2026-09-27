# Meld Diff

Meld Diff adds two views to Obsidian. Both are normal tabs: park them in the main editor, the left sidebar, or the right sidebar. The left ribbon has a button for each view, and every action is a command you can bind to a hotkey. Conflict View finds files that match your conflict pattern (Syncthing by default: `name.sync-conflict-YYYYMMDD-HHMMSS-DEVICE.ext`) and pairs them with the original note. Diff View is a Meld-like split source editor: line and character diffs, connecting waves, copy left/right, insert above/below, delete hunk, and normal file ⋮ actions on each side. You can also pick any two files to compare.

Desktop only (Obsidian 1.6+).

## Develop

```bash
npm install
npm test
npm run build
```

`npm run build` writes `main.js` next to `manifest.json` and `styles.css`. Copy or symlink this folder to `<vault>/.obsidian/plugins/meld-diff`, then enable Meld Diff in Settings → Community plugins. Reload Obsidian after each build. `npm run dev` rebuilds `main.js` on change.

Files over 1.5 MB still open in the diff, with a warning. Files over 15 MB are listed but not loaded, so a huge file cannot freeze the app.

## Conflict patterns

Syncthing is enabled by default. Obsidian Sync and Nextcloud presets are included and disabled. Add a regex or a glob (`*` and `**`) from Settings. An invalid regex is skipped instead of crashing the plugin. Each pattern card can test a vault path and shows the original it would recover.
