import PptxGenJS from "pptxgenjs";
import { PDFDocument, StandardFonts, type PDFFont, rgb } from "pdf-lib";
import type { Deck } from "./deckModel";
import { layoutDeck, SLIDE_H, SLIDE_W, type TextSpec } from "./deckLayout";

const pptxHex = (value: string) => value.replace("#", "").toUpperCase();
const pdfRgb = (value: string) =>
  rgb(
    parseInt(value.slice(1, 3), 16) / 255,
    parseInt(value.slice(3, 5), 16) / 255,
    parseInt(value.slice(5, 7), 16) / 255
  );

export async function renderDeckPptx(deck: Deck): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = "Nova";
  pptx.subject = deck.title;

  layoutDeck(deck).forEach((spec, index) => {
    const page = pptx.addSlide();
    page.background = { color: pptxHex(spec.background) };
    for (const shape of spec.shapes) {
      if (shape.kind === "line") {
        page.addShape(pptx.ShapeType.line, {
          x: shape.box.x,
          y: shape.box.y,
          w: shape.box.w,
          h: 0,
          line: { color: pptxHex(shape.color), width: 1.5 },
        });
      } else {
        page.addShape(shape.kind === "ellipse" ? pptx.ShapeType.ellipse : pptx.ShapeType.rect, {
          ...shape.box,
          fill: { color: pptxHex(shape.color) },
          line: { color: pptxHex(shape.color) },
        });
      }
    }
    for (const item of spec.texts) {
      page.addText(item.text, {
        ...item.box,
        fontFace: item.font,
        fontSize: item.size,
        bold: Boolean(item.bold),
        color: pptxHex(item.color),
        align: item.align ?? "left",
        valign: "top",
        breakLine: false,
        lineSpacingMultiple: 1.1,
      });
    }
    const notes = deck.slides[index]?.notes;
    if (notes) page.addNotes(notes);
  });

  return (await pptx.write({ outputType: "nodebuffer", compression: true })) as Buffer;
}

type PdfPage = ReturnType<Awaited<ReturnType<typeof PDFDocument.create>>["addPage"]>;

function standardFonts(font: string): { regular: string; bold: string } {
  if (font === "Times")
    return { regular: StandardFonts.TimesRoman, bold: StandardFonts.TimesRomanBold };
  if (font === "Courier")
    return { regular: StandardFonts.Courier, bold: StandardFonts.CourierBold };
  return { regular: StandardFonts.Helvetica, bold: StandardFonts.HelveticaBold };
}

function drawPdfText(page: PdfPage, item: TextSpec, fonts: Map<string, PDFFont>) {
  const key = `${item.font}:${item.bold ? "bold" : "regular"}`;
  const font = fonts.get(key);
  if (!font) return;
  const x = item.box.x * 72;
  const w = item.box.w * 72;
  const h = item.box.h * 72;
  const y = (SLIDE_H - item.box.y - item.box.h) * 72;
  const textWidth = font.widthOfTextAtSize(item.text, item.size);
  const drawX =
    item.align === "center"
      ? x + (w - textWidth) / 2
      : item.align === "right"
        ? x + w - textWidth
        : x;
  const drawY = y + Math.max(0, h - item.size) - item.size * 0.1;
  page.drawText(item.text, {
    x: drawX,
    y: drawY,
    size: item.size,
    font,
    color: pdfRgb(item.color),
  });
}

export async function renderDeckPdf(deck: Deck): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const fonts = new Map<string, PDFFont>();
  for (const item of layoutDeck(deck).flatMap(spec => spec.texts)) {
    const key = `${item.font}:${item.bold ? "bold" : "regular"}`;
    if (fonts.has(key)) continue;
    const pair = standardFonts(item.font);
    fonts.set(key, await pdf.embedFont(item.bold ? pair.bold : pair.regular));
  }

  for (const spec of layoutDeck(deck)) {
    const page = pdf.addPage([SLIDE_W * 72, SLIDE_H * 72]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: SLIDE_W * 72,
      height: SLIDE_H * 72,
      color: pdfRgb(spec.background),
    });
    for (const shape of spec.shapes) {
      const x = shape.box.x * 72;
      const w = shape.box.w * 72;
      const h = shape.box.h * 72;
      const y = (SLIDE_H - shape.box.y - shape.box.h) * 72;
      const color = pdfRgb(shape.color);
      if (shape.kind === "line") {
        page.drawLine({
          start: { x, y: y + h / 2 },
          end: { x: x + w, y: y + h / 2 },
          thickness: 1.5,
          color,
        });
      } else if (shape.kind === "ellipse") {
        page.drawEllipse({ x: x + w / 2, y: y + h / 2, xScale: w / 2, yScale: h / 2, color });
      } else {
        page.drawRectangle({ x, y, width: w, height: h, color });
      }
    }
    for (const item of spec.texts) drawPdfText(page, item, fonts);
  }
  return Buffer.from(await pdf.save());
}
