import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export const TOAST_MS = 6000;

export interface ToastState {
  id: number;
  message: string;
  undo?: () => void;
}

interface Ui {
  taskId: string | null;
  openTask: (id: string) => void;
  closeTask: () => void;
  listId: string | null;
  selectList: (id: string) => void;
  searchOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;
  toast: ToastState | null;
  showToast: (message: string, undo?: () => void) => void;
  dismissToast: () => void;
}

const UiContext = createContext<Ui | null>(null);
let toastCounter = 0;

export function UiProvider({ children }: { children: ReactNode }) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [listId, setListId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback((message: string, undo?: () => void) => {
    setToast({ id: ++toastCounter, message, undo });
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const value = useMemo<Ui>(
    () => ({
      taskId,
      openTask: setTaskId,
      closeTask: () => setTaskId(null),
      listId,
      selectList: setListId,
      searchOpen,
      openSearch: () => setSearchOpen(true),
      closeSearch: () => setSearchOpen(false),
      toast,
      showToast,
      dismissToast,
    }),
    [taskId, listId, searchOpen, toast, showToast, dismissToast],
  );
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): Ui {
  const ui = useContext(UiContext);
  if (!ui) throw new Error("useUi needs a UiProvider");
  return ui;
}
