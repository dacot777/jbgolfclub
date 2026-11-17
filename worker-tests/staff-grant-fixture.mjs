import { createHash, randomBytes } from 'node:crypto'

// Test-only grant for the isolated Miniflare database passed by the caller.
export async function issueStaffGrant(db, expiresAt = Date.now() + 60_000) {
  const token = randomBytes(32).toString('base64url')
  await db
    .prepare(
      'INSERT INTO staff_activation_grants(token_hash,expires_at) VALUES(?,?)',
    )
    .bind(createHash('sha256').update(token).digest('base64url'), expiresAt)
    .run()
  return token
}
