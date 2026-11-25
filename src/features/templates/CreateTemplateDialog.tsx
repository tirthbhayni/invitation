import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileUp, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useObjectUrl } from '@/hooks/useObjectUrl'
import {
  createDefaultField,
  createTemplate,
  prepareTemplateFile,
  saveTemplateFields,
  TEMPLATE_ACCEPT,
  type PreparedTemplateFile,
  type TemplateMeta,
} from '@/services/TemplateService'
import { errorMessage, formatBytes } from '@/utils/format'
import { TemplateDetailsForm } from './TemplateDetailsForm'

export function CreateTemplateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [prepared, setPrepared] = useState<PreparedTemplateFile | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [nameError, setNameError] = useState<string>()
  const [meta, setMeta] = useState<TemplateMeta>({
    name: '',
    eventName: '',
    eventCategory: 'Wedding',
  })

  const reset = () => {
    setFile(null)
    setPrepared(null)
    setFileError(null)
    setNameError(undefined)
    setMeta({ name: '', eventName: '', eventCategory: 'Wedding' })
  }

  const pick = async (f: File) => {
    setFile(f)
    setPrepared(null)
    setFileError(null)
    setPreparing(true)
    try {
      const p = await prepareTemplateFile(f)
      setPrepared(p)
      if (!meta.name.trim()) setMeta((m) => ({ ...m, name: f.name.replace(/\.[^.]+$/, '') }))
    } catch (err) {
      setFileError(errorMessage(err))
    } finally {
      setPreparing(false)
    }
  }

  const save = async () => {
    if (!meta.name.trim()) {
      setNameError('Please enter a template name.')
      return
    }
    if (!prepared) {
      setFileError('Please choose an invitation file.')
      return
    }
    setSaving(true)
    try {
      const tpl = await createTemplate({ ...meta, name: meta.name.trim() }, prepared)
      const field = await createDefaultField(tpl.id, 1, tpl.pageDimensions[0])
      await saveTemplateFields(tpl.id, [field])
      toast.success('Template saved', { description: 'Now position the guest name on the invitation.' })
      onOpenChange(false)
      reset()
      navigate(`/templates/${tpl.id}/edit`)
    } catch (err) {
      toast.error('Could not save template', { description: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !saving) reset()
        if (!saving) onOpenChange(o)
      }}
    >
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New invitation template</DialogTitle>
          <DialogDescription>
            Upload your finished invitation design. The original file is stored unchanged on this device.
          </DialogDescription>
        </DialogHeader>

        <label
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
            dragOver ? 'border-green-600 bg-green-50 dark:bg-green-950/30' : 'hover:bg-accent'
          } ${fileError ? 'border-destructive' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const f = e.dataTransfer.files?.[0]
            if (f) void pick(f)
          }}
        >
          {preparing ? (
            <Loader2 className="size-7 animate-spin text-muted-foreground" />
          ) : prepared?.thumbnail ? (
            <Thumb blob={prepared.thumbnail} />
          ) : (
            <FileUp className="size-7 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">
            {file ? file.name : 'Choose a PDF, JPG or PNG file'}
          </span>
          <span className="text-xs text-muted-foreground">
            {prepared
              ? `${prepared.pageCount} page${prepared.pageCount > 1 ? 's' : ''} · ${formatBytes(file?.size ?? 0)} · ${Math.round(prepared.pageDimensions[0].width)} × ${Math.round(prepared.pageDimensions[0].height)} pt`
              : 'Drag and drop or tap to browse · up to 50 MB'}
          </span>
          <input
            type="file"
            accept={TEMPLATE_ACCEPT}
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void pick(f)
            }}
          />
        </label>
        {fileError && (
          <p className="text-sm text-destructive" role="alert">
            {fileError}
          </p>
        )}

        <TemplateDetailsForm
          value={meta}
          onChange={(p) => {
            setMeta((m) => ({ ...m, ...p }))
            if (p.name) setNameError(undefined)
          }}
          errors={{ name: nameError }}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || preparing || !prepared}>
            {saving && <Loader2 className="animate-spin" />}
            Save and position name
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Thumb({ blob }: { blob: Blob }) {
  const url = useObjectUrl(blob)
  return url ? <img src={url} alt="" className="max-h-32 rounded border object-contain" /> : null
}
