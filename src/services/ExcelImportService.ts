import * as XLSX from 'xlsx'

export interface ImportedGuest {
  guestName: string
  mobileNumber: string
  countryCode: string
}

export interface ImportResult {
  guests: ImportedGuest[]
  skipped: number
  warnings: string[]
}

const MAX_IMPORT_BYTES = 10 * 1024 * 1024
const MAX_ROWS = 5000

const HEADER_ALIASES: Record<keyof ImportedGuest, string[]> = {
  guestName: ['guest name', 'guest', 'name', 'family name', 'guest / family name', 'full name'],
  mobileNumber: ['mobile number', 'mobile', 'phone', 'phone number', 'whatsapp', 'whatsapp number', 'contact', 'number'],
  countryCode: ['country code', 'country', 'code', 'dial code', 'isd'],
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') {
    // Phone numbers stored as numbers must not be shown in exponent form.
    return Number.isInteger(value) ? value.toFixed(0) : String(value)
  }
  return String(value).trim()
}

export async function importGuestFile(file: File): Promise<ImportResult> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('The file is larger than 10 MB.')
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error('Please upload an Excel (.xlsx) or CSV file.')
  let workbook: XLSX.WorkBook
  try {
    const data = await file.arrayBuffer()
    workbook = /\.csv$/i.test(file.name)
      ? XLSX.read(new TextDecoder('utf-8').decode(data), { type: 'string', raw: true })
      : XLSX.read(data, { type: 'array' })
  } catch {
    throw new Error('The file could not be read. Make sure it is a valid Excel or CSV file.')
  }
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error('The file has no sheets.')
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: '',
    blankrows: false,
    raw: true,
  })
  if (rows.length === 0) throw new Error('The file is empty.')

  const header = rows[0].map((h) => normalizeHeader(cellToString(h)))
  const columnIndex = {} as Record<keyof ImportedGuest, number>
  for (const key of Object.keys(HEADER_ALIASES) as (keyof ImportedGuest)[]) {
    columnIndex[key] = header.findIndex((h) => HEADER_ALIASES[key].includes(h))
  }
  const warnings: string[] = []
  let dataRows = rows.slice(1)
  if (columnIndex.guestName < 0) {
    // No recognised header row: assume Name, Mobile, Country Code order.
    columnIndex.guestName = 0
    columnIndex.mobileNumber = 1
    columnIndex.countryCode = 2
    dataRows = rows
    warnings.push('No "Guest Name" header found. Columns were read in the order: Name, Mobile, Country Code.')
  }
  if (dataRows.length > MAX_ROWS) {
    warnings.push(`Only the first ${MAX_ROWS} rows were imported.`)
    dataRows = dataRows.slice(0, MAX_ROWS)
  }

  let skipped = 0
  const guests: ImportedGuest[] = []
  for (const row of dataRows) {
    const get = (k: keyof ImportedGuest) => (columnIndex[k] >= 0 ? cellToString(row[columnIndex[k]]) : '')
    const guest: ImportedGuest = {
      guestName: get('guestName'),
      mobileNumber: get('mobileNumber'),
      countryCode: get('countryCode').replace(/[^\d+]/g, ''),
    }
    if (!guest.guestName && !guest.mobileNumber) {
      skipped++
      continue
    }
    guests.push(guest)
  }
  return { guests, skipped, warnings }
}

export function downloadSampleWorkbook(): void {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Guest Name', 'Mobile Number', 'Country Code'],
    ['Rajesh Patel & Family', '9876543210', '91'],
    ['શ્રી રાજેશભાઈ પટેલ સહપરિવાર', '98765 43211', '91'],
    ['श्री राजेश पटेल सपरिवार', '+91 98765 43212', ''],
    ['John Smith', '7911 123456', '44'],
  ])
  ws['!cols'] = [{ wch: 34 }, { wch: 18 }, { wch: 14 }]
  // Keep phone numbers as text so leading zeros survive.
  for (let r = 1; r <= 4; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 1 })]
    if (cell) cell.t = 's'
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Guests')
  XLSX.writeFile(wb, 'InvitePrint_Guest_Template.xlsx')
}

export function exportRows(rows: Record<string, string | number>[], fileName: string, format: 'csv' | 'xlsx'): void {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Data')
  XLSX.writeFile(wb, `${fileName}.${format}`, { bookType: format })
}
