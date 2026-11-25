import { useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/NativeSelect'
import { useCustomFonts } from '@/hooks/useData'
import { addCustomFont, BUILTIN_FONTS } from '@/services/FontService'
import { errorMessage } from '@/utils/format'

export function FontPicker({
  id,
  value,
  onChange,
  allowUpload = true,
}: {
  id?: string
  value: string
  onChange: (fontId: string) => void
  allowUpload?: boolean
}) {
  const custom = useCustomFonts()
  const input = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const known = BUILTIN_FONTS.some((f) => f.id === value) || custom.some((f) => f.id === value)

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const record = await addCustomFont(file)
      onChange(record.id)
      toast.success(`Font "${record.name}" added`, { description: `Supports: ${record.supportedLanguages.join(', ')}` })
    } catch (err) {
      toast.error('Could not add font', { description: errorMessage(err) })
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex gap-2">
      <NativeSelect id={id} className="min-w-0 flex-1" value={value} onChange={(e) => onChange(e.target.value)}>
        {!known && <option value={value}>Missing font (default used)</option>}
        <optgroup label="Built-in fonts">
          {BUILTIN_FONTS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} — {f.supportedLanguages.join(', ')}
            </option>
          ))}
        </optgroup>
        {custom.length > 0 && (
          <optgroup label="Your fonts">
            {custom.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} — {f.supportedLanguages.join(', ')}
              </option>
            ))}
          </optgroup>
        )}
      </NativeSelect>
      {allowUpload && (
        <>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => input.current?.click()}
            disabled={uploading}
            aria-label="Upload custom font (TTF or OTF)"
            title="Upload custom font (TTF or OTF)"
          >
            {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
          </Button>
          <input
            ref={input}
            type="file"
            accept=".ttf,.otf,font/ttf,font/otf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void upload(f)
            }}
          />
        </>
      )}
    </div>
  )
}
