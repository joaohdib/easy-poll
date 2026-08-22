import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;

export function SheetContent({ className, children, side = 'right', ...props }: ComponentProps<typeof DialogPrimitive.Content> & { side?: 'left' | 'right' }) {
  return <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#102019]/55 data-[state=closed]:animate-out data-[state=open]:animate-in" />
    <DialogPrimitive.Content className={cn('fixed inset-y-0 z-50 flex w-[min(92vw,720px)] flex-col overflow-hidden bg-[var(--surface)] shadow-2xl outline-none transition-transform duration-200 data-[state=closed]:translate-x-full data-[state=open]:translate-x-0', side === 'right' ? 'right-0 border-l border-[var(--border)]' : 'left-0 border-r border-[var(--border)] data-[state=closed]:-translate-x-full', className)} {...props}>
      {children}
      <DialogPrimitive.Close className="absolute right-5 top-5 grid size-10 place-items-center rounded-[10px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)]" aria-label="Fechar">
        <X className="size-5" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>;
}
