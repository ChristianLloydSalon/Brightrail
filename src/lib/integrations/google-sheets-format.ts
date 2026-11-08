/** Pure parsing for Google Sheets connections, shared by connection validation and the connector. */

export interface ServiceAccount { client_email: string; private_key: string }

/** Parses the pasted JSON key; returns a plain-language problem instead of throwing. */
export function parseServiceAccount(secret: string): ServiceAccount | { error: string } {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(secret.trim());
  } catch {
    return { error: "Paste the whole JSON key file you downloaded from Google Cloud (it starts with { and ends with })." };
  }
  if (j.type !== "service_account") return { error: "That JSON isn't a service account key (its \"type\" should be \"service_account\")." };
  if (typeof j.client_email !== "string" || !j.client_email.endsWith(".iam.gserviceaccount.com")) return { error: "The key is missing a valid client_email." };
  if (typeof j.private_key !== "string" || !j.private_key.includes("PRIVATE KEY")) return { error: "The key is missing its private_key." };
  return { client_email: j.client_email, private_key: j.private_key };
}

/** Accepts a full sheet URL or a bare ID. */
export function spreadsheetIdFrom(input: string): string | null {
  const v = input.trim();
  const m = v.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]{20,})/);
  if (m) return m[1]!;
  return /^[a-zA-Z0-9-_]{20,}$/.test(v) ? v : null;
}
