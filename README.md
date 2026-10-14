# PerfectMind Badminton Timetable

Version: 1.0.6. A personal, local Manifest V3 extension for University of Melbourne badminton courts. No server, Node.js or Python is needed to use it.

## Install in Edge

1. Open `edge://extensions` in Microsoft Edge.
2. Turn on **Developer mode**.
3. Click **Load Unpacked**.
4. Select the project folder containing `manifest.json`.
5. Click **PerfectMind Badminton Timetable** in the extensions menu. You can pin its icon to the toolbar.

Chrome also works; its management page is `chrome://extensions`.

To update an existing installation, click **Reload** on its extension card, then reopen the panel. If you installed a copied or unzipped folder, replace that folder's files first.

## InPrivate and sign-in

Opening the extension panel does not require a PerfectMind login. Sign in on the official website only if it requires authentication to display availability or make a booking.

To use the extension in Edge InPrivate:

1. Open `edge://extensions` in a regular Edge window.
2. Click **Details** for **PerfectMind Badminton Timetable**.
3. Enable **Allow in InPrivate**.
4. Open an InPrivate window and click the extension icon.

The extension uses split mode and opens its panel in the window where you clicked the icon. Website cookies are separate in InPrivate: a regular-window PerfectMind login does not sign you into InPrivate. Extension-local availability snapshots are shared between regular and InPrivate windows.

## Use

1. Open the panel and choose dates and times. Initially it checks today through six days later, from 14:00 to 22:00. Your previous query is restored if available.
2. Select **Parallel courts**: 1, 2, 4 (default), or **All 8 at once**. Click **Check availability**. Up to the selected number of official pages load together in inactive tabs in the panel's window. Each tab closes automatically when its court finishes.
3. If sign-in is required, click **Open official login**, sign in yourself, and check availability again.
4. You can switch to other tabs and continue browsing while the official pages load in the background. Keep this panel open: closing it does not support continued checking. **Stop** closes the owned loading tabs, stops queued courts and preserves results already retrieved.
5. Choose **30min**, **1hr**, **1hr30min** or **2hr**. Each panel opens with **1hr** selected and **Hide confirmed empty rows** checked.
6. A highlighted cell means that, starting at that time, every consecutive 30-minute slot has at least one confirmed available court for the selected duration. Switching courts is allowed. The period must fit inside the displayed time range.
7. Click a court badge to open its official timetable. A normal click in the extension also switches **Jump To Date** to the corresponding date. It does not select or reserve a slot.
8. **Export HTML** saves a standalone file with current highlights, colours and official links. View it offline without the extension; automatic official date navigation requires the extension panel. **Export data** saves JSON, including loading diagnostics.

`—` means no available courts were found after a successful check. `?` means a court has not been checked successfully. Unknown or failed results remain visible when empty rows are hidden. Hiding rows does not join separate periods into a continuous period.

Opening `index.html` directly displays the panel, but checking availability requires opening it from the installed extension.

## Data and maintenance

- Access is limited to `https://unimelb.perfectmind.com/*`, script execution and extension-local storage.
- The extension does not collect passwords or export login cookies. Availability, query dates, status and timestamps are saved locally in your browser.
- The extension's interface, messages, date headings and HTML exports are in English. Native browser date/time controls follow your browser or operating system locale.
- Each query is limited to 42 days. The school's booking window may be shorter.
- Query dates use `Australia/Melbourne`. Pagination follows the actual calendar columns, without assuming seven visible days per page.
- Results are snapshots. Courts load in parallel, with dates within each court checked sequentially. Confirm availability and book on the official website.
- Four parallel courts is the default balance between speed and resource use. All eight is available; actual speed depends on the website, connection and browser. Completion status includes elapsed time.
- The collector waits for PerfectMind's own availability request, then reads its populated data. It does not call the unconfigured Kendo `dataSource.read()`, which would clear the slots.
- Changes to the official DOM, date format or initialisation may require updating `collector.js`.

## Files

- `manifest.json`: metadata and permissions.
- `background.js`: opens the panel from the extension icon.
- `index.html` and `style.css`: interface and timetable.
- `app.js`: query orchestration, highlighting, links, storage and exports.
- `collector.js`: reads the official calendar.

## Versions

- **1.0.6**: selectable parallel court loading (1/2/4/8), inactive tabs tied to the panel window, failure isolation, serialised snapshot writes, stop cleanup and elapsed time.
- **1.0.5**: split-mode InPrivate support; opens the panel in the window where its icon was clicked.
- **1.0.4**: English interface, metadata, progress and error messages, date headings, HTML exports and documentation.
- **1.0.3**: whole-cell highlighting with court switching; defaults to 1hr and hidden confirmed empty rows.
- **1.0.2**: duration selector and clickable official court links.
- **1.0.1**: fixed empty results caused by clearing the local calendar data source. Verified all eight courts for 19–20 October 2026 in the installed Edge extension.

Installation reference: [Microsoft Edge documentation](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading).

## Developer verification

With Node.js installed, run `node tests/parallel.test.cjs`. The mocked browser checks concurrency limits, inactive tabs, window isolation, result merging, write ordering, per-court failure and stop cleanup.
