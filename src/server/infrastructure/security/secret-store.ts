import "server-only";
import type { Hasher, SecretStore } from "@/server/application/ports/services";
import { SupabaseRepository, type DbProvider } from "../supabase/repositories/base";
import { connectionSecretContext, decryptSecret, encryptSecret, hmacSha256Hex, randomToken, safeEqual, sha256, webhookSecretContext } from "./crypto";

/** node:crypto behind the Hasher port. */
export class NodeHasher implements Hasher {
  sha256 = sha256;
  hmacSha256Hex = hmacSha256Hex;
  safeEqual = safeEqual;
  randomToken = randomToken;
}

interface SecretTable { table: string; key: string; context: (ownerId: string) => string }

const CONNECTION_SECRETS: SecretTable = { table: "connection_secrets", key: "connection_id", context: connectionSecretContext };
const WEBHOOK_SECRETS: SecretTable = { table: "webhook_secrets", key: "endpoint_id", context: webhookSecretContext };

/**
 * AES-256-GCM secrets in a side table, each sealed with its owner's id as associated data so a
 * ciphertext copied onto another row won't decrypt. Plaintext never leaves the server.
 */
export class EncryptedSecretStore extends SupabaseRepository implements SecretStore {
  constructor(db: DbProvider, private readonly spec: SecretTable) {
    super(db);
  }

  static forConnections(db: DbProvider) {
    return new EncryptedSecretStore(db, CONNECTION_SECRETS);
  }

  static forWebhooks(db: DbProvider) {
    return new EncryptedSecretStore(db, WEBHOOK_SECRETS);
  }

  async read(ownerId: string): Promise<string | null> {
    const { data } = await this.db.from(this.spec.table).select("ciphertext").eq(this.spec.key, ownerId).maybeSingle();
    return data ? decryptSecret(data.ciphertext as string, this.spec.context(ownerId)) : null;
  }

  async write(ownerId: string, plain: string): Promise<void> {
    await this.db.from(this.spec.table).upsert({ [this.spec.key]: ownerId, ciphertext: encryptSecret(plain, this.spec.context(ownerId)) });
  }

  async remove(ownerId: string): Promise<void> {
    await this.db.from(this.spec.table).delete().eq(this.spec.key, ownerId);
  }
}
