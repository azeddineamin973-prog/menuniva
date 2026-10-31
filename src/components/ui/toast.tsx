'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { Icon } from './icons';

type Toast = { id: number; tone: 'success' | 'error' | 'info'; message: string };
const ToastContext = createContext<(message: string, tone?: Toast['tone']) => void>(() => {});

/** Short confirmation messages ("Marked sold out", "Could not update"). Announced to screen readers. */
export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, tone, message }]);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[80] flex flex-col items-center gap-2 px-4 lg:start-auto lg:end-6 lg:bottom-6 lg:items-end" aria-live="polite">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDone={() => setToasts((list) => list.filter((x) => x.id !== t.id))} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, toast.tone === 'error' ? 6000 : 3200);
    return () => clearTimeout(t);
  }, [toast, onDone]);
  return (
    <div
      className={cn(
        'animate-slide-up pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm shadow-lg',
        toast.tone === 'error' ? 'border-danger/30 bg-surface text-danger' : 'border-line bg-graphite text-white dark:bg-surface-3',
      )}
      data-testid="toast"
    >
      <Icon name={toast.tone === 'error' ? 'alert' : toast.tone === 'info' ? 'info' : 'checkCircle'} className={cn(toast.tone === 'success' && 'text-lime')} />
      <span>{toast.message}</span>
      <button type="button" onClick={onDone} className="-me-1 ms-1 rounded p-0.5 opacity-60 hover:opacity-100" aria-label="Dismiss">
        <Icon name="x" className="size-3.5" />
      </button>
    </div>
  );
}
