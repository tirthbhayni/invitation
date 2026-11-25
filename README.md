# InvitePrint – Personalized Invitation Generator

InvitePrint turns one finished invitation design (PDF, JPG or PNG) into a personalized PDF for every guest, with the guest's name printed in the right place, and helps you send it over WhatsApp.

Everything runs in the browser. There is no server, no login and no paid API. Templates, guest names, phone numbers and generated PDFs stay in the browser's IndexedDB storage on your own device.

```
Upload PDF → Set guest name position → Save template → Enter guest name → Enter mobile number
→ Generate PDF → Open WhatsApp → Attach PDF → Send
```

## Features

- **Templates.** Upload PDF, JPG or PNG files (images are wrapped losslessly into a PDF). Multi-page PDFs and pages with `/Rotate` and cropped boxes are supported. You can preview, duplicate, rename, replace the file, set a default and delete. The original upload is never modified.
- **Visual editor.** Drag, resize and rotate name fields. Positions are in PDF points, millimetres or percent. Fonts, size, minimum size, colour, bold, italic, underline, letter and line spacing, alignment, prefix and suffix, letter case, auto-fit and multiline are all configurable. Undo/redo, zoom, page navigation, sample names (English, Gujarati, Hindi, long names) and a test PDF download are included.
- **Correct Indian-language rendering.** Names are shaped with HarfBuzz (compiled to WebAssembly), so Gujarati and Hindi conjuncts, vowel signs and reordering render correctly, for example શ્રી, ક્ષ, કિ and श्री. If the selected font lacks a script, a matching Noto font is used for those characters automatically.
- **Identical preview and PDF.** The live preview and the PDF use the same glyph layout, so what you see is what is printed. The PDF also contains an invisible text layer, so the name stays searchable and copyable.
- **Generator.** Live preview, phone validation with a country code (+91 by default, no duplicated country codes), and the actions Generate, Download, Share PDF, Share on WhatsApp, Clear and Generate next.
- **Bulk.** Import guests from Excel or CSV (a sample workbook is provided), edit them in a table, validate entries and detect duplicates. Batch generation shows progress, all PDFs can be downloaded as a ZIP, and each row has its own WhatsApp button.
- **History.** Records each generated invitation with an honest status, plus filters, CSV/Excel export, re-download, regenerate, edit, mark as sent and delete.
- **Settings.** Defaults, theme (light, dark or system), custom font upload (TTF/OTF), storage usage, backup/restore as JSON, and clean-up tools.
- **PWA.** Installable, and works offline after the first visit. Fonts, the WebAssembly shaper and workers are precached.
- **Keyboard shortcuts.** `Ctrl + Enter` generates the PDF, `Ctrl + Shift + Enter` shares on WhatsApp and `Esc` closes dialogs. In the editor, `Ctrl + Z` / `Ctrl + Y` undo and redo, `Ctrl + S` saves, arrow keys nudge (`Shift` for larger steps) and `Delete` removes the selected field.

### What the statuses mean

WhatsApp gives a website no way to know whether a message was delivered or read, so InvitePrint never claims it was.

| Status | Meaning |
| --- | --- |
| Generated | The PDF was created on this device. |
| Downloaded | The PDF was saved to the device. |
| Share Initiated | The system share sheet was opened with the PDF. |
| WhatsApp Opened | A WhatsApp chat with the guest was opened. The PDF still has to be attached and sent by you. |
| Sent – Manually Confirmed | You clicked **Mark as sent** after sending it yourself. |
| Failed | Generation failed; the error is stored with the record. |

## Requirements

- Node.js 20.19 or newer (22 LTS recommended) and npm 10 or newer.
- A current version of Chrome, Edge, Firefox or Safari.

## Installation

```bash
git clone <your-repository-url> inviteprint
cd inviteprint
npm install
```

All fonts used for rendering (Noto Sans/Serif, Noto Sans/Serif Gujarati, Noto Sans Devanagari, Poppins, Roboto and Montserrat) are already included in `public/fonts`. They are distributed under the SIL Open Font License. Nothing is downloaded from a CDN at runtime.

## Development

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the Vite dev server at http://localhost:5173 |
| `npm test` | Runs the unit and rendering tests once (Vitest) |
| `npm run test:watch` | Runs tests in watch mode |
| `npm run typecheck` | Type-checks the whole project |
| `npm run build` | Type-checks and builds the production bundle into `dist/` |
| `npm run preview` | Serves the production build locally at http://localhost:4173 |

### Testing on a phone (same Wi-Fi)

```bash
npm run mobile
```

This builds the app and serves it over HTTPS on your local network, for example `https://10.222.33.51:4173`. HTTPS is required because phones only allow sharing files to WhatsApp on secure pages. The certificate is self-signed, so the phone shows a warning the first time: tap **Advanced → Proceed**. If the phone can't connect, allow Node.js through Windows Firewall on private networks. For everyday use, deploy the app to an HTTPS host (see Deployment) so no warning appears and it works away from your Wi-Fi.

Helper scripts:

```bash
node scripts/make-samples.mjs     # writes samples/sample-wedding-invitation.pdf and samples/sample-rotated-page.pdf
node scripts/generate-icons.mjs   # regenerates the PWA icons in public/icons
```

The tests cover Gujarati and Hindi shaping (conjuncts, no missing glyphs, vowel reordering), font fallback, auto-fit, multiline wrapping, prefix and suffix, PDF generation (page count and size are preserved, the template bytes are untouched, and the name can be extracted as text with pdf.js), rotated pages, filenames, phone normalization and WhatsApp URL encoding.

### Project structure

```
src/
  components/      shared UI (shadcn/ui components in components/ui)
  database/        Dexie (IndexedDB) schema and migrations
  features/        editor, preview, fonts and template building blocks
  hooks/           data and UI hooks
  layouts/         app shell with sidebar and mobile navigation
  pages/           Dashboard, Generator, Templates, Editor, Bulk, History, Settings
  services/        PDF, text layout, fonts, WhatsApp, storage, import/export, backup
  types/           shared TypeScript types
  utils/           units, matrices, filenames and formatting
  workers/         Web Worker that generates PDFs off the main thread
tests/             Vitest tests
scripts/           sample-file and icon generators
```

## Production build

```bash
npm run build
```

The output in `dist/` is a fully static site (HTML, JS, CSS, fonts, WebAssembly and a service worker). Any static host works. Two hosting rules matter:

1. **Serve over HTTPS.** Service workers (offline support and installing the app) and the Web Share API only work on secure origins. `localhost` counts as secure for testing.
2. **Use an SPA fallback.** Unknown paths such as `/templates/123/edit` must return `index.html`.

## Deployment

**Netlify.** Build command `npm run build`, publish directory `dist`. The SPA fallback is already in `public/_redirects`.

**Vercel.** Framework preset "Vite", build command `npm run build`, output directory `dist`. `vercel.json` already contains the rewrite.

**Cloudflare Pages.** Build command `npm run build`, output directory `dist`. Cloudflare Pages serves `index.html` for unknown routes automatically when there is no `404.html`.

**GitHub Pages or a sub-folder.** Set `base` in `vite.config.ts` (for example `base: '/inviteprint/'`) and copy `dist/index.html` to `dist/404.html` so deep links work.

**Nginx:**

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
location ~* \.wasm$ {
  types { application/wasm wasm; }
}
```

**Apache (`.htaccess`):**

```apache
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.html [L]
```

After a new deployment, open users receive the update the next time they load the app, because the service worker updates itself automatically.

## How WhatsApp sharing works

InvitePrint uses only official, free mechanisms:

- **Click to chat (`https://wa.me/<number>`).** Opens a chat with the guest without saving the contact. No message text is pre-filled. The link cannot carry a file, so InvitePrint downloads the PDF first, and you attach it in WhatsApp and press send.
- **Web Share API (Share PDF).** On phones and some desktop browsers, the system share sheet can pass the PDF file directly to WhatsApp. The app checks `navigator.canShare({ files })` first and falls back to downloading when sharing isn't supported.

There is no automation, no QR-session scraping, no unofficial library and no automatic bulk sending. In Bulk mode each chat is opened by an explicit click.

### Adding the WhatsApp Business Cloud API later

`src/services/WhatsAppService.ts` defines a `WhatsAppProvider` interface, and the current provider is `clickToChatProvider`. To send documents through the official Cloud API:

1. Build a small backend (serverless function or server) that stores the access token, uploads media and calls the Cloud API. **Never put the token in frontend code.**
2. Add a provider that calls your backend and returns the message ID.
3. Only set delivered or read statuses from the API's webhook callbacks. Until then the app must keep showing the honest statuses above.

## Privacy and data storage

- Templates, fields, fonts, history and generated PDFs are stored in IndexedDB in your browser. Nothing is uploaded anywhere.
- Guest names are always drawn as text or vector glyphs, never interpreted as HTML.
- Use **Settings → Backup** to export everything (optionally including generated PDFs) as a JSON file, and **Restore** to import it on another device or browser.
- **Settings → Request persistent storage** asks the browser not to evict the app's data when disk space is low.
- Turning off "Save generated PDF files" or "Save invitation history" in Settings reduces what is kept.

## Known browser limitations

- **WhatsApp cannot receive a file from a link.** `wa.me` opens a chat with text only, so the PDF has to be attached manually (or sent with **Share PDF** on devices that support file sharing).
- **Web Share with files** works in Chrome and Edge on Android, Safari on iOS/iPadOS 15+, Safari on macOS, and Chrome/Edge on Windows and ChromeOS. Firefox on desktop and Chrome on Linux don't support sharing files; the app falls back to downloading. Sharing requires HTTPS and must start from a click.
- **iOS / iPadOS.** Downloaded PDFs open in a preview or go to the Files app rather than a Downloads folder. Safari may delete stored data for sites that haven't been used for several weeks unless the app is added to the Home Screen. Keep backups.
- **Storage limits and eviction.** Browsers limit how much each site can store, and may clear data when the device runs low on space, in private/incognito windows, or when the user clears site data. Large templates and many saved PDFs use space quickly; Settings shows current usage.
- **Popup blockers.** WhatsApp opens in a new tab directly from your click. If a browser still blocks it, the app shows a link to open the chat manually.
- **WhatsApp delivery and read receipts** can't be detected by any website, so statuses only go as far as "WhatsApp Opened" until you confirm with **Mark as sent**.
- **Encrypted or password-protected PDFs** can't be used as templates. Remove the password first, for example by printing to a new PDF.
- **Fonts.** Custom fonts must be TTF or OTF files (WOFF/WOFF2 aren't supported) and must allow embedding. Fonts without a real bold face are made bold synthetically, and italics without an italic font are slanted synthetically.
- **Very large files.** Templates are limited to 50 MB and guest lists to 5,000 rows. Very large or image-heavy PDFs generate more slowly on low-end phones.
- **Private browsing.** Some browsers limit or disable IndexedDB and service workers in private windows, so data may not persist.
