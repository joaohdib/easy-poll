import { useCallback, useEffect, useRef, useState } from 'react';
import type { ToastState } from '../components/Toast';

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number | null>(null);
  const showToast = useCallback((message: string, error = false) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setToast({ message, error });
    timer.current = window.setTimeout(() => setToast(null), 4_500);
  }, []);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  return { toast, showToast };
}
