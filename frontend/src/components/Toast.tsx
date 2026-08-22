export interface ToastState { message: string; error: boolean }

export function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;
  return <div className={`toast${toast.error ? ' error' : ''}`} role="status" aria-live="polite">{toast.message}</div>;
}
