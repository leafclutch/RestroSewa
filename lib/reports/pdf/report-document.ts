import "server-only";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

// ─── Reusable report PDF builder ───────────────────────────────────────────────
// A thin, report-agnostic layer over pdf-lib: a branded header (logo + restaurant
// name + report title + date), section titles, key/value rows with auto page
// breaks, and a finalize() that stamps every page with a page number and a subtle
// HRestroSewa footer. A daily/weekly/monthly report just feeds it sections — no
// PDF plumbing to duplicate.
//
// pdf-lib (not pdfkit) on purpose: pure JS, no font files read from disk, so it
// bundles cleanly in a Next.js serverless function. The standard Helvetica font is
// WinAnsi-only, so all drawn text is sanitised to Latin-1 to avoid a hard crash on
// a non-Latin restaurant name (rare here, but must never throw mid-send).

const A4 = { w: 595.28, h: 841.89 };
const M = 48; // page margin
const FOOTER_Y = 30;

const INK = rgb(0.06, 0.09, 0.16); // #0f172a
const MUTE = rgb(0.42, 0.45, 0.5);
const FAINT = rgb(0.62, 0.66, 0.72);
const HAIR = rgb(0.88, 0.9, 0.93);
const HEADING = rgb(0.58, 0.64, 0.72);

export type ReportLogo = { bytes: Uint8Array; type: "png" | "jpg" };

export type ReportPdfInit = {
  /** e.g. "Daily Financial Summary" */
  title: string;
  restaurantName: string;
  /** e.g. the business date, pretty-printed. Shown top-right. */
  subtitle?: string;
  logo?: ReportLogo | null;
};

/** Helvetica is Latin-1 only; drop anything it can't encode rather than throw. */
function safe(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
}

export class ReportPdf {
  private page!: PDFPage;
  private y = 0;

  private constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
    private init: ReportPdfInit
  ) {}

  static async create(init: ReportPdfInit): Promise<ReportPdf> {
    const doc = await PDFDocument.create();
    doc.setTitle(safe(`${init.title} — ${init.restaurantName}`));
    doc.setCreator("HRestroSewa");
    doc.setProducer("HRestroSewa");
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const r = new ReportPdf(doc, font, bold, init);
    r.page = doc.addPage([A4.w, A4.h]);
    r.y = A4.h - M;
    await r.drawHeader();
    return r;
  }

  // ── low-level ──
  private text(s: string, x: number, y: number, size: number, font: PDFFont, color = INK) {
    this.page.drawText(safe(s), { x, y, size, font, color });
  }
  private rightText(s: string, xRight: number, y: number, size: number, font: PDFFont, color = INK) {
    const clean = safe(s);
    const w = font.widthOfTextAtSize(clean, size);
    this.page.drawText(clean, { x: xRight - w, y, size, font, color });
  }
  private hairline(thickness = 1, color = HAIR) {
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: A4.w - M, y: this.y }, thickness, color });
  }

  private async drawHeader() {
    let textX = M;
    const top = this.y;
    if (this.init.logo) {
      try {
        const img =
          this.init.logo.type === "png"
            ? await this.doc.embedPng(this.init.logo.bytes)
            : await this.doc.embedJpg(this.init.logo.bytes);
        const box = 46;
        const scale = Math.min(box / img.width, box / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        this.page.drawImage(img, { x: M, y: top - h, width: w, height: h });
        textX = M + box + 14;
      } catch {
        /* unreadable logo bytes — carry on without it */
      }
    }
    this.text(this.init.restaurantName, textX, top - 16, 16, this.bold, INK);
    this.text(this.init.title, textX, top - 33, 12, this.font, MUTE);
    if (this.init.subtitle) this.rightText(this.init.subtitle, A4.w - M, top - 16, 11, this.font, MUTE);
    this.y = top - 60;
    this.hairline();
    this.y -= 16;
  }

  private continuationHeader() {
    const top = this.y;
    this.text(`${this.init.restaurantName} — ${this.init.title} (continued)`, M, top - 12, 10, this.font, MUTE);
    this.y = top - 26;
    this.hairline();
    this.y -= 14;
  }

  /** Break to a new page (with a compact header) when `space` won't fit above the footer. */
  private ensure(space: number) {
    if (this.y - space < FOOTER_Y + 24) {
      this.page = this.doc.addPage([A4.w, A4.h]);
      this.y = A4.h - M;
      this.continuationHeader();
    }
  }

  // ── public building blocks ──
  sectionTitle(t: string) {
    this.ensure(34);
    this.y -= 10;
    this.text(t.toUpperCase(), M, this.y, 10, this.bold, HEADING);
    this.y -= 7;
    this.hairline();
    this.y -= 16;
  }

  row(label: string, value: string, opts?: { strong?: boolean }) {
    this.ensure(20);
    const strong = !!opts?.strong;
    this.text(label, M, this.y, 11, this.font, strong ? INK : MUTE);
    this.rightText(value, A4.w - M, this.y, 11, strong ? this.bold : this.font, INK);
    this.y -= 18;
  }

  spacer(h = 8) {
    this.y -= h;
  }

  /** A muted, word-wrapped note (e.g. a caveat). */
  note(text: string) {
    const size = 9;
    const maxW = A4.w - 2 * M;
    const words = safe(text).split(/\s+/);
    let line = "";
    const flush = () => {
      if (!line) return;
      this.ensure(14);
      this.text(line, M, this.y, size, this.font, MUTE);
      this.y -= 13;
      line = "";
    };
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (this.font.widthOfTextAtSize(test, size) > maxW) {
        flush();
        line = w;
      } else {
        line = test;
      }
    }
    flush();
  }

  /** Stamp every page with a footer + "Page X of Y", then serialise. */
  async finalize(): Promise<Uint8Array> {
    const pages = this.doc.getPages();
    const total = pages.length;
    pages.forEach((p, i) => {
      p.drawLine({
        start: { x: M, y: FOOTER_Y + 14 },
        end: { x: A4.w - M, y: FOOTER_Y + 14 },
        thickness: 0.5,
        color: HAIR,
      });
      p.drawText("Generated by HRestroSewa", { x: M, y: FOOTER_Y, size: 8, font: this.font, color: FAINT });
      const pnum = `Page ${i + 1} of ${total}`;
      const w = this.font.widthOfTextAtSize(pnum, 8);
      p.drawText(pnum, { x: A4.w - M - w, y: FOOTER_Y, size: 8, font: this.font, color: FAINT });
    });
    return this.doc.save();
  }
}
