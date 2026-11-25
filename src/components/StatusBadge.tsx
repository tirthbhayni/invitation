import { cn } from '@/lib/utils'
import type { InvitationStatus } from '@/types'
import { STATUS_LABELS } from '@/services/InvitationService'

const STYLES: Record<InvitationStatus, string> = {
  failed: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  generated: 'bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200',
  downloaded: 'bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  share_initiated: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  whatsapp_opened: 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200',
  sent_confirmed: 'bg-green-600 text-white',
}

export function StatusBadge({ status, className }: { status: InvitationStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        STYLES[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}
