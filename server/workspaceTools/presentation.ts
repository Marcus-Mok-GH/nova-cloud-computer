import {
  createWorkspaceFileForUser,
  getWorkspaceFileForUser,
  updateWorkspaceFileForUser,
} from "../db";
import { applyDeckOperations, type DeckOperation } from "./deckEdit";
import { normaliseDeck, parseDeck, type Deck } from "./deckModel";
import { renderDeckPdf, renderDeckPptx } from "./deckRender";
import { type ToolCtx, type ToolExecution } from "./types";

const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const PDF_MIME = "application/pdf";
const JSON_MIME = "application/json";

const dataUri = (mime: string, buffer: Buffer) =>
  `data:${mime};base64,${buffer.toString("base64")}`;

function baseName(name: string): string {
  return (
    name
      .replace(/\.(deck\.json|pptx|pdf)$/i, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 80) || "presentation"
  );
}

function fail(reason: string): ToolExecution {
  return { ok: false, result: reason, action: { kind: "tool", name: "presentation", operation: "failed" } };
}

async function saveExport(
  ctx: ToolCtx,
  deck: Deck,
  format: "pptx" | "pdf"
): Promise<{ label: string; id?: number }> {
  const buffer =
    format === "pptx" ? await renderDeckPptx(deck) : await renderDeckPdf(deck);
  const mime = format === "pptx" ? PPTX_MIME : PDF_MIME;
  const name = `${baseName(deck.title)}.${format}`;
  const content = dataUri(mime, buffer);

  // The workspace snapshot is refreshed only BETWEEN model rounds. A model
  // that calls generate and export in the same round would not see the new
  // file by name, so remember export ids in the deck itself.
  const rememberedId = deck.exports?.[format];
  const remembered = rememberedId
    ? await getWorkspaceFileForUser(ctx.ownerId, rememberedId).catch(() => null)
    : null;
  const existing =
    remembered ?? ctx.computer.files.find(file => file.name === name) ?? null;

  if (existing) {
    await updateWorkspaceFileForUser(ctx.ownerId, existing.id, { content });
    deck.exports = { ...deck.exports, [format]: existing.id };
    return { label: `${name} (updated file id ${existing.id})`, id: existing.id };
  }
  const created = await createWorkspaceFileForUser(ctx.ownerId, { name, content, mimeType: mime });
  if (created) deck.exports = { ...deck.exports, [format]: created.id };
  return {
    label: created ? `${name} (file id ${created.id})` : `${name} (could not be saved)`,
    id: created?.id,
  };
}

export async function toolGeneratePresentation(ctx: ToolCtx): Promise<ToolExecution> {
  const parsed = normaliseDeck({
    title: ctx.args.title,
    design: ctx.args.design,
    slides: ctx.args.slides,
  });
  if (!parsed.ok) return fail(parsed.reason);
  const deck = parsed.value;
  const jsonName = `${baseName(deck.title)}.deck.json`;
  const saved = await createWorkspaceFileForUser(ctx.ownerId, {
    name: jsonName,
    content: JSON.stringify(deck),
    mimeType: JSON_MIME,
  });
  if (!saved) return fail("The deck could not be saved to Files.");
  const pptx = await saveExport(ctx, deck, "pptx");
  await updateWorkspaceFileForUser(ctx.ownerId, saved.id, {
    content: JSON.stringify(deck),
  });
  return {
    ok: true,
    result:
      `Created an editable ${deck.slides.length}-slide presentation in the ${deck.design.theme} theme. ` +
      `Editable deck source: "${jsonName}" (file id ${saved.id}); PowerPoint: ${pptx.label}. ` +
      "Tell the user they can ask for changes and then export to PDF. Do not paste file contents into the conversation.",
    action: { kind: "file", name: saved.name, operation: "created" },
  };
}

async function loadDeck(ctx: ToolCtx): Promise<{ deck: Deck; id: number; name: string } | null> {
  const id = Number(ctx.args.deck_id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = await getWorkspaceFileForUser(ctx.ownerId, id);
  if (!row) return null;
  const deck = parseDeck(row.content ?? "");
  return deck ? { deck, id, name: row.name } : null;
}

export async function toolEditPresentation(ctx: ToolCtx): Promise<ToolExecution> {
  const loaded = await loadDeck(ctx);
  if (!loaded) return fail("That presentation deck was not found in this workspace.");
  const operations = Array.isArray(ctx.args.operations)
    ? (ctx.args.operations as DeckOperation[])
    : [];
  if (!operations.length) return fail("Provide at least one edit operation.");
  const updated = applyDeckOperations(loaded.deck, operations);
  if (updated.slides.length < 1 || updated.slides.length > 20)
    return fail("A deck must keep between 1 and 20 slides.");
  await updateWorkspaceFileForUser(ctx.ownerId, loaded.id, {
    content: JSON.stringify(updated),
  });
  return {
    ok: true,
    result:
      `Updated "${loaded.name}" with ${operations.length} change(s). ` +
      "The JSON source is current; call export_presentation to refresh the PowerPoint or PDF.",
    action: { kind: "file", name: loaded.name, operation: "updated" },
  };
}

export async function toolExportPresentation(ctx: ToolCtx): Promise<ToolExecution> {
  const loaded = await loadDeck(ctx);
  if (!loaded) return fail("That presentation deck was not found in this workspace.");
  const requested = Array.isArray(ctx.args.formats) ? ctx.args.formats : ["pptx"];
  const formats = (["pptx", "pdf"] as const).filter(format => requested.includes(format));
  if (!formats.length) return fail("Request at least one format: pptx or pdf.");
  const saved: string[] = [];
  for (const format of formats) saved.push((await saveExport(ctx, loaded.deck, format)).label);
  await updateWorkspaceFileForUser(ctx.ownerId, loaded.id, {
    content: JSON.stringify(loaded.deck),
  });
  return {
    ok: true,
    result: `Exported the deck: ${saved.join("; ")}. Tell the user where to find the files.`,
    action: { kind: "file", name: `${baseName(loaded.deck.title)}.${formats[0]}`, operation: "created" },
  };
}
