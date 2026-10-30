/**
 * Zero-dependency EIP-712 / EIP-3009 (TransferWithAuthorization) Signer for Base USDC
 *
 * Implements:
 * - Pure TypeScript Keccak-256 (Ethereum standard 0x01 padding)
 * - Pure BigInt secp256k1 ECDSA signing (RFC 6979 deterministic k + low-S normalization + recovery id v=27/28)
 * - EIP-55 checksummed address derivation from a 32-byte private key
 * - EIP-712 typed-data hashing for Circle's FiatTokenV2 (`USD Coin`, version `2`) `TransferWithAuthorization`
 * - Standard x402 v1 Base64 `X-PAYMENT` header construction
 */

import crypto from "node:crypto";

// ============================================================================
// 1. Keccak-256 (Ethereum Standard)
// ============================================================================

const KECCAK_ROUNDS = 24;
const RC: bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

const ROTC: number[] = [
  1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14,
  27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44,
];

const PILN: number[] = [
  10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4,
  15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1,
];

const MASK64 = 0xffffffffffffffffn;

function rotl64(x: bigint, n: number): bigint {
  return ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK64;
}

function keccakF1600(state: bigint[]): void {
  const bc = new Array<bigint>(5);
  for (let round = 0; round < KECCAK_ROUNDS; round++) {
    // Theta
    for (let i = 0; i < 5; i++) {
      bc[i] = state[i] ^ state[i + 5] ^ state[i + 10] ^ state[i + 15] ^ state[i + 20];
    }
    for (let i = 0; i < 5; i++) {
      const t = bc[(i + 4) % 5] ^ rotl64(bc[(i + 1) % 5], 1);
      for (let j = 0; j < 25; j += 5) {
        state[j + i] ^= t;
      }
    }
    // Rho & Pi
    let t = state[1];
    for (let i = 0; i < 24; i++) {
      const j = PILN[i];
      bc[0] = state[j];
      state[j] = rotl64(t, ROTC[i]);
      t = bc[0];
    }
    // Chi
    for (let j = 0; j < 25; j += 5) {
      for (let i = 0; i < 5; i++) {
        bc[i] = state[j + i];
      }
      for (let i = 0; i < 5; i++) {
        state[j + i] ^= (~bc[(i + 1) % 5] & MASK64) & bc[(i + 2) % 5];
      }
    }
    // Iota
    state[0] ^= RC[round];
  }
}

export function keccak256(input: Uint8Array): Buffer {
  const rate = 136; // 1088 bits for Keccak-256
  const state = new Array<bigint>(25).fill(0n);
  const paddedLen = Math.ceil((input.length + 1) / rate) * rate;
  const buf = new Uint8Array(paddedLen);
  buf.set(input);
  buf[input.length] = 0x01; // Keccak padding (NOT 0x06 SHA-3)
  buf[paddedLen - 1] |= 0x80;

  const view = new DataView(buf.buffer);
  for (let offset = 0; offset < paddedLen; offset += rate) {
    for (let i = 0; i < rate / 8; i++) {
      state[i] ^= view.getBigUint64(offset + i * 8, true);
    }
    keccakF1600(state);
  }

  const out = Buffer.alloc(32);
  const outView = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let i = 0; i < 4; i++) {
    outView.setBigUint64(i * 8, state[i], true);
  }
  return out;
}

// ============================================================================
// 2. Pure BigInt secp256k1 ECDSA (Deterministic RFC 6979 + Recovery ID v=27/28)
// ============================================================================

const SECP_P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const SECP_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP_GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const SECP_GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

interface Point {
  x: bigint;
  y: bigint;
}

function mod(a: bigint, m: bigint = SECP_P): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function modInv(a: bigint, m: bigint = SECP_P): bigint {
  let [t, newT] = [0n, 1n];
  let [r, newR] = [m, mod(a, m)];
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  return mod(t, m);
}

function pointAdd(p1: Point | null, p2: Point | null): Point | null {
  if (!p1) return p2;
  if (!p2) return p1;
  if (p1.x === p2.x && p1.y !== p2.y) return null;
  const m =
    p1.x === p2.x
      ? mod(3n * p1.x * p1.x * modInv(2n * p1.y))
      : mod((p2.y - p1.y) * modInv(p2.x - p1.x));
  const x3 = mod(m * m - p1.x - p2.x);
  const y3 = mod(m * (p1.x - x3) - p1.y);
  return { x: x3, y: y3 };
}

function pointMul(k: bigint, p: Point = { x: SECP_GX, y: SECP_GY }): Point {
  let res: Point | null = null;
  let addend: Point | null = p;
  let scalar = k;
  while (scalar > 0n) {
    if (scalar & 1n) {
      res = pointAdd(res, addend);
    }
    addend = pointAdd(addend, addend);
    scalar >>= 1n;
  }
  if (!res) throw new Error("Invalid scalar multiplication");
  return res;
}

function bigintTo32Bytes(n: bigint): Buffer {
  return Buffer.from(n.toString(16).padStart(64, "0"), "hex");
}

export function privateKeyToAddress(privateKeyHex: string): string {
  const cleanHex = privateKeyHex.replace(/^0x/, "");
  const privKey = BigInt("0x" + cleanHex);
  const pubPoint = pointMul(privKey);
  const pubBytes = Buffer.concat([bigintTo32Bytes(pubPoint.x), bigintTo32Bytes(pubPoint.y)]);
  const addrLower = keccak256(pubBytes).subarray(12).toString("hex");
  const hashHex = keccak256(Buffer.from(addrLower, "utf-8")).toString("hex");
  let checksummed = "0x";
  for (let i = 0; i < 40; i++) {
    checksummed += parseInt(hashHex[i], 16) >= 8 ? addrLower[i].toUpperCase() : addrLower[i];
  }
  return checksummed;
}

export function signDigestSecp256k1(digest32: Buffer, privateKeyHex: string): string {
  const d = BigInt("0x" + privateKeyHex.replace(/^0x/, ""));
  const z = BigInt("0x" + digest32.toString("hex")) % SECP_N;

  // Deterministic nonce via HMAC-SHA256
  const kHash = crypto
    .createHmac("sha256", bigintTo32Bytes(d))
    .update(digest32)
    .digest();
  let k = (BigInt("0x" + kHash.toString("hex")) % (SECP_N - 1n)) + 1n;

  const R = pointMul(k);
  const r = R.x % SECP_N;
  let v = Number(R.y & 1n);
  if (R.x >= SECP_N) v |= 2;

  let s = mod(modInv(k, SECP_N) * mod(z + r * d, SECP_N), SECP_N);
  // EIP-2 low-S normalization
  if (s > SECP_N / 2n) {
    s = SECP_N - s;
    v ^= 1;
  }

  const rHex = r.toString(16).padStart(64, "0");
  const sHex = s.toString(16).padStart(64, "0");
  const vHex = (v + 27).toString(16).padStart(2, "0");
  return `0x${rHex}${sHex}${vHex}`;
}

function modPow(base: bigint, exp: bigint, m: bigint): bigint {
  let res = 1n;
  base = mod(base, m);
  while (exp > 0n) {
    if (exp & 1n) res = mod(res * base, m);
    base = mod(base * base, m);
    exp >>= 1n;
  }
  return res;
}

/**
 * EIP-191 personal_sign (`\x19Ethereum Signed Message:\n<length><message>`)
 */
export function signPersonalMessage(message: string, privateKeyHex: string): string {
  const msgBytes = Buffer.from(message, "utf-8");
  const prefixBytes = Buffer.from(`\x19Ethereum Signed Message:\n${msgBytes.length}`, "utf-8");
  const digest = keccak256(Buffer.concat([prefixBytes, msgBytes]));
  return signDigestSecp256k1(digest, privateKeyHex);
}

/**
 * Recovers the checksummed Ethereum address from an EIP-191 personal_sign signature
 * and original plain text message.
 */
export function recoverPersonalSignAddress(message: string, signatureHex: string): string {
  const cleanSig = signatureHex.replace(/^0x/, "");
  if (cleanSig.length !== 130) {
    throw new Error(`Invalid signature length: ${cleanSig.length} hex chars (expected 130)`);
  }
  const r = BigInt("0x" + cleanSig.slice(0, 64));
  const s = BigInt("0x" + cleanSig.slice(64, 128));
  let v = parseInt(cleanSig.slice(128, 130), 16);
  if (v >= 27) v -= 27;

  const msgBytes = Buffer.from(message, "utf-8");
  const prefixBytes = Buffer.from(`\x19Ethereum Signed Message:\n${msgBytes.length}`, "utf-8");
  const digest = keccak256(Buffer.concat([prefixBytes, msgBytes]));
  const z = BigInt("0x" + digest.toString("hex")) % SECP_N;

  const x = r;
  const y2 = mod(mod(x * x * x) + 7n);
  let y = modPow(y2, (SECP_P + 1n) / 4n, SECP_P);
  if ((y & 1n) !== BigInt(v & 1)) {
    y = SECP_P - y;
  }

  const R: Point = { x, y };
  const rInv = modInv(r, SECP_N);
  const sR = pointMul(s, R);
  const zG = pointMul(z, { x: SECP_GX, y: SECP_GY });
  const negZg: Point = { x: zG.x, y: SECP_P - zG.y };
  const sRminusZg = pointAdd(sR, negZg);
  if (!sRminusZg) throw new Error("Invalid point recovery");
  const Q = pointMul(rInv, sRminusZg);

  const pubBytes = Buffer.concat([bigintTo32Bytes(Q.x), bigintTo32Bytes(Q.y)]);
  const addrLower = keccak256(pubBytes).subarray(12).toString("hex");
  const hashHex = keccak256(Buffer.from(addrLower, "utf-8")).toString("hex");
  let checksummed = "0x";
  for (let i = 0; i < 40; i++) {
    checksummed += parseInt(hashHex[i], 16) >= 8 ? addrLower[i].toUpperCase() : addrLower[i];
  }
  return checksummed;
}

// ============================================================================
// 3. EIP-712 / EIP-3009 TransferWithAuthorization Signer for Base USDC
// ============================================================================

function abiEncodeAddress(addr: string): Buffer {
  const clean = addr.toLowerCase().replace(/^0x/, "");
  return Buffer.from(clean.padStart(64, "0"), "hex");
}

function abiEncodeUint256(val: string | number | bigint): Buffer {
  const b = BigInt(val);
  return bigintTo32Bytes(b);
}

function abiEncodeBytes32(hex32: string): Buffer {
  const clean = hex32.replace(/^0x/, "").padStart(64, "0");
  return Buffer.from(clean, "hex");
}

export interface Eip3009Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export function buildSignedX402PaymentHeader(params: {
  privateKeyHex: string;
  network: "eip155:8453" | "eip155:84532" | "base" | "base-sepolia";
  usdcAddress: string;
  payTo: string;
  valueAtomic: string;
  resourceUrl?: string;
  description?: string;
  tokenName?: string;
  tokenVersion?: string;
  validForSeconds?: number;
  extensions?: Record<string, unknown>;
}): {
  headerBase64: string;
  paymentPayload: Record<string, any>;
  payerAddress: string;
} {
  const payerAddress = privateKeyToAddress(params.privateKeyHex);
  const isMainnet = params.network === "base" || params.network === "eip155:8453";
  const chainId = isMainnet ? 8453 : 84532;
  const caip2Network = isMainnet ? "eip155:8453" : "eip155:84532";
  const tokenName = params.tokenName || "USD Coin";
  const tokenVersion = params.tokenVersion || "2";
  const nowSec = Math.floor(Date.now() / 1000);
  const validAfter = String(nowSec - 60); // Valid starting 60s ago for clock skew
  const validBefore = String(nowSec + (params.validForSeconds || 600));
  const nonce = "0x" + crypto.randomBytes(32).toString("hex");

  // 1. EIP-712 Domain Separator
  // EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)
  const domainTypeHash = keccak256(
    Buffer.from(
      "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
      "utf-8"
    )
  );
  const nameHash = keccak256(Buffer.from(tokenName, "utf-8"));
  const versionHash = keccak256(Buffer.from(tokenVersion, "utf-8"));
  const domainSeparator = keccak256(
    Buffer.concat([
      domainTypeHash,
      nameHash,
      versionHash,
      abiEncodeUint256(chainId),
      abiEncodeAddress(params.usdcAddress),
    ])
  );

  // 2. EIP-3009 Struct Hash
  // TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)
  const transferTypeHash = keccak256(
    Buffer.from(
      "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)",
      "utf-8"
    )
  );
  const structHash = keccak256(
    Buffer.concat([
      transferTypeHash,
      abiEncodeAddress(payerAddress),
      abiEncodeAddress(params.payTo),
      abiEncodeUint256(params.valueAtomic),
      abiEncodeUint256(validAfter),
      abiEncodeUint256(validBefore),
      abiEncodeBytes32(nonce),
    ])
  );

  // 3. EIP-712 Digest: keccak256("\x19\x01" || domainSeparator || structHash)
  const digest = keccak256(
    Buffer.concat([Buffer.from([0x19, 0x01]), domainSeparator, structHash])
  );

  const signature = signDigestSecp256k1(digest, params.privateKeyHex);

  const authorization: Eip3009Authorization = {
    from: payerAddress,
    to: params.payTo,
    value: params.valueAtomic,
    validAfter,
    validBefore,
    nonce,
  };

  const paymentPayload: Record<string, any> = {
    x402Version: 2 as const,
    resource: {
      url:
        params.resourceUrl ||
        "https://agent-distribution-gateway.vercel.app/api/v1/enrich/person",
      description:
        params.description ||
        "Apollo.io Verified B2B Person Enrichment (1 profile lookup)",
      mimeType: "application/json",
    },
    accepted: {
      scheme: "exact" as const,
      network: caip2Network,
      amount: params.valueAtomic,
      asset: params.usdcAddress,
      payTo: params.payTo,
      maxTimeoutSeconds: 60,
      extra: {
        name: tokenName,
        version: tokenVersion,
      },
    },
    payload: {
      signature,
      authorization,
    },
  };

  if (params.extensions) {
    paymentPayload.extensions = params.extensions;
  }

  const headerBase64 = Buffer.from(JSON.stringify(paymentPayload), "utf-8").toString(
    "base64"
  );

  return {
    headerBase64,
    paymentPayload,
    payerAddress,
  };
}
