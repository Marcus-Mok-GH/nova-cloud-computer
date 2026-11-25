import { type Deck, type Design, type Slide } from "./deckModel";

export type DeckOperation =
  | { op: "set_title"; value: string }
  | { op: "set_design"; patch: Partial<Design> }
  | { op: "update_slide"; id: string; patch: Partial<Slide> }
  | { op: "add_slide"; slide: Slide; after?: string }
  | { op: "remove_slide"; id: string }
  | { op: "move_slide"; id: string; before?: string };

export function applyDeckOperations(deck: Deck, operations: DeckOperation[]): Deck {
  let next: Deck = {
    ...deck,
    design: { ...deck.design },
    exports: { ...deck.exports },
    slides: deck.slides.map(s => ({ ...s })),
  };
  for (const op of operations) {
    if (op.op === "set_title") {
      next = { ...next, title: op.value.trim() || next.title };
    } else if (op.op === "set_design") {
      next = { ...next, design: { ...next.design, ...op.patch } };
    } else if (op.op === "update_slide") {
      next = {
        ...next,
        slides: next.slides.map(slide =>
          slide.id === op.id ? { ...slide, ...op.patch, id: slide.id } : slide
        ),
      };
    } else if (op.op === "add_slide") {
      const slides = [...next.slides];
      const at = op.after ? slides.findIndex(slide => slide.id === op.after) + 1 : slides.length;
      slides.splice(at, 0, { ...op.slide });
      next = { ...next, slides };
    } else if (op.op === "remove_slide") {
      next = { ...next, slides: next.slides.filter(slide => slide.id !== op.id) };
    } else if (op.op === "move_slide") {
      const slides = [...next.slides];
      const from = slides.findIndex(slide => slide.id === op.id);
      if (from < 0) continue;
      const [moved] = slides.splice(from, 1);
      const to = op.before ? slides.findIndex(slide => slide.id === op.before) : slides.length;
      slides.splice(to < 0 ? slides.length : to, 0, moved);
      next = { ...next, slides };
    }
  }
  return next;
}
