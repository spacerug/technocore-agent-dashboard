import { BrowserIdentity, identityFromSeed } from "./browser-crypto";

const PASSKEY_LABEL = "NEONCORE sovereign DID";
const PRF_DOMAIN = "neoncore.space/did-key/passkey-prf/v1";
const PASSKEY_CEREMONY_TIMEOUT_MS = 60_000;

let activePasskeyCeremony: AbortController | null = null;

type PrfResults = {
  enabled?: boolean;
  results?: { first?: ArrayBuffer };
};

type PublicKeyCredentialWithPrf = PublicKeyCredential & {
  getClientExtensionResults(): AuthenticationExtensionsClientOutputs & { prf?: PrfResults };
};

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function prfSalt(): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(PRF_DOMAIN)));
}

function requirePasskeySupport(): void {
  if (typeof window === "undefined" || !window.isSecureContext) {
    throw new Error("Passkey identity requires a secure HTTPS connection.");
  }
  if (typeof PublicKeyCredential === "undefined" || !navigator.credentials?.create || !navigator.credentials?.get) {
    throw new Error("This browser does not support passkeys. Use current Chrome or Edge, or load an identity JSON.");
  }
}

async function runPasskeyCeremony<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  activePasskeyCeremony?.abort();
  const controller = new AbortController();
  activePasskeyCeremony = controller;
  const deadline = window.setTimeout(() => controller.abort(), PASSKEY_CEREMONY_TIMEOUT_MS);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("The previous or timed-out passkey request was cancelled. Select a passkey action to try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(deadline);
    if (activePasskeyCeremony === controller) activePasskeyCeremony = null;
  }
}

export function cancelPasskeyCeremony(): void {
  activePasskeyCeremony?.abort();
  activePasskeyCeremony = null;
}

function prfSeed(credential: PublicKeyCredentialWithPrf): Uint8Array | null {
  const first = credential.getClientExtensionResults().prf?.results?.first;
  return first instanceof ArrayBuffer && first.byteLength >= 32
    ? new Uint8Array(first).slice(0, 32)
    : null;
}

async function unlockCredential(signal: AbortSignal, allowCredentialId?: ArrayBuffer): Promise<PublicKeyCredentialWithPrf> {
  const salt = await prfSalt();
  const publicKey = {
    challenge: randomBytes(32),
    userVerification: "required",
    timeout: PASSKEY_CEREMONY_TIMEOUT_MS,
    ...(allowCredentialId ? { allowCredentials: [{ id: allowCredentialId, type: "public-key" }] } : {}),
    extensions: { prf: { eval: { first: salt } } },
  } as PublicKeyCredentialRequestOptions;
  const credential = await navigator.credentials.get({ publicKey, signal }) as PublicKeyCredentialWithPrf | null;
  if (!credential) throw new Error("The passkey was not unlocked.");
  return credential;
}

async function identityFromCredential(credential: PublicKeyCredentialWithPrf): Promise<BrowserIdentity> {
  const seed = prfSeed(credential);
  if (!seed) {
    throw new Error("This passkey provider did not return WebAuthn PRF key material. Keep using identity JSON on this device.");
  }
  return identityFromSeed(seed, PASSKEY_LABEL, "passkey");
}

export function passkeyIdentityAvailable(): boolean {
  return typeof window !== "undefined"
    && window.isSecureContext
    && typeof PublicKeyCredential !== "undefined"
    && Boolean(navigator.credentials?.create)
    && Boolean(navigator.credentials?.get);
}

export async function createPasskeyIdentity(): Promise<BrowserIdentity> {
  requirePasskeySupport();
  return runPasskeyCeremony(async (signal) => {
    const salt = await prfSalt();
    const publicKey = {
      challenge: randomBytes(32),
      rp: { name: "NEONCORE" },
      user: {
        id: randomBytes(32),
        name: `neoncore-${Date.now()}`,
        displayName: PASSKEY_LABEL,
      },
      pubKeyCredParams: [
        { alg: -8, type: "public-key" },
        { alg: -7, type: "public-key" },
      ],
      timeout: PASSKEY_CEREMONY_TIMEOUT_MS,
      attestation: "none",
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
      },
      extensions: { prf: { eval: { first: salt } } },
    } as PublicKeyCredentialCreationOptions;
    const created = await navigator.credentials.create({ publicKey, signal }) as PublicKeyCredentialWithPrf | null;
    if (!created) throw new Error("The passkey was not created.");
    if (created.getClientExtensionResults().prf?.enabled === false) {
      throw new Error("This passkey provider does not support the PRF feature needed for a recoverable DID.");
    }
    const seed = prfSeed(created);
    if (seed) return identityFromSeed(seed, PASSKEY_LABEL, "passkey");
    return identityFromCredential(await unlockCredential(signal, created.rawId));
  });
}

export async function recoverPasskeyIdentity(): Promise<BrowserIdentity> {
  requirePasskeySupport();
  return runPasskeyCeremony(async (signal) => identityFromCredential(await unlockCredential(signal)));
}
