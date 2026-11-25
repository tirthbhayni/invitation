import { useEffect, useState } from 'react'
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Underline } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Toggle } from '@/components/ui/toggle'
import { NativeSelect } from '@/components/NativeSelect'
import { NumberField } from '@/components/NumberField'
import { FontPicker } from '@/features/fonts/FontPicker'
import type { HAlign, NameField, PageDimension, TextTransformMode, VAlign } from '@/types'
import { axisLength, fromPoints, toPoints, type PositionUnit } from '@/utils/units'

type Patch = (patch: Partial<NameField>, coalesceKey?: string) => void

function HexInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <Input
      value={text}
      maxLength={7}
      aria-label="Font colour hex value"
      onChange={(e) => {
        const v = e.target.value.trim()
        setText(v)
        if (/^#[0-9a-f]{6}$/i.test(v)) onChange(v.toLowerCase())
      }}
      onBlur={() => setText(value)}
    />
  )
}

const COLOR_PRESETS = [
  { name: 'Black', hex: '#000000' },
  { name: 'Charcoal', hex: '#1f2937' },
  { name: 'Maroon', hex: '#7a1e2c' },
  { name: 'Red', hex: '#b91c1c' },
  { name: 'Pink', hex: '#be185d' },
  { name: 'Saffron', hex: '#e07a1f' },
  { name: 'Gold', hex: '#b8860b' },
  { name: 'Green', hex: '#166534' },
  { name: 'Royal blue', hex: '#1e40af' },
  { name: 'Navy', hex: '#1e2a4a' },
  { name: 'Purple', hex: '#6b21a8' },
  { name: 'White', hex: '#ffffff' },
]

function ColorSwatches({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const current = value.toLowerCase()
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Preset font colours">
      {COLOR_PRESETS.map((c) => {
        const active = current === c.hex
        return (
          <button
            key={c.hex}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={c.name}
            title={`${c.name} ${c.hex}`}
            onClick={() => onChange(c.hex)}
            className={`size-11 rounded-full border border-black/15 transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:size-7 dark:border-white/25 ${
              active ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'hover:ring-2 hover:ring-muted-foreground/40'
            }`}
            style={{ backgroundColor: c.hex }}
          />
        )
      })}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string; icon?: React.ReactNode }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-full rounded-md border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.label}
          title={o.label}
          onClick={() => onChange(o.value)}
          className={`flex h-10 flex-1 items-center justify-center gap-1 rounded text-xs md:h-8 ${
            value === o.value ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
          }`}
        >
          {o.icon ?? o.label}
        </button>
      ))}
    </div>
  )
}

export function PositionSettings({
  field,
  page,
  pageCount,
  unit,
  onUnitChange,
  onPatch,
}: {
  field: NameField
  page: PageDimension
  pageCount: number
  unit: PositionUnit
  onUnitChange: (u: PositionUnit) => void
  onPatch: Patch
}) {
  const unitSuffix = unit === 'percent' ? '%' : unit
  const posField = (axis: 'x' | 'y' | 'width' | 'height', label: string) => (
    <NumberField
      label={label}
      value={fromPoints(field[axis], unit, axisLength(axis, page))}
      onChange={(v) => onPatch({ [axis]: toPoints(v, unit, axisLength(axis, page)) }, `pos-${axis}`)}
      min={axis === 'width' || axis === 'height' ? 0.1 : undefined}
      suffix={unitSuffix}
      decimals={unit === 'pt' ? 1 : 2}
    />
  )
  return (
    <Section title="Position">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="field-page" className="text-xs text-muted-foreground">
            Page number
          </Label>
          <NativeSelect
            id="field-page"
            value={field.pageNumber}
            onChange={(e) => onPatch({ pageNumber: Number(e.target.value) })}
          >
            {Array.from({ length: pageCount }, (_, i) => (
              <option key={i} value={i + 1}>
                Page {i + 1}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="field-unit" className="text-xs text-muted-foreground">
            Units
          </Label>
          <NativeSelect id="field-unit" value={unit} onChange={(e) => onUnitChange(e.target.value as PositionUnit)}>
            <option value="pt">PDF points</option>
            <option value="mm">Millimetres</option>
            <option value="percent">Percentage</option>
          </NativeSelect>
        </div>
        {posField('x', 'X position')}
        {posField('y', 'Y position')}
        {posField('width', 'Width')}
        {posField('height', 'Height')}
        <NumberField
          label="Rotation"
          value={field.rotation}
          onChange={(v) => onPatch({ rotation: v }, 'rotation')}
          min={-180}
          max={180}
          suffix="°"
          decimals={1}
        />
      </div>
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">Horizontal alignment</span>
        <Segmented<HAlign>
          label="Horizontal alignment"
          value={field.alignment}
          onChange={(v) => onPatch({ alignment: v })}
          options={[
            { value: 'left', label: 'Left', icon: <AlignLeft className="size-4" /> },
            { value: 'center', label: 'Center', icon: <AlignCenter className="size-4" /> },
            { value: 'right', label: 'Right', icon: <AlignRight className="size-4" /> },
          ]}
        />
      </div>
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">Vertical alignment</span>
        <Segmented<VAlign>
          label="Vertical alignment"
          value={field.verticalAlignment}
          onChange={(v) => onPatch({ verticalAlignment: v })}
          options={[
            { value: 'top', label: 'Top' },
            { value: 'middle', label: 'Middle' },
            { value: 'bottom', label: 'Bottom' },
          ]}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Positions are stored in PDF points from the top-left of the page, so zoom and screen size never change the
        printed position.
      </p>
    </Section>
  )
}

export function TypographySettings({ field, onPatch }: { field: NameField; onPatch: Patch }) {
  return (
    <Section title="Typography">
      <div className="space-y-1">
        <Label htmlFor="field-font" className="text-xs text-muted-foreground">
          Font family
        </Label>
        <FontPicker id="field-font" value={field.fontId} onChange={(fontId) => onPatch({ fontId })} />
        <p className="text-xs text-muted-foreground">
          Gujarati and Hindi letters automatically use a matching Noto font if the selected font lacks them.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Font size" value={field.fontSize} min={1} max={500} onChange={(v) => onPatch({ fontSize: v }, 'fontSize')} suffix="pt" decimals={1} />
        <NumberField
          label="Minimum font size"
          value={field.minimumFontSize}
          min={1}
          max={500}
          onChange={(v) => onPatch({ minimumFontSize: v }, 'minFont')}
          suffix="pt"
          decimals={1}
          disabled={!field.autoFit}
        />
        <div className="col-span-2 space-y-2">
          <Label htmlFor="field-color" className="text-xs text-muted-foreground">
            Font colour
          </Label>
          <div className="flex gap-2">
            <input
              id="field-color"
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(field.fontColor) ? field.fontColor : '#000000'}
              onChange={(e) => onPatch({ fontColor: e.target.value }, 'color')}
              className="h-11 w-12 shrink-0 cursor-pointer rounded-md border bg-background p-1 md:h-9"
              aria-label="Pick font colour"
            />
            <HexInput value={field.fontColor} onChange={(v) => onPatch({ fontColor: v }, 'color')} />
          </div>
          <ColorSwatches value={field.fontColor} onChange={(v) => onPatch({ fontColor: v })} />
        </div>
        <NumberField label="Letter spacing" value={field.letterSpacing} min={-20} max={100} step={0.1} onChange={(v) => onPatch({ letterSpacing: v }, 'ls')} suffix="pt" decimals={2} />
        <NumberField label="Line spacing" value={field.lineSpacing} min={0.5} max={5} step={0.05} onChange={(v) => onPatch({ lineSpacing: v }, 'lh')} suffix="×" decimals={2} />
        <div className="col-span-2 space-y-1">
          <span className="text-xs text-muted-foreground">Style</span>
          <div className="flex gap-1">
            <Toggle variant="outline" pressed={field.fontWeight === 'bold'} onPressedChange={(p) => onPatch({ fontWeight: p ? 'bold' : 'normal' })} aria-label="Bold" className="size-11 md:size-9">
              <Bold />
            </Toggle>
            <Toggle variant="outline" pressed={field.fontStyle === 'italic'} onPressedChange={(p) => onPatch({ fontStyle: p ? 'italic' : 'normal' })} aria-label="Italic" className="size-11 md:size-9">
              <Italic />
            </Toggle>
            <Toggle variant="outline" pressed={field.underline} onPressedChange={(p) => onPatch({ underline: p })} aria-label="Underline" className="size-11 md:size-9">
              <Underline />
            </Toggle>
          </div>
        </div>
      </div>
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">Text alignment</span>
        <Segmented<HAlign>
          label="Text alignment"
          value={field.alignment}
          onChange={(v) => onPatch({ alignment: v })}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' },
          ]}
        />
      </div>
    </Section>
  )
}

export function TextSettings({ field, onPatch }: { field: NameField; onPatch: Patch }) {
  return (
    <Section title="Text">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="field-prefix" className="text-xs text-muted-foreground">
            Prefix
          </Label>
          <Input id="field-prefix" value={field.prefix} placeholder="e.g. Shri" onChange={(e) => onPatch({ prefix: e.target.value }, 'prefix')} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="field-suffix" className="text-xs text-muted-foreground">
            Suffix
          </Label>
          <Input id="field-suffix" value={field.suffix} placeholder="e.g. & Family" onChange={(e) => onPatch({ suffix: e.target.value }, 'suffix')} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="field-case" className="text-xs text-muted-foreground">
          Letter case
        </Label>
        <NativeSelect id="field-case" value={field.textTransform} onChange={(e) => onPatch({ textTransform: e.target.value as TextTransformMode })}>
          <option value="none">Preserve original text</option>
          <option value="uppercase">UPPERCASE</option>
          <option value="lowercase">lowercase</option>
        </NativeSelect>
      </div>
      <label className="flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 py-2">
        <span>
          <span className="block text-sm font-medium">Automatic text fitting</span>
          <span className="block text-xs text-muted-foreground">Shrink long names down to the minimum font size</span>
        </span>
        <Switch checked={field.autoFit} onCheckedChange={(v) => onPatch({ autoFit: v })} />
      </label>
      <label className="flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 py-2">
        <span>
          <span className="block text-sm font-medium">Multiline wrapping</span>
          <span className="block text-xs text-muted-foreground">Wrap long names onto more lines inside the box</span>
        </span>
        <Switch checked={field.multiline} onCheckedChange={(v) => onPatch({ multiline: v })} />
      </label>
    </Section>
  )
}
