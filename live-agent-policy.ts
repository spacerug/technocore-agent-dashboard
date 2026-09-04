export const DEFAULT_LIVE_AGENT_OWNER_DID = "did:key:z6MkvNuQBWuTsmqZQaDPrnkWYZYvByG58a2y3GgPS3PsfCvf";

export function isAuthorizedLiveAgentDid(
  did: string | null | undefined,
  allowedDid = DEFAULT_LIVE_AGENT_OWNER_DID,
): boolean {
  return Boolean(did && did === allowedDid);
}

export function isAddressedToLiveAgent(
  value: string | null | undefined,
  ownerDid = DEFAULT_LIVE_AGENT_OWNER_DID,
): boolean {
  const message = String(value ?? "").trim().toLowerCase();
  if (!message) return false;
  return message.includes("neoncore") || message.includes(ownerDid.toLowerCase());
}
