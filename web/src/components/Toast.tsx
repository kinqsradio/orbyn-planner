import { useUi } from "../app/ui";

export function Toast() {
  const { toast, dismissToast } = useUi();
  if (!toast) return null;
  return (
    <div className="toast" role="status" key={toast.id}>
      <span>{toast.message}</span>
      {toast.undo && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.undo?.();
            dismissToast();
          }}
        >
          Undo
        </button>
      )}
    </div>
  );
}
