import PptxGenJS from "pptxgenjs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { deriveInk, type Deck, type Design, type Slide } from "./deckModel";

const hex = (value: string) => value.replace("#", "").toUpperCase();
const pdfRgb = (value: string) =>
  rgb(
    parseInt(value.slice(1, 3), 16) / 255,
    parseInt(value.slice(3, 5), 16) / 255,
    parseInt(value.slice(5, 7), 16) / 255
  );

const titleSize = (design: Design) => (design.density === "airy" ? 34 : 28);

function pptxSlide(pptx: PptxGenJS, slide: Slide, design: Design, deckTitle: string) {
  const page = pptx.addSlide();
  page.background = { color: hex(design.background) };
  const ink = hex(deriveInk(design.background));
  const accent = hex(design.accent);
  const font = design.font;
  const isCover = slide.layout === "cover";

  page.addText(isCover ? deckTitle : slide.title, {
    x: 0.7,
    y: design.cover === "banner" && isCover ? 2.6 : 0.55,
    w: 8.6,
    h: isCover ? 1.8 : 0.95,
    fontFace: font,
    fontSize: isCover ? 42 : titleSize(design),
    bold: true,
    color: ink,
    breakLine: false,
  });

  const bullets = slide.bullets ?? [];
  if (bullets.length) {
    page.addText(
      bullets.map(bullet => ({ text: bullet, options: { bullet: { code: "2022" }, breakLine: true } })),
      { x: 0.9, y: isCover ? 2.8 : 1.7, w: 8.2, h: 3.8, fontFace: font, fontSize: 18, color: ink }
    );
  }
  if (slide.items?.length) {
    page.addText(
      slide.items.map(item => ({
        text: `${item.label}: ${item.value}`,
        options: { bullet: { code: "25AA" }, breakLine: true },
      })),
      { x: 0.9, y: 3.0, w: 8.2, h: 2.6, fontFace: font, fontSize: 16, color: ink }
    );
  }
  if (design.motif === "rule") {
    page.addShape(pptx.ShapeType.rect, { x: 0.7, y: 1.45, w: 1.1, h: 0.05, fill: { color: accent }, line: { color: accent } });
  } else if (design.motif === "dots") {
    for (let i = 0; i < 6; i += 1)
      page.addShape(pptx.ShapeType.ellipse, { x: 0.7 + i * 0.22, y: 6.55, w: 0.08, h: 0.08, fill: { color: accent }, line: { color: accent } });
  } else if (design.motif === "grid") {
    for (let i = 0; i < 4; i += 1)
      page.addShape(pptx.ShapeType.rect, { x: 8.3, y: 0.7 + i * 1.4, w: 0.4, h: 0.02, fill: { color: accent }, line: { color: accent } });
  }
  page.addText("Nova", { x: 0.7, y: 6.65, w: 2, h: 0.3, fontFace: font, fontSize: 10, color: accent });
  if (slide.notes) page.addNotes(slide.notes);
}

export async function renderDeckPptx(deck: Deck): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = "Nova";
  pptx.subject = deck.title;
  for (const slide of deck.slides) pptxSlide(pptx, slide, deck.design, deck.title);
  return (await pptx.write({ outputType: "nodebuffer", compression: true })) as Buffer;
}

export async function renderDeckPdf(deck: Deck): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const fontName =
    deck.design.font === "Times"
      ? StandardFonts.TimesRoman
      : deck.design.font === "Courier"
        ? StandardFonts.Courier
        : StandardFonts.Helvetica;
  const font = await pdf.embedFont(fontName);
  const bold = await pdf.embedFont(
    deck.design.font === "Times"
      ? StandardFonts.TimesRomanBold
      : deck.design.font === "Courier"
        ? StandardFonts.CourierBold
        : StandardFonts.HelveticaBold
  );
  const ink = pdfRgb(deriveInk(deck.design.background));
  const accent = pdfRgb(deck.design.accent);
  for (const slide of deck.slides) {
    const page = pdf.addPage([720, 405]);
    page.drawRectangle({ x: 0, y: 0, width: 720, height: 405, color: pdfRgb(deck.design.background) });
    page.drawText(slide.layout === "cover" ? deck.title : slide.title, {
      x: 48, y: 330, size: slide.layout === "cover" ? 36 : 26, font: bold, color: ink,
    });
    (slide.bullets ?? []).forEach((bullet, index) => {
      page.drawText(`• ${bullet}`, { x: 60, y: 280 - index * 34, size: 16, font, color: ink });
    });
    (slide.items ?? []).forEach((item, index) => {
      page.drawText(`${item.label}: ${item.value}`, { x: 60, y: 280 - index * 30, size: 14, font, color: ink });
    });
    if (deck.design.motif !== "none") {
      page.drawLine({ start: { x: 48, y: 305 }, end: { x: 150, y: 305 }, thickness: 2, color: accent });
    }
    page.drawText("Nova", { x: 48, y: 22, size: 9, font, color: accent });
  }
  return Buffer.from(await pdf.save());
}
