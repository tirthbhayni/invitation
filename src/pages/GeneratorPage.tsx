import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eraser,
  FilePlus2,
  FileText,
  Loader2,
  MessageCircle,
  Share2,
  SkipForward,
  WifiOff,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CountrySelect } from '@/components/CountrySelect'
import { EmptyState } from '@/components/EmptyState'
import { NativeSelect } from '@/components/NativeSelect'
import { PageHeader } from '@/components/PageHeader'
import { PdfPreview } from '@/features/preview/PdfPreview'
import { useSettingsLoaded, useTemplateFields, useTemplates } from '@/hooks/useData'
import { useFieldLayouts } from '@/hooks/useFieldLayouts'
import { useHotkeys } from '@/hooks/useHotkeys'
import { usePdfDocument } from '@/hooks/usePdfDocument'
import { useOnline } from '@/hooks/useOnline'
import { generateInvitationPdf, type GeneratedPdf } from '@/services/GenerationService'
import { canShareFiles, downloadBlob, shareFile, toPdfFile } from '@/services/FileShareService'
import { markInvitation, recordInvitation, updateInvitation } from '@/services/InvitationService'
import { markTemplateUsed } from '@/services/TemplateService'
import { buildWhatsAppUrl, normalizePhone, openWhatsAppChat } from '@/services/WhatsAppService'
import { buildPdfFilename } from '@/utils/filename'
import { errorMessage } from '@/utils/format'
import type { Template } from '@/types'

interface ReadyPdf extends GeneratedPdf {
  key: string
  fileName: string
}

type Action = 'generate' | 'download' | 'share' | 'whatsapp'

interface LastShared {
  id: string
  guestName: string
  sent: boolean
  /** 'share': the file went through the share menu. 'chat': only a wa.me chat was opened. */
  mode: 'share' | 'chat'
  fileName: string
  pdf?: Blob
  waUrl?: string
}

function pickInitialTemplate(templates: Template[], requested: string | null, defaultId?: string): string | undefined {
  if (requested && templates.some((t) => t.id === requested)) return requested
  if (defaultId && templates.some((t) => t.id === defaultId)) return defaultId
  const flagged = templates.find((t) => t.isDefault)
  if (flagged) return flagged.id
  const recent = [...templates].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))[0]
  return recent?.id
}

export default function GeneratorPage() {
  const [params] = useSearchParams()
  const templates = useTemplates()
  const { settings, loaded } = useSettingsLoaded()
  const online = useOnline()

  const [templateId, setTemplateId] = useState<string>()
  const template = templates?.find((t) => t.id === templateId)
  const fields = useTemplateFields(templateId)

  const [guestName, setGuestName] = useState('')
  const [country, setCountry] = useState('IN')
  const [phone, setPhone] = useState('')
  const [touched, setTouched] = useState({ name: false, phone: false })
  const [busy, setBusy] = useState<Action | null>(null)
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null)
  const [lastShared, setLastShared] = useState<LastShared | null>(null)
  const [page, setPage] = useState(1)
  const nameInput = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)

  // Initial template and country once data is available.
  const initialized = useRef(false)
  useEffect(() => {
    if (!templates || !loaded || initialized.current) return
    initialized.current = true
    setTemplateId(pickInitialTemplate(templates, params.get('template'), settings.defaultTemplateId))
    setCountry(settings.defaultCountryCode || 'IN')
  }, [templates, loaded, params, settings.defaultTemplateId, settings.defaultCountryCode])

  useEffect(() => {
    if (templates && templateId && !templates.some((t) => t.id === templateId)) {
      setTemplateId(pickInitialTemplate(templates, null, settings.defaultTemplateId))
    }
  }, [templates, templateId, settings.defaultTemplateId])

  useEffect(() => {
    if (fields?.length) setPage(fields[0].pageNumber)
    else setPage(1)
  }, [templateId]) // eslint-disable-line react-hooks/exhaustive-deps

  const { layouts, loading: layoutLoading, error: layoutError } = useFieldLayouts(fields, guestName)
  const layers = useMemo(
    () => (fields ?? []).flatMap((f) => (layouts.get(f.id) ? [{ field: f, layout: layouts.get(f.id)! }] : [])),
    [fields, layouts],
  )
  const overflow = [...layouts.values()].some((l) => l.overflow)
  const missingFont = [...layouts.values()].some((l) => l.missingFont)

  const docKey = template ? `${template.id}:${template.pdfBlob.size}:${template.fileName}` : null
  const pdfDoc = usePdfDocument(docKey, template?.pdfBlob)

  const trimmedName = guestName.trim()
  const phoneResult = normalizePhone(phone, country)
  const nameError = !trimmedName ? 'Guest name is required.' : null
  const phoneError = !phoneResult.valid && !phoneResult.empty ? phoneResult.error : null
  const fileName = buildPdfFilename(settings.filenamePattern, {
    guestName: trimmedName,
    templateName: template?.name,
    eventName: template?.eventName,
  })

  // ---------------------------------------------------------------------------
  // PDF generation with background pre-generation and stale-result protection.

  const genKey =
    template && fields && fields.length > 0 && trimmedName
      ? `${template.id}|${template.updatedAt}|${JSON.stringify(fields)}|${trimmedName}`
      : null
  const genKeyRef = useRef(genKey)
  genKeyRef.current = genKey
  const [ready, setReady] = useState<ReadyPdf | null>(null)
  const readyRef = useRef(ready)
  readyRef.current = ready
  const inflight = useRef(new Map<string, Promise<ReadyPdf>>())
  const currentReady = ready && ready.key === genKey ? ready : null

  const ensurePdf = useCallback((): Promise<ReadyPdf> => {
    const key = genKeyRef.current
    if (!key || !template || !fields) return Promise.reject(new Error('Select a template and enter a guest name.'))
    if (readyRef.current?.key === key) return Promise.resolve(readyRef.current)
    let p = inflight.current.get(key)
    if (!p) {
      const name = trimmedName
      const fname = fileName
      p = generateInvitationPdf(template, name, fields).then(
        (r) => {
          const result: ReadyPdf = { ...r, key, fileName: fname }
          if (genKeyRef.current === key) setReady(result)
          return result
        },
        (err: unknown) => {
          throw Object.assign(err instanceof Error ? err : new Error(String(err)), { generation: true })
        },
      )
      p.finally(() => inflight.current.delete(key)).catch(() => {})
      inflight.current.set(key, p)
    }
    return p
  }, [template, fields, trimmedName, fileName])

  useEffect(() => {
    if (!genKey) return
    const t = window.setTimeout(() => {
      ensurePdf().catch(() => {
        /* surfaced when the user acts */
      })
    }, 400)
    return () => window.clearTimeout(t)
  }, [genKey, ensurePdf])

  // ---------------------------------------------------------------------------
  // History records: one record per generated PDF, updated with later actions.

  const recordRef = useRef<{ key: string; id: string } | null>(null)
  const ensureRecord = async (pdf: ReadyPdf): Promise<string | null> => {
    if (!settings.saveGuestHistory || !template) return null
    const phoneData = phoneResult.valid
      ? { mobileNumber: phoneResult.nationalNumber, countryCode: phoneResult.countryCode }
      : { mobileNumber: '', countryCode: '' }
    if (recordRef.current?.key === pdf.key) {
      await updateInvitation(recordRef.current.id, phoneData)
      return recordRef.current.id
    }
    const inv = await recordInvitation({
      templateId: template.id,
      templateName: template.name,
      guestName: trimmedName,
      ...phoneData,
      pdfFileName: pdf.fileName,
      pdfBlob: settings.saveGeneratedPDFs ? pdf.blob : undefined,
    })
    recordRef.current = { key: pdf.key, id: inv.id }
    void markTemplateUsed(template.id)
    return inv.id
  }

  const validate = (needPhone: boolean): boolean => {
    setTouched({ name: true, phone: needPhone || touched.phone })
    if (!template) {
      toast.error('Please select an invitation template.')
      return false
    }
    if (!fields || fields.length === 0) {
      toast.error('This template has no guest name field.', {
        description: 'Open the template editor and add a name field.',
      })
      return false
    }
    if (nameError) {
      nameInput.current?.focus()
      toast.error(nameError)
      return false
    }
    if (needPhone && !phoneResult.valid) {
      document.getElementById('gen-phone')?.focus()
      toast.error(phoneResult.error)
      return false
    }
    if (!needPhone && phoneError) {
      // An invalid optional number is not saved, but should not block PDF-only actions.
      setTouched((t) => ({ ...t, phone: true }))
    }
    return true
  }

  const run = async (action: Action, fn: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(action)
    try {
      await fn()
    } catch (err) {
      const isGeneration = (err as { generation?: boolean })?.generation
      toast.error(isGeneration ? 'PDF generation failed' : 'Something went wrong', { description: errorMessage(err) })
      if (isGeneration && template && settings.saveGuestHistory) {
        await recordInvitation({
          templateId: template.id,
          templateName: template.name,
          guestName: trimmedName,
          mobileNumber: phoneResult.valid ? phoneResult.nationalNumber : '',
          countryCode: phoneResult.valid ? phoneResult.countryCode : '',
          pdfFileName: fileName,
          generationStatus: 'failed',
          errorMessage: errorMessage(err),
        }).catch(() => {})
      }
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }

  const warnOverflow = (pdf: ReadyPdf) => {
    if (pdf.warnings.some((w) => w.overflow)) {
      toast.warning('The name is too long for the configured area', {
        description: 'It was printed at the minimum font size and may extend beyond the box.',
      })
    }
  }

  const clearGuest = () => {
    setGuestName('')
    setPhone('')
    setTouched({ name: false, phone: false })
    setBlockedUrl(null)
    requestAnimationFrame(() => nameInput.current?.focus())
  }

  const handleGenerate = () => {
    if (!validate(false)) return
    void run('generate', async () => {
      const pdf = await ensurePdf()
      await ensureRecord(pdf)
      warnOverflow(pdf)
      toast.success('Invitation PDF generated', {
        description: pdf.fileName,
        action: { label: 'Download', onClick: () => downloadBlob(pdf.blob, pdf.fileName) },
      })
    })
  }

  const afterDelivery = () => {
    if (settings.autoClearForm) clearGuest()
  }

  const handleDownload = () => {
    if (!validate(false)) return
    const pdf = currentReady
    if (pdf) downloadBlob(pdf.blob, pdf.fileName)
    void run('download', async () => {
      const p = pdf ?? (await ensurePdf())
      if (!pdf) downloadBlob(p.blob, p.fileName)
      const id = await ensureRecord(p)
      if (id) await markInvitation(id, 'downloaded')
      warnOverflow(p)
      toast.success('PDF downloaded', { description: p.fileName })
      afterDelivery()
    })
  }

  /** Hands the PDF file itself to the system share menu, where WhatsApp attaches it directly. */
  const shareViaSheet = (action: 'share' | 'whatsapp') => {
    const pdf = currentReady
    const sharePromise = pdf ? shareFile(toPdfFile(pdf.blob, pdf.fileName)) : null
    const buttonLabel = action === 'whatsapp' ? 'Share on WhatsApp' : 'Share PDF'
    const waUrl = phoneResult.valid ? buildWhatsAppUrl(phoneResult.waNumber) : undefined
    void run(action, async () => {
      const p = pdf ?? (await ensurePdf())
      const outcome = await (sharePromise ?? shareFile(toPdfFile(p.blob, p.fileName)))
      warnOverflow(p)
      if (outcome === 'shared') {
        const id = await ensureRecord(p)
        if (id) {
          await markInvitation(id, 'share_initiated')
          setLastShared({ id, guestName: trimmedName, sent: false, mode: 'share', fileName: p.fileName, waUrl })
        }
        toast.success('PDF handed to the share menu', {
          description: 'Finish sending it in WhatsApp, then confirm here.',
        })
        afterDelivery()
      } else if (outcome === 'needs_gesture') {
        toast.info('Your PDF is ready', { description: `Tap "${buttonLabel}" again to open the share menu.` })
      } else if (outcome === 'unsupported' || outcome === 'failed') {
        downloadBlob(p.blob, p.fileName)
        const id = await ensureRecord(p)
        if (id) await markInvitation(id, 'downloaded')
        toast.info('File sharing is not available here', {
          description: 'The PDF was downloaded instead. Attach it in WhatsApp with the 📎 button.',
        })
      }
    })
  }

  const handleSharePdf = () => {
    if (!validate(false)) return
    shareViaSheet('share')
  }

  const handleWhatsApp = () => {
    const viaShareMenu = canShareFiles()
    if (!validate(!viaShareMenu)) return
    if (viaShareMenu) {
      toast.info('Choose WhatsApp in the share menu', {
        description: 'Then pick the guest’s chat. The PDF is attached automatically.',
      })
      shareViaSheet('whatsapp')
      return
    }
    if (!phoneResult.valid) return
    const waNumber = phoneResult.waNumber
    const pdf = currentReady
    const name = trimmedName
    let target: Window | null = null
    let status: 'opened' | 'blocked' | 'pending' = 'pending'

    if (pdf) {
      // Everything is ready: download and open the chat inside the click handler.
      downloadBlob(pdf.blob, pdf.fileName)
      if (online) status = openWhatsAppChat(waNumber)
    } else if (online) {
      // Reserve a window during the click so it is not blocked after generation finishes.
      target = window.open('about:blank', '_blank')
      try {
        target?.document.write('<p style="font:16px system-ui;padding:24px">Preparing your invitation…</p>')
      } catch {
        /* ignore */
      }
    }

    void run('whatsapp', async () => {
      const p = pdf ?? (await ensurePdf().catch((err) => {
        target?.close()
        throw err
      }))
      if (!pdf) {
        downloadBlob(p.blob, p.fileName)
        if (online) status = openWhatsAppChat(waNumber, target)
      }
      const id = await ensureRecord(p)
      if (id) await markInvitation(id, 'downloaded')
      warnOverflow(p)

      if (!online) {
        toast.error('You are offline', {
          description: 'WhatsApp needs an internet connection. The PDF was downloaded so you can send it later.',
        })
        return
      }
      if (status === 'blocked') {
        setBlockedUrl(buildWhatsAppUrl(waNumber))
        toast.warning('Your browser blocked the WhatsApp window', {
          description: 'Use the "Open WhatsApp chat" button below.',
        })
        return
      }
      if (id) {
        await markInvitation(id, 'whatsapp_opened')
        setLastShared({ id, guestName: name, sent: false, mode: 'chat', fileName: p.fileName, pdf: p.blob })
      }
      setBlockedUrl(null)
      toast.success('WhatsApp chat opened', {
        description: 'This browser cannot attach files automatically. Follow the steps below to attach the PDF.',
      })
      afterDelivery()
    })
  }

  const handleClear = () => {
    clearGuest()
    setLastShared(null)
  }

  useHotkeys([
    { key: 'Enter', ctrl: true, allowInInputs: true, handler: handleGenerate },
    { key: 'Enter', ctrl: true, shift: true, allowInInputs: true, handler: handleWhatsApp },
  ])

  if (templates === undefined) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (templates.length === 0) {
    return (
      <>
        <PageHeader title="Invitation Generator" />
        <EmptyState
          icon={FilePlus2}
          title="Create your first template"
          description="Upload your invitation PDF or image, then mark where the guest name should appear."
          action={
            <Button asChild>
              <Link to="/templates?new=1">Create New Template</Link>
            </Button>
          }
        />
      </>
    )
  }

  const busyIcon = (a: Action, Icon: typeof Download) =>
    busy === a ? <Loader2 className="animate-spin" /> : <Icon />
  const preparing = !!genKey && !currentReady
  const shareSupported = canShareFiles()

  return (
    <div className="pb-24 lg:pb-0">
      <PageHeader
        title="Invitation Generator"
        description={
          <span className="hidden md:inline">
            Shortcuts: <kbd className="rounded border px-1 text-xs">Ctrl + Enter</kbd> generate PDF ·{' '}
            <kbd className="rounded border px-1 text-xs">Ctrl + Shift + Enter</kbd> share on WhatsApp
          </span>
        }
      />
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
        <form
          className="min-w-0 space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            handleGenerate()
          }}
        >
          <div className="space-y-4 rounded-lg border bg-card p-4">
            <div className="space-y-1.5">
              <Label htmlFor="gen-template">Invitation template</Label>
              <NativeSelect id="gen-template" value={templateId ?? ''} onChange={(e) => setTemplateId(e.target.value)}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </NativeSelect>
              {template && fields && fields.length === 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  This template has no name field.{' '}
                  <Link className="underline" to={`/templates/${template.id}/edit`}>
                    Open the editor
                  </Link>{' '}
                  to add one.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gen-name">Guest / Family name *</Label>
              <Input
                id="gen-name"
                ref={nameInput}
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                placeholder="Enter guest or family name"
                autoComplete="off"
                autoFocus
                maxLength={300}
                aria-invalid={touched.name && !!nameError}
                aria-describedby="gen-name-help"
                className="h-12 text-lg md:h-11 md:text-base"
              />
              <p id="gen-name-help" className={`text-xs ${touched.name && nameError ? 'text-destructive' : 'text-muted-foreground'}`}>
                {touched.name && nameError ? nameError : 'English, ગુજરાતી, हिन्दी and other languages are supported.'}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gen-phone">WhatsApp mobile number</Label>
              <div className="flex gap-2">
                <CountrySelect value={country} onChange={setCountry} className="w-32 shrink-0 sm:w-44" compact />
                <Input
                  id="gen-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                  placeholder="98765 43210"
                  aria-invalid={touched.phone && !!phoneError}
                  aria-describedby="gen-phone-help"
                  className="min-w-0 flex-1"
                />
              </div>
              <p
                id="gen-phone-help"
                className={`text-xs ${touched.phone && phoneError ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {touched.phone && phoneError
                  ? phoneError
                  : phoneResult.valid
                    ? `WhatsApp: ${phoneResult.formatted} — no need to save the contact.`
                    : shareSupported
                      ? 'Optional: saved with the history record.'
                      : 'Required for WhatsApp, optional for PDF only.'}
              </p>
            </div>
          </div>

          {(overflow || missingFont || layoutError) && (
            <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" role="alert">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                {overflow && <p>This name does not fit in the name area even at the minimum font size.</p>}
                {missingFont && <p>The template font is missing; a default font is being used.</p>}
                {layoutError && <p>{layoutError}</p>}
              </div>
            </div>
          )}
          {!online && (
            <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
              <WifiOff className="size-4 shrink-0" />
              You are offline. PDFs still work; WhatsApp needs internet.
            </div>
          )}

          <div className="space-y-2 rounded-lg border bg-card p-4">
            <Button type="button" variant="whatsapp" size="lg" className="w-full text-base" onClick={handleWhatsApp} disabled={!!busy}>
              {busyIcon('whatsapp', MessageCircle)}
              Share on WhatsApp
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button type="submit" variant="outline" disabled={!!busy}>
                {busyIcon('generate', FileText)}
                Generate PDF
              </Button>
              <Button type="button" variant="outline" onClick={handleDownload} disabled={!!busy}>
                {busyIcon('download', Download)}
                Download PDF
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleSharePdf}
                disabled={!!busy}
                title={shareSupported ? 'Open the device share menu' : 'Not supported in this browser: downloads instead'}
              >
                {busyIcon('share', Share2)}
                Share PDF
              </Button>
              <Button type="button" variant="outline" onClick={handleClear} disabled={!!busy}>
                <Eraser />
                Clear Form
              </Button>
            </div>
            <Button type="button" variant="secondary" className="w-full" onClick={clearGuest} disabled={!!busy}>
              <SkipForward />
              Generate Next Invitation
            </Button>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {!trimmedName
                ? 'Enter a guest name to prepare the PDF.'
                : preparing
                  ? 'Preparing PDF…'
                  : currentReady
                    ? `Ready: ${currentReady.fileName}`
                    : ''}
            </p>
          </div>

          {blockedUrl && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40">
              <p className="mb-2">The browser blocked the new window. Tap below to open the chat:</p>
              <Button asChild variant="whatsapp">
                <a
                  href={blockedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    if (lastShared === null && recordRef.current) {
                      void markInvitation(recordRef.current.id, 'whatsapp_opened')
                      setLastShared({
                        id: recordRef.current.id,
                        guestName: trimmedName,
                        sent: false,
                        mode: 'chat',
                        fileName: currentReady?.fileName ?? fileName,
                        pdf: currentReady?.blob,
                      })
                    }
                    setBlockedUrl(null)
                  }}
                >
                  <MessageCircle />
                  Open WhatsApp chat
                </a>
              </Button>
            </div>
          )}

          {lastShared && (
            <div className="rounded-lg border bg-card p-4 text-sm">
              {lastShared.sent ? (
                <p className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <CheckCircle2 className="size-4" /> Marked as sent to {lastShared.guestName}.
                </p>
              ) : (
                <>
                  {lastShared.mode === 'share' ? (
                    <p className="mb-3">
                      The PDF for <strong>{lastShared.guestName}</strong> was passed to the share menu. If you picked
                      WhatsApp and a chat, it is attached there — press send in WhatsApp, then confirm here.
                    </p>
                  ) : (
                    <div className="mb-3 space-y-2">
                      <p>
                        The WhatsApp chat for <strong>{lastShared.guestName}</strong> is open. This browser cannot
                        attach files automatically, so attach the downloaded PDF:
                      </p>
                      <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">
                        <li>
                          In the chat, click <strong>📎</strong> or <strong>+</strong>, then <strong>Document</strong>.
                        </li>
                        <li>
                          Choose <strong className="break-all">{lastShared.fileName}</strong> from your Downloads
                          folder (or drag the file into the chat).
                        </li>
                        <li>Press send.</li>
                      </ol>
                      <p className="text-xs text-muted-foreground">
                        Tip: Chrome or Edge on Windows, Android and iPhone can attach the PDF automatically through the
                        share menu.
                      </p>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={async () => {
                        await markInvitation(lastShared.id, 'sent_confirmed')
                        setLastShared({ ...lastShared, sent: true })
                      }}
                    >
                      <CheckCircle2 />
                      Mark as sent
                    </Button>
                    {lastShared.mode === 'chat' && lastShared.pdf && (
                      <Button size="sm" variant="outline" onClick={() => downloadBlob(lastShared.pdf!, lastShared.fileName)}>
                        <Download />
                        Download PDF again
                      </Button>
                    )}
                    {lastShared.mode === 'share' && lastShared.waUrl && (
                      <Button size="sm" variant="outline" asChild>
                        <a href={lastShared.waUrl} target="_blank" rel="noopener noreferrer">
                          <MessageCircle />
                          Open guest’s chat
                        </a>
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={clearGuest}>
                      Next invitation
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </form>

        <div className="min-w-0 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <h2 className="font-medium">Live preview</h2>
            {layoutLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Updating preview" />}
          </div>
          {template ? (
            <PdfPreview
              doc={pdfDoc.doc}
              loading={pdfDoc.loading}
              error={pdfDoc.error}
              pageCount={template.pageCount}
              pageDimensions={template.pageDimensions}
              layers={layers}
              page={page}
              onPageChange={setPage}
              viewportClassName="h-[55vh] lg:h-[calc(100dvh-13rem)]"
              title={`Preview for ${trimmedName || 'guest'}`}
            />
          ) : (
            <div className="flex h-64 items-center justify-center rounded-lg border text-sm text-muted-foreground">
              Select a template
            </div>
          )}
          {!trimmedName && template && (
            <p className="text-xs text-muted-foreground">Type a guest name to see it placed on the invitation.</p>
          )}
        </div>
      </div>

      {/* Quick actions stay reachable on phones and tablets. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 p-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-xl gap-2">
          <Button variant="outline" className="flex-1" onClick={handleDownload} disabled={!!busy}>
            {busyIcon('download', Download)}
            PDF
          </Button>
          <Button variant="whatsapp" className="flex-[2]" onClick={handleWhatsApp} disabled={!!busy}>
            {busyIcon('whatsapp', MessageCircle)}
            Share on WhatsApp
          </Button>
        </div>
      </div>
    </div>
  )
}
