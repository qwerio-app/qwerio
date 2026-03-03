import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";

if (typeof globalThis.crypto === "undefined") {
  (globalThis as { crypto?: Crypto }).crypto = webcrypto as unknown as Crypto;
}
