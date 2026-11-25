/** Affine matrix [a, b, c, d, e, f] using the PDF / Canvas convention. */
export type Matrix = [number, number, number, number, number, number]

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** Returns m1 × m2: applies m2 first, then m1. */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1
  const [a2, b2, c2, d2, e2, f2] = m2
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ]
}

export function translate(tx: number, ty: number): Matrix {
  return [1, 0, 0, 1, tx, ty]
}

/** Rotation in degrees. In a y-down space positive angles rotate clockwise. */
export function rotate(deg: number): Matrix {
  const r = (deg * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return [cos, sin, -sin, cos, 0, 0]
}

export function applyToPoint(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

/** Transform from a field's local box space (origin top-left, y down) into page display space. */
export function fieldMatrix(field: {
  x: number
  y: number
  width: number
  height: number
  rotation: number
}): Matrix {
  const cx = field.x + field.width / 2
  const cy = field.y + field.height / 2
  return multiply(
    multiply(translate(cx, cy), rotate(field.rotation || 0)),
    translate(-field.width / 2, -field.height / 2),
  )
}

/**
 * Maps page display space (top-left origin, y down, page /Rotate applied) to
 * PDF user space for a page with the given crop box and rotation.
 */
export function displayToUserSpace(
  box: { x: number; y: number; width: number; height: number },
  rotation: number,
): Matrix {
  const { x: x0, y: y0, width: w, height: h } = box
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return [0, 1, 1, 0, x0, y0]
    case 180:
      return [-1, 0, 0, 1, x0 + w, y0]
    case 270:
      return [0, -1, -1, 0, x0 + w, y0 + h]
    default:
      return [1, 0, 0, -1, x0, y0 + h]
  }
}
