import type { PageDimension } from '@/types'

export type PositionUnit = 'pt' | 'mm' | 'percent'

const MM_PER_PT = 25.4 / 72

export function fromPoints(value: number, unit: PositionUnit, pageLength: number): number {
  if (unit === 'mm') return value * MM_PER_PT
  if (unit === 'percent') return pageLength ? (value / pageLength) * 100 : 0
  return value
}

export function toPoints(value: number, unit: PositionUnit, pageLength: number): number {
  if (unit === 'mm') return value / MM_PER_PT
  if (unit === 'percent') return (value / 100) * pageLength
  return value
}

export function axisLength(axis: 'x' | 'y' | 'width' | 'height', page: PageDimension): number {
  return axis === 'x' || axis === 'width' ? page.width : page.height
}

export function round(value: number, decimals = 2): number {
  const f = 10 ** decimals
  return Math.round(value * f) / f
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
