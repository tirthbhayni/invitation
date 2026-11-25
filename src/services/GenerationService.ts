import type { NameField, Template } from '@/types'
import type { FieldWarning, GenerateResult } from './PDFService'
import type { WorkerRequest, WorkerResponse } from '@/workers/protocol'
import { getTemplateFields } from './TemplateService'

let worker: Worker | null = null
let workerBroken = false
let nextId = 1
const pending = new Map<number, { resolve: (r: GenerateResult) => void; reject: (e: Error) => void }>()

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === 'undefined') return null
  if (!worker) {
    try {
      worker = new Worker(new URL('../workers/pdf.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const p = pending.get(e.data.id)
        if (!p) return
        pending.delete(e.data.id)
        if (e.data.ok) p.resolve({ bytes: e.data.bytes, warnings: e.data.warnings })
        else p.reject(Object.assign(new Error(e.data.error), { code: e.data.code }))
      }
      worker.onerror = () => {
        workerBroken = true
        worker?.terminate()
        worker = null
        for (const [, p] of pending) p.reject(new Error('worker-crashed'))
        pending.clear()
      }
    } catch {
      workerBroken = true
      return null
    }
  }
  return worker
}

async function generateOnMainThread(payload: Parameters<typeof import('./PDFService').generatePersonalizedPdf>[0]) {
  const { generatePersonalizedPdf } = await import('./PDFService')
  return generatePersonalizedPdf(payload)
}

export function forgetFontEverywhere(fontId: string): void {
  void import('./FontService').then((m) => m.forgetFont(fontId))
  void import('./TextLayoutService').then((m) => m.forgetShapingFont(fontId))
  const w = getWorker()
  if (w) w.postMessage({ id: 0, type: 'forget-font', fontId } satisfies WorkerRequest)
}

/** Returns the stored PDF of a history record, or regenerates it from its template. */
export async function resolveInvitationPdf(
  inv: { templateId: string; guestName: string; pdfBlob?: Blob },
  forceRegenerate = false,
): Promise<Blob> {
  if (inv.pdfBlob && !forceRegenerate) return inv.pdfBlob
  const { db } = await import('@/database/db')
  const template = await db.templates.get(inv.templateId)
  if (!template) {
    throw new Error('The template used for this invitation was deleted, so the PDF cannot be regenerated.')
  }
  return (await generateInvitationPdf(template, inv.guestName)).blob
}

export interface GeneratedPdf {
  blob: Blob
  warnings: FieldWarning[]
}

/** Generates a personalized PDF from a template, off the main thread when possible. */
export async function generateInvitationPdf(
  template: Template,
  guestName: string,
  fields?: NameField[],
): Promise<GeneratedPdf> {
  const useFields = fields ?? (await getTemplateFields(template.id))
  const pdfBytes = await template.pdfBlob.arrayBuffer()
  const payload = { pdfBytes, fields: useFields, guestName, title: `Invitation – ${guestName.trim()}` }

  let result: GenerateResult
  const w = getWorker()
  if (w) {
    try {
      result = await new Promise<GenerateResult>((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject })
        w.postMessage({ id, type: 'generate', payload } satisfies WorkerRequest, [pdfBytes])
      })
    } catch (err) {
      if ((err as Error).message !== 'worker-crashed') throw err
      result = await generateOnMainThread({ ...payload, pdfBytes: await template.pdfBlob.arrayBuffer() })
    }
  } else {
    result = await generateOnMainThread(payload)
  }
  return {
    blob: new Blob([result.bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
    warnings: result.warnings,
  }
}
