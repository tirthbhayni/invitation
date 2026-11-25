import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { zipSync } from 'fflate'
import {
  CheckCircle2,
  Download,
  FileArchive,
  FileDown,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  Loader2,
  MessageCircle,
  Plus,
  Search,
  Square,
  Trash2,
  Upload,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { NativeSelect } from '@/components/NativeSelect'
import { CountrySelect } from '@/components/CountrySelect'
import { useConfirm } from '@/components/ConfirmDialog'
import { db } from '@/database/db'
import { useSettingsLoaded, useTemplateFields, useTemplates } from '@/hooks/useData'
import { downloadSampleWorkbook, importGuestFile } from '@/services/ExcelImportService'
import { generateInvitationPdf } from '@/services/GenerationService'
import { canShareFiles, downloadBlob, shareFile, toPdfFile } from '@/services/FileShareService'
import { markInvitation, recordInvitation } from '@/services/InvitationService'
import { markTemplateUsed } from '@/services/TemplateService'
import { countryForDialCode, normalizePhone, openWhatsAppChat, type PhoneResult } from '@/services/WhatsAppService'
import { withStorage } from '@/services/StorageService'
import { buildPdfFilename } from '@/utils/filename'
import { errorMessage } from '@/utils/format'
import { createId } from '@/utils/id'
import type { BulkGuest } from '@/types'
import { cn } from '@/lib/utils'

function InlineInput({
  value,
  onCommit,
  label,
  invalid,
  type = 'text',
  className,
}: {
  value: string
  onCommit: (v: string) => void
  label: string
  invalid?: boolean
  type?: string
  className?: string
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <Input
      value={text}
      type={type}
      inputMode={type === 'tel' ? 'tel' : undefined}
      aria-label={label}
      aria-invalid={invalid}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={cn('h-10 md:h-8', className)}
    />
  )
}

interface RowInfo {
  guest: BulkGuest
  phone: PhoneResult
  nameMissing: boolean
  duplicate: boolean
  valid: boolean
}

export default function BulkPage() {
  const templates = useTemplates()
  const { settings, loaded } = useSettingsLoaded()
  const guests = useLiveQuery(() => db.bulkGuests.orderBy('order').toArray(), [])
  const { confirm, dialog } = useConfirm()

  const [templateId, setTemplateId] = useState<string>()
  const template = templates?.find((t) => t.id === templateId)
  const fields = useTemplateFields(templateId)
  const [defaultCountry, setDefaultCountry] = useState('IN')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null)
  const [importing, setImporting] = useState(false)
  const [rowBusy, setRowBusy] = useState<string | null>(null)
  const cancelRef = useRef(false)
  const pdfs = useRef(new Map<string, { blob: Blob; fileName: string; key: string }>())
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!templates || !loaded || templateId) return
    const def =
      templates.find((t) => t.id === settings.defaultTemplateId) ?? templates.find((t) => t.isDefault) ?? templates[0]
    setTemplateId(def?.id)
    setDefaultCountry(settings.defaultCountryCode)
  }, [templates, loaded, templateId, settings.defaultTemplateId, settings.defaultCountryCode])

  const rows: RowInfo[] = useMemo(() => {
    const list = guests ?? []
    const phoneCount = new Map<string, number>()
    const nameCount = new Map<string, number>()
    const parsed = list.map((g) => {
      const country = (g.countryCode && countryForDialCode(g.countryCode)) || defaultCountry
      const phone = normalizePhone(g.mobileNumber, country)
      if (phone.valid) phoneCount.set(phone.waNumber, (phoneCount.get(phone.waNumber) ?? 0) + 1)
      const nk = g.guestName.trim().toLowerCase()
      if (nk) nameCount.set(nk, (nameCount.get(nk) ?? 0) + 1)
      return { g, phone }
    })
    return parsed.map(({ g, phone }) => {
      const nameMissing = !g.guestName.trim()
      const duplicate =
        (phone.valid && (phoneCount.get(phone.waNumber) ?? 0) > 1) ||
        (nameCount.get(g.guestName.trim().toLowerCase()) ?? 0) > 1
      return {
        guest: g,
        phone,
        nameMissing,
        duplicate,
        valid: !nameMissing && (phone.valid || phone.empty),
      }
    })
  }, [guests, defaultCountry])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) => r.guest.guestName.toLowerCase().includes(q) || r.guest.mobileNumber.replace(/\D/g, '').includes(q.replace(/\D/g, '') || '\u0000'),
    )
  }, [rows, query])

  const selectedRows = rows.filter((r) => selected.has(r.guest.id))
  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.guest.id))
  const generatedCount = rows.filter((r) => r.guest.pdfStatus === 'generated').length
  const fieldsKey = JSON.stringify(fields ?? [])
  const pdfKey = (g: BulkGuest) => `${templateId}|${template?.updatedAt}|${fieldsKey}|${g.guestName.trim()}`

  const updateGuest = (id: string, patch: Partial<BulkGuest>) => withStorage(() => db.bulkGuests.update(id, patch))

  const addGuests = async (items: Omit<BulkGuest, 'id' | 'order' | 'pdfStatus' | 'shareStatus' | 'createdAt'>[]) => {
    const last = await db.bulkGuests.orderBy('order').last()
    let order = (last?.order ?? 0) + 1
    const now = Date.now()
    await withStorage(() =>
      db.bulkGuests.bulkAdd(
        items.map((i) => ({ ...i, id: createId(), order: order++, pdfStatus: 'pending', shareStatus: 'none', createdAt: now })),
      ),
    )
  }

  const handleImport = async (file: File) => {
    setImporting(true)
    try {
      const result = await importGuestFile(file)
      if (result.guests.length === 0) {
        toast.error('No guests found in the file', { description: 'Check that the first column contains guest names.' })
        return
      }
      await addGuests(result.guests)
      toast.success(`Imported ${result.guests.length} guest${result.guests.length === 1 ? '' : 's'}`, {
        description: [result.skipped ? `${result.skipped} empty rows skipped.` : '', ...result.warnings].filter(Boolean).join(' '),
      })
    } catch (err) {
      toast.error('Import failed', { description: errorMessage(err) })
    } finally {
      setImporting(false)
    }
  }

  const getPdf = async (g: BulkGuest): Promise<{ blob: Blob; fileName: string } | null> => {
    const mem = pdfs.current.get(g.id)
    if (mem && mem.key === pdfKey(g)) return mem
    if (g.invitationId && g.pdfStatus === 'generated') {
      const inv = await db.invitations.get(g.invitationId)
      if (inv?.pdfBlob && inv.guestName === g.guestName.trim() && inv.templateId === templateId) {
        return { blob: inv.pdfBlob, fileName: inv.pdfFileName }
      }
    }
    return null
  }

  const generateOne = async (r: RowInfo): Promise<{ blob: Blob; fileName: string }> => {
    if (!template || !fields) throw new Error('Select a template first.')
    if (fields.length === 0) throw new Error('This template has no guest name field.')
    const g = r.guest
    if (!r.valid) throw new Error(r.nameMissing ? 'Guest name is missing.' : 'Mobile number is invalid.')
    await updateGuest(g.id, { pdfStatus: 'generating', error: undefined })
    try {
      const name = g.guestName.trim()
      const { blob, warnings } = await generateInvitationPdf(template, name, fields)
      const fileName = buildPdfFilename(settings.filenamePattern, { guestName: name, templateName: template.name, eventName: template.eventName })
      pdfs.current.set(g.id, { blob, fileName, key: pdfKey(g) })
      let invitationId: string | undefined
      if (settings.saveGuestHistory) {
        const inv = await recordInvitation({
          templateId: template.id,
          templateName: template.name,
          guestName: name,
          mobileNumber: r.phone.valid ? r.phone.nationalNumber : '',
          countryCode: r.phone.valid ? r.phone.countryCode : '',
          pdfFileName: fileName,
          pdfBlob: settings.saveGeneratedPDFs ? blob : undefined,
        })
        invitationId = inv.id
      }
      await updateGuest(g.id, {
        pdfStatus: 'generated',
        invitationId,
        error: warnings.some((w) => w.overflow) ? 'Name did not fully fit at the minimum font size.' : undefined,
      })
      return { blob, fileName }
    } catch (err) {
      await updateGuest(g.id, { pdfStatus: 'failed', error: errorMessage(err) })
      throw err
    }
  }

  const generateMany = async (list: RowInfo[]) => {
    if (!template) return toast.error('Select a template first.')
    if (!fields?.length) return toast.error('This template has no guest name field.')
    const targets = list.filter((r) => r.valid)
    const skipped = list.length - targets.length
    if (targets.length === 0) return toast.error('No valid guests selected.', { description: 'Fix the highlighted rows first.' })
    cancelRef.current = false
    setProgress({ done: 0, total: targets.length, failed: 0 })
    let failed = 0
    let succeeded = 0
    for (let i = 0; i < targets.length; i++) {
      if (cancelRef.current) break
      try {
        await generateOne(targets[i])
        succeeded++
      } catch {
        failed++
      }
      setProgress({ done: i + 1, total: targets.length, failed })
    }
    void markTemplateUsed(template.id)
    const cancelled = cancelRef.current
    setProgress(null)
    const summary = `${succeeded} PDF${succeeded === 1 ? '' : 's'} generated`
    toast[failed || cancelled ? 'warning' : 'success'](cancelled ? `Cancelled — ${summary}` : summary, {
      description:
        [failed ? `${failed} failed.` : '', skipped ? `${skipped} invalid rows skipped.` : ''].filter(Boolean).join(' ') ||
        undefined,
    })
  }

  const downloadZip = async (list: RowInfo[]) => {
    const files: Record<string, Uint8Array> = {}
    const used = new Set<string>()
    let missing = 0
    for (const r of list) {
      const pdf = await getPdf(r.guest)
      if (!pdf) {
        missing++
        continue
      }
      let name = pdf.fileName
      for (let n = 2; used.has(name.toLowerCase()); n++) name = pdf.fileName.replace(/\.pdf$/i, `_${n}.pdf`)
      used.add(name.toLowerCase())
      files[name] = new Uint8Array(await pdf.blob.arrayBuffer())
    }
    const count = Object.keys(files).length
    if (count === 0) {
      return toast.error('No generated PDFs to download', { description: 'Generate the PDFs first.' })
    }
    const zipped = zipSync(files, { level: 0 })
    downloadBlob(new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), `${template?.name ?? 'Invitations'}_${new Date().toISOString().slice(0, 10)}.zip`.replace(/[\\/:*?"<>|]/g, '_'))
    for (const r of list) if (r.guest.invitationId) void markInvitation(r.guest.invitationId, 'downloaded')
    toast.success(`ZIP with ${count} PDF${count === 1 ? '' : 's'} downloaded`, {
      description: missing ? `${missing} guests without a generated PDF were skipped.` : undefined,
    })
  }

  const downloadOne = async (r: RowInfo) => {
    setRowBusy(r.guest.id)
    try {
      const pdf = (await getPdf(r.guest)) ?? (await generateOne(r))
      downloadBlob(pdf.blob, pdf.fileName)
      const inv = (await db.bulkGuests.get(r.guest.id))?.invitationId
      if (inv) await markInvitation(inv, 'downloaded')
    } catch (err) {
      toast.error('Could not create PDF', { description: errorMessage(err) })
    } finally {
      setRowBusy(null)
    }
  }

  const shareSupported = canShareFiles()

  const shareOne = (r: RowInfo) => {
    if (!template) return toast.error('Select a template first.')
    const mem = pdfs.current.get(r.guest.id)
    const memReady = mem && mem.key === pdfKey(r.guest)
    const sharePromise = memReady ? shareFile(toPdfFile(mem.blob, mem.fileName)) : null
    setRowBusy(r.guest.id)
    void (async () => {
      try {
        const pdf = memReady ? mem : ((await getPdf(r.guest)) ?? (await generateOne(r)))
        const outcome = await (sharePromise ?? shareFile(toPdfFile(pdf.blob, pdf.fileName)))
        if (!memReady) pdfs.current.set(r.guest.id, { ...pdf, key: pdfKey(r.guest) })
        const invId = (await db.bulkGuests.get(r.guest.id))?.invitationId
        if (outcome === 'shared') {
          await updateGuest(r.guest.id, { shareStatus: 'share_initiated' })
          if (invId) await markInvitation(invId, 'share_initiated')
          toast.success(`PDF for ${r.guest.guestName.trim()} handed to the share menu`, {
            description: 'Finish sending it in WhatsApp, then mark it as sent.',
          })
        } else if (outcome === 'needs_gesture') {
          toast.info('The PDF is ready', { description: 'Click the WhatsApp button again to open the share menu.' })
        } else if (outcome === 'unsupported' || outcome === 'failed') {
          downloadBlob(pdf.blob, pdf.fileName)
          if (invId) await markInvitation(invId, 'downloaded')
          toast.info('File sharing is not available here', { description: 'The PDF was downloaded instead.' })
        }
      } catch (err) {
        toast.error('Could not prepare PDF', { description: errorMessage(err) })
      } finally {
        setRowBusy(null)
      }
    })()
  }

  const whatsappOne = (r: RowInfo) => {
    if (shareSupported) return shareOne(r)
    if (!r.phone.valid) {
      toast.error(r.phone.empty ? 'This guest has no mobile number.' : r.phone.error)
      return
    }
    if (!template) return toast.error('Select a template first.')
    const name = r.guest.guestName.trim()
    const mem = pdfs.current.get(r.guest.id)
    const memReady = mem && mem.key === pdfKey(r.guest)
    if (memReady) downloadBlob(mem.blob, mem.fileName)
    if (openWhatsAppChat(r.phone.waNumber) === 'blocked') {
      toast.warning('The browser blocked the WhatsApp window. Allow pop-ups for this site and try again.')
      return
    }
    void (async () => {
      try {
        if (!memReady) {
          const pdf = (await getPdf(r.guest)) ?? (await generateOne(r))
          downloadBlob(pdf.blob, pdf.fileName)
        }
        await updateGuest(r.guest.id, { shareStatus: 'whatsapp_opened' })
        const invId = (await db.bulkGuests.get(r.guest.id))?.invitationId
        if (invId) {
          await markInvitation(invId, 'downloaded')
          await markInvitation(invId, 'whatsapp_opened')
        }
      } catch (err) {
        toast.error('Could not prepare PDF', { description: errorMessage(err) })
      }
    })()
    toast.success(`WhatsApp opened for ${name}`, {
      description: 'In the chat click 📎 → Document and choose the downloaded PDF, then press send.',
    })
  }

  const markSent = async (r: RowInfo) => {
    await updateGuest(r.guest.id, { shareStatus: 'sent_confirmed' })
    if (r.guest.invitationId) await markInvitation(r.guest.invitationId, 'sent_confirmed')
  }

  const deleteRows = (ids: string[]) =>
    confirm({
      title: `Delete ${ids.length} guest${ids.length === 1 ? '' : 's'}?`,
      description: 'They will be removed from this bulk list. Invitation history is not affected.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        await db.bulkGuests.bulkDelete(ids)
        ids.forEach((id) => pdfs.current.delete(id))
        setSelected((s) => new Set([...s].filter((id) => !ids.includes(id))))
      },
    })

  if (templates && templates.length === 0) {
    return (
      <>
        <PageHeader title="Bulk Invitations" />
        <EmptyState
          icon={FilePlus2}
          title="Create a template first"
          description="Bulk generation uses one of your invitation templates."
          action={
            <Button asChild>
              <Link to="/templates?new=1">Create New Template</Link>
            </Button>
          }
        />
      </>
    )
  }

  const busy = !!progress

  return (
    <div>
      {dialog}
      <PageHeader
        title="Bulk Invitations"
        description="Import a guest list, generate all PDFs and open each WhatsApp chat. Nothing is ever sent automatically."
        actions={
          <>
            <Button variant="outline" onClick={downloadSampleWorkbook}>
              <FileDown />
              Sample Excel
            </Button>
            <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={importing}>
              {importing ? <Loader2 className="animate-spin" /> : <Upload />}
              Import Excel / CSV
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void handleImport(f)
              }}
            />
          </>
        }
      />

      <div className="mb-4 grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="bulk-template">Invitation template</Label>
          <NativeSelect id="bulk-template" value={templateId ?? ''} onChange={(e) => setTemplateId(e.target.value)}>
            {templates?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bulk-country">Default country code</Label>
          <CountrySelect id="bulk-country" value={defaultCountry} onChange={setDefaultCountry} />
          <p className="text-xs text-muted-foreground">Used for rows without a country code.</p>
        </div>
      </div>

      {progress && (
        <div className="mb-4 rounded-lg border bg-card p-4" role="status" aria-live="polite">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span>
              Generating PDFs… {progress.done} / {progress.total}
              {progress.failed ? ` · ${progress.failed} failed` : ''}
            </span>
            <Button size="sm" variant="outline" onClick={() => (cancelRef.current = true)}>
              <Square />
              Cancel
            </Button>
          </div>
          <Progress value={(progress.done / progress.total) * 100} />
        </div>
      )}

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search guests" className="pl-9" aria-label="Search guests" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => addGuests([{ guestName: '', mobileNumber: '', countryCode: '' }])}
            disabled={busy}
          >
            <Plus />
            Add guest
          </Button>
          <Button onClick={() => generateMany(selectedRows.length ? selectedRows : rows)} disabled={busy || rows.length === 0}>
            <FileText />
            {selectedRows.length ? `Generate selected (${selectedRows.length})` : 'Generate all'}
          </Button>
          <Button variant="outline" onClick={() => downloadZip(selectedRows.length ? selectedRows : rows)} disabled={busy || generatedCount === 0}>
            <FileArchive />
            Download ZIP
          </Button>
          {selectedRows.length > 0 && (
            <Button variant="outline" className="text-destructive" onClick={() => deleteRows(selectedRows.map((r) => r.guest.id))} disabled={busy}>
              <Trash2 />
              Delete ({selectedRows.length})
            </Button>
          )}
        </div>
      </div>

      {guests === undefined ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : guests.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No guests yet"
          description="Import an Excel or CSV file with columns: Guest Name, Mobile Number, Country Code — or add guests manually."
          action={
            <>
              <Button variant="outline" onClick={downloadSampleWorkbook}>
                <FileSpreadsheet />
                Download sample Excel
              </Button>
              <Button onClick={() => fileInput.current?.click()}>
                <Upload />
                Import file
              </Button>
            </>
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allVisibleSelected}
                      onCheckedChange={(c) =>
                        setSelected((s) => {
                          const next = new Set(s)
                          visible.forEach((r) => (c ? next.add(r.guest.id) : next.delete(r.guest.id)))
                          return next
                        })
                      }
                      aria-label="Select all guests"
                    />
                  </TableHead>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Guest name</TableHead>
                  <TableHead className="w-44">Mobile number</TableHead>
                  <TableHead className="w-20">Code</TableHead>
                  <TableHead>Validation</TableHead>
                  <TableHead>PDF</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => {
                  const g = r.guest
                  const index = rows.indexOf(r) + 1
                  return (
                    <TableRow key={g.id} data-state={selected.has(g.id) ? 'selected' : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(g.id)}
                          onCheckedChange={(c) =>
                            setSelected((s) => {
                              const next = new Set(s)
                              if (c) next.add(g.id)
                              else next.delete(g.id)
                              return next
                            })
                          }
                          aria-label={`Select ${g.guestName || `row ${index}`}`}
                        />
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">{index}</TableCell>
                      <TableCell>
                        <InlineInput
                          value={g.guestName}
                          label={`Guest name row ${index}`}
                          invalid={r.nameMissing}
                          onCommit={(v) => updateGuest(g.id, { guestName: v, pdfStatus: 'pending', error: undefined })}
                        />
                      </TableCell>
                      <TableCell>
                        <InlineInput
                          value={g.mobileNumber}
                          type="tel"
                          label={`Mobile number row ${index}`}
                          invalid={!r.phone.valid && !r.phone.empty}
                          onCommit={(v) => updateGuest(g.id, { mobileNumber: v })}
                        />
                      </TableCell>
                      <TableCell>
                        <InlineInput
                          value={g.countryCode}
                          label={`Country code row ${index}`}
                          onCommit={(v) => updateGuest(g.id, { countryCode: v.replace(/[^\d+]/g, '') })}
                        />
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.nameMissing ? (
                          <span className="text-destructive">Name missing</span>
                        ) : !r.phone.valid && !r.phone.empty ? (
                          <span className="text-destructive">Invalid mobile</span>
                        ) : (
                          <span className="text-green-700 dark:text-green-400">
                            Valid{!r.phone.valid ? ' (no mobile)' : ''}
                          </span>
                        )}
                        {r.duplicate && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800 dark:bg-amber-950 dark:text-amber-200">Duplicate</span>}
                      </TableCell>
                      <TableCell className="text-xs">
                        {g.pdfStatus === 'generating' ? (
                          <span className="inline-flex items-center gap-1">
                            <Loader2 className="size-3 animate-spin" /> Generating
                          </span>
                        ) : g.pdfStatus === 'generated' ? (
                          <span className="text-green-700 dark:text-green-400">Generated</span>
                        ) : g.pdfStatus === 'failed' ? (
                          <span className="text-destructive">Failed</span>
                        ) : (
                          <span className="text-muted-foreground">Pending</span>
                        )}
                        {g.error && (
                          <p className="max-w-40 truncate text-amber-700 dark:text-amber-400" title={g.error}>
                            {g.error}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {g.shareStatus === 'sent_confirmed' ? (
                          <span className="font-medium text-green-700 dark:text-green-400">Sent – Confirmed</span>
                        ) : g.shareStatus === 'whatsapp_opened' ? (
                          <span className="text-green-700 dark:text-green-400">WhatsApp Opened</span>
                        ) : g.shareStatus === 'share_initiated' ? (
                          <span className="text-green-700 dark:text-green-400">Share Initiated</span>
                        ) : (
                          <span className="text-muted-foreground">Not shared</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => downloadOne(r)}
                            disabled={busy || rowBusy === g.id || !r.valid}
                            aria-label={`Generate and download PDF for ${g.guestName}`}
                            title="Generate / download PDF"
                          >
                            {rowBusy === g.id ? <Loader2 className="animate-spin" /> : <Download />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-green-700 dark:text-green-400"
                            onClick={() => whatsappOne(r)}
                            disabled={busy || (!shareSupported && !r.phone.valid) || r.nameMissing}
                            aria-label={`Send ${g.guestName}'s PDF on WhatsApp`}
                            title={shareSupported ? 'Share the PDF to WhatsApp' : 'Open WhatsApp chat'}
                          >
                            <MessageCircle />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => markSent(r)}
                            disabled={g.shareStatus === 'sent_confirmed' || g.pdfStatus !== 'generated'}
                            aria-label={`Mark ${g.guestName} as sent`}
                            title="Mark as sent (manually confirmed)"
                          >
                            <CheckCircle2 />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => deleteRows([g.id])}
                            disabled={busy}
                            aria-label={`Delete ${g.guestName}`}
                            title="Delete"
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
                {visible.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                      No guests match your search.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>
              {rows.length} guests · {rows.filter((r) => r.valid).length} valid · {generatedCount} generated ·{' '}
              {rows.filter((r) => r.duplicate).length} possible duplicates
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={busy}
              onClick={() =>
                confirm({
                  title: 'Clear the whole guest list?',
                  description: 'All guests in this bulk list will be removed. Invitation history is kept.',
                  confirmLabel: 'Clear list',
                  destructive: true,
                  onConfirm: async () => {
                    await db.bulkGuests.clear()
                    pdfs.current.clear()
                    setSelected(new Set())
                  },
                })
              }
            >
              Clear list
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
