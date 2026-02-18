const NANO_ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DEFAULT_NANO_ID_SIZE = 12;

export function createNanoId(size = DEFAULT_NANO_ID_SIZE): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let id = "";

  for (const byte of bytes) {
    id += NANO_ID_ALPHABET[byte % NANO_ID_ALPHABET.length];
  }

  return id;
}
