import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  History as HistoryIcon,
  Loader2,
  MessageCircle,
  MoreVertical,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Undo2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { NativeSelect } from '@/components/NativeSelect'
import { StatusBadge } from '@/components/StatusBadge'
import { CountrySelect } from '@/components/CountrySelect'
import { useConfirm } from '@/components/ConfirmDialog'
import { PdfBlobViewer } from '@/features/preview/PdfBlobViewer'
import { db } from '@/database/db'
import { useSettings, useTemplates } from '@/hooks/useData'
import { resolveInvitationPdf } from '@/services/GenerationService'
import { canShareFiles, downloadBlob, shareFile, toPdfFile } from '@/services/FileShareService'
import {
  clearHistory,
  deleteInvitations,
  fullNumber,
  markInvitation,
  STATUS_LABELS,
  updateInvitation,
} from '@/services/InvitationService'
import { exportRows } from '@/services/ExcelImportService'
import { countryForDialCode, normalizePhone, openWhatsAppChat } from '@/services/WhatsAppService'
import { errorMessage, formatDateTime } from '@/utils/format'
import { buildPdfFilename } from '@/utils/filename'
import type { Invitation, InvitationStatus } from '@/types'

const PAGE_SIZE = 50

export default function HistoryPage() {
  const invitations = useLiveQuery(() => db.invitations.orderBy('createdAt').reverse().toArray(), [])
  const templates = useTemplates()
  const settings = useSettings()
  const { confirm, dialog } = useConfirm()
  const [query, setQuery] = useState('')
  const [templateFilter, setTemplateFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<InvitationStatus | ''>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [pageIndex, setPageIndex] = useState(0)
  const [previewBlob, setPreviewBlob] = useState<{ blob: Blob; title: string } | null>(null)
  const [editing, setEditing] = useState<Invitation | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const qDigits = q.replace(/\D/g, '')
    const fromTs = from ? new Date(`${from}T00:00:00`).getTime() : -Infinity
    const toTs = to ? new Date(`${to}T23:59:59.999`).getTime() : Infinity
    return (invitations ?? []).filter(
      (i) =>
        (!templateFilter || i.templateId === templateFilter) &&
        (!statusFilter || i.shareStatus === statusFilter) &&
        i.createdAt >= fromTs &&
        i.createdAt <= toTs &&
        (!q ||
          i.guestName.toLowerCase().includes(q) ||
          (qDigits.length >= 3 && `${i.countryCode}${i.mobileNumber}`.includes(qDigits))),
    )
  }, [invitations, query, templateFilter, statusFilter, from, to])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(pageIndex, pageCount - 1)
  const rows = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)

  const withPdf = async (inv: Invitation, fn: (blob: Blob) => void | Promise<void>, regenerate = false) => {
    setBusyId(inv.id)
    try {
      const blob = await resolveInvitationPdf(inv, regenerate)
      await fn(blob)
    } catch (err) {
      toast.error('PDF unavailable', { description: errorMessage(err) })
    } finally {
      setBusyId(null)
    }
  }

  const shareToWhatsApp = (inv: Invitation) => {
    const sharePromise = inv.pdfBlob ? shareFile(toPdfFile(inv.pdfBlob, inv.pdfFileName)) : null
    void withPdf(inv, async (blob) => {
      const outcome = await (sharePromise ?? shareFile(toPdfFile(blob, inv.pdfFileName)))
      if (outcome === 'shared') {
        await markInvitation(inv.id, 'share_initiated')
        toast.success('PDF handed to the share menu', { description: 'Finish sending it in WhatsApp, then mark it as sent.' })
      } else if (outcome === 'needs_gesture') {
        toast.info('The PDF is ready', { description: 'Choose "Share on WhatsApp" again to open the share menu.' })
      } else if (outcome === 'unsupported' || outcome === 'failed') {
        downloadBlob(blob, inv.pdfFileName)
        toast.info('File sharing is not available here', { description: 'The PDF was downloaded instead.' })
      }
    })
  }

  const openWhatsApp = (inv: Invitation) => {
    if (canShareFiles()) return shareToWhatsApp(inv)
    if (!inv.mobileNumber) {
      toast.error('No mobile number saved for this guest', { description: 'Use "Edit guest details" to add one.' })
      return
    }
    const wa = `${inv.countryCode}${inv.mobileNumber}`
    if (inv.pdfBlob) downloadBlob(inv.pdfBlob, inv.pdfFileName)
    const result = openWhatsAppChat(wa)
    if (result === 'blocked') {
      toast.warning('The browser blocked the WhatsApp window. Allow pop-ups for this site and try again.')
      return
    }
    void markInvitation(inv.id, 'whatsapp_opened')
    if (!inv.pdfBlob) {
      void withPdf(inv, (blob) => downloadBlob(blob, inv.pdfFileName))
    }
    toast.success('WhatsApp chat opened', {
      description: 'In the chat click 📎 → Document and choose the downloaded PDF, then press send.',
    })
  }

  const exportHistory = (format: 'csv' | 'xlsx') => {
    if (filtered.length === 0) return toast.info('Nothing to export')
    exportRows(
      filtered.map((i) => ({
        'Invitation ID': i.id,
        'Template ID': i.templateId,
        'Template Name': i.templateName,
        'Guest Name': i.guestName,
        'Country Code': i.countryCode ? `+${i.countryCode}` : '',
        'Mobile Number': i.mobileNumber,
        'PDF Filename': i.pdfFileName,
        'Generated At': new Date(i.createdAt).toLocaleString(),
        'PDF Generation': i.generationStatus === 'failed' ? 'Failed' : 'Generated',
        Downloaded: i.downloaded ? 'Yes' : 'No',
        'WhatsApp Opened': i.whatsappOpened ? 'Yes' : 'No',
        'Sent (Manually Confirmed)': i.manuallySent ? 'Yes' : 'No',
        Status: STATUS_LABELS[i.shareStatus],
      })),
      `InvitePrint_History_${new Date().toISOString().slice(0, 10)}`,
      format,
    )
  }

  return (
    <div>
      {dialog}
      <PageHeader
        title="Invitation History"
        description="Status shows what happened on this device. WhatsApp delivery cannot be detected; mark invitations as sent yourself."
        actions={
          <>
            <Button variant="outline" onClick={() => exportHistory('csv')}>
              <FileSpreadsheet />
              Export CSV
            </Button>
            <Button variant="outline" onClick={() => exportHistory('xlsx')}>
              <FileSpreadsheet />
              Export Excel
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPageIndex(0)
            }}
            placeholder="Search guest name or mobile number"
            className="pl-9"
            aria-label="Search guest name or mobile number"
          />
        </div>
        <NativeSelect value={templateFilter} onChange={(e) => setTemplateFilter(e.target.value)} aria-label="Filter by template">
          <option value="">All templates</option>
          {templates?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as InvitationStatus | '')} aria-label="Filter by status">
          <option value="">All statuses</option>
          {(Object.keys(STATUS_LABELS) as InvitationStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </NativeSelect>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" title="From date" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" title="To date" />
      </div>

      {invitations === undefined ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : invitations.length === 0 ? (
        <EmptyState
          icon={HistoryIcon}
          title="No invitation history"
          description={
            settings.saveGuestHistory
              ? 'Invitations you generate will be listed here.'
              : 'Saving invitation history is turned off in Settings.'
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Guest</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead className="max-md:hidden">Template</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="max-sm:hidden">Generated</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="max-w-56">
                      <p className="truncate font-medium" title={inv.guestName}>
                        {inv.guestName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground" title={inv.pdfFileName}>
                        {inv.pdfFileName}
                      </p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{fullNumber(inv) || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="max-w-40 truncate max-md:hidden">{inv.templateName}</TableCell>
                    <TableCell>
                      <StatusBadge status={inv.shareStatus} />
                      {inv.errorMessage && <p className="mt-1 max-w-48 truncate text-xs text-destructive" title={inv.errorMessage}>{inv.errorMessage}</p>}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground max-sm:hidden">
                      {formatDateTime(inv.createdAt)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${inv.guestName}`} disabled={busyId === inv.id}>
                            {busyId === inv.id ? <Loader2 className="animate-spin" /> : <MoreVertical />}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => withPdf(inv, (blob) => setPreviewBlob({ blob, title: inv.guestName }))}
                          >
                            <Eye /> Preview
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              withPdf(inv, async (blob) => {
                                downloadBlob(blob, inv.pdfFileName)
                                await markInvitation(inv.id, 'downloaded')
                              })
                            }
                          >
                            <Download /> Download again
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              withPdf(
                                inv,
                                async (blob) => {
                                  await updateInvitation(inv.id, settings.saveGeneratedPDFs ? { pdfBlob: blob } : {})
                                  if (inv.generationStatus === 'failed') {
                                    await db.invitations.update(inv.id, { generationStatus: 'generated', errorMessage: undefined })
                                    await markInvitation(inv.id, 'downloaded')
                                  }
                                  downloadBlob(blob, inv.pdfFileName)
                                  toast.success('Invitation regenerated with the current template')
                                },
                                true,
                              )
                            }
                          >
                            <RefreshCw /> Regenerate
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => openWhatsApp(inv)}>
                            <MessageCircle /> Share on WhatsApp
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setEditing(inv)}>
                            <Pencil /> Edit guest details
                          </DropdownMenuItem>
                          {inv.manuallySent ? (
                            <DropdownMenuItem onSelect={() => markInvitation(inv.id, 'sent_unconfirmed')}>
                              <Undo2 /> Unmark as sent
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              disabled={inv.generationStatus === 'failed'}
                              onSelect={() => markInvitation(inv.id, 'sent_confirmed')}
                            >
                              <CheckCircle2 /> Mark as sent
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() =>
                              confirm({
                                title: 'Delete this record?',
                                description: `The history entry for "${inv.guestName}" will be removed.`,
                                confirmLabel: 'Delete',
                                destructive: true,
                                onConfirm: () => deleteInvitations([inv.id]),
                              })
                            }
                          >
                            <Trash2 /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                      No invitations match the filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>
              {filtered.length} record{filtered.length === 1 ? '' : 's'}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={current === 0} onClick={() => setPageIndex(current - 1)}>
                Previous
              </Button>
              <span className="tabular-nums">
                {current + 1} / {pageCount}
              </span>
              <Button variant="outline" size="sm" disabled={current >= pageCount - 1} onClick={() => setPageIndex(current + 1)}>
                Next
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() =>
                  confirm({
                    title: 'Clear all invitation history?',
                    description: 'All history records and stored PDFs will be deleted from this device. Templates are kept.',
                    confirmLabel: 'Clear history',
                    destructive: true,
                    onConfirm: async () => {
                      await clearHistory()
                      toast.success('History cleared')
                    },
                  })
                }
              >
                Clear history
              </Button>
            </div>
          </div>
        </>
      )}

      <Dialog open={!!previewBlob} onOpenChange={(o) => !o && setPreviewBlob(null)}>
        <DialogContent className="flex max-h-[95dvh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{previewBlob?.title}</DialogTitle>
            <DialogDescription>Generated invitation PDF</DialogDescription>
          </DialogHeader>
          {previewBlob && <PdfBlobViewer blob={previewBlob.blob} />}
        </DialogContent>
      </Dialog>

      <EditGuestDialog invitation={editing} onClose={() => setEditing(null)} filenamePattern={settings.filenamePattern} defaultCountry={settings.defaultCountryCode} />
    </div>
  )
}

function EditGuestDialog({
  invitation,
  onClose,
  filenamePattern,
  defaultCountry,
}: {
  invitation: Invitation | null
  onClose: () => void
  filenamePattern: string
  defaultCountry: string
}) {
  return (
    <Dialog open={!!invitation} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {invitation && (
          <EditGuestForm
            key={invitation.id}
            invitation={invitation}
            onClose={onClose}
            filenamePattern={filenamePattern}
            defaultCountry={defaultCountry}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function EditGuestForm({
  invitation,
  onClose,
  filenamePattern,
  defaultCountry,
}: {
  invitation: Invitation
  onClose: () => void
  filenamePattern: string
  defaultCountry: string
}) {
  const [name, setName] = useState(invitation.guestName)
  const [country, setCountry] = useState<string>(countryForDialCode(invitation.countryCode) ?? defaultCountry)
  const [phone, setPhone] = useState(invitation.mobileNumber)
  const [saving, setSaving] = useState(false)
  const phoneResult = normalizePhone(phone, country)
  const phoneError = !phoneResult.valid && !phoneResult.empty ? phoneResult.error : null

  const save = async () => {
    if (!name.trim() || phoneError) return
    setSaving(true)
    try {
      const nameChanged = name.trim() !== invitation.guestName
      await updateInvitation(invitation.id, {
        guestName: name.trim(),
        mobileNumber: phoneResult.valid ? phoneResult.nationalNumber : '',
        countryCode: phoneResult.valid ? phoneResult.countryCode : '',
        ...(nameChanged
          ? {
              pdfFileName: buildPdfFilename(filenamePattern, { guestName: name.trim(), templateName: invitation.templateName }),
              pdfBlob: undefined,
            }
          : {}),
      })
      toast.success('Guest details updated', {
        description: nameChanged ? 'The PDF will be regenerated with the new name when you download it.' : undefined,
      })
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <DialogHeader>
        <DialogTitle>Edit guest details</DialogTitle>
        <DialogDescription>Changes apply to this history record.</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="edit-name">Guest / Family name</Label>
        <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!name.trim()} />
        {!name.trim() && <p className="text-xs text-destructive">Guest name is required.</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-phone">Mobile number</Label>
        <div className="flex gap-2">
          <CountrySelect value={country} onChange={setCountry} className="w-32 shrink-0 sm:w-44" compact />
          <Input id="edit-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={!!phoneError} className="min-w-0 flex-1" />
        </div>
        {phoneError && <p className="text-xs text-destructive">{phoneError}</p>}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || !name.trim() || !!phoneError}>
          {saving && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}
