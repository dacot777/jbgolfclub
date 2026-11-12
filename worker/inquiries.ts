import type { Env } from './types'
import { decryptToken, encryptToken } from './crypto'
import {
  ASSIGNEE_LABELS,
  BRANCH_LABELS,
  CHANNEL_LABELS,
  INQUIRY_LIMITS,
  PRODUCT_LABELS,
  SOURCE_LABELS,
  STAGE_LABELS,
  type Inquiry,
  type InquiryInput,
} from '../src/lib/inquiry-types'

type PrivateFields = Pick<InquiryInput, keyof typeof INQUIRY_LIMITS>
type InquiryRow = Omit<Inquiry, keyof PrivateFields> & {
  privateFields: string | null
  creationFingerprint: string | null
}
const columns = `id,version,first_date AS firstDate,product,channel,source,ad_id AS adId,stage,assignee,branch,
  private_fields AS privateFields,creation_fingerprint AS creationFingerprint`
const emptyFields: PrivateFields = {
  name: '',
  contact: '',
  note: '',
  nextAction: '',
}
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

export class InquiryError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code)
  }
}
function invalid(): never {
  throw new InquiryError('invalid_inquiry', 400)
}
function idFrom(value: unknown) {
  return typeof value === 'string' && uuid.test(value)
    ? value.toLowerCase()
    : invalid()
}
function versionFrom(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
    ? value
    : invalid()
}
function option<T extends Record<string, string>>(
  value: unknown,
  options: T,
): keyof T & string {
  return typeof value === 'string' && Object.hasOwn(options, value)
    ? value
    : invalid()
}
function textField(value: unknown, max: number) {
  return typeof value === 'string' &&
    value.length <= max &&
    !value.includes('\u0000')
    ? value
    : invalid()
}
function inputFrom(raw: Record<string, unknown>): InquiryInput {
  const firstDate = raw.firstDate
  if (firstDate !== null) {
    if (typeof firstDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(firstDate))
      return invalid()
    const date = new Date(firstDate + 'T00:00:00Z')
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== firstDate
    )
      return invalid()
  }
  const adId = raw.adId ?? null
  if (
    adId !== null &&
    (raw.source !== 'instagram_ad' ||
      typeof adId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,120}$/.test(adId))
  )
    return invalid()
  return {
    firstDate,
    product: option(raw.product, PRODUCT_LABELS),
    channel: option(raw.channel, CHANNEL_LABELS),
    source: option(raw.source, SOURCE_LABELS),
    adId,
    stage: option(raw.stage, STAGE_LABELS),
    assignee: option(raw.assignee, ASSIGNEE_LABELS),
    name: textField(raw.name, INQUIRY_LIMITS.name),
    contact: textField(raw.contact, INQUIRY_LIMITS.contact),
    note: textField(raw.note, INQUIRY_LIMITS.note),
    nextAction: textField(raw.nextAction, INQUIRY_LIMITS.nextAction),
    branch: raw.branch == null ? null : option(raw.branch, BRANCH_LABELS),
  }
}
async function itemFrom(row: InquiryRow, env: Env): Promise<Inquiry> {
  const { privateFields, creationFingerprint: _fingerprint, ...data } = row
  let fields = emptyFields
  if (privateFields !== null) {
    const plaintext = await decryptToken(
      privateFields,
      env.TOKEN_ENCRYPTION_KEY,
      'jbgolf:inquiry:v1:' + row.id,
    )
    fields = JSON.parse(plaintext) as PrivateFields
  }
  return {
    ...data,
    name: fields.name,
    contact: fields.contact,
    note: fields.note,
    nextAction: fields.nextAction,
  }
}
export async function listInquiries(env: Env): Promise<Inquiry[]> {
  const { results } = await env.DB.prepare(
    `SELECT ${columns} FROM inquiries ORDER BY created_at DESC,rowid DESC`,
  ).all<InquiryRow>()
  return Promise.all(results.map((row) => itemFrom(row, env)))
}
async function privateFields(
  env: Env,
  id: string,
  { name, contact, note, nextAction }: InquiryInput,
) {
  return name || contact || note || nextAction
    ? encryptToken(
        JSON.stringify({ name, contact, note, nextAction }),
        env.TOKEN_ENCRYPTION_KEY,
        'jbgolf:inquiry:v1:' + id,
      )
    : null
}
async function confirmAd(env: Env, adId: string | null) {
  if (!adId) return
  const exists = await env.DB.prepare(
    `SELECT 1 AS present FROM reviewed_ads WHERE id=?
    UNION ALL SELECT 1 FROM meta_ad_registry WHERE account_id=? AND suppressed=0 AND COALESCE(reviewed_id,public_key)=? LIMIT 1`,
  )
    .bind(adId, env.META_AD_ACCOUNT_ID?.replace(/^act_/, '') ?? '', adId)
    .first()
  if (!exists) throw new InquiryError('unknown_ad', 400)
}

export async function createInquiry(
  env: Env,
  raw: Record<string, unknown>,
  fingerprintFor: (value: string) => Promise<string>,
) {
  const id = idFrom(raw.id)
  const input = inputFrom(raw)
  // A keyed fingerprint permits a delayed retry after an edit without storing or exposing the original personal fields.
  const { branch, ...legacyFields } = input
  // Keep existing fingerprints valid for retries of creates without an assigned branch.
  const fingerprint = await fingerprintFor(
    'inquiry-create:' +
      id +
      ':' +
      JSON.stringify(branch === null ? legacyFields : input),
  )
  const existing = () =>
    env.DB.prepare(`SELECT ${columns} FROM inquiries WHERE id=?`)
      .bind(id)
      .first<InquiryRow>()
  let row = await existing()
  if (!row) {
    await confirmAd(env, input.adId)
    row = await env.DB.prepare(
      `INSERT INTO inquiries(id,created_at,first_date,product,channel,source,ad_id,stage,assignee,private_fields,creation_fingerprint,branch)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM deleted_inquiry_ids WHERE id=?)
      ON CONFLICT(id) DO NOTHING RETURNING ${columns}`,
    )
      .bind(
        id,
        Date.now(),
        input.firstDate,
        input.product,
        input.channel,
        input.source,
        input.adId,
        input.stage,
        input.assignee,
        await privateFields(env, id, input),
        fingerprint,
        branch,
        id,
      )
      .first<InquiryRow>()
    if (!row) row = await existing()
  }
  if (!row || row.creationFingerprint !== fingerprint)
    throw new InquiryError('inquiry_conflict', 409)
  return itemFrom(row, env)
}

export async function updateInquiry(
  env: Env,
  idValue: string,
  raw: Record<string, unknown>,
) {
  const id = idFrom(idValue)
  const version = versionFrom(raw.version)
  const input = inputFrom(raw)
  const original = await env.DB.prepare(
    'SELECT version,ad_id AS adId,branch FROM inquiries WHERE id=?',
  )
    .bind(id)
    .first<Pick<Inquiry, 'version' | 'adId' | 'branch'>>()
  if (!original) throw new InquiryError('inquiry_not_found', 404)
  if (original.version !== version)
    throw new InquiryError('inquiry_conflict', 409)
  if (original.adId !== input.adId) await confirmAd(env, input.adId)
  const row = await env.DB.prepare(
    `UPDATE inquiries SET first_date=?,product=?,channel=?,source=?,ad_id=?,stage=?,assignee=?,
      private_fields=?,branch=?,version=version+1 WHERE id=? AND version=? RETURNING ${columns}`,
  )
    .bind(
      input.firstDate,
      input.product,
      input.channel,
      input.source,
      input.adId,
      input.stage,
      input.assignee,
      await privateFields(env, id, input),
      raw.branch === undefined ? original.branch : input.branch,
      id,
      original.version,
    )
    .first<InquiryRow>()
  if (!row) throw new InquiryError('inquiry_conflict', 409)
  return itemFrom(row, env)
}

export async function deleteInquiry(
  env: Env,
  idValue: string,
  raw: Record<string, unknown>,
) {
  const id = idFrom(idValue)
  const version = versionFrom(raw.version)
  // Mark and erase in a single D1 transaction. A stale delete must do neither.
  const [, , remaining] = await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO deleted_inquiry_ids(id) SELECT id FROM inquiries WHERE id=? AND version=?',
    ).bind(id, version),
    env.DB.prepare('DELETE FROM inquiries WHERE id=? AND version=?').bind(
      id,
      version,
    ),
    env.DB.prepare('SELECT version FROM inquiries WHERE id=?').bind(id),
  ])
  if (remaining.results.length) throw new InquiryError('inquiry_conflict', 409)
  return { deleted: true }
}
