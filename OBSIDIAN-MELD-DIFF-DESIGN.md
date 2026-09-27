# Obsidian Meld Diff — Design Document for Grok Build

**Working title:** Meld Diff  
**Suggested plugin id:** `meld-diff`  
**Suggested display name:** Meld Diff  
**Suggested description:** Meld-style side-by-side diff and merge for vault files, with configurable sync-conflict discovery (Syncthing and others).  
**Target:** Obsidian desktop first (1.6+). Mobile is out of scope for v1 because the Meld layout needs horizontal space.  
**License:** MIT  
**Stack:** TypeScript, official Obsidian plugin template, CodeMirror 6 (`@codemirror/state`, `@codemirror/view`, `@codemirror/merge`, `@codemirror/search`, `@codemirror/commands`, `@codemirror/language`), no React/Svelte required.

This document is the implementation spec. Follow it literally. Where something is marked **Decision**, treat it as locked unless the user later overrides it. Where something is marked **Open**, use the recommended default.

---

## 1. Problem

Sync tools (especially Syncthing) leave sibling conflict files next to notes:

```
foo.md
foo.sync-conflict-20241128-143022-ABCDEF1.md
```

Existing Obsidian plugins can list or sequentially merge those files, but none reproduce **Meld**:

- live two-pane source editors
- line *and* intra-line (character/punctuation) highlighting
- a center “link map” that draws connecting waves between matching hunks
- hunk actions: replace left/right, insert above, insert below, delete
- arbitrary file-vs-file compare, not only conflicts

This plugin does both jobs: a **Conflict View** that indexes matches, and a **Diff View** that is a Meld-like editor inside Obsidian.

---

## 2. Goals and non-goals

### Goals (v1)

1. Settings let the user define one or more conflict-file matchers using globs and/or regular expressions, with a rule that recovers the original path.
2. Conflict View walks the vault, pairs each conflict file with its original, and stays live as files appear/rename/delete.
3. Diff View is always **source text** (raw characters), never Live Preview / Reading view.
4. Diff View is a true split editor: left file, center link map + action gutter, right file.
5. Diff highlighting covers changed lines and changed characters/punctuation inside those lines.
6. Hunk controls match Meld semantics: Replace (default), Delete (Shift), Insert above/below (Ctrl).
7. Either pane can be edited in place; diffs recompute live; saves write back to the vault.
8. Diff View can be opened on **any two text files**, not only conflicts. Header file pickers change left and right independently.
9. Each side exposes file actions equivalent to a normal markdown pane’s ⋮ menu (open, rename, move, delete, reveal, copy path).
10. Theme-aware colors using Obsidian CSS variables.
11. Conflict View and Diff View are normal workspace tabs. The user can leave them in the main editor area, drag them into the left or right sidebars, split them, or pop them out, exactly like a markdown note or the file explorer.
12. The left ribbon has a button for each view. Every user-facing action also exists as a command that can be given a hotkey.

### Non-goals (v1)

- Three-way merge / ancestor pane
- Directory / folder comparison
- Meld synchronization points
- Binary, image, PDF, canvas, base, or Excalidraw visual diffs
- Driving the Syncthing HTTP API
- Auto-merge heuristics
- Mobile-optimized layout

---

## 3. User-facing surfaces

| Surface | Type | Where |
|---|---|---|
| Conflict View | `ItemView` | Any workspace leaf: main tabs, left sidebar, right sidebar, splits, pop-out windows |
| Diff View | `ItemView` | Same — a normal tab, not a modal and not locked to one region |
| Settings tab | `PluginSettingTab` | Settings → Community plugins → Meld Diff |
| Commands | Command palette + hotkeys | See §8. All of them set `hotkeys: []` so the user can bind them |
| Left ribbon | Two icons | Opens / reveals Conflict View and Diff View |
| Status bar | Item | Conflict count; click reveals Conflict View |
| File-explorer / editor menus | Context menu | “Compare with…”, “Compare with conflict” |

---

## 3.1 Workspace behavior (locked)

Both views are first-class `ItemView` tabs. They must participate in the normal Obsidian leaf lifecycle:

- Appear in the tab header with an icon + title.
- Can be dragged from the main editor area into the left sidebar, the right sidebar, a split, or a new window.
- Can be pinned, closed, moved, and restored with the workspace layout (`getState` / `setState`).
- Do **not** hard-code `getLeftLeaf` or `getRightLeaf` as the only home. Default *first open* placement is a main-area tab (`workspace.getLeaf('tab')`). After that, the leaf stays where the user put it.
- `navigation = true` on **both** views so they behave like documents in the tab switcher and history.

### Opening policy

Shared helper `revealOrOpenView(viewType, opts)`:

| Situation | Behavior |
|---|---|
| A leaf of that type already exists | `revealLeaf` it. Do not spawn a duplicate. |
| None exists | Create a new leaf in the main tab area and `setViewState` |
| Command / ribbon with “new tab” | Always create another leaf, even if one exists |
| Command “open in left sidebar” | Use `getLeftLeaf(false)` (create the left split if needed) |
| Command “open in right sidebar” | Use `getRightLeaf(false)` |
| Conflict row “Diff” and a Diff View already exists | Reuse the most recently active Diff leaf and load that pair into it (do not steal a leaf the user parked in a sidebar unless it is the only one) |

Multiple Diff View tabs are allowed — different pairs can stay open. Conflict View is treated as a singleton by the ribbon and the default Open command; “Open conflict view in new tab” is the escape hatch.

Pop-out windows (`workspace.openPopoutLeaf` / dragging a tab to a new window) must keep working. Do not assume a single `workspace.rootSplit`.

### Responsive chrome

When a view is parked in a narrow sidebar:

- Conflict View is a list; it should feel natural at sidebar width.
- Diff View keeps the split layout but stacks the header: Left picker on one row, Right picker on the next, hunk toolbar on a third. Editors stay side by side as long as the pane is wider than ~560px. Below that, still side by side (this is a diff tool) with a horizontal scrollbar rather than switching to a single pane.

---

## 3.2 Left ribbon (locked)

Add **two** `addRibbonIcon` buttons on the left ribbon, independently togglable in settings (both on by default):

| Ribbon | Icon | Tooltip | Click |
|---|---|---|---|
| Conflicts | `alert-triangle` (or `git-pull-request`) | `Meld Diff: Conflicts` | Reveal existing Conflict View, or open one as a main tab |
| Diff | `git-compare` / `columns-2` | `Meld Diff: Diff` | Reveal existing Diff View, or open an empty Diff View as a main tab |

Ribbon order: Conflicts first, Diff second.

Right-click on a ribbon icon is not required. Holding modifier keys on click is not required; placement commands cover that.

If `statusBarEnabled` is on, clicking the status bar uses the same reveal-or-open path as the Conflicts ribbon button.

---

## 4. Conflict file matching

### 4.1 Why this is configurable

Syncthing is the default, but Nextcloud, Dropbox, Obsidian Sync “create conflict file”, Resilio, and homemade scripts all use different names. The matcher must accept wildcards **and** regex, as requested.

### 4.2 Pattern model

Settings store an ordered list of `ConflictPattern`:

```ts
interface ConflictPattern {
  id: string;                 // stable uuid
  enabled: boolean;
  name: string;               // "Syncthing"
  mode: "regex" | "glob";
  expression: string;
  // How to recover the original vault path from a matched conflict path.
  // "capture" uses named groups `stem` + optional `ext`, or group `original`.
  // "replace" runs originalRewrite against the conflict basename.
  originalMode: "capture" | "replace";
  originalRewrite?: string;   // e.g. "$stem$ext" or a replacement pattern
  // Optional: ignore these folders when scanning (in addition to global ignores)
  ignoreGlobs?: string[];
}
```

Matching is applied to the vault path using `/` separators, then also to the basename. A file is a conflict if **any enabled pattern** matches.

### 4.3 Built-in presets (ship these; user can edit/disable)

**Syncthing (default, enabled)**  
Official form: `<filename>.sync-conflict-<date>-<time>-<modifiedBy>.<ext>`  
Example: `Notes/foo.md` → `Notes/foo.sync-conflict-20241128-143022-ABCDEF1.md`

```
mode: regex
expression: ^(?<dir>.*/)?(?<stem>[^/]+)\.sync-conflict-(?<date>\d{8})-(?<time>\d{6})-(?<modifiedBy>[A-Za-z0-9]+)(?<ext>\.[^./]+)$
originalMode: capture
originalRewrite: $dir$stem$ext
```

Also accept the variant where the original extension is kept in the stem (`foo.md.sync-conflict-...md`) by shipping a second enabled Syncthing variant:

```
expression: ^(?<dir>.*/)?(?<stem>[^/]+)\.sync-conflict-(?<date>\d{8})-(?<time>\d{6})-(?<modifiedBy>[A-Za-z0-9]+)(?<ext>\.[^./]+)$
```

The first pattern already covers `foo.sync-conflict-DATE-TIME-DEV.md`. The second is the same if `stem` may contain dots. **One regex is enough** if `stem` is `[^/]+?` (non-greedy) and we try candidate originals:

**Resolution algorithm (locked):**

1. Regex match against full path and against basename.
2. If named group `original` exists, join with `dir` and use that.
3. Else compute candidate original paths, in order, and pick the first that **exists in the vault** (or, if none exist, the first candidate — shown as “missing original”):
   - `$dir$stem$ext`  → `Notes/foo.md` from `Notes/foo.sync-conflict-...md`
   - `$dir$stem`      → in case ext was already inside stem
   - strip one `.sync-conflict-DATE-TIME-DEV` occurrence from the basename and restore the last extension
4. If several conflict files map to the same original, group them.

**Obsidian Sync conflict file preset (disabled by default)**

```
expression: ^(?<dir>.*/)?(?<stem>[^/]+)\.sync-conflict-(?<date>\d{8})-(?<time>\d{6})(?<ext>\.[^./]+)$
originalRewrite: $dir$stem$ext
```

**Nextcloud / Desktop client style (disabled)**

```
mode: glob
expression: "**/* (conflicted copy *).* "
```

Implement glob via a small matcher (`micromatch` or a tiny glob-to-regex). Document that `*` and `**` work. Glob original recovery: remove the first ` (conflicted copy …)` / `.sync-conflict-…` substring; if that fails, user must switch the pattern to regex.

**Custom regex**

User can add rows. Validate on blur. Invalid regex shows an inline error and is skipped at scan time (do not crash the plugin).

### 4.4 Wildcard vs regex in the UI

Settings UI for each pattern:

- Name
- Enabled toggle
- Mode dropdown: `Regex` | `Glob`
- Expression textarea
- “Test against path” input that shows: match / no match, extracted original, date, device
- Preset buttons: Syncthing, Obsidian Sync, Nextcloud, Blank
- Move up/down (first match wins for metadata extraction)

### 4.5 Scan ignores (global settings)

Default ignore globs:

```
.obsidian/**
.trash/**
**/.git/**
**/.stfolder/**
**/.stversions/**
```

User-editable. Never treat files inside these paths as conflicts or originals for pairing.

### 4.6 Indexer

Class `ConflictIndex`:

- `rebuild()` — walk `app.vault.getFiles()` (and, if setting enabled, also `adapter.list` for extensions Obsidian does not index). **Decision:** v1 uses `vault.getFiles()` plus a setting “Include unrecognized extensions” that also scans via `vault.adapter` for matching names. Default on, so `.png.sync-conflict-…` appears even if we cannot text-diff it.
- Incremental updates via:
  - `vault.on('create' | 'delete' | 'rename' | 'modify')`
- Debounce rebuilds 250ms.
- Public query API:
  - `listGroups(): ConflictGroup[]`
  - `conflictsFor(originalPath: string)`
  - `isConflict(path: string)`
  - `originalFor(conflictPath: string)`

```ts
interface ConflictGroup {
  originalPath: string;          // may not exist
  originalExists: boolean;
  conflicts: ConflictFile[];
}

interface ConflictFile {
  path: string;
  patternId: string;
  date?: string;                 // YYYYMMDD if parsed
  time?: string;                 // HHMMSS if parsed
  modifiedBy?: string;
  mtime: number;
  size: number;
}
```

---

## 5. Conflict View

**View type:** `meld-diff-conflicts`  
**Icon:** `alert-triangle`  
**Display text:** `Conflicts`  
**Leaf:** any workspace leaf. First open from ribbon/command uses a main tab. After the user drags it into a sidebar, later “Open conflict view” calls must `revealLeaf` that same leaf instead of creating a new one in the center.

### 5.1 Layout

```
┌─────────────────────────────────────────┐
│ Conflicts                    [↻] [⚙]    │
│ [filter files…                ]         │
│ 3 originals · 5 conflict files          │
├─────────────────────────────────────────┤
│ ▾ Notes                                 │
│   foo.md                     2 conflicts│
│     2024-11-28 14:30  ABCDEF1  [Diff]   │
│     2024-12-01 09:12  ZZZZZZ2  [Diff]   │
│   bar.md                     1 conflict │
│     2025-01-04 18:01  ABCDEF1  [Diff]   │
│ ▸ Projects                              │
└─────────────────────────────────────────┘
```

- Group by parent folder, then by original file.
- Each original row shows basename, conflict count, and whether the original is missing (warning icon).
- Each conflict row shows parsed date/time (localized), device id, size.
- Click original row → expand/collapse.
- Click conflict row or **Diff** → reveal-or-open a Diff View tab (wherever the user last put one) and load left = original, right = conflict. A dedicated command can force a new Diff tab for that pair.
- If original is missing, Diff View still opens; left pane shows an empty buffer and a banner “Original file not found. Pick a file.”

### 5.2 Row actions (context menu + buttons)

On a **conflict file**:

- Open diff
- Open conflict file in a normal pane
- Reveal in file explorer
- Use original (delete this conflict file) — confirm
- Use conflict version (overwrite original with conflict, then delete conflict) — confirm
- Copy conflict path

On an **original**:

- Open original
- Open all diffs in sequence (next unresolved)
- Reveal
- Delete all sibling conflicts — confirm

### 5.3 Empty / loading / error states

- Scanning…  
- No conflict files match the current patterns.  
- All patterns invalid — link to settings.

### 5.4 Live updates

Index events refresh the list without destroying scroll position or expanded folders.

---

## 6. Diff View (Meld clone)

**View type:** `meld-diff-editor`  
**Icon:** `git-compare`  
**Display text:** `basenameL ↔ basenameR` (or `Diff` if empty)  
**Leaf:** any workspace leaf. Same docking rules as Conflict View. Several Diff tabs may exist at once; each persists its own `leftPath` / `rightPath`.

Persist `getState()` / `setState()`:

```ts
interface DiffViewState {
  leftPath: string | null;
  rightPath: string | null;
}
```

So workspace restore reopens the same pair.

### 6.1 Chrome / header

Always visible at the top of the view (not inside CM):

```
┌─────────────────────────────────────────────────────────────────────┐
│ [↕ swap]  Left: [🔎 foo.md        ▾] [⋮]   Right: [🔎 foo.sync-… ▾] [⋮] │
│ Changes: 3   [◀ prev] [next ▶]   [wrap] [align scroll]               │
└─────────────────────────────────────────────────────────────────────┘
```

**File pickers**

- Clicking the field opens an Obsidian `FuzzySuggestModal` over `vault.getFiles()`, text-like files first, current folder boosted.
- User may type a path and hit Enter.
- Clearing a side is allowed (empty editor).
- Changing a file:
  - If that side is dirty, prompt: Save / Discard / Cancel.
  - Then load the new file.

**Per-side ⋮ menu** — this is the “Obsidian three-dot menu” requested. Because a custom `ItemView` has only one leaf ⋮, **each header side has its own ⋮**. Also override `onPaneMenu` so the leaf ⋮ contains two submenus, “Left file” and “Right file”.

Each side menu includes (mirror `MarkdownView` file actions as closely as the API allows):

- Open in new tab (normal markdown/file view)
- Open to the right
- Reveal in navigation / system explorer (`app.showInFolder`)
- Rename…
- Move file… (`app.fileManager.promptForNextFile` / `renameFile`)
- Make a copy
- Copy path / copy Obsidian URL
- Delete — uses `app.fileManager.trashFile` so it respects system-vs-Obsidian trash settings
- Open appearance / related is **not** required

Do **not** implement a fake Live Preview toggle. Source-only is the product.

**Swap** exchanges left/right paths and editor contents (preserving dirty buffers).

### 6.2 Editor rules (locked)

- Always CodeMirror 6 source editors. No `MarkdownView`, no Reading mode, no Live Preview.
- Both panes editable unless the file is missing or the user pinned a side read-only (optional setting, default both editable).
- Line numbers on.
- Line wrapping follows a view toggle (default: on, matching Obsidian).
- Tab size / indent from Obsidian editor settings when readable (`vault.getConfig('tabSize')` etc.).
- Monospace using `--font-text-theme` / `--font-monospace-theme` and editor font size CSS vars so it looks like a note in source mode.
- Markdown syntax highlighting is **allowed** (CM language support) as long as every character remains visible and un-prettified. No widgets that hide `**`, `[[`, or list markers. If a highlighter hides source tokens, disable it. **Decision:** start with plain text + markdown stream highlighter that does **not** replace syntax with widgets. Safer default: **no markdown widgets, only coloring**.
- Search inside a pane: standard CM search (`Mod-F`) scoped to the focused editor.

### 6.3 Layout of the three columns

```
[ left editor + line gutter ] [ link map + action gutter ] [ right editor + line gutter ]
```

Widths: editors flex equally; center column fixed ~28–36px.

Vertical scroll of the two editors stays aligned on unchanged lines (CodeMirror `MergeView` alignment). The center canvas scrolls with them.

### 6.4 Diff engine

Use `@codemirror/merge` `MergeView`:

```ts
new MergeView({
  a: { doc: leftText, extensions: leftExtensions },
  b: { doc: rightText, extensions: rightExtensions },
  parent: host,
  highlightChanges: true,
  gutter: true,
  orientation: "a-b",
  diffConfig: { scanLimit: 10000 },
  collapseUnchanged: undefined, // off by default; setting can enable
});
```

- `highlightChanges: true` gives intra-line / character-level marks (`cm-changedText`).
- `scanLimit` default 10_000 characters per chunk; expose in settings (advanced).
- Recompute is automatic as the user types.

Classify each `Chunk` as:

- `insert` — present only on right
- `delete` — present only on left
- `change` — present on both, text differs

### 6.5 Link map (“the nice wave”)

`@codemirror/merge` draws a simple connector column, but it is not Meld’s bezier river. **Implement a custom overlay** on top of (or instead of) the default revert column.

For each chunk:

1. Measure left chunk top/bottom in view coordinates (`view.lineBlockAt` / `coordsAtPos`).
2. Measure right chunk top/bottom.
3. Draw an SVG path between those y-intervals:

```
M 0,yLtop
C cx,yLtop  cx,yRtop  width,yRtop
L width,yRbot
C cx,yRbot  cx,yLbot  0,yLbot
Z
```

Use a cubic curve with control x at ~50% so it reads as Meld’s wave.

Fill color by chunk type:

| Type | CSS variable fallback |
|---|---|
| change | `rgba(var(--color-yellow-rgb), 0.25)` or `--text-warning` tint |
| insert (right only) | `--color-green` tint |
| delete (left only) | `--color-red` tint |

Stroke slightly stronger than fill. Hovering a hunk brightens both editors’ hunk highlight and the wave.

Redraw on `EditorView.requestMeasure`, scroll, resize (`view.onResize`), theme change.

### 6.6 Hunk actions (Meld parity)

Meld’s rules ([official “Dealing with changes”](https://meldmerge.org/help/file-changes.html)):

- Default click = **Replace**: overwrite the opposite hunk with this hunk.
- Hold **Shift** = **Delete**: delete *this* hunk from its own file.
- Hold **Ctrl** (Cmd on macOS) = **Insert**: copy this hunk to the other file **above or below** the corresponding hunk, without deleting what is already there.

UI:

In the center column, at the start of each hunk, show small icon buttons. Icons swap with modifiers, exactly like Meld:

| Modifier | Left-pointing control | Right-pointing control |
|---|---|---|
| none | Replace left with right | Replace right with left |
| Shift | Delete left hunk | Delete right hunk |
| Ctrl/Cmd | Insert right hunk above/below on left | Insert left hunk above/below on right |

When Ctrl is held, each direction becomes a split control with **above** and **below** chevrons (Meld “Copy Above/Below Left/Right”). If space is tight, a two-item popover on Ctrl-click is acceptable.

Also put the same actions on:

- hunk context menu (right-click the wave or the highlighted lines)
- command palette (operate on hunk at cursor)
- optional toolbar “Copy all remaining left→right / right→left” with confirm

**Apply algorithm**

Operate on document offsets from `Chunk` (`fromA/toA`, `fromB/toB`):

- Replace right with left: `right.dispatch` replace `[fromB, toB)` with `left.slice(fromA, toA)`. Preserve a trailing newline so we do not glue paragraphs.
- Insert above: insert at `fromB` (or `fromA`).
- Insert below: insert at `toB` (or `toA`).
- Delete: replace range with `""`, keep a single newline if both neighbors would otherwise merge mid-line.

After a hunk action, focus stays where it was; diff recomputes; both sides mark dirty if text changed.

### 6.7 Navigation

- Toolbar prev/next change
- `Alt-Up` / `Alt-Down` (and commands) using `goToPreviousChunk` / `goToNextChunk` from `@codemirror/merge`
- Clicking a wave scrolls both sides so that hunk is centered

### 6.8 Saving and external updates

- Each side tracks `dirty` vs last-saved text.
- `Mod-S` in the view saves the **focused** pane; `Mod-Shift-S` saves both.
- Debounced autosave: **Decision:** off by default; setting “Autosave after edits” (debounce 750ms) available.
- `vault.on('modify')` for a loaded path: if that side is **not** dirty, reload; if dirty, show a banner “File changed on disk” with Reload / Keep editing.
- `vault.on('delete' | 'rename')`: update path in state; if deleted, banner and freeze that pane.

Write with `app.vault.modify(file, text)` for `TFile`. If the path is not a `TFile` yet (should not happen), use `adapter.write`.

Never write on every keystroke without the autosave setting.

### 6.9 Binary / non-text files

If either file looks binary (NUL in first 8KB, or extension in a denylist: `png jpg jpeg gif webp pdf mp3 mp4 zip` etc.):

- Do not load into CM.
- Show a placeholder panel: filename, size, “Cannot text-diff this file.”
- Conflict View still lists it and still offers Use original / Use conflict.

### 6.10 Empty Diff View

Opening Diff View with no files is valid. Pickers are empty; editors show a muted “Select a file”. This satisfies “preview whatever files they want.”

---

## 7. Settings

```ts
interface MeldDiffSettings {
  patterns: ConflictPattern[];
  ignoreGlobs: string[];
  includeUnrecognizedExtensions: boolean;
  scanOnStartup: boolean;
  statusBarEnabled: boolean;
  ribbonEnabled: boolean;
  collapseUnchanged: boolean;
  collapseMargin: number;
  scanLimit: number;
  autosave: boolean;
  autosaveMs: number;
  defaultLeftIsOriginal: boolean;  // true: original left, conflict right
  wrapLines: boolean;
  showIntraLine: boolean;          // highlightChanges
  ribbonConflicts: boolean;
  ribbonDiff: boolean;
}
```

Defaults: Syncthing pattern on, status bar on, both ribbon buttons on, original on the left, wrap on, intra-line on, autosave off, collapse unchanged off.

---

## 8. Commands (all hotkey-bindable)

Register every command with `this.addCommand`. Do not assign default hotkeys except where noted; leave them empty so the user binds them under Settings → Hotkeys. Filter commands with `checkCallback` so hunk actions only enable when a Diff View is active.

Command names must start with `Meld Diff:` so they group in the Hotkeys pane.

### 8.1 Open / place views

| Id | Name | Action |
|---|---|---|
| `open-conflict-view` | Meld Diff: Open conflict view | Reveal existing Conflict View, else open as a main tab |
| `open-conflict-view-new-tab` | Meld Diff: Open conflict view in new tab | Always a new main tab |
| `open-conflict-view-left` | Meld Diff: Open conflict view in left sidebar | `getLeftLeaf(false)` |
| `open-conflict-view-right` | Meld Diff: Open conflict view in right sidebar | `getRightLeaf(false)` |
| `toggle-conflict-view` | Meld Diff: Toggle conflict view | If a Conflict leaf is active, detach it; otherwise reveal-or-open |
| `open-diff-view` | Meld Diff: Open diff view | Reveal most recent Diff View, else open empty Diff as a main tab |
| `open-diff-view-new-tab` | Meld Diff: Open diff view in new tab | Always a new empty Diff tab |
| `open-diff-view-left` | Meld Diff: Open diff view in left sidebar | |
| `open-diff-view-right` | Meld Diff: Open diff view in right sidebar | |
| `toggle-diff-view` | Meld Diff: Toggle diff view | Same toggle pattern as conflicts |

### 8.2 Start a comparison

| Id | Name | Action |
|---|---|---|
| `diff-current-with-other` | Meld Diff: Compare current file with… | Fuzzy-pick a second file; open/reuse Diff (current = left) |
| `diff-current-with-conflict` | Meld Diff: Compare current file with its conflict | If several conflicts, pick one |
| `diff-two-files` | Meld Diff: Compare two files… | Two pickers, then open Diff |
| `diff-current-as-left` | Meld Diff: Set current file as diff left | Reuse active Diff View, or open one |
| `diff-current-as-right` | Meld Diff: Set current file as diff right | Same for the right pane |

### 8.3 Conflict index

| Id | Name | Action |
|---|---|---|
| `scan-conflicts` | Meld Diff: Rescan vault for conflicts | Rebuild index, refresh open Conflict Views |
| `open-next-conflict-diff` | Meld Diff: Open next unresolved conflict | First group in the index that still has a conflict file |

### 8.4 Diff View — navigation and files

These require an active Diff View (`checkCallback`). Suggested optional defaults are listed; do not set them unless the key is free.

| Id | Name | Suggested default | Action |
|---|---|---|---|
| `next-hunk` | Meld Diff: Next change | `Alt+ArrowDown` | Jump to next hunk |
| `prev-hunk` | Meld Diff: Previous change | `Alt+ArrowUp` | Jump to previous hunk |
| `swap-sides` | Meld Diff: Swap left and right | | |
| `save-left` | Meld Diff: Save left file | | |
| `save-right` | Meld Diff: Save right file | | |
| `save-both` | Meld Diff: Save both files | `Mod+Shift+S` when view focused | |
| `pick-left-file` | Meld Diff: Choose left file | | Opens the left file picker |
| `pick-right-file` | Meld Diff: Choose right file | | Opens the right file picker |

`Mod+S` inside the Diff View is handled as an editor command on the focused pane, not only as a plugin command.

### 8.5 Diff View — hunk actions

Operate on the hunk containing the cursor in the focused editor. Same semantics as §6.6.

| Id | Name | Action |
|---|---|---|
| `copy-hunk-to-left` | Meld Diff: Replace left hunk with right | |
| `copy-hunk-to-right` | Meld Diff: Replace right hunk with left | |
| `insert-hunk-above-left` | Meld Diff: Insert right hunk above left | |
| `insert-hunk-below-left` | Meld Diff: Insert right hunk below left | |
| `insert-hunk-above-right` | Meld Diff: Insert left hunk above right | |
| `insert-hunk-below-right` | Meld Diff: Insert left hunk below right | |
| `delete-hunk-left` | Meld Diff: Delete left hunk | |
| `delete-hunk-right` | Meld Diff: Delete right hunk | |

No default hotkeys for hunk actions. Users who want Meld muscle memory can bind them.

---

## 9. File explorer integration

`workspace.on('file-menu')`:

- Always: **Compare with…**
- If the file is an original that has conflicts: **Compare with conflict** (submenu if many)
- If the file is itself a conflict: **Compare with original**
- Two-file selection (when the API/selection allows): **Compare selected files**

---

## 10. Architecture for implementers

```
src/
  main.ts                 Plugin: settings, views, commands, ribbon, menus, index lifecycle
  workspace.ts            revealOrOpenView, sidebar/main/new-tab helpers
  settings.ts             load/save + defaults + presets
  settings-tab.ts
  patterns.ts             glob/regex compile, original path recovery, testers
  index/conflict-index.ts
  views/conflict-view.ts
  views/diff-view.ts      ItemView chrome, state, menus, save/load
  diff/merge-host.ts      constructs MergeView, extensions, theme
  diff/link-map.ts        SVG wave overlay
  diff/hunk-actions.ts    replace / insert above / insert below / delete
  diff/file-suggest.ts    FuzzySuggestModal
  ui/status-bar.ts
  ui/confirm.ts
  css/styles.css
  manifest.json
```

### 10.1 Obsidian integration notes

- Register views in `onload`. On `onunload`, detach only leaves this plugin created if Obsidian does not already do so; do not wipe the user's saved workspace layout while the plugin is merely disabled mid-session beyond the normal Obsidian contract.
- `navigation = true` on **both** views.
- Ribbon icons must be registered with `this.addRibbonIcon` so they disappear on unload.
- Use `this.registerEvent` for vault/workspace events.
- Never call `getLeftLeaf` unless the user picked a “left sidebar” command. Default open path is `workspace.getLeaf('tab')` then `revealLeaf`.
- Use `app.fileManager.processFrontMatter` only if we ever touch frontmatter — we should not.
- Respect `app.vault.getConfig('useTab')` and readable line-width only as CSS; do not reflow markdown.

### 10.2 Theme

Define plugin CSS that colors:

```css
.meld-hunk-change { background: color-mix(in srgb, var(--color-yellow) 22%, transparent); }
.meld-hunk-insert { background: color-mix(in srgb, var(--color-green) 18%, transparent); }
.meld-hunk-delete { background: color-mix(in srgb, var(--color-red) 18%, transparent); }
.cm-mergeView .cm-changedText { background: color-mix(in srgb, var(--color-orange) 35%, transparent); }
```

Do not hard-code dark-theme hex values.

### 10.3 Performance

- Conflict scan is O(files) and cheap; do not read file bodies during scan.
- Diff of huge notes: rely on `scanLimit`; if a file > 1.5 MB, show a warning and still attempt.
- Virtualize the Conflict View list if a vault has > 500 groups (simple folder collapsing is enough for v1).

### 10.4 Testing checklist for the implementer

1. Create `foo.md` and `foo.sync-conflict-20240101-120000-ABCDEF1.md` in the same folder. Conflict View lists `foo.md →` that file.
2. Open Diff; left is `foo.md`, right is the conflict.
3. Change one word on the right: only that word highlights, wave appears, prev/next finds it.
4. Click “copy to left”: left word updates; both dirty; save writes `foo.md`.
5. Ctrl + “insert below” appends the hunk without deleting the existing left hunk.
6. Shift + delete removes the hunk on that side.
7. Header picker can load `bar.md` vs `baz.md` with no conflict relationship.
8. Side ⋮ Delete sends the file to trash and updates the pane.
9. Rename original in explorer: group remaps, open Diff state follows if that path was loaded.
10. Invalid user regex does not crash plugin.
11. Both ribbon buttons appear on the left ribbon and open/reveal the correct view.
12. Drag Conflict View from a main tab into the left sidebar; quit and reopen Obsidian; it comes back in the left sidebar with the same expanded folders.
13. Drag Diff View into the right sidebar; it remains usable; “Open diff view” reveals that sidebar leaf instead of creating a third copy.
14. Every command in §8 shows up under Settings → Hotkeys and can be bound.

---

## 11. Suggested extras (not required for v1, implement if cheap)

Priority order if time remains:

1. After a pair becomes identical, prompt: “Files match. Delete conflict file?”
2. “Resolve” button on a group: keep left / keep right / open diff.
3. Status bar is red when count > 0.
4. Ignore whitespace / ignore case toggles (pass custom diff preprocess).
5. Collapse unchanged regions (MergeView `collapseUnchanged`).
6. Remember last-used pair per original path.
7. Command “resolve next conflict” walks the index.

Do **not** implement three-way merge or folder mode in the first delivery.

---

## 12. Manifest sketch

```json
{
  "id": "meld-diff",
  "name": "Meld Diff",
  "version": "0.1.0",
  "minAppVersion": "1.6.0",
  "description": "Meld-style split diff and merge, plus configurable sync-conflict discovery.",
  "author": "Andrew Pullins",
  "isDesktopOnly": true
}
```

`isDesktopOnly: true` for v1.

---

## 13. Implementation order for Grok Build

Build in this sequence so each step is demoable:

1. Plugin skeleton, settings with Syncthing preset, pattern tester.
2. `ConflictIndex` + Conflict View list + live vault events.
3. Diff View chrome + two file pickers + two independent CM editors + save/load.
4. Swap in `MergeView` with `highlightChanges`.
5. Custom SVG link map waves aligned to chunks.
6. Hunk actions with Meld modifier semantics.
7. Per-side ⋮ menus + `onPaneMenu` + file-explorer commands.
8. Ribbon buttons, full command set from §8, workspace reveal/open helpers, disk-change banners, binary guard.
9. Polish CSS against light and dark default themes.
10. Manual test pass against the checklist in §10.4.

---

## 14. Copy for README (short)

Meld Diff adds two views to Obsidian. Both are normal tabs: park them in the main editor, the left sidebar, or the right sidebar. The left ribbon has a button for each view, and every action is a command you can bind to a hotkey. Conflict View finds files that match your conflict pattern (Syncthing by default: `name.sync-conflict-YYYYMMDD-HHMMSS-DEVICE.ext`) and pairs them with the original note. Diff View is a Meld-like split source editor: line and character diffs, connecting waves, copy left/right, insert above/below, delete hunk, and normal file ⋮ actions on each side. You can also pick any two files to compare.

---

## 15. Open decisions (recommended defaults already applied above)

| Topic | Recommendation |
|---|---|
| Plugin name | Meld Diff |
| Default side | Original left, conflict right |
| Autosave | Off |
| Mobile | Desktop only |
| After identical | Prompt to delete conflict (v1.1 if not in first cut) |
| Include binaries in Conflict View | Yes, but no text diff |
| Markdown widgets in diff | No; color only |
| Default view placement | Main tab; user docks wherever they want |
| Ribbon | Both buttons on |

If the user specifies otherwise before coding starts, update this table and the corresponding section.
