import type { FieldWarning, GenerateOptions } from '@/services/PDFService'

export type WorkerRequest =
  | { id: number; type: 'generate'; payload: GenerateOptions }
  | { id: number; type: 'forget-font'; fontId: string }

export type WorkerResponse =
  | { id: number; ok: true; bytes: Uint8Array; warnings: FieldWarning[] }
  | { id: number; ok: false; error: string; code?: string }
