import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { FilePlus2, FileStack, FileText, History, MessageCircle, Send, Upload, Users, CalendarCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { db } from '@/database/db'
import { useObjectUrl } from '@/hooks/useObjectUrl'
import { formatDateTime, startOfToday } from '@/utils/format'
import type { Template } from '@/types'

function Stat({ label, value, icon: Icon }: { label: string; value: number | undefined; icon: typeof FileText }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className="size-4 text-muted-foreground" aria-hidden />
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value ?? '–'}</p>
    </div>
  )
}

function TemplateThumb({ template }: { template: Template }) {
  const url = useObjectUrl(template.thumbnail)
  return (
    <Link
      to={`/generate?template=${template.id}`}
      className="group flex min-w-0 items-center gap-3 rounded-md border p-2 hover:bg-accent"
    >
      <div className="flex h-14 w-11 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
        {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <FileText className="size-4" />}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{template.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {template.eventCategory}
          {template.lastUsedAt ? ` · used ${formatDateTime(template.lastUsedAt)}` : ''}
        </p>
      </div>
    </Link>
  )
}

export default function DashboardPage() {
  const stats = useLiveQuery(async () => {
    const [templates, invitations, today, shareAttempts] = await Promise.all([
      db.templates.count(),
      db.invitations.where('generationStatus').equals('generated').count(),
      db.invitations.where('createdAt').aboveOrEqual(startOfToday()).filter((i) => i.generationStatus === 'generated').count(),
      db.invitations.toCollection().toArray().then((all) => all.reduce((n, i) => n + (i.shareAttempts ?? 0), 0)),
    ])
    return { templates, invitations, today, shareAttempts }
  }, [])
  const recent = useLiveQuery(() => db.invitations.orderBy('createdAt').reverse().limit(6).toArray(), [])
  const recentTemplates = useLiveQuery(async () => {
    const all = await db.templates.toArray()
    return all.sort((a, b) => (b.lastUsedAt ?? b.updatedAt) - (a.lastUsedAt ?? a.updatedAt)).slice(0, 5)
  }, [])

  const firstRun = stats && stats.templates === 0

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Create personalized invitations and share them on WhatsApp."
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/templates?new=1">
                <FilePlus2 />
                Create New Template
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/bulk">
                <Users />
                Bulk Generate
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/history">
                <History />
                View History
              </Link>
            </Button>
            <Button asChild variant="whatsapp">
              <Link to="/generate">
                <Send />
                Generate Invitation
              </Link>
            </Button>
          </>
        }
      />

      {firstRun && (
        <div className="mb-6 rounded-lg border bg-card p-5">
          <h2 className="font-medium">Get started in three steps</h2>
          <ol className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
            <li className="rounded-md bg-muted/60 p-3">
              <Upload className="mb-2 size-5 text-green-600" />
              <strong>1. Upload</strong> your finished invitation PDF or image.
            </li>
            <li className="rounded-md bg-muted/60 p-3">
              <FileStack className="mb-2 size-5 text-green-600" />
              <strong>2. Position</strong> the guest name box and choose a font.
            </li>
            <li className="rounded-md bg-muted/60 p-3">
              <MessageCircle className="mb-2 size-5 text-green-600" />
              <strong>3. Generate</strong> a PDF per guest and open WhatsApp chats.
            </li>
          </ol>
          <Button asChild className="mt-4">
            <Link to="/templates?new=1">
              <FilePlus2 />
              Create your first template
            </Link>
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Invitation templates" value={stats?.templates} icon={FileStack} />
        <Stat label="Generated invitations" value={stats?.invitations} icon={FileText} />
        <Stat label="Generated today" value={stats?.today} icon={CalendarCheck} />
        <Stat label="WhatsApp share attempts" value={stats?.shareAttempts} icon={MessageCircle} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="min-w-0 rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="font-medium">Recent invitations</h2>
            <Button asChild variant="ghost" size="sm">
              <Link to="/history">View all</Link>
            </Button>
          </div>
          {recent && recent.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={History} title="No invitations yet" description="Generated invitations will appear here." />
            </div>
          ) : (
            <ul className="divide-y">
              {recent?.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{inv.guestName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {inv.templateName} · {formatDateTime(inv.createdAt)}
                      {inv.mobileNumber ? ` · +${inv.countryCode} ${inv.mobileNumber}` : ''}
                    </p>
                  </div>
                  <StatusBadge status={inv.shareStatus} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="min-w-0 rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="font-medium">Recently used templates</h2>
            <Button asChild variant="ghost" size="sm">
              <Link to="/templates">All</Link>
            </Button>
          </div>
          <div className="space-y-2 p-3">
            {recentTemplates && recentTemplates.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">No templates yet.</p>
            )}
            {recentTemplates?.map((t) => <TemplateThumb key={t.id} template={t} />)}
          </div>
        </section>
      </div>
    </div>
  )
}
