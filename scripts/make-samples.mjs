// Creates sample invitation PDFs in ./samples for trying the app and for manual testing.
import { mkdirSync, writeFileSync } from 'node:fs'
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib'

const maroon = rgb(0.45, 0.08, 0.12)
const gold = rgb(0.72, 0.55, 0.2)

async function weddingCard() {
  const doc = await PDFDocument.create()
  const serif = await doc.embedFont(StandardFonts.TimesRoman)
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold)
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic)
  const page = doc.addPage([420, 595]) // A5
  const { width, height } = page.getSize()
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 0.98, 0.94) })
  page.drawRectangle({ x: 18, y: 18, width: width - 36, height: height - 36, borderColor: gold, borderWidth: 3 })
  page.drawRectangle({ x: 26, y: 26, width: width - 52, height: height - 52, borderColor: gold, borderWidth: 0.8 })
  const center = (text, y, font, size, color = maroon) =>
    page.drawText(text, { x: (width - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color })
  center('|| Shree Ganeshaya Namah ||', 530, italic, 13, gold)
  center('Wedding Invitation', 480, serifBold, 30)
  center('Dear', 400, italic, 16, rgb(0.3, 0.3, 0.3))
  page.drawLine({ start: { x: 70, y: 352 }, end: { x: width - 70, y: 352 }, thickness: 0.6, color: gold })
  center('We joyfully invite you and your family', 310, serif, 14, rgb(0.25, 0.25, 0.25))
  center('to celebrate the wedding of', 292, serif, 14, rgb(0.25, 0.25, 0.25))
  center('Rahul & Priya', 240, serifBold, 32)
  center('Sunday, 14 February 2027 · 7:00 PM', 190, serif, 13, rgb(0.25, 0.25, 0.25))
  center('Shubh Vatika, Ahmedabad', 170, serif, 13, rgb(0.25, 0.25, 0.25))
  center('With best compliments from the Patel family', 70, italic, 11, gold)

  const p2 = doc.addPage([420, 595])
  p2.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 0.98, 0.94) })
  p2.drawRectangle({ x: 18, y: 18, width: width - 36, height: height - 36, borderColor: gold, borderWidth: 3 })
  const c2 = (text, y, font, size) => p2.drawText(text, { x: (width - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color: maroon })
  c2('Programme', 500, serifBold, 26)
  c2('Mehendi · 12 Feb · 4 PM', 420, serif, 15)
  c2('Sangeet · 13 Feb · 8 PM', 390, serif, 15)
  c2('Wedding · 14 Feb · 7 PM', 360, serif, 15)
  c2('Reception · 15 Feb · 8 PM', 330, serif, 15)
  doc.setTitle('Sample wedding invitation')
  return doc.save()
}

async function rotatedCard() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.HelveticaBold)
  // Portrait media box displayed as landscape through /Rotate 90.
  const page = doc.addPage([400, 600])
  page.setRotation(degrees(90))
  page.drawRectangle({ x: 20, y: 20, width: 360, height: 560, borderColor: rgb(0.1, 0.4, 0.3), borderWidth: 4 })
  page.drawText('Housewarming (rotated page)', { x: 330, y: 120, size: 24, font, rotate: degrees(90), color: rgb(0.1, 0.4, 0.3) })
  return doc.save()
}

mkdirSync('samples', { recursive: true })
writeFileSync('samples/sample-wedding-invitation.pdf', await weddingCard())
writeFileSync('samples/sample-rotated-page.pdf', await rotatedCard())
console.log('Samples written to ./samples')
