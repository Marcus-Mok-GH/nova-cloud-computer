import PptxGenJS from "pptxgenjs";
import { PDFDocument, PDFName, PDFRef, PDFString, StandardFonts, type PDFFont, rgb } from "pdf-lib";
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
  // LAYOUT_16x9 in pptxgenjs is 10"x5.625"; the shared engine uses the
  // PowerPoint widescreen canvas, so define it explicitly to stay in sync.
  pptx.defineLayout({ name: "NOVA_WIDE", width: SLIDE_W, height: SLIDE_H });
  pptx.layout = "NOVA_WIDE";
  pptx.author = "Nova";
  pptx.subject = deck.title;

  layoutDeck(deck).forEach((spec, index) => {
    const page = pptx.addSlide();
    page.background = { color: pptxHex(spec.background) };
    for (const shape of spec.shapes) {
      if (shape.kind === "line") {
        page.addShape(pptx.ShapeType.line, {
          x: shape.box.x,
          y: shape.box.y + shape.box.h / 2,
          w: shape.box.w,
          h: 0,
          line: { color: pptxHex(shape.color), width: 1.5 },
        });
      } else {
        page.addShape(shape.kind === "ellipse" ? pptx.ShapeType.ellipse : pptx.ShapeType.rect, {
          ...shape.box,
          fill: { color: pptxHex(shape.color) },
          line: { color: pptxHex(shape.color) },
          ...(shape.href ? { hyperlink: { url: shape.href } } : {}),
        });
      }
    }
    for (const item of spec.texts) {
      page.addText(item.text, {
        ...item.box,
        fontFace: item.font,
        fontSize: item.size,
        bold: Boolean(item.bold),
        italic: Boolean(item.italic),
        color: pptxHex(item.color),
        align: item.align ?? "left",
        valign: item.valign ?? "top",
        // No internal insets: the layout engine already reserves grid gutters,
        // and zero insets keep PPTX text boxes identical to PDF boxes.
        inset: 0,
        breakLine: false,
        wrap: true,
        lineSpacingMultiple: item.lineSpacing ?? 1.25,
        ...(item.href ? { hyperlink: { url: item.href } } : {}),
      });
    }
    const notes = deck.slides[index]?.notes;
    if (notes) page.addNotes(notes);
  });

  return (await pptx.write({ outputType: "nodebuffer", compression: true })) as Buffer;
}

type PdfPage = ReturnType<Awaited<ReturnType<typeof PDFDocument.create>>["addPage"]>;

/** Link annotations accumulate per page; a second link must not drop the first. */
const pdfAnnotations = new WeakMap<PdfPage, PDFRef[]>();

function addPdfLink(pdfDoc: PDFDocument, page: PdfPage, annotation: PDFRef) {
  const existing = pdfAnnotations.get(page) ?? [];
  existing.push(annotation);
  pdfAnnotations.set(page, existing);
  page.node.set(PDFName.of("Annots"), pdfDoc.context.obj(existing));
}

/** The layout engine uses Office-safe fonts; pdf-lib maps them to its standard families. */
function standardFonts(font: string) {
  if (font === "Cambria") {
    return {
      regular: StandardFonts.TimesRoman,
      bold: StandardFonts.TimesRomanBold,
      italic: StandardFonts.TimesRomanItalic,
      boldItalic: StandardFonts.TimesRomanBoldItalic,
    };
  }
  if (font === "Consolas") {
    return {
      regular: StandardFonts.Courier,
      bold: StandardFonts.CourierBold,
      italic: StandardFonts.CourierOblique,
      boldItalic: StandardFonts.CourierBoldOblique,
    };
  }
  // Calibri and Arial are metrically close to Helvetica for PDF handouts.
  return {
    regular: StandardFonts.Helvetica,
    bold: StandardFonts.HelveticaBold,
    italic: StandardFonts.HelveticaOblique,
    boldItalic: StandardFonts.HelveticaBoldOblique,
  };
}

function fontKey(item: TextSpec) {
  const variant = item.bold
    ? item.italic ? "boldItalic" : "bold"
    : item.italic ? "italic" : "regular";
  return `${item.font}:${variant}`;
}

function drawPdfText(
  pdfDoc: PDFDocument,
  page: PdfPage,
  item: TextSpec,
  fonts: Map<string, PDFFont>
) {
  const font = fonts.get(fontKey(item));
  if (!font) return;
  const x = item.box.x * 72;
  const w = item.box.w * 72;
  const h = item.box.h * 72;
  const lines = item.text.split("\n");
  const leading = item.size * (item.lineSpacing ?? 1.25);
  const top = (SLIDE_H - item.box.y) * 72 - item.size * 0.78;
  const firstY = item.valign === "middle"
    ? top - Math.max(0, h - lines.length * leading) / 2
    : top;
  if (item.href) {
    const annotation = pdfDoc.context.register(
      pdfDoc.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [x, (SLIDE_H - item.box.y - item.box.h) * 72, x + w, (SLIDE_H - item.box.y) * 72],
        Border: [0, 0, 0],
        A: { Type: "Action", S: "URI", URI: PDFString.of(item.href) },
      })
    );
    addPdfLink(pdfDoc, page, annotation);
  }
  lines.forEach((line, index) => {
    const textWidth = font.widthOfTextAtSize(line, item.size);
    const drawX =
      item.align === "center"
        ? x + (w - textWidth) / 2
        : item.align === "right"
          ? x + w - textWidth
          : x;
    page.drawText(line, {
      x: Math.max(0, drawX),
      y: firstY - index * leading,
      size: item.size,
      font,
      color: pdfRgb(item.color),
    });
  });
}

export async function renderDeckPdf(deck: Deck): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const specs = layoutDeck(deck);
  const fonts = new Map<string, PDFFont>();
  for (const item of specs.flatMap(spec => spec.texts)) {
    const key = fontKey(item);
    if (fonts.has(key)) continue;
    const pair = standardFonts(item.font);
    const variant = item.bold
      ? item.italic ? pair.boldItalic : pair.bold
      : item.italic ? pair.italic : pair.regular;
    fonts.set(key, await pdf.embedFont(variant));
  }

  for (const spec of specs) {
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
    for (const item of spec.texts) drawPdfText(pdf, page, item, fonts);
  }
  return Buffer.from(await pdf.save());
}
