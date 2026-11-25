import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  FileUp,
  Loader2,
  Maximize,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Send,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState } from '@/components/EmptyState'
import { useConfirm } from '@/components/ConfirmDialog'
import { useTemplate, useTemplateFields } from '@/hooks/useData'
import { usePdfDocument } from '@/hooks/usePdfDocument'
import { useFieldLayouts } from '@/hooks/useFieldLayouts'
import { useElementSize } from '@/hooks/useElementWidth'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useUndoable } from '@/hooks/useUndoable'
import { PageView } from '@/features/preview/PageView'
import { FieldBox, type FieldGeometry } from '@/features/editor/FieldBox'
import { PositionSettings, TextSettings, TypographySettings } from '@/features/editor/FieldProperties'
import { TemplateDetailsForm } from '@/features/templates/TemplateDetailsForm'
import {
  createDefaultField,
  prepareTemplateFile,
  replaceTemplateFile,
  saveTemplateFields,
  TEMPLATE_ACCEPT,
  updateTemplate,
  type TemplateMeta,
} from '@/services/TemplateService'
import { generateInvitationPdf } from '@/services/GenerationService'
import { downloadBlob } from '@/services/FileShareService'
import { buildPdfFilename } from '@/utils/filename'
import { clamp, type PositionUnit } from '@/utils/units'
import { errorMessage } from '@/utils/format'
import { createId } from '@/utils/id'
import type { NameField, Template } from '@/types'

const SAMPLE_NAMES = [
  { label: 'English', value: 'Rajesh Patel & Family' },
  { label: 'Gujarati', value: 'શ્રી રાજેશભાઈ પટેલ સહપરિવાર' },
  { label: 'Hindi', value: 'श्री राजेश पटेल सपरिवार' },
  { label: 'Long', value: 'Shri Rajeshkumar Ramanlal Patel and Family Members' },
]
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4]

function metaOf(t: Template): TemplateMeta {
  return {
    name: t.name,
    eventName: t.eventName,
    eventCategory: t.eventCategory,
    eventDate: t.eventDate,
  }
}

export default function TemplateEditorPage() {
  const { id } = useParams()
  const template = useTemplate(id)
  const savedFields = useTemplateFields(id)

  if (template === undefined || savedFields === undefined) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (template === null) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Template not found"
        description="It may have been deleted or this link is out of date."
        action={
          <Button asChild>
            <Link to="/templates">Back to templates</Link>
          </Button>
        }
      />
    )
  }
  return <Editor key={template.id} template={template} initialFields={savedFields} />
}

function Editor({ template, initialFields }: { template: Template; initialFields: NameField[] }) {
  const navigate = useNavigate()
  const history = useUndoable<NameField[]>(initialFields)
  const fields = history.value
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(initialFields))
  const [meta, setMeta] = useState<TemplateMeta>(() => metaOf(template))
  const [savedMeta, setSavedMeta] = useState(() => JSON.stringify(metaOf(template)))
  const [selectedId, setSelectedId] = useState<string | null>(initialFields[0]?.id ?? null)
  const [page, setPage] = useState(initialFields[0]?.pageNumber ?? 1)
  const [zoomMode, setZoomMode] = useState<'fit' | number>('fit')
  const [unit, setUnit] = useState<PositionUnit>('pt')
  const [testName, setTestName] = useState(SAMPLE_NAMES[0].value)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [nameError, setNameError] = useState<string>()
  const replaceInput = useRef<HTMLInputElement>(null)
  const { confirm, dialog } = useConfirm()

  const docKey = `${template.id}:${template.pdfBlob.size}:${template.fileName}`
  const { doc, error: docError } = usePdfDocument(docKey, template.pdfBlob)
  const pageSize = template.pageDimensions[page - 1] ?? template.pageDimensions[0]
  const viewport = useRef<HTMLDivElement>(null)
  const { width: vw, height: vh } = useElementSize(viewport)
  const fitZoom = vw > 0 ? Math.max(0.1, Math.min((vw - 48) / pageSize.width, (vh - 48) / pageSize.height)) : 1
  const zoom = clamp(zoomMode === 'fit' ? fitZoom : zoomMode, 0.05, 6)

  const { layouts } = useFieldLayouts(fields, testName)
  const layers = useMemo(
    () => fields.flatMap((f) => (layouts.get(f.id) ? [{ field: f, layout: layouts.get(f.id)! }] : [])),
    [fields, layouts],
  )
  const selected = fields.find((f) => f.id === selectedId) ?? null
  const selectedLayout = selected ? layouts.get(selected.id) : undefined
  const dirty = JSON.stringify(fields) !== savedSnapshot || JSON.stringify(meta) !== savedMeta

  const allowNavigation = useRef(false)
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !allowNavigation.current && dirty && currentLocation.pathname !== nextLocation.pathname,
  )
  const blockerRef = useRef(blocker)
  blockerRef.current = blocker
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    confirm({
      title: 'Discard unsaved changes?',
      description: 'You have changes to this template that have not been saved.',
      confirmLabel: 'Discard changes',
      destructive: true,
      onConfirm: () => blockerRef.current.proceed?.(),
      onCancel: () => blockerRef.current.reset?.(),
    })
  }, [blocker.state, confirm])
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const patchField = useCallback(
    (fieldId: string, patch: Partial<NameField>, coalesceKey?: string) => {
      history.set(
        (prev) => prev.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)),
        coalesceKey ? `${fieldId}-${coalesceKey}` : undefined,
      )
      if (patch.pageNumber) setPage(patch.pageNumber)
    },
    [history],
  )

  const addField = async () => {
    const field = await createDefaultField(template.id, page, pageSize)
    if (selected) {
      Object.assign(field, {
        ...selected,
        id: createId(),
        pageNumber: page,
        y: clamp(selected.y + selected.height + 10, 0, pageSize.height - selected.height),
      })
    }
    history.set((prev) => [...prev, field])
    setSelectedId(field.id)
  }

  const deleteField = (fieldId: string) => {
    history.set((prev) => prev.filter((f) => f.id !== fieldId))
    if (selectedId === fieldId) setSelectedId(null)
  }

  const resetPosition = async () => {
    if (!selected) return
    const def = await createDefaultField(template.id, selected.pageNumber, template.pageDimensions[selected.pageNumber - 1])
    patchField(selected.id, { x: def.x, y: def.y, width: def.width, height: def.height, rotation: 0 })
  }

  const save = async () => {
    if (!meta.name.trim()) {
      setNameError('Please enter a template name.')
      toast.error('Template name is required')
      return false
    }
    setSaving(true)
    try {
      await saveTemplateFields(template.id, fields)
      await updateTemplate(template.id, { ...meta, name: meta.name.trim() })
      setSavedSnapshot(JSON.stringify(fields))
      setSavedMeta(JSON.stringify(meta))
      toast.success('Template saved')
      return true
    } catch (err) {
      toast.error('Could not save template', { description: errorMessage(err) })
      return false
    } finally {
      setSaving(false)
    }
  }

  const downloadTest = async () => {
    if (!testName.trim()) return toast.error('Enter a test guest name first')
    if (fields.length === 0) return toast.error('Add a name field first')
    setTesting(true)
    try {
      const { blob, warnings } = await generateInvitationPdf(template, testName, fields)
      downloadBlob(blob, buildPdfFilename('{guest_name}_Test', { guestName: testName }))
      if (warnings.some((w) => w.overflow)) toast.warning('The test name does not fully fit in at least one field.')
    } catch (err) {
      toast.error('Test PDF failed', { description: errorMessage(err) })
    } finally {
      setTesting(false)
    }
  }

  const replaceFile = async (file: File) => {
    try {
      const prepared = await prepareTemplateFile(file)
      await replaceTemplateFile(template.id, prepared)
      history.set((prev) => prev.map((f) => (f.pageNumber > prepared.pageCount ? { ...f, pageNumber: 1 } : f)))
      setPage(1)
      toast.success('Invitation file replaced', { description: 'Field positions were kept.' })
    } catch (err) {
      toast.error('Could not replace file', { description: errorMessage(err) })
    }
  }

  const stepZoom = (dir: 1 | -1) => {
    const next = dir > 0 ? ZOOM_STEPS.find((z) => z > zoom + 0.01) : [...ZOOM_STEPS].reverse().find((z) => z < zoom - 0.01)
    setZoomMode(next ?? (dir > 0 ? 4 : 0.25))
  }

  useHotkeys([
    { key: 'z', ctrl: true, handler: history.undo },
    { key: 'z', ctrl: true, shift: true, handler: history.redo },
    { key: 'y', ctrl: true, handler: history.redo },
    { key: 's', ctrl: true, allowInInputs: true, handler: () => void save() },
  ])

  const pageFields = fields.filter((f) => f.pageNumber === page)
  const overflow = selectedLayout?.overflow

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {dialog}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/templates" aria-label="Back to templates">
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{meta.name || 'Untitled template'}</h1>
            <p className="text-xs text-muted-foreground">
              {template.pageCount} page{template.pageCount > 1 ? 's' : ''} · {fields.length} name field
              {fields.length === 1 ? '' : 's'} {dirty && <span className="text-amber-600">· Unsaved changes</span>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={downloadTest} disabled={testing}>
            {testing ? <Loader2 className="animate-spin" /> : <Download />}
            Test PDF
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              if (!dirty || (await save())) {
                allowNavigation.current = true
                navigate(`/generate?template=${template.id}`)
              }
            }}
          >
            <Send />
            Generate invitation
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            Save template
          </Button>
        </div>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card">
          <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
            <Button size="sm" onClick={addField}>
              <Plus />
              Add Name Field
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={history.undo} disabled={!history.canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
              <Undo2 />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={history.redo} disabled={!history.canRedo} aria-label="Redo" title="Redo (Ctrl+Y)">
              <Redo2 />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={resetPosition} disabled={!selected} aria-label="Reset position" title="Reset position">
              <RotateCcw />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => selected && deleteField(selected.id)}
              disabled={!selected}
              aria-label="Delete selected field"
              title="Delete selected field"
            >
              <Trash2 />
            </Button>
            <div className="mx-1 h-6 w-px bg-border max-sm:hidden" />
            <Button variant="ghost" size="icon-sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {page}/{template.pageCount}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setPage((p) => Math.min(template.pageCount, p + 1))}
              disabled={page >= template.pageCount}
              aria-label="Next page"
            >
              <ChevronRight />
            </Button>
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" onClick={() => stepZoom(-1)} aria-label="Zoom out">
                <ZoomOut />
              </Button>
              <button
                type="button"
                className="min-w-12 rounded px-1 text-xs text-muted-foreground tabular-nums hover:bg-accent"
                onClick={() => setZoomMode(1)}
                title="Reset zoom to 100%"
              >
                {Math.round(zoom * 100)}%
              </button>
              <Button variant="ghost" size="icon-sm" onClick={() => stepZoom(1)} aria-label="Zoom in">
                <ZoomIn />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => setZoomMode('fit')} aria-label="Fit to screen" title="Fit to screen">
                <Maximize />
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
            <Label htmlFor="test-name" className="shrink-0 text-xs text-muted-foreground">
              Test guest name
            </Label>
            <Input id="test-name" value={testName} onChange={(e) => setTestName(e.target.value)} className="min-w-40 flex-1" />
            <div className="flex flex-wrap gap-1">
              {SAMPLE_NAMES.map((s) => (
                <Button key={s.label} variant="outline" size="sm" onClick={() => setTestName(s.value)}>
                  {s.label}
                </Button>
              ))}
            </div>
          </div>

          <div
            ref={viewport}
            className="relative h-[60vh] min-h-80 overflow-auto bg-neutral-100 lg:h-[calc(100dvh-15rem)] dark:bg-neutral-900"
            onPointerDown={() => setSelectedId(null)}
          >
            {docError ? (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-destructive">{docError}</div>
            ) : !doc ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="flex min-h-full min-w-fit items-center justify-center p-6">
                <PageView doc={doc} pageNumber={page} pageSize={pageSize} zoom={zoom} layers={layers}>
                  {pageFields.map((f) => (
                    <FieldBox
                      key={f.id}
                      field={f}
                      zoom={zoom}
                      page={pageSize}
                      selected={f.id === selectedId}
                      label={`{{guest_name}}${fields.length > 1 ? ` #${fields.indexOf(f) + 1}` : ''}`}
                      onSelect={() => setSelectedId(f.id)}
                      onChange={(g: Partial<FieldGeometry>, key) => patchField(f.id, g, key)}
                      onDelete={() => deleteField(f.id)}
                    />
                  ))}
                </PageView>
              </div>
            )}
          </div>
          {fields.length === 0 && (
            <p className="border-t px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              This template has no name field yet. Click <strong>Add Name Field</strong> to place the guest name.
            </p>
          )}
          {fields.length > 0 && pageFields.length === 0 && (
            <p className="border-t px-3 py-2 text-sm text-muted-foreground">
              No name field on this page. Fields are on page{' '}
              {[...new Set(fields.map((f) => f.pageNumber))].join(', ')}.
            </p>
          )}
        </div>

        <div className="min-w-0 rounded-lg border bg-card">
          <Tabs defaultValue="field" className="gap-0">
            <TabsList className="m-2 grid w-[calc(100%-1rem)] grid-cols-3">
              <TabsTrigger value="field">Position</TabsTrigger>
              <TabsTrigger value="type">Typography</TabsTrigger>
              <TabsTrigger value="details">Details</TabsTrigger>
            </TabsList>
            <div className="max-h-none overflow-y-auto px-4 pb-4 lg:max-h-[calc(100dvh-12rem)]">
              {(['field', 'type'] as const).map((tab) => (
                <TabsContent key={tab} value={tab} className="space-y-6 pt-2">
                  {!selected ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      {fields.length ? 'Select a name field on the invitation to edit it.' : 'Add a name field to get started.'}
                    </p>
                  ) : (
                    <>
                      {overflow && (
                        <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" role="alert">
                          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                          The test name does not fit at the minimum font size. Enlarge the box, lower the minimum size or
                          enable multiline wrapping.
                        </div>
                      )}
                      {selectedLayout?.shrunk && !overflow && (
                        <p className="text-xs text-muted-foreground">
                          Auto-fit reduced the test name to {selectedLayout.fontSize.toFixed(1)} pt.
                        </p>
                      )}
                      {tab === 'field' ? (
                        <PositionSettings
                          field={selected}
                          page={template.pageDimensions[selected.pageNumber - 1] ?? pageSize}
                          pageCount={template.pageCount}
                          unit={unit}
                          onUnitChange={setUnit}
                          onPatch={(p, k) => patchField(selected.id, p, k)}
                        />
                      ) : (
                        <>
                          <TypographySettings field={selected} onPatch={(p, k) => patchField(selected.id, p, k)} />
                          <TextSettings field={selected} onPatch={(p, k) => patchField(selected.id, p, k)} />
                        </>
                      )}
                    </>
                  )}
                </TabsContent>
              ))}
              <TabsContent value="details" className="space-y-6 pt-2">
                <TemplateDetailsForm
                  value={meta}
                  onChange={(p) => {
                    setMeta((m) => ({ ...m, ...p }))
                    if (p.name) setNameError(undefined)
                  }}
                  errors={{ name: nameError }}
                />
                <div className="space-y-2 rounded-md border p-3">
                  <p className="text-sm font-medium">Invitation file</p>
                  <p className="text-xs break-all text-muted-foreground">{template.fileName}</p>
                  <Button variant="outline" size="sm" onClick={() => replaceInput.current?.click()}>
                    <FileUp />
                    Replace file
                  </Button>
                  <input
                    ref={replaceInput}
                    type="file"
                    accept={TEMPLATE_ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (f) void replaceFile(f)
                    }}
                  />
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
