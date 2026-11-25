import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Database,
  Download,
  HardDrive,
  Loader2,
  Moon,
  Monitor,
  ShieldCheck,
  Sun,
  Trash2,
  Type,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { PageHeader } from '@/components/PageHeader'
import { NativeSelect } from '@/components/NativeSelect'
import { CountrySelect } from '@/components/CountrySelect'
import { NumberField } from '@/components/NumberField'
import { useConfirm } from '@/components/ConfirmDialog'
import { FontPicker } from '@/features/fonts/FontPicker'
import { useCustomFonts, useSettings, useTemplates } from '@/hooks/useData'
import { db } from '@/database/db'
import { getStorageEstimate, requestPersistentStorage, updateSettings } from '@/services/StorageService'
import { clearAllData, createBackup, readBackup } from '@/services/BackupService'
import { clearHistory } from '@/services/InvitationService'
import { deleteTemplate, findUnusedTemplateIds } from '@/services/TemplateService'
import { addCustomFont, deleteCustomFont } from '@/services/FontService'
import { forgetFontEverywhere } from '@/services/GenerationService'
import { downloadBlob } from '@/services/FileShareService'
import { buildPdfFilename, DEFAULT_FILENAME_PATTERN } from '@/utils/filename'
import { errorMessage, formatBytes } from '@/utils/format'
import type { ThemeMode } from '@/types'

function Card({ title, icon: Icon, children, description }: { title: string; icon: typeof Sun; children: ReactNode; description?: ReactNode }) {
  return (
    <section className="rounded-lg border bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="flex items-center gap-2 font-medium">
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="space-y-4 p-4">{children}</div>
    </section>
  )
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

function FilenameSetting({ value }: { value: string }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <div className="space-y-1.5">
      <Label htmlFor="set-filename">PDF filename format</Label>
      <Input
        id="set-filename"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => updateSettings({ filenamePattern: text.trim() || DEFAULT_FILENAME_PATTERN })}
      />
      <p className="text-xs text-muted-foreground">
        Variables: <code>{'{guest_name}'}</code> <code>{'{template_name}'}</code> <code>{'{event_name}'}</code>{' '}
        <code>{'{date}'}</code>. Example:{' '}
        <strong className="break-all">{buildPdfFilename(text, { guestName: 'Rajesh Patel', templateName: 'Wedding', eventName: 'Reception' })}</strong>
      </p>
    </div>
  )
}

export default function SettingsPage() {
  const settings = useSettings()
  const templates = useTemplates()
  const fonts = useCustomFonts()
  const { confirm, dialog } = useConfirm()
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof getStorageEstimate>>>(null)
  const [includePdfs, setIncludePdfs] = useState(false)
  const [exporting, setExporting] = useState(false)
  const restoreInput = useRef<HTMLInputElement>(null)
  const fontInput = useRef<HTMLInputElement>(null)
  const [uploadingFont, setUploadingFont] = useState(false)

  const refreshStorage = () => void getStorageEstimate().then(setStorage)
  useEffect(refreshStorage, [])

  const save = (patch: Parameters<typeof updateSettings>[0]) =>
    updateSettings(patch).catch((err) => toast.error('Could not save setting', { description: errorMessage(err) }))

  const exportBackup = async () => {
    setExporting(true)
    try {
      const blob = await createBackup(includePdfs)
      downloadBlob(blob, `InvitePrint_Backup_${new Date().toISOString().slice(0, 10)}.json`)
      toast.success('Backup downloaded', { description: formatBytes(blob.size) })
    } catch (err) {
      toast.error('Backup failed', { description: errorMessage(err) })
    } finally {
      setExporting(false)
    }
  }

  const restore = async (file: File) => {
    try {
      const { summary, restore: apply } = await readBackup(file)
      confirm({
        title: 'Restore this backup?',
        description: (
          <div className="space-y-2">
            <p>All current data on this device will be replaced with the backup{summary.exportedAt ? ` from ${new Date(summary.exportedAt).toLocaleString()}` : ''}:</p>
            <p className="text-foreground">
              {summary.counts.templates} templates · {summary.counts.invitations} history records · {summary.counts.fonts} fonts ·{' '}
              {summary.counts.bulkGuests} bulk guests
            </p>
          </div>
        ),
        confirmLabel: 'Replace and restore',
        destructive: true,
        onConfirm: async () => {
          try {
            await apply()
            toast.success('Backup restored')
            refreshStorage()
          } catch (err) {
            toast.error('Restore failed', { description: errorMessage(err) })
          }
        },
      })
    } catch (err) {
      toast.error('Cannot read backup', { description: errorMessage(err) })
    }
  }

  const usagePct = storage && storage.quota ? Math.min(100, (storage.usage / storage.quota) * 100) : 0

  return (
    <div className="space-y-5">
      {dialog}
      <PageHeader title="Settings" description="Preferences are saved automatically on this device." />

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Defaults" icon={Type}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="set-country">Default country code</Label>
              <CountrySelect id="set-country" value={settings.defaultCountryCode} onChange={(v) => save({ defaultCountryCode: v })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="set-template">Default invitation template</Label>
              <NativeSelect
                id="set-template"
                value={settings.defaultTemplateId ?? ''}
                onChange={async (e) => {
                  const id = e.target.value || undefined
                  await save({ defaultTemplateId: id })
                  if (id) {
                    await db.transaction('rw', db.templates, async () => {
                      await db.templates.where('isDefault').equals(1).modify({ isDefault: 0 })
                      await db.templates.update(id, { isDefault: 1 })
                    })
                  }
                }}
              >
                <option value="">Last used template</option>
                {templates?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="set-font">Default font for new name fields</Label>
              <FontPicker id="set-font" value={settings.defaultFontId} onChange={(v) => save({ defaultFontId: v })} />
            </div>
            <NumberField label="Default font size" value={settings.defaultFontSize} min={4} max={300} suffix="pt" decimals={1} onChange={(v) => save({ defaultFontSize: v })} />
            <div className="space-y-1">
              <Label htmlFor="set-color" className="text-xs text-muted-foreground">
                Default text colour
              </Label>
              <div className="flex items-center gap-2">
                <input
                  id="set-color"
                  type="color"
                  value={settings.defaultFontColor}
                  onChange={(e) => save({ defaultFontColor: e.target.value })}
                  className="h-11 w-14 cursor-pointer rounded-md border bg-background p-1 md:h-9"
                />
                <span className="font-mono text-sm">{settings.defaultFontColor}</span>
              </div>
            </div>
          </div>
          <FilenameSetting value={settings.filenamePattern} />
        </Card>

        <div className="space-y-5">
          <Card title="Behaviour" icon={Monitor}>
            <ToggleRow
              label="Auto-clear form after generation"
              description="Clear the guest name and mobile number after downloading or sharing."
              checked={settings.autoClearForm}
              onChange={(v) => save({ autoClearForm: v })}
            />
            <ToggleRow
              label="Save invitation history"
              description="Keep a record of each generated invitation on this device."
              checked={settings.saveGuestHistory}
              onChange={(v) => save({ saveGuestHistory: v })}
            />
            <ToggleRow
              label="Save generated PDF files"
              description="Store PDFs with history so they can be downloaded again without regenerating. Uses more storage."
              checked={settings.saveGeneratedPDFs}
              onChange={(v) => save({ saveGeneratedPDFs: v })}
            />
          </Card>

          <Card title="Appearance" icon={Sun}>
            <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
              {(
                [
                  { value: 'light', label: 'Light', icon: Sun },
                  { value: 'dark', label: 'Dark', icon: Moon },
                  { value: 'system', label: 'System', icon: Monitor },
                ] as { value: ThemeMode; label: string; icon: typeof Sun }[]
              ).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={settings.theme === value}
                  onClick={() => save({ theme: value })}
                  className={`flex min-h-11 items-center justify-center gap-2 rounded-md border text-sm ${
                    settings.theme === value ? 'border-foreground bg-accent font-medium' : 'hover:bg-accent/60'
                  }`}
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              ))}
            </div>
          </Card>

          <Card title="Custom fonts" icon={Type} description="Upload TTF or OTF files. Fonts are stored on this device and embedded into PDFs.">
            {fonts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No custom fonts yet. Use the upload button next to any font picker.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {fonts.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{f.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {f.fileType.toUpperCase()} · {f.supportedLanguages.join(', ')} · {formatBytes(f.fileBlob.size)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete font ${f.name}`}
                      onClick={() =>
                        confirm({
                          title: `Delete font "${f.name}"?`,
                          description: 'Name fields using this font will fall back to Noto Sans.',
                          confirmLabel: 'Delete font',
                          destructive: true,
                          onConfirm: async () => {
                            await deleteCustomFont(f.id)
                            forgetFontEverywhere(f.id)
                            toast.success('Font deleted')
                          },
                        })
                      }
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <Button variant="outline" size="sm" onClick={() => fontInput.current?.click()} disabled={uploadingFont}>
              {uploadingFont ? <Loader2 className="animate-spin" /> : <Upload />}
              Upload font
            </Button>
            <input
              ref={fontInput}
              type="file"
              accept=".ttf,.otf,font/ttf,font/otf"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                setUploadingFont(true)
                try {
                  const record = await addCustomFont(f)
                  toast.success(`Font "${record.name}" added`, { description: `Supports: ${record.supportedLanguages.join(', ')}` })
                } catch (err) {
                  toast.error('Could not add font', { description: errorMessage(err) })
                } finally {
                  setUploadingFont(false)
                }
              }}
            />
          </Card>
        </div>
      </div>

      <Card
        title="Data and privacy"
        icon={ShieldCheck}
        description="Invitation files, guest names and mobile numbers never leave this device. Nothing is uploaded to any server."
      >
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Browser storage can be erased if you clear site data, use private browsing, or the device runs low on space.
          Export a backup regularly to keep your templates and history safe.
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-2 rounded-md border p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <HardDrive className="size-4" /> Storage
            </p>
            {storage ? (
              <>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-green-600" style={{ width: `${usagePct}%` }} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(storage.usage)} used of {formatBytes(storage.quota)} available
                </p>
                <p className="text-xs text-muted-foreground">
                  {storage.persisted ? 'Persistent storage is enabled.' : 'Storage may be cleared by the browser when space is low.'}
                </p>
                {!storage.persisted && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      const ok = await requestPersistentStorage()
                      toast[ok ? 'success' : 'info'](ok ? 'Persistent storage enabled' : 'The browser did not grant persistent storage')
                      refreshStorage()
                    }}
                  >
                    Request persistent storage
                  </Button>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Storage information is not available in this browser.</p>
            )}
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Database className="size-4" /> Backup
            </p>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={includePdfs} onCheckedChange={(v) => setIncludePdfs(!!v)} />
              Include generated PDFs (larger file)
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={exportBackup} disabled={exporting}>
                {exporting ? <Loader2 className="animate-spin" /> : <Download />}
                Export complete backup
              </Button>
              <Button variant="outline" size="sm" onClick={() => restoreInput.current?.click()}>
                <Upload />
                Restore backup
              </Button>
              <input
                ref={restoreInput}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) void restore(f)
                }}
              />
            </div>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-destructive">
              <Trash2 className="size-4" /> Clean up
            </p>
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  confirm({
                    title: 'Clear invitation history?',
                    description: 'All history records and stored PDFs will be deleted. Templates are kept.',
                    confirmLabel: 'Clear history',
                    destructive: true,
                    onConfirm: async () => {
                      await clearHistory()
                      toast.success('Invitation history cleared')
                      refreshStorage()
                    },
                  })
                }
              >
                Clear invitation history
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const ids = await findUnusedTemplateIds()
                  if (ids.length === 0) return toast.info('No unused templates found')
                  confirm({
                    title: `Delete ${ids.length} unused template${ids.length === 1 ? '' : 's'}?`,
                    description: 'Templates that were never used to generate an invitation and are not the default will be deleted.',
                    confirmLabel: 'Delete unused',
                    destructive: true,
                    onConfirm: async () => {
                      for (const id of ids) await deleteTemplate(id)
                      toast.success(`${ids.length} template${ids.length === 1 ? '' : 's'} deleted`)
                      refreshStorage()
                    },
                  })
                }}
              >
                Delete unused templates
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() =>
                  confirm({
                    title: 'Clear ALL application data?',
                    description:
                      'Every template, font, history record, bulk list and setting will be permanently deleted from this device. Export a backup first if you may need it.',
                    confirmLabel: 'Delete everything',
                    destructive: true,
                    onConfirm: async () => {
                      await clearAllData()
                      toast.success('All data cleared')
                      refreshStorage()
                    },
                  })
                }
              >
                Clear all application data
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-1 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">About WhatsApp sharing</p>
          <p>
            InvitePrint uses WhatsApp's official click-to-chat links (wa.me). They open a chat with any number without
            saving it as a contact, but cannot attach files automatically, so the PDF is downloaded for you to attach.
            The "Share PDF" button uses your device's share menu where supported; it cannot preselect a WhatsApp contact.
            InvitePrint never marks an invitation as delivered — only you can confirm it was sent.
          </p>
        </div>
      </Card>
    </div>
  )
}
