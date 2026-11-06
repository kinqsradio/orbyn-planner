import { isDesktop } from "../../app/platform";

interface Internals {
  invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Saves a file the person asked for. In the desktop app the shell's `save_export` command opens the system's save dialog
 * and writes where they choose (true when saved, false when they cancel). In a browser it is a download. Nothing is sent
 * anywhere: the text is already in memory.
 */
export async function saveFile(name: string, mime: string, contents: string): Promise<boolean> {
  if (isDesktop()) {
    const internals = (window as unknown as { __TAURI_INTERNALS__: Internals }).__TAURI_INTERNALS__;
    return (await internals.invoke("save_export", { name, contents })) === true;
  }
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // After the click has been handled.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
