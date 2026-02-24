const SHIFT_AMOUNTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
  9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
  16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10,
  15, 21,
] as const;

const ROUND_CONSTANTS = Array.from({ length: 64 }, (_, index) =>
  Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0,
);

function leftRotate(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function toHexFromWord(word: number): string {
  let hex = "";

  for (let byteIndex = 0; byteIndex < 4; byteIndex += 1) {
    const value = (word >>> (byteIndex * 8)) & 0xff;
    hex += value.toString(16).padStart(2, "0");
  }

  return hex;
}

function toMd5WordArray(input: Uint8Array): Uint8Array {
  const messageLength = input.length;
  const withOneBitLength = messageLength + 1;
  const paddedLengthWithoutSize =
    withOneBitLength + ((56 - (withOneBitLength % 64) + 64) % 64);
  const finalLength = paddedLengthWithoutSize + 8;
  const buffer = new Uint8Array(finalLength);
  buffer.set(input);
  buffer[messageLength] = 0x80;

  const bitLength = messageLength * 8;
  const lowBits = bitLength >>> 0;
  const highBits = Math.floor(bitLength / 0x100000000) >>> 0;
  const offset = finalLength - 8;

  buffer[offset] = lowBits & 0xff;
  buffer[offset + 1] = (lowBits >>> 8) & 0xff;
  buffer[offset + 2] = (lowBits >>> 16) & 0xff;
  buffer[offset + 3] = (lowBits >>> 24) & 0xff;
  buffer[offset + 4] = highBits & 0xff;
  buffer[offset + 5] = (highBits >>> 8) & 0xff;
  buffer[offset + 6] = (highBits >>> 16) & 0xff;
  buffer[offset + 7] = (highBits >>> 24) & 0xff;

  return buffer;
}

export function md5(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const message = toMd5WordArray(bytes);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let chunkOffset = 0; chunkOffset < message.length; chunkOffset += 64) {
    const words = new Uint32Array(16);

    for (let index = 0; index < 16; index += 1) {
      const base = chunkOffset + index * 4;
      words[index] =
        (message[base] |
          (message[base + 1] << 8) |
          (message[base + 2] << 16) |
          (message[base + 3] << 24)) >>>
        0;
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let round = 0; round < 64; round += 1) {
      let f = 0;
      let g = 0;

      if (round < 16) {
        f = (b & c) | (~b & d);
        g = round;
      } else if (round < 32) {
        f = (d & b) | (~d & c);
        g = (5 * round + 1) % 16;
      } else if (round < 48) {
        f = b ^ c ^ d;
        g = (3 * round + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * round) % 16;
      }

      const roundValue = (a + f + ROUND_CONSTANTS[round] + words[g]) >>> 0;
      const nextB = (b + leftRotate(roundValue, SHIFT_AMOUNTS[round])) >>> 0;

      a = d;
      d = c;
      c = b;
      b = nextB;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return (
    toHexFromWord(a0) +
    toHexFromWord(b0) +
    toHexFromWord(c0) +
    toHexFromWord(d0)
  );
}
