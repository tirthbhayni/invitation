import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Copy,
  Eye,
  FilePlus2,
  FileStack,
  FileText,
  Loader2,
  MoreVertical,
  Pencil,
  Search,
  Send,
  Star,
  Trash2,
  Type,
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
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { NativeSelect } from '@/components/NativeSelect'
import { useConfirm } from '@/components/ConfirmDialog'
import { CreateTemplateDialog } from '@/features/templates/CreateTemplateDialog'
import { PdfPreview } from '@/features/preview/PdfPreview'
import { useTemplateFields, useTemplates } from '@/hooks/useData'
import { useObjectUrl } from '@/hooks/useObjectUrl'
import { usePdfDocument } from '@/hooks/usePdfDocument'
import { useFieldLayouts } from '@/hooks/useFieldLayouts'
import { deleteTemplate, duplicateTemplate, renameTemplate, setDefaultTemplate } from '@/services/TemplateService'
import { errorMessage, formatDate } from '@/utils/format'
import { EVENT_CATEGORIES, type Template } from '@/types'

function TemplateCard({
  template,
  onPreview,
  onRename,
  onDelete,
}: {
  template: Template
  onPreview: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const url = useObjectUrl(template.thumbnail)
  const navigate = useNavigate()
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card">
      <button
        type="button"
        onClick={onPreview}
        className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted"
        aria-label={`Preview ${template.name}`}
      >
        {url ? (
          <img src={url} alt="" className="h-full w-full object-contain" />
        ) : (
          <FileText className="size-8 text-muted-foreground" />
        )}
        {template.isDefault === 1 && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-xs font-medium text-white">
            <Star className="size-3" /> Default
          </span>
        )}
      </button>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-medium" title={template.name}>
              {template.name}
            </h3>
            <p className="truncate text-xs text-muted-foreground">
              {template.eventCategory}
              {template.eventName ? ` · ${template.eventName}` : ''}
              {template.eventDate ? ` · ${formatDate(template.eventDate)}` : ''}
            </p>
            <p className="text-xs text-muted-foreground">
              {template.pageCount} page{template.pageCount > 1 ? 's' : ''} · {template.fileType === 'application/pdf' ? 'PDF' : 'Image'}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${template.name}`}>
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => navigate(`/generate?template=${template.id}`)}>
                <Send /> Generate invitation
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate(`/templates/${template.id}/edit`)}>
                <Pencil /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onPreview}>
                <Eye /> Preview
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={async () => {
                  try {
                    const copy = await duplicateTemplate(template.id)
                    toast.success(`Duplicated as "${copy.name}"`)
                  } catch (err) {
                    toast.error('Could not duplicate', { description: errorMessage(err) })
                  }
                }}
              >
                <Copy /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onRename}>
                <Type /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={template.isDefault === 1}
                onSelect={async () => {
                  await setDefaultTemplate(template.id)
                  toast.success(`"${template.name}" is now the default template`)
                }}
              >
                <Star /> Set as default
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="mt-auto flex gap-2 pt-2">
          <Button asChild variant="outline" size="sm" className="flex-1">
            <Link to={`/templates/${template.id}/edit`}>
              <Pencil />
              Edit
            </Link>
          </Button>
          <Button asChild variant="whatsapp" size="sm" className="flex-1">
            <Link to={`/generate?template=${template.id}`}>
              <Send />
              Generate
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

function TemplatePreviewDialog({ template, onClose }: { template: Template | null; onClose: () => void }) {
  const fields = useTemplateFields(template?.id)
  const { layouts } = useFieldLayouts(fields, 'Rajesh Patel & Family')
  const layers = useMemo(
    () => (fields ?? []).flatMap((f) => (layouts.get(f.id) ? [{ field: f, layout: layouts.get(f.id)! }] : [])),
    [fields, layouts],
  )
  const { doc, error, loading } = usePdfDocument(
    template ? `${template.id}:${template.pdfBlob.size}:${template.fileName}` : null,
    template?.pdfBlob,
  )
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [template?.id])
  return (
    <Dialog open={!!template} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[95dvh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{template?.name}</DialogTitle>
          <DialogDescription>Preview with a sample guest name.</DialogDescription>
        </DialogHeader>
        {template && (
          <PdfPreview
            doc={doc}
            error={error}
            loading={loading}
            pageCount={template.pageCount}
            pageDimensions={template.pageDimensions}
            layers={layers}
            page={page}
            onPageChange={setPage}
            viewportClassName="h-[65dvh]"
            allowFullscreen={false}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

export default function TemplatesPage() {
  const templates = useTemplates()
  const [params, setParams] = useSearchParams()
  const [createOpen, setCreateOpen] = useState(params.get('new') === '1')
  const [preview, setPreview] = useState<Template | null>(null)
  const [renaming, setRenaming] = useState<Template | null>(null)
  const [newName, setNewName] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const { confirm, dialog } = useConfirm()

  useEffect(() => {
    if (params.get('new') === '1') {
      setCreateOpen(true)
      params.delete('new')
      setParams(params, { replace: true })
    }
  }, [params, setParams])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (templates ?? []).filter(
      (t) =>
        (!category || t.eventCategory === category) &&
        (!q || t.name.toLowerCase().includes(q) || t.eventName.toLowerCase().includes(q)),
    )
  }, [templates, query, category])

  return (
    <div>
      {dialog}
      <PageHeader
        title="Invitation Templates"
        description="Your uploaded invitation designs and their guest name settings."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <FilePlus2 />
            Create New Template
          </Button>
        }
      />

      {templates === undefined ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : templates.length === 0 ? (
        <EmptyState
          icon={FileStack}
          title="No templates yet"
          description="Upload your invitation as PDF, JPG or PNG. The original design stays unchanged; only the guest name is added."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <FilePlus2 />
              Create New Template
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search templates"
                className="pl-9"
                aria-label="Search templates"
              />
            </div>
            <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)} className="sm:w-52" aria-label="Filter by category">
              <option value="">All categories</option>
              {EVENT_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </NativeSelect>
          </div>
          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No templates match your search.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  onPreview={() => setPreview(t)}
                  onRename={() => {
                    setRenaming(t)
                    setNewName(t.name)
                  }}
                  onDelete={() =>
                    confirm({
                      title: `Delete "${t.name}"?`,
                      description:
                        'The template, its uploaded file and name positions will be removed from this device. Invitation history is kept.',
                      confirmLabel: 'Delete template',
                      destructive: true,
                      onConfirm: async () => {
                        await deleteTemplate(t.id)
                        toast.success('Template deleted')
                      },
                    })
                  }
                />
              ))}
            </div>
          )}
        </>
      )}

      <CreateTemplateDialog open={createOpen} onOpenChange={setCreateOpen} />
      <TemplatePreviewDialog template={preview} onClose={() => setPreview(null)} />

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (!renaming) return
              try {
                await renameTemplate(renaming.id, newName)
                toast.success('Template renamed')
                setRenaming(null)
              } catch (err) {
                toast.error(errorMessage(err))
              }
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>Rename template</DialogTitle>
              <DialogDescription>Choose a name you will recognise in the generator.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="rename">Template name</Label>
              <Input id="rename" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus maxLength={120} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!newName.trim()}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
