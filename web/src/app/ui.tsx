import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export const TOAST_MS = 10_000;

export interface ToastState {
  id: number;
  message: string;
  undo?: () => void;
  /** Move focus to Undo when it appears, for a change that took the focused thing away. */
  focusUndo?: boolean;
}

export interface EventKey {
  id: string;
  /** The date of the occurrence that was opened. */
  date: string;
}

interface Ui {
  taskId: string | null;
  openTask: (id: string) => void;
  closeTask: () => void;
  eventKey: EventKey | null;
  openEvent: (id: string, date: string) => void;
  closeEvent: () => void;
  /** The day a new event starts on, while the New event dialog is open. */
  newEventDate: string | null;
  openNewEvent: (date?: string) => void;
  closeNewEvent: () => void;
  calendarsOpen: boolean;
  openCalendars: () => void;
  closeCalendars: () => void;
  listId: string | null;
  selectList: (id: string) => void;
  newTaskOpen: boolean;
  /** Where a new task starts out, when opened from a project. */
  newTaskDefaults: { projectId?: string | null; sectionId?: string | null };
  openNewTask: (defaults?: { projectId?: string | null; sectionId?: string | null }) => void;
  closeNewTask: () => void;
  searchOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;
  toast: ToastState | null;
  showToast: (message: string, undo?: () => void, options?: { focusUndo?: boolean }) => void;
  dismissToast: () => void;
}

const UiContext = createContext<Ui | null>(null);
let toastCounter = 0;

export function UiProvider({ children }: { children: ReactNode }) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [eventKey, setEventKey] = useState<EventKey | null>(null);
  const [newEventDate, setNewEventDate] = useState<string | null>(null);
  const [calendarsOpen, setCalendarsOpen] = useState(false);
  const [listId, setListId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTaskDefaults, setNewTaskDefaults] = useState<{ projectId?: string | null; sectionId?: string | null }>({});
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback((message: string, undo?: () => void, options?: { focusUndo?: boolean }) => {
    setToast({ id: ++toastCounter, message, undo, focusUndo: options?.focusUndo });
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

  const value = useMemo<Ui>(
    () => ({
      taskId,
      // The side panel shows one thing at a time: a task or an event.
      openTask: (id: string) => {
        setEventKey(null);
        setTaskId(id);
      },
      closeTask: () => setTaskId(null),
      eventKey,
      openEvent: (id: string, date: string) => {
        setTaskId(null);
        setEventKey({ id, date });
      },
      closeEvent: () => setEventKey(null),
      newEventDate,
      openNewEvent: (date?: string) => setNewEventDate(date ?? ""),
      closeNewEvent: () => setNewEventDate(null),
      calendarsOpen,
      openCalendars: () => setCalendarsOpen(true),
      closeCalendars: () => setCalendarsOpen(false),
      listId,
      selectList: setListId,
      newTaskOpen,
      newTaskDefaults,
      openNewTask: (defaults) => {
        setNewTaskDefaults(defaults ?? {});
        setNewTaskOpen(true);
      },
      closeNewTask: () => setNewTaskOpen(false),
      searchOpen,
      openSearch: () => setSearchOpen(true),
      closeSearch: () => setSearchOpen(false),
      toast,
      showToast,
      dismissToast,
    }),
    [newTaskDefaults, taskId, eventKey, newEventDate, calendarsOpen, listId, newTaskOpen, searchOpen, toast, showToast, dismissToast],
  );
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): Ui {
  const ui = useContext(UiContext);
  if (!ui) throw new Error("useUi needs a UiProvider");
  return ui;
}
