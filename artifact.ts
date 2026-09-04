import JSZip from "jszip";
import {
  BrowserIdentity,
  cleanText,
  makeProof,
  prettyJson,
  sha256Bytes,
  sha256File,
  verifySignedDocument,
} from "./browser-crypto";

export const ARTIFACT_SCHEMA = "technocore-agent-dashboard/pre-genesis-artifact/v1";

export type ArtifactPackage = {
  manifest: Record<string, unknown>;
  certificateText: string;
  certificateSha256: string;
  artworkSha256: string;
  artifactId: string;
  artworkFilename: string;
  announcement: string;
  zipBlob: Blob;
};

function timestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "digital-artifact";
}

function safeTitle(value: string): string {
  const title = value.trim().replace(/\s+/g, " ");
  if (!title) throw new Error("Give the artwork a title.");
  if (title.length > 120) throw new Error("Keep the artwork title under 120 characters.");
  return title;
}

function safeSourceUrl(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > 2048) throw new Error("The public source URL is too long.");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("The public source URL must begin with http:// or https://.");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Use a public http:// or https:// URL without embedded credentials.");
  }
  return parsed.toString();
}

async function imageType(file: File): Promise<{ mediaType: string; extension: string }> {
  if (file.size <= 0 || file.size > 100 * 1024 * 1024) throw new Error("Choose an artwork image smaller than 100 MB.");
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const starts = (...bytes: number[]) => bytes.every((value, index) => header[index] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { mediaType: "image/png", extension: "png" };
  if (starts(0xff, 0xd8, 0xff)) return { mediaType: "image/jpeg", extension: "jpg" };
  const ascii = new TextDecoder().decode(header);
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) return { mediaType: "image/gif", extension: "gif" };
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return { mediaType: "image/webp", extension: "webp" };
  throw new Error("Choose a PNG, JPEG, GIF, or WebP image.");
}

export async function createArtifactPackage(input: {
  identity: BrowserIdentity;
  file: File;
  title: string;
  sourceUrl: string;
}): Promise<ArtifactPackage> {
  const title = safeTitle(input.title);
  const sourceUrl = safeSourceUrl(input.sourceUrl);
  const type = await imageType(input.file);
  const artworkSha256 = await sha256File(input.file);
  const artifactId = `${slug(title)}-${artworkSha256.slice(0, 12)}`;
  const artworkFilename = `artwork.${type.extension}`;
  const unsigned: Record<string, unknown> = {
    schema: ARTIFACT_SCHEMA,
    status: "pre-genesis-digital-artifact",
    artifact_id: artifactId,
    title,
    creator_did: input.identity.did,
    created_at_utc: timestamp(),
    artwork: {
      filename: artworkFilename,
      media_type: type.mediaType,
      bytes: input.file.size,
      sha256: artworkSha256,
    },
    source_url: sourceUrl,
    declaration:
      "The creator DID declares authorship of this exact artwork file and may seek to mint the same SHA-256 content on FLOP Network if official NFT support becomes available. This certificate is not an on-chain NFT, token, official FLOP protocol asset, or promise of rewards.",
  };
  const manifest = { ...unsigned, proof: await makeProof(input.identity, unsigned) };
  const certificateText = prettyJson(manifest);
  const certificateSha256 = await sha256Bytes(new TextEncoder().encode(certificateText));
  const source = sourceUrl ? ` | Public source: ${sourceUrl}` : "";
  const announcement = cleanText(
    `FLOP PRE-GENESIS DIGITAL ARTIFACT | ID: ${artifactId} | Title: ${title} | Creator DID: ${input.identity.did} | Original SHA-256: ${artworkSha256} | Certificate SHA-256: ${certificateSha256}${source} | Declaration: This is an original digital-artwork provenance record published through FLOP Labs' Technocore. It is not an on-chain NFT, token, official FLOP protocol asset, or promise of rewards.`,
  );

  const zip = new JSZip();
  zip.file(artworkFilename, await input.file.arrayBuffer());
  zip.file("artifact-certificate.json", certificateText);
  zip.file(
    "README-FIRST.txt",
    [
      "PRE-GENESIS DIGITAL ARTIFACT PACKAGE",
      "====================================",
      "",
      "Safe to publish: artwork, artifact-certificate.json, and a confirmed public receipt.",
      "Never add an identity JSON, PEM, password, seed phrase, or wallet private key.",
      "",
      "This package is a signed provenance record. It is not an on-chain NFT, an official FLOP asset, or a reward promise.",
      "",
    ].join("\n"),
  );
  const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { manifest, certificateText, certificateSha256, artworkSha256, artifactId, artworkFilename, announcement, zipBlob };
}

export async function verifyArtifact(certificateText: string, artwork: File): Promise<{
  artifactId: string;
  title: string;
  creatorDid: string;
  artworkSha256: string;
  certificateSha256: string;
}> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(certificateText.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("The artifact certificate is not readable JSON.");
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("The artifact certificate structure is invalid.");
  const document = manifest as Record<string, unknown>;
  await verifySignedDocument(document, ARTIFACT_SCHEMA);
  const artworkRecord = document.artwork as Record<string, unknown> | undefined;
  if (!artworkRecord || typeof artworkRecord.sha256 !== "string") throw new Error("The certificate has no artwork fingerprint.");
  const type = await imageType(artwork);
  const artworkSha256 = await sha256File(artwork);
  if (artworkSha256 !== artworkRecord.sha256) throw new Error("The artwork fingerprint does not match the signed certificate.");
  if (artwork.size !== artworkRecord.bytes || type.mediaType !== artworkRecord.media_type) {
    throw new Error("The artwork size or media type does not match the signed certificate.");
  }
  return {
    artifactId: String(document.artifact_id ?? ""),
    title: String(document.title ?? ""),
    creatorDid: String(document.creator_did ?? ""),
    artworkSha256,
    certificateSha256: await sha256Bytes(new TextEncoder().encode(certificateText)),
  };
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
