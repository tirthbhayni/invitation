import { useState, type ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { buttonVariants } from '@/components/ui/button'

export interface ConfirmOptions {
  title: string
  description: ReactNode
  confirmLabel?: string
  destructive?: boolean
  onConfirm: () => void | Promise<void>
  onCancel?: () => void
}

/** Imperative confirm dialog: `confirm({...})` opens it, `dialog` must be rendered. */
export function useConfirm(): { confirm: (o: ConfirmOptions) => void; dialog: ReactNode } {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const [busy, setBusy] = useState(false)

  const dialog = (
    <AlertDialog
      open={!!options}
      onOpenChange={(open) => {
        if (open || busy) return
        options?.onCancel?.()
        setOptions(null)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{options?.title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{options?.description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className={options?.destructive ? buttonVariants({ variant: 'destructive' }) : undefined}
            onClick={async (e) => {
              e.preventDefault()
              if (!options) return
              setBusy(true)
              try {
                await options.onConfirm()
                setOptions(null)
              } finally {
                setBusy(false)
              }
            }}
          >
            {options?.confirmLabel ?? 'Confirm'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { confirm: setOptions, dialog }
}
