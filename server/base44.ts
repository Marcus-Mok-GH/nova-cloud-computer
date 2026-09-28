/**
 * Base44 encoding for arbitrary bytes using the QR-compatible alphabet from
 * RFC 9285's Base45 alphabet with the space character removed.
 *
 * Base44 is not a single universally standardized format, so this module
 * deliberately documents the byte-pair variant used here: two bytes become
 * three characters and one byte becomes two characters.
 */

export const BASE44_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$%*+-./:";

const BASE = BASE44_ALPHABET.length;
const BYTE_PAIR_MAX = 0xffff;

function digitFor(character: string): number {
  const digit = BASE44_ALPHABET.indexOf(character);
  if (digit < 0) throw new Error(`Invalid Base44 character: "${character}".`);
  return digit;
}

/** Encode arbitrary bytes as Base44. */
export function encodeBase44(data: Uint8Array): string {
  let result = "";

  for (let index = 0; index < data.length; index += 2) {
    const remaining = data.length - index;
    if (remaining === 1) {
      const value = data[index];
      result += BASE44_ALPHABET[value % BASE];
      result += BASE44_ALPHABET[Math.floor(value / BASE)];
      continue;
    }

    const value = data[index] * 256 + data[index + 1];
    result += BASE44_ALPHABET[value % BASE];
    result += BASE44_ALPHABET[Math.floor(value / BASE) % BASE];
    result += BASE44_ALPHABET[Math.floor(value / (BASE * BASE))];
  }

  return result;
}

/** Decode Base44 into the original arbitrary bytes. */
export function decodeBase44(input: string): Uint8Array {
  if (input.length % 3 === 1) {
    throw new Error("Invalid Base44 length: a Base44 value cannot end with one character.");
  }

  const output: number[] = [];
  let index = 0;

  while (index < input.length) {
    const remaining = input.length - index;
    if (remaining === 2) {
      const value = digitFor(input[index]) + BASE * digitFor(input[index + 1]);
      if (value > 0xff) {
        throw new Error("Invalid Base44 final group: two characters decode to more than one byte.");
      }
      output.push(value);
      break;
    }

    const value =
      digitFor(input[index]) +
      BASE * digitFor(input[index + 1]) +
      BASE * BASE * digitFor(input[index + 2]);
    if (value > BYTE_PAIR_MAX) {
      throw new Error("Invalid Base44 group: three characters decode to more than two bytes.");
    }
    output.push(value >> 8, value & 0xff);
    index += 3;
  }

  return Uint8Array.from(output);
}

/** Encode UTF-8 text as Base44. */
export function encodeBase44Text(value: string): string {
  return encodeBase44(new TextEncoder().encode(value));
}

/** Decode Base44 as UTF-8 text, rejecting invalid UTF-8. */
export function decodeBase44Text(value: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(decodeBase44(value));
}
