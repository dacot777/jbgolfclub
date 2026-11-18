import type { Env } from './types'
import { decryptToken, encryptToken } from './crypto'
import {
  ASSIGNEE_LABELS,
  BRANCH_LABELS,
  CHANNEL_LABELS,
  CUSTOMER_TYPE_LABELS,
  INQUIRY_LIMITS,
  PRODUCT_LABELS,
  SOURCE_LABELS,
  STAGE_LABELS,
  type Inquiry,
  type InquiryInput,
  type InquiryListRow,
  type InquirySummaryRow,
} from '../src/lib/inquiry-types'

type PrivateFields = Required<Pick<InquiryInput, keyof typeof INQUIRY_LIMITS>>
type InquiryRow = Omit<Inquiry, keyof PrivateFields> & {
  privateFields: string | null
  creationFingerprint: string | null
}
const columns = `id,version,first_date AS firstDate,product,channel,source,ad_id AS adId,stage,assignee,branch,customer_type AS customerType,
  private_fields AS privateFields,creation_fingerprint AS creationFingerprint`
const emptyFields: PrivateFields = {
  name: '',
  contact: '',
  note: '',
  nextAction: '',
}
const publicColumns =
  'id,version,first_date AS firstDate,product,branch,channel,source,assignee,stage'
type PublicInquiryRow = Pick<
  Inquiry,
  | 'id'
  | 'version'
  | 'firstDate'
  | 'product'
  | 'branch'
  | 'channel'
  | 'source'
  | 'assignee'
  | 'stage'
>
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
function isInquiryDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false
  const date = new Date(value + 'T00:00:00Z')
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  )
}

function inputFrom(raw: Record<string, unknown>): InquiryInput {
  const firstDate = raw.firstDate
  if (firstDate !== null && !isInquiryDate(firstDate)) return invalid()
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
    nextAction:
      raw.nextAction === undefined
        ? ''
        : textField(raw.nextAction, INQUIRY_LIMITS.nextAction),
    branch: raw.branch == null ? null : option(raw.branch, BRANCH_LABELS),
    customerType:
      raw.customerType == null
        ? null
        : option(raw.customerType, CUSTOMER_TYPE_LABELS),
  }
}
async function readPrivateFields(
  env: Env,
  id: string,
  encrypted: string | null,
): Promise<PrivateFields> {
  if (encrypted === null) return emptyFields
  const plaintext = await decryptToken(
    encrypted,
    env.TOKEN_ENCRYPTION_KEY,
    'jbgolf:inquiry:v1:' + id,
  )
  return JSON.parse(plaintext) as PrivateFields
}
async function itemFrom(row: InquiryRow, env: Env): Promise<Inquiry> {
  const { privateFields, creationFingerprint: _fingerprint, ...data } = row
  const fields = await readPrivateFields(env, row.id, privateFields)
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

// Only the agreed shared fields are readable without a staff session. Creation
// retries also pass through this projection, even after a private staff edit.
export function publicInquiryItem(item: PublicInquiryRow): Inquiry {
  return {
    id: item.id,
    version: item.version,
    firstDate: item.firstDate,
    product: item.product,
    branch: item.branch,
    channel: item.channel,
    source: item.source,
    assignee: item.assignee,
    stage: item.stage,
    adId: null,
    customerType: null,
    ...emptyFields,
  }
}

export async function listPublicInquiries(env: Env): Promise<Inquiry[]> {
  const { results } = await env.DB.prepare(
    `SELECT ${publicColumns} FROM inquiries ORDER BY created_at DESC,rowid DESC`,
  ).all<PublicInquiryRow>()
  return results.map(publicInquiryItem)
}

export async function updatePublicInquiry(
  env: Env,
  idValue: string,
  raw: Record<string, unknown>,
) {
  const id = idFrom(idValue)
  const version = versionFrom(raw.version)
  // Ignore private input on a shared edit; omitted/redacted fields must never
  // replace the encrypted original, including its legacy next action.
  const input = inputFrom({
    ...raw,
    ...emptyFields,
    adId: null,
    customerType: null,
  })
  const updated = await env.DB.prepare(
    `UPDATE inquiries SET first_date=?,product=?,branch=CASE WHEN ? THEN ? ELSE branch END,
      channel=?,source=?,assignee=?,stage=?,
      ad_id=CASE WHEN ?='instagram_ad' THEN ad_id ELSE NULL END,version=version+1
      WHERE id=? AND version=? RETURNING ${publicColumns}`,
  )
    .bind(
      input.firstDate,
      input.product,
      Number(raw.branch !== undefined),
      input.branch,
      input.channel,
      input.source,
      input.assignee,
      input.stage,
      input.source,
      id,
      version,
    )
    .first<PublicInquiryRow>()
  if (updated) return publicInquiryItem(updated)
  const exists = await env.DB.prepare('SELECT 1 FROM inquiries WHERE id=?')
    .bind(id)
    .first()
  throw new InquiryError(
    exists ? 'inquiry_conflict' : 'inquiry_not_found',
    exists ? 409 : 404,
  )
}

function displayCategory<T extends string>(
  value: unknown,
  labels: Record<T, string>,
): T | null {
  return typeof value === 'string' && Object.hasOwn(labels, value)
    ? (value as T)
    : null
}

export async function publicInquiryList(db: Env['DB']) {
  try {
    const { results } = await db
      .prepare(
        `SELECT first_date AS firstDate, product, branch, channel, source, assignee, stage
       FROM inquiries ORDER BY created_at DESC, rowid DESC`,
      )
      .all<InquiryListRow>()
    const rows: InquiryListRow[] = results.map((row) => ({
      firstDate: isInquiryDate(row.firstDate) ? row.firstDate : null,
      product: displayCategory(row.product, PRODUCT_LABELS),
      branch: displayCategory(row.branch, BRANCH_LABELS),
      channel: displayCategory(row.channel, CHANNEL_LABELS),
      source: displayCategory(row.source, SOURCE_LABELS),
      assignee: displayCategory(row.assignee, ASSIGNEE_LABELS),
      stage: displayCategory(row.stage, STAGE_LABELS),
    }))
    return Response.json({ rows }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json(
      { error: { code: 'inquiries_unavailable' } },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}

export async function publicInquirySummary(db: Env['DB']) {
  try {
    // Only these fixed categories are public, including on databases with older rows.
    const { results: rows } = await db
      .prepare(
        `SELECT product, branch, channel, stage, COUNT(*) AS count
       FROM inquiries
       WHERE product IN ('camp','lesson','other')
         AND (branch IS NULL OR branch IN ('hanam','cheongdam','seohyeon'))
         AND channel IN ('kakao','instagram_dm','phone','other')
         AND stage IN ('received','consulting','completed','closed')
       GROUP BY product, branch, channel, stage
       ORDER BY product, branch, channel, stage`,
      )
      .all<InquirySummaryRow>()
    return Response.json(
      { rows },
      {
        headers: { 'Cache-Control': 'public, max-age=0, s-maxage=30' },
      },
    )
  } catch {
    return Response.json(
      { error: { code: 'inquiries_unavailable' } },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      },
    )
  }
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
  const { branch, customerType, ...legacyFields } = input
  // Older creates omitted unset classifications and used a blank nextAction.
  const fingerprint = await fingerprintFor(
    'inquiry-create:' +
      id +
      ':' +
      JSON.stringify({
        ...legacyFields,
        ...(branch === null ? {} : { branch }),
        ...(customerType === null ? {} : { customerType }),
      }),
  )
  const existing = () =>
    env.DB.prepare(`SELECT ${columns} FROM inquiries WHERE id=?`)
      .bind(id)
      .first<InquiryRow>()
  let row = await existing()
  if (!row) {
    await confirmAd(env, input.adId)
    row = await env.DB.prepare(
      `INSERT INTO inquiries(id,created_at,first_date,product,channel,source,ad_id,stage,assignee,private_fields,creation_fingerprint,branch,customer_type)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM deleted_inquiry_ids WHERE id=?)
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
        customerType,
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
    'SELECT version,ad_id AS adId,branch,customer_type AS customerType,private_fields AS privateFields FROM inquiries WHERE id=?',
  )
    .bind(id)
    .first<
      Pick<
        InquiryRow,
        'version' | 'adId' | 'branch' | 'customerType' | 'privateFields'
      >
    >()
  if (!original) throw new InquiryError('inquiry_not_found', 404)
  if (original.version !== version)
    throw new InquiryError('inquiry_conflict', 409)
  if (original.adId !== input.adId) await confirmAd(env, input.adId)
  if (raw.nextAction === undefined && original.privateFields !== null)
    input.nextAction = (
      await readPrivateFields(env, id, original.privateFields)
    ).nextAction
  const row = await env.DB.prepare(
    `UPDATE inquiries SET first_date=?,product=?,channel=?,source=?,ad_id=?,stage=?,assignee=?,
      private_fields=?,branch=?,customer_type=?,version=version+1 WHERE id=? AND version=? RETURNING ${columns}`,
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
      raw.customerType === undefined
        ? original.customerType
        : input.customerType,
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
