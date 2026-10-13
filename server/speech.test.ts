import { describe, expect, it } from "vitest";
import {
  MAX_SPEECH_CHUNK_CHARS,
  chunkTextForSpeech,
  joinSpeechChunks,
  normalizeSpeechLanguage,
  speechChunkUrl,
  stripId3v2,
} from "./speech";

/** Two MPEG frame starts, as Google's endpoint emits them. */
const FRAME_A = Buffer.concat([
  Buffer.from([0xff, 0xf3, 0x84, 0xc4]),
  Buffer.alloc(32, 7),
]);
const FRAME_B = Buffer.concat([
  Buffer.from([0xff, 0xf3, 0x84, 0xc4]),
  Buffer.alloc(16, 3),
]);

function id3v2(bodySize: number): Buffer {
  const tag = Buffer.alloc(10 + bodySize, 0);
  tag.write("ID3", 0, "ascii");
  tag[3] = 3; // ID3v2.3
  // Synchsafe size.
  tag[6] = (bodySize >>> 21) & 0x7f;
  tag[7] = (bodySize >>> 14) & 0x7f;
  tag[8] = (bodySize >>> 7) & 0x7f;
  tag[9] = bodySize & 0x7f;
  return tag;
}

describe("chunkTextForSpeech", () => {
  it("returns one chunk for text that fits", () => {
    expect(chunkTextForSpeech("Hello there.")).toEqual(["Hello there."]);
  });

  it("returns no chunks for blank text", () => {
    expect(chunkTextForSpeech("   \n  ")).toEqual([]);
  });

  it("collapses newlines so chunks are single lines", () => {
    expect(chunkTextForSpeech("One.\nTwo.")).toEqual(["One. Two."]);
  });

  it("keeps every chunk under the upstream limit", () => {
    const text = Array.from(
      { length: 40 },
      (_, i) => `Sentence number ${i} states a complete and verifiable fact.`
    ).join(" ");
    const chunks = chunkTextForSpeech(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks)
      expect(chunk.length).toBeLessThanOrEqual(MAX_SPEECH_CHUNK_CHARS);
  });

  it("never silently drops a over-long run-on sentence", () => {
    const runOn = `${"prefix ".repeat(80)}tail`;
    const chunks = chunkTextForSpeech(runOn);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(" ")).toContain("tail");
    for (const chunk of chunks)
      expect(chunk.length).toBeLessThanOrEqual(MAX_SPEECH_CHUNK_CHARS);
  });

  it("preserves the whole message across chunks", () => {
    const text = Array.from(
      { length: 12 },
      (_, i) => `Sentence ${i} is complete.`
    ).join(" ");
    expect(chunkTextForSpeech(text).join(" ")).toBe(text);
  });
});

describe("stripId3v2", () => {
  it("leaves a bare MPEG stream untouched", () => {
    expect(stripId3v2(FRAME_A)).toEqual(FRAME_A);
  });

  it("removes a leading ID3v2 tag", () => {
    const tagged = Buffer.concat([id3v2(20), FRAME_A]);
    expect(stripId3v2(tagged)).toEqual(FRAME_A);
  });

  it("returns empty for a tag with no audio behind it", () => {
    expect(stripId3v2(id3v2(20))).toEqual(Buffer.alloc(0));
  });
});

describe("joinSpeechChunks", () => {
  it("concatenates chunks into one stream", () => {
    expect(joinSpeechChunks([FRAME_A, FRAME_B])).toEqual(
      Buffer.concat([FRAME_A, FRAME_B])
    );
  });

  it("strips a tag that would break the joined stream", () => {
    const joined = joinSpeechChunks([
      Buffer.concat([id3v2(20), FRAME_A]),
      FRAME_B,
    ]);
    expect(joined).toEqual(Buffer.concat([FRAME_A, FRAME_B]));
  });

  it("returns an empty buffer for no chunks", () => {
    expect(joinSpeechChunks([])).toEqual(Buffer.alloc(0));
  });
});

describe("speechChunkUrl", () => {
  it("sends the text, language and client parameters", () => {
    const url = speechChunkUrl("Hello there", "en");
    expect(url.origin).toBe("https://translate.google.com");
    expect(url.pathname).toBe("/translate_tts");
    expect(url.searchParams.get("q")).toBe("Hello there");
    expect(url.searchParams.get("tl")).toBe("en");
    expect(url.searchParams.get("client")).toBe("tw-ob");
  });

  it("url-encodes the text", () => {
    const url = speechChunkUrl("a & b?", "pt-BR");
    expect(url.searchParams.get("q")).toBe("a & b?");
    expect(url.toString()).toContain("q=a+%26+b%3F");
  });

  it("keeps a two-part language tag", () => {
    expect(speechChunkUrl("hi", "pt-BR").searchParams.get("tl")).toBe("pt-BR");
  });
});

describe("normalizeSpeechLanguage", () => {
  it("accepts plain and regional language tags", () => {
    expect(normalizeSpeechLanguage("en")).toBe("en");
    expect(normalizeSpeechLanguage(" pt-BR ")).toBe("pt-BR");
  });

  it("rejects anything that is not a language tag", () => {
    expect(normalizeSpeechLanguage("")).toBeNull();
    expect(normalizeSpeechLanguage("english")).toBeNull();
    expect(normalizeSpeechLanguage("en;drop table")).toBeNull();
    expect(normalizeSpeechLanguage("en-US-x")).toBeNull();
    expect(normalizeSpeechLanguage(undefined)).toBeNull();
  });
});
