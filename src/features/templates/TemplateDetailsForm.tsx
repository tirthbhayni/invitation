import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/NativeSelect'
import { EVENT_CATEGORIES, type EventCategory } from '@/types'
import type { TemplateMeta } from '@/services/TemplateService'

export function TemplateDetailsForm({
  value,
  onChange,
  errors = {},
}: {
  value: TemplateMeta
  onChange: (patch: Partial<TemplateMeta>) => void
  errors?: Partial<Record<keyof TemplateMeta, string>>
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="tpl-name">Template name *</Label>
        <Input
          id="tpl-name"
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="e.g. Wedding card – Gujarati"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? 'tpl-name-err' : undefined}
          maxLength={120}
        />
        {errors.name && (
          <p id="tpl-name-err" className="text-xs text-destructive">
            {errors.name}
          </p>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="tpl-event">Event name</Label>
          <Input
            id="tpl-event"
            value={value.eventName}
            onChange={(e) => onChange({ eventName: e.target.value })}
            placeholder="e.g. Rahul weds Priya"
            maxLength={160}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tpl-category">Event category</Label>
          <NativeSelect
            id="tpl-category"
            value={value.eventCategory}
            onChange={(e) => onChange({ eventCategory: e.target.value as EventCategory })}
          >
            {EVENT_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tpl-date">Event date (optional)</Label>
          <Input
            id="tpl-date"
            type="date"
            value={value.eventDate ?? ''}
            onChange={(e) => onChange({ eventDate: e.target.value || undefined })}
          />
        </div>
      </div>
    </div>
  )
}
