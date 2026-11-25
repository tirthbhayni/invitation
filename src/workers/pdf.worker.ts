/// <reference lib="webworker" />
import { generatePersonalizedPdf, type GenerateOptions } from '@/services/PDFService'
import { forgetFont } from '@/services/FontService'
import { forgetShapingFont } from '@/services/TextLayoutService'
import type { WorkerRequest, WorkerResponse } from './protocol'

declare const self: DedicatedWorkerGlobalScope

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data
  if (msg.type === 'forget-font') {
    forgetFont(msg.fontId)
    forgetShapingFont(msg.fontId)
    return
  }
  try {
    const opts: GenerateOptions = msg.payload
    const result = await generatePersonalizedPdf(opts)
    const response: WorkerResponse = { id: msg.id, ok: true, bytes: result.bytes, warnings: result.warnings }
    self.postMessage(response, [result.bytes.buffer as ArrayBuffer])
  } catch (err) {
    const response: WorkerResponse = {
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: (err as { code?: string })?.code,
    }
    self.postMessage(response)
  }
}
