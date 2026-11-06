import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export const TOAST_MS = 10_000;

export interface ToastState {
  id: number;
  message: string;
  undo?: () => void;
  /** Move focus to Undo when it appears, for a change that took the focused thing away. */
  focusUndo?: boolean;
}

interface Ui {
  taskId: string | null;
  openTask: (id: string) => void;
  closeTask: () => void;
  listId: string | null;
  selectList: (id: string) => void;
  newTaskOpen: boolean;
  openNewTask: () => void;
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
  const [listId, setListId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback((message: string, undo?: () => void, options?: { focusUndo?: boolean }) => {
    setToast({ id: ++toastCounter, message, undo, focusUndo: options?.focusUndo });
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

  const value = useMemo<Ui>(
    () => ({
      taskId,
      openTask: setTaskId,
      closeTask: () => setTaskId(null),
      listId,
      selectList: setListId,
      newTaskOpen,
      openNewTask: () => setNewTaskOpen(true),
      closeNewTask: () => setNewTaskOpen(false),
      searchOpen,
      openSearch: () => setSearchOpen(true),
      closeSearch: () => setSearchOpen(false),
      toast,
      showToast,
      dismissToast,
    }),
    [taskId, listId, newTaskOpen, searchOpen, toast, showToast, dismissToast],
  );
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): Ui {
  const ui = useContext(UiContext);
  if (!ui) throw new Error("useUi needs a UiProvider");
  return ui;
}
