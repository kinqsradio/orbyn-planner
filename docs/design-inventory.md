# Design inventory: Planner against the designs

- **Designs commit:** `718fa7bea400b0d70594d9e61259d89f8d4ef55a` (orbyn-designs `origin/main`, committed 2026-11-07), files `artifacts/planner-designs.html`, `account-designs.html`, `motion-designs.html`.
- **Page versions:** the brief says Planner Designs v36 and Account Designs v53. The HTML files carry no version marker (the version lives on the artifact server), so these are taken from the brief and not verified here.
- **Planner main checked:** `50b5bc2a3eceba9dbe429ad9ec90cc8d41a8a1b3`. Date: 2026-11-08.
- **Method:** `npx vite --port 5340` on `web/`, headless Chromium (Playwright), device-only mode on sample data from the designs, clock fixed to Sat 7 Nov 2026 08:30 UTC, reduced motion on. Each checked frame was rendered at the design frame size in Light, Dark and Dim next to the design frame (window title bar hidden) and read in all three themes. Copy was also diffed as text.
- **Screenshots** are not committed. Files live in the author’s scratch folder as `design-<id>-<theme>.png`, `build-<id>-<theme>.png` and a three-theme side-by-side `cmp-<id>.png`.
- **Status words.** *matched*: layout, copy, sizes and colours agree in all three themes and I looked at it. *partial*: built, with the listed differences. *not built*: no code for it (the cell says how that was established). *gated*: the frame’s own note says it is not shown today or is Planned. *in progress*: Settings frames being built on the unmerged `feat/settings-copy`; not screenshotted. *not checked yet*: not compared; the component is only a pointer from reading the code.
- **Left out of every “differs” cell** because they hold for all frames and need things this device-only run cannot provide: (G1) the design sidebar has a Booking item and a Notifications count, the build has neither (nav.ts:11; booking and sharing are not built); (G2) the sync pill reads “Synced · 3 devices” in the design and “Connected” in the build, since real sync needs an account and engine; (G3) “Good morning, Sam” needs an account name, the build says “Good morning”; (G4) the design draws a window title bar, the web build has none.

## Counts

| Page / area | Frames | matched | partial | not built | gated | in progress | not checked yet |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Planner Designs (all)** | **126** | **0** | **35** | **30** | **8** | **26** | **27** |
| Planner · Getting started | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| Planner · Search | 2 | 0 | 0 | 0 | 0 | 0 | 2 |
| Planner · Empty, loading and error states | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| Planner · Today | 13 | 0 | 12 | 0 | 1 | 0 | 0 |
| Planner · Calendar | 18 | 0 | 8 | 4 | 0 | 0 | 6 |
| Planner · Tasks | 20 | 0 | 10 | 9 | 0 | 0 | 1 |
| Planner · Lists | 5 | 0 | 1 | 3 | 0 | 0 | 1 |
| Planner · Sharing | 5 | 0 | 0 | 5 | 0 | 0 | 0 |
| Planner · Completed and deleted | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| Planner · Projects | 4 | 0 | 3 | 0 | 0 | 0 | 1 |
| Planner · Booking | 8 | 0 | 0 | 8 | 0 | 0 | 0 |
| Planner · Notifications | 4 | 0 | 0 | 0 | 2 | 0 | 2 |
| Planner · Settings | 31 | 0 | 0 | 0 | 5 | 26 | 0 |
| Planner · Account and auth | 8 | 0 | 0 | 0 | 0 | 0 | 8 |
| Planner · Phone | 5 | 0 | 0 | 0 | 0 | 0 | 5 |
| **Account Designs (all)** | **128** | **0** | **0** | **0** | **13** | **14** | **101** |
| Account · Account site | 14 | 0 | 0 | 0 | 5 | 0 | 9 |
| Account · Delete account | 40 | 0 | 0 | 0 | 0 | 0 | 40 |
| Account · Protection | 24 | 0 | 0 | 0 | 8 | 14 | 2 |
| Account · Sign-up | 2 | 0 | 0 | 0 | 0 | 0 | 2 |
| Account · Keys and devices | 10 | 0 | 0 | 0 | 0 | 0 | 10 |
| Account · Two-factor | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| Account · Emails | 10 | 0 | 0 | 0 | 0 | 0 | 10 |
| Account · Witness | 6 | 0 | 0 | 0 | 0 | 0 | 6 |
| Account · Key service | 9 | 0 | 0 | 0 | 0 | 0 | 9 |
| Account · Start over | 6 | 0 | 0 | 0 | 0 | 0 | 6 |
| Account · Consent | 2 | 0 | 0 | 0 | 0 | 0 | 2 |
| Account · Launcher | 3 | 0 | 0 | 0 | 0 | 0 | 3 |
| Account · Phone | 1 | 0 | 0 | 0 | 0 | 0 | 1 |

Deep pass (Today, calendar, tasks) is complete. Everything else is marked *not checked yet* unless the code shows the feature is absent or the frame note says it is gated. Frames outside this repository (account site, email, witness, key service, launcher) are listed with the owner and not compared.

## Planner Designs (v36 per the brief)

### Getting started

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `first-run` First run | none found (App.tsx has no first-run steps) | not built | – | no code for the three set-up steps; grep finds no "When your week starts" |

### Today

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `today` Today | `features/today/TodayPage.tsx:150` | partial | `cmp-today.png` | no difference left after fix/done-rows (to re-check) |
| `sync-waiting` Offline, waiting to sync | `features/today/TodayPage.tsx:291, features/sync/SyncLine.tsx:29` | partial | `cmp-sync-waiting.png` | popover is narrower |
| `p-today-empty` Today · Nothing planned | `features/today/TodayPage.tsx:316` | partial | `cmp-p-today-empty.png` | empty block sits higher and has a hairline above it (app.css:131); design starts the heading about 45px lower with no rule |
| `p-today-loading` Today · Loading | `features/today/TodayPage.tsx:266` | partial | `cmp-p-today-loading.png` | "New task" is disabled and dimmed (TodayPage.tsx:271), design keeps it active; skeleton rows are one full-width bar with no row dot, design uses varied widths and a dot; the 400 ms wait is built (TodayPage.tsx:66) |
| `p-today-error` Today · Error | `features/today/TodayPage.tsx:40 (TodayError, exported, never rendered)` | gated | – | frame note: shown only when the local store reports a read failure, which it does not yet; not screenshotted |
| `p-today-syncing` Today · Syncing | `features/sync/SyncLine.tsx:72` | partial | `cmp-p-today-syncing.png` | no difference left after feat/sync-pill (to re-check by eye) |
| `p-today-sync-failed` Today · Couldn’t sync | `features/sync/SyncLine.tsx:90` | partial | `cmp-p-today-sync-failed.png` | no difference left after feat/sync-pill (to re-check by eye) |
| `p-today-all-day` Today · All-day events | `features/today/TodayPage.tsx:87-109, :330` | partial | `cmp-p-today-all-day.png` | week column counts the tiling event on Sun 8 (Coming up 12, design 11: the design data says "day 2 of 3" yet leaves Sun 8 alone) |
| `p-today-long` Today · A long day | `features/today/TodayPage.tsx:150` | partial | `cmp-p-today-long.png` | Today shows 13 vs 14: the 07:30 event has ended at 08:30 and the build counts only what is still to come (TodayPage.tsx:223) |
| `p-today-goal-labels` Today · Progress goal labels | `features/today/TodayPage.tsx:29 (goalLabel), :212` | partial | – | "goal yesterday" can never show: Progress keeps only goals from today on (TodayPage.tsx:212). Today, tomorrow and weekday labels read as designed in the DOM; "goal 14 Nov" is by code only. No screenshots |
| `p-today-week-empty` Today · Empty days in the week | `features/today/TodayPage.tsx:139` | partial | `cmp-p-today-week-empty.png` | no difference left after fix/done-rows; "Nothing planned" in the quiet colour matches. |
| `p-today-overnight` Today · Events across midnight | `features/today/TodayPage.tsx:87-109, :124` | partial | `cmp-p-today-overnight.png` | "Until 06:00" and "Started yesterday 22:00" match |
| `p-today-overnight-long` Today · Events across several days | `features/today/TodayPage.tsx:87-109` | partial | `cmp-p-today-overnight-long.png` | multi-day all-day event reads "Conference: Lisbon · day 3 of 5" with the calendar name; design shows the plain title and "Mon 9 Nov – Fri 13 Nov" (the design frames disagree: p-today-all-day wants "· day 2 of 3"); week column lists 6 days, design 4 |

### Tasks

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `work-list` Tasks · List | `features/tasks/TasksPage.tsx:80` | partial | `cmp-work-list.png` | header has "Completed and deleted" where design has "View options" (TasksPage.tsx:102); due filter is four radio pills and one "Any list" select, design has Any due date / Any priority / Any list / Anyone chips (TasksPage.tsx:109-150); no Owner column or Blocked status (TaskRow.tsx:41) |
| `work-board` Tasks · Board | `features/tasks/TasksPage.tsx:178` | partial | `cmp-work-board.png` | two lanes (To do, Done); design has four (To do, In progress, Blocked, Done) and a progress bar on cards; Task has no status field (types.ts:19) |
| `new-task` New task | `features/tasks/NewTaskDialog.tsx:15` | partial | `cmp-new-task.png` | full form with native date/time inputs, selects and a Project select, under a scrim; design is a compact card: Title, Due, List, then Repeat / Reminder / Priority as value rows |
| `task-panel` Task panel | `features/tasks/TaskPanel.tsx:26` | partial | `cmp-task-panel.png` | panel is a form: title input, native date and time, selects, Tags input, "Add a step"; design is key/value rows; "Linked" cross-app card not built |
| `p-task-loading` Task panel · Loading | none found | not built | – | TaskPanel renders from the store at once; no loading state (grep: no skeleton in features/tasks) |
| `p-task-error` Task panel · Error | `features/tasks/TaskPanel.tsx:101` | not built | – | only a save error ("Couldn’t save that change."); no "can’t be opened" state with Retry |
| `p-task-subtasks` Task panel · Subtasks | `features/tasks/TaskPanel.tsx (checklist)` | partial | – | checklist steps have title and done only (types.ts:11), no date or person; not looked at |
| `p-task-attachments` Task panel · Attachments | none found | not built | – | grep for "attach" finds nothing |
| `p-task-recurring` Task panel · Repeat | `features/tasks/RepeatPicker.tsx:92` | partial | `cmp-p-task-recurring.png` | Repeat is a select of presets; design opens an inline editor (Daily / Weekly / Monthly / Yearly, weekday dots, Every N, Ends, a "Next: …" line, Never repeat / Done) |
| `p-task-reminder` Task panel · Reminder picker | `features/tasks/reminder.ts:12` | not checked yet | – | build uses a native select (seen in task-panel capture) |
| `p-task-comments` Task panel · Comments and activity | none found | not built | – | grep for "comment" finds nothing |
| `p-task-assignee` Task panel · Assignee picker | none found | not built | – | Task has no assignee field (types.ts:19) |
| `p-task-date` Task panel · Date picker | `features/tasks/TaskPanel.tsx` | partial | – | native date and time inputs (seen in task-panel capture), design has a small month, a time and four shortcuts; picker itself not captured |
| `p-task-move` Task panel · Move to a list | `features/tasks/TaskPanel.tsx` | partial | – | a List select (seen in task-panel capture), design has a searchable list with the current one marked |
| `p-task-delete` Task panel · Deleted, with undo | `features/tasks/TaskPanel.tsx:132, components/Toast.tsx:62` | partial | `cmp-p-task-delete.png` | toast is a centred dark pill "Task deleted · Undo"; design: bottom-right card with the task name and "Kept for 30 days"; panel closes to nothing, design shows "No task selected" |
| `p-lists-no-results` Tasks · Filtered with no results | `features/tasks/TasksPage.tsx:153` | partial | `cmp-p-lists-no-results.png` | build says "No tasks match / Try another filter." with no way to clear; design names the filters, shows removable chips and "Remove Owner" / "Clear filters" buttons |
| `p-lists-bulk` Tasks · Bulk select | none found | not built | – | grep for "bulk" finds nothing |
| `p-board-drag` Board · Drag in progress | none found | not built | – | no drag code in features (grep: no draggable or drag handlers) |
| `task-notes` Task panel with linked notes | none found | not built | – | no link to Notes in TaskPanel |
| `task-notes-none` Notes not on this device | none found | not built | – | no link to Notes in TaskPanel |

### Lists

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `lists` Lists | `features/lists/ListsPage.tsx:57` | partial | `cmp-lists.png` | header shows four colour swatches and "Completed and deleted"; design has "Share" and "Shared with Maya" (sharing not built) |
| `p-lists-empty` Lists · Empty list | `features/lists/ListsPage.tsx:57` | not checked yet | – |  |
| `p-lists-loading` Lists · Loading | `features/lists/ListsPage.tsx:59` | not built | – | `ready` only disables "New list" (:122); no skeleton rows |
| `p-lists-error` Lists · Error | none found | not built | – | no list error state in ListsPage |
| `p-lists-offline` Lists · Offline | none found | not built | – | SyncLine is used on Today only (grep), so Lists shows no offline state |

### Completed and deleted

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `trash` Completed and deleted | `features/completed/CompletedPage.tsx:11` | partial | `cmp-trash.png` | dates read "5 Nov", design "Thu 5"; done titles are faded, design keeps full contrast |

### Projects

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `projects` Projects | `features/projects/ProjectsPage.tsx:14` | partial | `cmp-projects.png` | due reads "30 Jan 2027", design "Jan 30"; otherwise table, filters and meter match |
| `project-detail` Project | `features/projects/ProjectPage.tsx:258` | partial | `cmp-project-detail.png` | header has All projects / Edit / Mark done, design Share; sections carry reorder, rename and delete controls and an "Add a section" form; no "Shared with" panel; dates "Mon" vs "Mon 9"; due "30 Jan 2027" vs "30 Jan" |
| `project-board` Project · Board | `features/projects/ProjectPage.tsx:177` | partial | `cmp-project-board.png` | a "Move to" link under every card; no assignee on cards ("Mon 9 · Maya"); dates "Mon" vs "Mon 9"; header buttons as above |
| `p-project-archived` Project · Archived | `features/projects/ProjectsPage.tsx:14` | not checked yet | – |  |

### Sharing

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `share` Share a list or project | none found | not built | – | no sharing UI; grep finds no invite or permission code |
| `p-share-pending` Share · Invite pending | none found | not built | – | no sharing UI |
| `p-share-permission` Share · Change permission | none found | not built | – | no sharing UI |
| `p-share-remove` Share · Remove a person | none found | not built | – | no sharing UI |
| `p-share-advanced` Share · Link sharing off | none found | not built | – | no sharing UI |

### Calendar

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `p-cal-day-empty-phone` Calendar · Phone day view, empty day | `features/calendar/CalendarPage.tsx:47` | not built | `cmp-p-cal-day-empty-phone.png` | phone shows the desktop Day view (time grid, "Tasks today 0 / No tasks for this day"); design has a month title, a five-day strip and "Nothing planned" |
| `calendar-week` Calendar · Week | `features/calendar/CalendarPage.tsx:47, features/calendar/TimeGrid.tsx:36` | partial | `cmp-calendar-week.png` | 7 columns Mon–Sun, design 5 (Tue–Sat); hours labelled every hour from 07:00, design every two hours from 9:00; toolbar adds a "Calendars" button; "Due this week" lists today’s tasks too, design only overdue and later; event time "09:00" vs "9:00" |
| `calendar-day` Calendar · Day | `features/calendar/CalendarPage.tsx:47, features/calendar/TimeGrid.tsx:36` | partial | `cmp-calendar-day.png` | toolbar has Month and Calendars, design Week / Day / Agenda only; hours every hour from 07:00 vs every two hours; "Tasks today" lists all open tasks |
| `calendar-agenda` Calendar · Agenda | `features/calendar/AgendaView.tsx:17` | partial | `cmp-calendar-agenda.png` | matches in structure; toolbar pills differ (Month, Day, Calendars extra); row meta joins place and length ("Room 3 · 1h"), design shows one; no "Every Tuesday" note |
| `calendar-month` Calendar · Month | `features/calendar/MonthView.tsx:11` | partial | `cmp-calendar-month.png` | toolbar as above; cells show three items then "+1 more", design lists items as dot and title |
| `event-panel` Event panel | `features/calendar/EventPanel.tsx:16` | partial | `cmp-event-panel.png` | editable form (native date and time, selects, EventPanel.tsx:195) vs key/value rows; with the panel open the toolbar pills wrap onto several lines |
| `new-event` New event | `features/calendar/NewEventDialog.tsx:13` | partial | `cmp-new-event.png` | native date and two time inputs and an All day checkbox, design one "When" line; calendar is a select; extra scrim |
| `calendar-manage` Calendars | `features/calendar/CalendarsDialog.tsx:9, features/calendar/CalendarList.tsx:86` | partial | `cmp-calendar-manage.png` | rows carry four colour swatches, Rename and a Shown toggle; design rows are name and "Shown" text; "Family · shared" needs sharing (not built); a failed subscription row exists (CalendarList.tsx:72) |
| `p-event-invitees` Event panel · Invitees and replies | `features/calendar/EventPanel.tsx:16` | not checked yet | – | Event has `people` with responses (types.ts:112) |
| `p-event-recurring` Event panel · Edit a repeating event | `features/calendar/ScopeDialog.tsx:22` | not checked yet | – |  |
| `p-event-conflict` Event panel · Conflict | none found | not checked yet | – |  |
| `p-event-video` Event panel · Video link | none found | not built | – | no video-link field on CalendarEvent (types.ts:103) |
| `p-event-delete` Event panel · Delete | `features/calendar/EventPanel.tsx:16` | not checked yet | – |  |
| `p-cal-loading` Calendar · Loading | none found | not built | – | CalendarPage never reads `ready`; no loading state |
| `p-cal-sync-error` Calendar · Sync error, outside calendar | `features/calendar/CalendarList.tsx:72` | not checked yet | – | a subscription refresh error shows in the Calendars dialog only |
| `p-cal-all-day` Calendar · All-day and multi-day | `features/calendar/TimeGrid.tsx:36` | partial | `cmp-p-cal-all-day.png` | a multi-day event is cut into one small chip per day column ("Home renova…"); design draws one bar across Tue–Thu labelled "… · Tue 3 to Thu 5"; the design frame also has no side summary |
| `p-cal-time-zone` Calendar · Time zones | `store/occurrences.ts:52` | not checked yet | – |  |
| `p-cal-busy-only` Calendar · Busy-only shared calendar | none found | not built | – | needs shared calendars (not built) |

### Booking

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `booking` Booking pages | none found | not built | – | no booking code; grep for "booking" finds nothing |
| `booking-new` New booking page | none found | not built | – | no booking code; grep for "booking" finds nothing |
| `booking-public` Public booking page | none found | not built | – | no booking code; grep for "booking" finds nothing |
| `booking-form` Request a time | none found | not built | – | no booking code; grep for "booking" finds nothing |
| `booking-sent` Request sent | none found | not built | – | no booking code; grep for "booking" finds nothing |
| `booking-none` No times and a taken slot | none found | not built | – | no booking code; grep for "booking" finds nothing |
| `booking-accepted` Accepted into the calendar | none found | not built | – | no booking code; grep for "booking" finds nothing |
| `booking-phone` Booking on a phone | none found | not built | – | no booking code; grep for "booking" finds nothing |

### Notifications

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `notifications` Notifications | `features/notifications/NotificationsPage.tsx:14` | not checked yet | – |  |
| `p-notif-empty` Notifications · Empty | `features/notifications/NotificationsPage.tsx:14` | not checked yet | – |  |
| `p-notif-grouped` Notifications · Grouped | none found | gated | – | frame note: Planned, needs sharing or connected apps |
| `p-notif-snooze` Notifications · Snooze a reminder | none found | gated | – | frame note: Planned, needs sharing |

### Search

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `search` Search or add | `features/search/SearchDialog.tsx:26` | not checked yet | – | dialog exists; copy and layout not compared |
| `p-search-none` Search · No results | `features/search/SearchDialog.tsx:26` | not checked yet | – |  |

### Empty, loading and error states

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `empty-error` Empty, loading and error states | `components/EmptyState.tsx:4` | not checked yet | – |  |

### Settings

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `settings-account` Settings · Account and devices | `features/settings/SettingsPage.tsx:18, features/auth/AccountSettings.tsx:317` | in progress (feat/settings-copy) | – |  |
| `add-device` Approve a new sign-in | `features/auth/PendingScreen.tsx:11` | in progress (feat/settings-copy) | – |  |
| `settings` Settings · Planning | `features/settings/SettingsPage.tsx:18` | in progress (feat/settings-copy) | – |  |
| `settings-notifications` Settings · Notifications | `features/settings/NotificationsSettings.tsx:21` | in progress (feat/settings-copy) | – |  |
| `p-set-notif-reminders-off` Settings · Notifications · Reminders off | `features/settings/NotificationsSettings.tsx:21` | in progress (feat/settings-copy) | – |  |
| `p-set-notif-reminders-asking` Settings · Notifications · Asking for permission | `features/settings/NotificationsSettings.tsx:21` | in progress (feat/settings-copy) | – |  |
| `p-set-notif-reminders-blocked` Settings · Notifications · Blocked in the browser | `features/settings/NotificationsSettings.tsx:21` | in progress (feat/settings-copy) | – |  |
| `p-set-notif-unsupported` Settings · Notifications · No notification support | `features/settings/NotificationsSettings.tsx:21` | in progress (feat/settings-copy) | – |  |
| `connected-apps` Settings · Connected apps | none found | in progress (feat/settings-copy) | – |  |
| `settings-calendars` Settings · Calendars | `features/calendar/CalendarList.tsx:86` | in progress (feat/settings-copy) | – |  |
| `settings-privacy` Settings · Data protection | `features/auth/ProtectionSettings.tsx:164` | in progress (feat/settings-copy) | – |  |
| `advanced-on` Turn on Advanced protection | `features/auth/ProtectionSettings.tsx:164` | gated | – | frame note: Advanced is Planned |
| `web-approve` Approve the web for an hour | none found | in progress (feat/settings-copy) | – |  |
| `p-set-account-loading` Settings · Account · Loading | `features/settings/SettingsPage.tsx:18` | in progress (feat/settings-copy) | – |  |
| `p-set-account-error` Settings · Account · Save error | `features/settings/SettingsPage.tsx:18` | in progress (feat/settings-copy) | – |  |
| `p-set-planning-loading` Settings · Planning · Loading | `features/settings/SettingsPage.tsx:18` | in progress (feat/settings-copy) | – |  |
| `p-set-planning-error` Settings · Planning · Save error | `features/settings/SettingsPage.tsx:18` | in progress (feat/settings-copy) | – |  |
| `p-set-notifications-loading` Settings · Notifications · Loading | `features/settings/NotificationsSettings.tsx:21` | gated | – | frame note: not shown today (preferences are local); settings-copy also touches this file |
| `p-set-notifications-error` Settings · Notifications · Save error | `features/settings/NotificationsSettings.tsx:21` | gated | – | frame note: not shown today (preferences are local); settings-copy also touches this file |
| `p-set-connected-apps-loading` Settings · Connected apps · Loading | none found | in progress (feat/settings-copy) | – |  |
| `p-set-connected-apps-error` Settings · Connected apps · Save error | none found | in progress (feat/settings-copy) | – |  |
| `p-set-calendars-loading` Settings · Calendars · Loading | `features/calendar/CalendarList.tsx:86` | in progress (feat/settings-copy) | – |  |
| `p-set-calendars-error` Settings · Calendars · Save error | `features/calendar/CalendarList.tsx:86` | in progress (feat/settings-copy) | – |  |
| `p-set-privacy-loading` Settings · Privacy · Loading | `features/auth/ProtectionSettings.tsx:164` | gated | – | frame note: not shown today (preferences are local); settings-copy also touches this file |
| `p-set-privacy-error` Settings · Privacy · Save error | `features/auth/ProtectionSettings.tsx:164` | gated | – | frame note: not shown today (preferences are local); settings-copy also touches this file |
| `p-export-dialog` Settings · Privacy · Export your data | `features/export/ExportSettings.tsx:15` | in progress (feat/settings-copy) | – |  |
| `p-export-busy` Settings · Privacy · Exporting | `features/export/ExportSettings.tsx:15` | in progress (feat/settings-copy) | – |  |
| `p-export-done` Settings · Privacy · Exported | `features/export/ExportSettings.tsx:15` | in progress (feat/settings-copy) | – |  |
| `p-export-failed` Settings · Privacy · Export failed | `features/export/ExportSettings.tsx:15` | in progress (feat/settings-copy) | – |  |
| `p-set-privacy-verified-removed` Settings · Privacy · Verified, other device | `features/auth/ProtectionSettings.tsx:164` | in progress (feat/settings-copy) | – |  |
| `p-set-privacy-verified-this-device` Settings · Privacy · Verified, signed on this device | `features/auth/ProtectionSettings.tsx:164` | in progress (feat/settings-copy) | – |  |

### Account and auth

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `landing` Landing | `features/auth/AuthScreens.tsx:20` | not checked yet | – | grep matches 4 of 6 lines |
| `sign-up` Sign up | `features/auth/AuthScreens.tsx:197` | not checked yet | – |  |
| `verify` Verify your email | `features/auth/AuthScreens.tsx:46` | not checked yet | – |  |
| `p-verify-ready` Verify your email · Send a new code | `features/auth/AuthScreens.tsx:46` | not checked yet | – |  |
| `p-verify-throttled` Verify your email · Too many codes | `features/auth/AuthScreens.tsx:46` | not checked yet | – |  |
| `sign-in` Sign in | `features/auth/AuthScreens.tsx:256` | not checked yet | – |  |
| `p-sign-in-local` Sign in · from inside the planner | `features/auth/AuthScreens.tsx:256` | not checked yet | – |  |
| `recovery` Recover your account | `features/auth/AuthScreens.tsx:398` | not checked yet | – |  |

### Phone

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `phone` Today, a list and offline on a phone | `app/App.tsx:103 (tab bar), features/today/TodayPage.tsx:150` | not checked yet | – | phone Today uses the "Today" title and a week fold (TodayPage.tsx:353) |
| `p-phone-task` Phone · Task as a sheet | `features/tasks/TaskPanel.tsx:26` | not checked yet | – |  |
| `p-phone-week` Phone · Calendar week | `features/calendar/CalendarPage.tsx:47` | not checked yet | – | p-cal-day-empty-phone shows the phone calendar has no day strip; this frame itself not compared |
| `p-phone-empty` Phone · Empty states | `features/today/TodayPage.tsx:316` | not checked yet | – |  |
| `p-phone-offline` Phone · Offline | `features/sync/SyncLine.tsx:29` | not checked yet | – |  |

## Account Designs (v53 per the brief)

### Account site

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `overview` Overview | not in this repo (the account site) | gated | – | frame note: Planned, data-gated |
| `devices` Devices | not in this repo (the account site) | not checked yet | – | other repo |
| `remove-device` Remove a device | not in this repo (the account site) | gated | – | frame note: Planned, data-gated |
| `approve-sign-in` Approve a new sign-in | not in this repo (the account site) | not checked yet | – | other repo |
| `protection` Data protection | not in this repo (the account site) | not checked yet | – | other repo |
| `advanced-flow` Turn on Advanced protection | not in this repo (the account site) | gated | – | frame note: Planned, data-gated |
| `recovery` Recovery | not in this repo (the account site) | gated | – | frame note: Planned, data-gated |
| `recover` Recover with a key | not in this repo (the account site) | gated | – | frame note: Planned, data-gated |
| `connected` Connected apps and grants | not in this repo (the account site) | not checked yet | – | other repo |
| `grant` A grant in detail | not in this repo (the account site) | not checked yet | – | other repo |
| `billing` Plan and billing | not in this repo (the account site) | not checked yet | – | other repo |
| `payment-failed` Payment failed | not in this repo (the account site) | not checked yet | – | other repo |
| `family` Family | not in this repo (the account site) | not checked yet | – | other repo |
| `account-states` Empty, loading and offline | not in this repo (the account site) | not checked yet | – | other repo |

### Delete account

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `del-entry` Delete account in Settings | `features/auth/DeleteAccount.tsx:227, features/auth/AccountSettings.tsx:317` | not checked yet | – |  |
| `del-entry-planner` Delete account in Planner settings | `features/auth/DeleteAccount.tsx:227, features/auth/AccountSettings.tsx:317` | not checked yet | – |  |
| `del-dialog` Confirm deletion | `features/auth/DeleteAccount.tsx:41` | not checked yet | – |  |
| `del-dialog-ready` Confirm deletion, code entered | `features/auth/DeleteAccount.tsx:41` | not checked yet | – |  |
| `del-dialog-recovery` Confirm with a recovery code | `features/auth/DeleteAccount.tsx:41` | not checked yet | – |  |
| `del-dialog-stale` Sign-in too old | `features/auth/DeleteAccount.tsx:41` | not checked yet | – |  |
| `del-dialog-untrusted` Not a trusted device | `features/auth/DeleteAccount.tsx:41` | not checked yet | – |  |
| `del-scheduled` Deletion scheduled | `features/auth/DeletionBanner.tsx:78` | not checked yet | – |  |
| `del-banner` Banner during the 7 days | `features/auth/DeletionBanner.tsx:78` | not checked yet | – |  |
| `del-banner-tomorrow` Banner the day before | `features/auth/DeletionBanner.tsx:78` | not checked yet | – |  |
| `del-banner-today` Banner on the last day | `features/auth/DeletionBanner.tsx:78` | not checked yet | – |  |
| `del-row-grace` Settings during the 7 days | `features/auth/DeleteAccount.tsx:227, features/auth/AccountSettings.tsx:317` | not checked yet | – |  |
| `del-frozen` Paused actions: protection | `features/auth/ProtectionSettings.tsx:164` | not checked yet | – |  |
| `del-frozen-devices` Paused actions: devices | `features/auth/DeleteAccount.tsx:227, features/auth/AccountSettings.tsx:317` | not checked yet | – |  |
| `del-cancelled` Deletion cancelled in the app | `features/auth/DeletionBanner.tsx:78` | not checked yet | – |  |
| `del-mail` Cancel from the email link | `features/auth/CancelDeletionPage.tsx:50` | not checked yet | – |  |
| `del-choose` The account was deleted: export or remove (Mac app) | desktop app (desktop/), not web/src | not checked yet | – |  |
| `del-exported` After exporting (Mac app) | desktop app (desktop/), not web/src | not checked yet | – |  |
| `del-dialog-wrong` Wrong two-factor code | `features/auth/DeleteAccount.tsx:41` | not checked yet | – |  |
| `del-dialog-recovery-wrong` Wrong recovery code | `features/auth/DeleteAccount.tsx:41` | not checked yet | – |  |
| `del-dialog-busy` Deleting… | `features/auth/DeleteAccount.tsx:41` | not checked yet | – |  |
| `del-dialog-check-failed` Couldn’t check two-factor | `features/auth/DeleteAccount.tsx:41` | not checked yet | – |  |
| `del-cancel-busy` Cancelling… (banner and settings row) | `features/auth/DeleteAccount.tsx:227, features/auth/AccountSettings.tsx:317` | not checked yet | – |  |
| `del-cancel-error` Couldn’t cancel deletion (banner and settings row) | `features/auth/DeleteAccount.tsx:227, features/auth/AccountSettings.tsx:317` | not checked yet | – |  |
| `del-removing` Removing this device’s copy (Mac app, after Remove it now) | desktop app (desktop/), not web/src | not checked yet | – |  |
| `del-final` Opening an app after deletion (Mac app) | desktop app (desktop/), not web/src | not checked yet | – |  |
| `del-choose-web` The account was deleted: export or remove (web) | `features/auth/DeletedAccount.tsx:41` | not checked yet | – |  |
| `del-exported-web` After exporting (web) | `features/auth/DeletedAccount.tsx:41` | not checked yet | – |  |
| `del-export-failed` Export failed (web) | `features/auth/DeletedAccount.tsx:41` | not checked yet | – |  |
| `del-remove-failed` Remove failed (web) | `features/auth/DeletedAccount.tsx:41` | not checked yet | – |  |
| `del-exporting-web` Exporting… (web) | `features/auth/DeletedAccount.tsx:41` | not checked yet | – |  |
| `del-removing-busy-web` Removing… on the button (web) | `features/auth/DeletedAccount.tsx:41` | not checked yet | – |  |
| `del-exporting` Exporting… (Mac app) | desktop app (desktop/), not web/src | not checked yet | – |  |
| `del-removing-busy` Removing… on the button (Mac app) | desktop app (desktop/), not web/src | not checked yet | – |  |
| `del-checking-web` Checking your account… (web) | `features/auth/DeletedAccount.tsx:41` | not checked yet | – |  |
| `del-removing-web` Removing this browser’s copy (web) | `features/auth/DeletedAccount.tsx:41` | not checked yet | – |  |
| `del-final-web` Opening the web app after deletion | `features/auth/DeletedAccount.tsx:41` | not checked yet | – |  |
| `del-final-nothing` Nothing to remove (web) | `features/auth/DeletedAccount.tsx:41` | not checked yet | – |  |
| `del-removal-phone` The deleted-account flow on a phone | `features/auth/DeletedAccount.tsx:41` | not checked yet | – |  |
| `del-phone` Delete account on a phone | `features/auth/DeleteAccount.tsx:41` | not checked yet | – |  |

### Protection

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `pv-standard-planned` Standard protection, Planned (today) | `features/auth/ProtectionSettings.tsx:164` | in progress (feat/settings-copy) | – | file touched by the branch |
| `pv-standard-offer` Turn on Standard protection? (After slice 8; not built) | none found | gated | – | title says "After slice 8; not built" |
| `pv-standard-offer-planner` Standard offer in Planner Settings (After slice 8; not built) | none found | gated | – | title says "After slice 8; not built" |
| `pv-standard-offer-untrusted` Standard offer on a device that isn’t trusted (After slice 8; not built) | none found | gated | – | title says "After slice 8; not built" |
| `pv-standard-offer-busy` Turning on Standard… (After slice 8; not built) | none found | gated | – | title says "After slice 8; not built" |
| `pv-standard-offer-done` Standard protection is on (After slice 8; not built) | none found | gated | – | title says "After slice 8; not built" |
| `pv-standard-offer-failed` Couldn’t turn on Standard (After slice 8; not built) | none found | gated | – | title says "After slice 8; not built" |
| `pv-advanced-confirm` Turn on Advanced protection? Switching from Standard | none found | gated | – | frame note: Advanced and recovery are Planned |
| `pv-advanced-confirm-new` Turn on Advanced protection? Account never had a server copy | none found | gated | – | frame note: Advanced and recovery are Planned |
| `pv-card` Protection card, every state | `features/auth/ProtectionSettings.tsx:164` | in progress (feat/settings-copy) | – | frame also says "not shown today" |
| `pv-card-loading` Protection card, checking | `features/auth/ProtectionSettings.tsx:71, :124, :164` | in progress (feat/settings-copy) | – | file touched by the branch |
| `pv-card-error` Protection card, couldn’t check | `features/auth/ProtectionSettings.tsx:71, :124, :164` | in progress (feat/settings-copy) | – | file touched by the branch |
| `pv-verified` Protection, verified | `features/auth/ProtectionSettings.tsx:164` | in progress (feat/settings-copy) | – | frame also says "not shown today" |
| `pv-rollback` Protection, can’t confirm | `features/auth/ProtectionSettings.tsx:71, :124, :164` | in progress (feat/settings-copy) | – | file touched by the branch |
| `pv-details` Protection details | `features/auth/ProtectionSettings.tsx:71, :124, :164` | in progress (feat/settings-copy) | – | file touched by the branch |
| `pv-details-unlisted` Protection details: signer not listed | `features/auth/ProtectionSettings.tsx:71, :124, :164` | in progress (feat/settings-copy) | – | file touched by the branch |
| `pv-notif-row` Protection change in an app’s notifications | `features/notifications/NotificationsPage.tsx:14` | not checked yet | – |  |
| `pv-confirm` Confirm your protection level | `features/auth/ProtectionSettings.tsx:71, :124, :164` | in progress (feat/settings-copy) | – | file touched by the branch |
| `pv-confirm-unset` Confirm: no level set yet | `features/auth/ProtectionSettings.tsx:71, :124, :164` | in progress (feat/settings-copy) | – | file touched by the branch |
| `pv-confirm-failed` Confirm couldn’t finish | `features/auth/ProtectionSettings.tsx:71, :124, :164` | in progress (feat/settings-copy) | – | file touched by the branch |
| `pv-busy` Busy buttons | `features/auth/ProtectionSettings.tsx:71, :124, :164` | in progress (feat/settings-copy) | – | file touched by the branch |
| `pv-confirm-conflict` Changed on another device first | `features/auth/ProtectionSettings.tsx:71, :124, :164` | in progress (feat/settings-copy) | – | file touched by the branch |
| `pv-notice` Protection was changed on another device | `features/auth/ProtectionSettings.tsx:71, :124, :164` | in progress (feat/settings-copy) | – | file touched by the branch |
| `pv-phone` Protection and sign-up on a phone | `features/auth/ProtectionSettings.tsx:164` | not checked yet | – |  |

### Sign-up

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `pv-signup-code` Check your email: 6-digit code | `features/auth/AuthScreens.tsx:46` | not checked yet | – |  |
| `pv-no-memory` Sign-up: this browser can’t hold the account | `features/auth/AuthScreens.tsx:168` | not checked yet | – |  |

### Keys and devices

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `pv-keys-fail` Account created, keys not saved | `features/auth/KeysNotSaved.tsx:206` | not checked yet | – |  |
| `pv-approve-choose` Approve another device: which device is it? | `features/auth/KeysNotSaved.tsx:13, :109` | not checked yet | – |  |
| `pv-keys-fail-again` Keys still not saved | `features/auth/KeysNotSaved.tsx:206` | not checked yet | – |  |
| `pv-approve-dialog` Approve another device | `features/auth/KeysNotSaved.tsx:13, :109` | not checked yet | – |  |
| `pv-approve-after` Approve another device: after They match | `features/auth/KeysNotSaved.tsx:13, :109` | not checked yet | – |  |
| `pv-approve-timeout` Approve another device: no answer | `features/auth/KeysNotSaved.tsx:13, :109` | not checked yet | – |  |
| `pv-approve-cancelled` Approve another device: the other device cancelled | `features/auth/KeysNotSaved.tsx:13, :109` | not checked yet | – |  |
| `pv-approve-mismatch` Approve another device: the digits didn’t match | `features/auth/KeysNotSaved.tsx:13, :109` | not checked yet | – |  |
| `pv-approve-failed` Approve another device: it failed | `features/auth/KeysNotSaved.tsx:13, :109` | not checked yet | – |  |
| `pv-keys-moved` Keys moved to another device | `features/auth/KeysNotSaved.tsx:206` | not checked yet | – |  |

### Two-factor

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `pv-codes-copied` Recovery codes copied | `features/auth/TwoFactor.tsx:176` | not checked yet | – |  |

### Emails

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `em-rules` How Orbyn email works | engine / email service (other repo) | not checked yet | – | other repo |
| `em-code` Verification code | engine / email service (other repo) | not checked yet | – | other repo |
| `em-exists` Sign-up with an email that already has an account | engine / email service (other repo) | not checked yet | – | other repo |
| `em-delete` Account will be deleted | engine / email service (other repo) | not checked yet | – | other repo |
| `em-delete-local` Account will be deleted, no account site | engine / email service (other repo) | not checked yet | – | other repo |
| `em-exists-local` Sign-up with an existing email, no account site | engine / email service (other repo) | not checked yet | – | other repo |
| `em-ops` Operator start-up errors | engine / email service (other repo) | not checked yet | – | other repo |
| `em-ops-smtp` Certificate library, SMTP address and log lines | engine / email service (other repo) | not checked yet | – | other repo |
| `em-ops-config` SMTP address, TLS and companion settings | engine / email service (other repo) | not checked yet | – | other repo |
| `em-ops-more` More certificate-file checks | engine / email service (other repo) | not checked yet | – | other repo |

### Witness

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `wit-start` First start and bootstrap flags | witness CLI (other repo) | not checked yet | – | other repo |
| `wit-replay` Replay and saved-state errors | witness CLI (other repo) | not checked yet | – | other repo |
| `wit-config` Keys and options | witness CLI (other repo) | not checked yet | – | other repo |
| `wit-run` State, address and log lines | witness CLI (other repo) | not checked yet | – | other repo |
| `wit-help` Help text | witness CLI (other repo) | not checked yet | – | other repo |
| `wit-keygen` keygen help | witness CLI (other repo) | not checked yet | – | other repo |

### Key service

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `ks-help` Help text: commands | key-service CLI (other repo) | not checked yet | – | other repo |
| `ks-help-settings` Help text: settings | key-service CLI (other repo) | not checked yet | – | other repo |
| `ks-init` init | key-service CLI (other repo) | not checked yet | – | other repo |
| `ks-init-log-key` init-log-key | key-service CLI (other repo) | not checked yet | – | other repo |
| `ks-config-errors` Missing settings and bad commands | key-service CLI (other repo) | not checked yet | – | other repo |
| `ks-migrate` migrate errors | key-service CLI (other repo) | not checked yet | – | other repo |
| `ks-serve` serve start-up errors | key-service CLI (other repo) | not checked yet | – | other repo |
| `ks-reload` Reload on SIGHUP | key-service CLI (other repo) | not checked yet | – | other repo |
| `ks-publisher` Head publisher start-up errors | key-service CLI (other repo) | not checked yet | – | other repo |

### Start over

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `so-card` Account created, browser can’t keep its keys | `features/auth/AuthScreens.tsx:168` | not checked yet | – |  |
| `so-check` Check your email | `features/auth/AuthScreens.tsx:46` | not checked yet | – |  |
| `so-email` The email | email / other repo | not checked yet | – |  |
| `so-email-local` The email without an account site | email / other repo | not checked yet | – |  |
| `so-landing` The link’s landing page and its states | `features/auth/CancelDeletionPage.tsx:50` | not checked yet | – |  |
| `so-phone` Start over on a phone | email / other repo | not checked yet | – |  |

### Consent

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `consent` Consent screen | not in this repo (the account site) | not checked yet | – | other repo |
| `consent-edge` Unknown app and Advanced protection | not in this repo (the account site) | not checked yet | – | other repo |

### Launcher

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `launcher` Launcher in the menu bar | desktop launcher (other repo) | not checked yet | – | other repo |
| `launcher-first` First run and update failed | desktop launcher (other repo) | not checked yet | – | other repo |
| `launcher-sign-in` Sign in once | desktop launcher (other repo) | not checked yet | – | other repo |

### Phone

| Frame | Component (web/src) | Status | Shots | Differs / note |
| --- | --- | --- | --- | --- |
| `phone` Account, approval and consent on a phone | `features/settings/SettingsPage.tsx:18` | not checked yet | – |  |

## Not checked

- Every frame marked *not checked yet*: no render or text comparison was made. Pointers in the component column come from reading the code and a copy match count, not from looking at the screen.
- Sample data was written to approximate the design frames, not copied from them, so counts and a few dates differ for that reason. Differences listed above are the ones that come from the build, not the sample data; where the design’s own sample data disagrees with itself (p-today-all-day, p-today-long, p-today-overnight-long) the cell says so.
- Not exercised, because they need an account and an engine: the “Synced” pill, the account name in the greeting, a notification count, and anything behind sign-in. Hover, focus, keyboard and drag states, and the real (not reduced) motion, were not exercised.
- `p-today-error`, `p-task-loading` and similar states that the build cannot reach were checked in code only.
- `p-today-goal-labels`, `p-task-date`, `p-task-move`, `p-task-subtasks` and `p-lists-empty` were not rendered (or the capture failed); their cells are from the code or from other captures, as stated in each cell.
- Whether the Planner and Account versions are v36 and v53: taken from the brief.

## Motion Designs (Planner and Account rows)

Only demos whose app title is Orbyn Planner or Orbyn Account are listed (21 of 85 demos). Generic demos (button, toggle, menu, modal, toast, sheet and others) are not listed. Durations and easings were read against `web/src/styles/tokens.css` and `tokens.ts`, not filmed. Tokens match the designs: fast 150, base 200, slow 300, page 240, exits 105 / 140 / 210 / 170, wait 400, `cubic-bezier(.2,.8,.2,1)` and `cubic-bezier(.4,0,.2,1)` (`tokens.css:119-127`, `tokens.ts:6-24`, kept equal by `tokens.test.ts`).

| Row | What moves | Spec (duration · easing) | Code | Status |
| --- | --- | --- | --- | --- |
| `checkbox` Planner · New task | box fill and border; tick opacity and scale .4 to 1 | fast 150ms · out | `features/tasks/TaskRow.tsx:23` (Check) has no transition; only nav colour animates (`styles/app.css:49`) | not built |
| `segmented` Planner · Views | thumb slides; label colour | base 200ms, fast 150ms · out | View pills are plain radio buttons without a thumb (`TasksPage.tsx:111`, `CalendarPage.tsx:77`) | not built |
| `tabs` Account · Security | underline slides; pane fades and moves 6px | base 200ms, fast 150ms · out, exit io; pane 60ms after underline | no Security tabs in this repo; Project tabs (`ProjectPage.tsx:258`) switch instantly | not built |
| `inputerr` Account · Sign in | border colour; message fades and moves -4px to 0 | fast 150ms, base 200ms · out, exit io | error text appears with no transition (`AuthScreens.tsx:256`) | not built |
| `select` Planner · Repeat | menu fades, moves -4px, scale .98; chevron turns 180deg | base 200ms, fast 150ms · out, exit io | native `<select>` (`RepeatPicker.tsx:92`) | not built |
| `banner` Account · Security | banner fades and moves -8px in a reserved slot | base 200ms, exit 140ms · out, exit io | `features/auth/DeletionBanner.tsx:78` has no transition | not built |
| `skeleton` Planner · Today | skeleton opacity; content opacity | fast 150ms, base 200ms, exit 105ms, wait 400ms · out, exit io | 400 ms wait built (`TodayPage.tsx:66`, `motionMs("wait")`); no fade of skeleton or content (no opacity transition) | differs |
| `syncline` Planner · Sync | label cross-fade; state shows at least 1s | fast 150ms, exit 105ms · out, exit io | `features/sync/SyncLine.tsx:66` swaps labels at once; no 1s minimum | not built |
| `checkoff` Planner · Today | tick, strike scaleX, row fade, row moves to Done after 1.5s with Undo | fast 150, base 200, slow 300ms · out | no tick or strike motion; a finished task stays in place until tomorrow (`tasks/selectors.ts:17`); Undo only for repeating tasks (`useComplete.ts:13`) | not built |
| `additem` Planner · Today | new row fades and moves -6px; rows below shift one slot | base 200ms · out | `TasksPage.tsx:17` (QuickAddField) adds the row with no motion | not built |
| `delete` Planner · Today | row fades; siblings move up one slot | base 200ms, exit 140ms · out, exit io | `TaskPanel.tsx:132` deletes with a toast; no collapse motion | not built |
| `reorder` Planner · Today | lifted row scale 1.02 and shadow; neighbours shift | fast 150ms, base 200ms · out | no drag reorder in the code (no drag handlers) | not built |
| `board` Planner · Board | card travels between lanes; lift scale 1.03 | slow 300ms, fast 150, base 200ms · out | `TasksPage.tsx:178`, `ProjectPage.tsx:177` move cards by a "Move to" link, no drag or travel | not built |
| `calcreate` Planner · Week | event block scaleY from top edge on create and resize | fast 150ms · out | `calendar/TimeGrid.tsx:36` has no drag-create or resize | not built |
| `calview` Planner · Calendar | thumb slides; view fades and moves 6px | base 200ms, page 240ms, exit 170ms · out, exit io | `CalendarPage.tsx:47` switches view at once | not built |
| `booking` Planner · Book a time | slot colour and press scale .97; summary fades and moves 8px | fast 150ms, base 200ms, wait 400ms · out | no booking screens | not built |
| `signin` Account · Sign-in request | button spinner after 400ms; card content cross-fade | fast 150ms, wait 400ms · out, exit io | spinner after 400 ms is built (`components/BusyButton.tsx:13`, spinner `app.css:89`); no card cross-fade | differs |
| `consent` Account · Connect an app | toggle knob slides; spinner after 400ms; card cross-fade | fast 150ms, wait 400ms · out, exit io | no consent screen here (the account site); `BusyButton` supplies only the 400 ms spinner | not built |
| `collapse` Planner · Narrow window | drawer slides from -100%; scrim fades | slow 300ms, exit 210ms · out, exit io | under 768px the sidebar becomes a tab bar plus a "More" sheet (`app/App.tsx:88`, `app.css:151-159`), no drawer at 900px and no slide | differs |
| `reduced` (row 1) Planner · Today | opacity only, 150ms | base 200ms, exit 140ms normally; 150ms under reduced motion | `styles/tokens.css:130-135` forces colour and opacity transitions at `--m-fast`; spinner stands still (`app.css:92`) | matched (code read, not filmed) |
| `reduced` (row 2) Planner · Today | opacity only, 150ms | same as row 1 | same as row 1 | matched (code read, not filmed) |
