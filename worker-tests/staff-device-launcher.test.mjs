import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, rmdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import jsQR from 'jsqr'
import { issueStaffDevice } from '../scripts/issue-staff-device.mjs'

test('the staff launcher stores the one-time link on this device and registers only its digest', async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'jb-staff-launcher-test-'),
  )
  const launcher = path.join(directory, '운영-기기-연결.html')
  t.after(async () => {
    await rm(launcher, { force: true })
    await rmdir(directory)
  })
  const issued = []
  const register = (hash, until) => issued.push({ hash, until })
  const before = Date.now()
  assert.equal(await issueStaffDevice(directory, register), launcher)
  const readToken = async () => {
    const text = await readFile(launcher, 'utf8')
    const match =
      /href="https:\/\/jbgolf-connection\.jbgolfacademy\.workers\.dev\/#staff-device\/([a-zA-Z0-9_-]{43})"/.exec(
        text,
      )
    assert.ok(
      match,
      'launcher should contain the official site and a device ticket',
    )
    return match[1]
  }
  const token = await readToken()
  assert.equal(
    createHash('sha256').update(token).digest('base64url'),
    issued[0].hash,
  )
  const day = 24 * 60 * 60 * 1000
  assert.ok(
    issued[0].until >= before + day && issued[0].until <= Date.now() + day,
  )
  assert.equal(Buffer.from(token, 'base64url').length, 32)
  await assert.rejects(
    issueStaffDevice(directory, () => {
      throw Error('offline')
    }),
    /offline/,
  )
  assert.ok(
    (await readToken()) === token,
    'a failed replacement must preserve the existing launcher',
  )
  await issueStaffDevice(directory, register)
  assert.ok(
    (await readToken()) !== token,
    'a new launcher should contain a new ticket',
  )
  assert.deepEqual(await readdir(directory), [path.basename(launcher)])
  if (process.platform !== 'win32') {
    assert.equal((await stat(launcher)).mode & 0o777, 0o600)
  } else {
    const aclCheck = [
      "$ErrorActionPreference = 'Stop'",
      '$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User',
      '$acl = [IO.File]::GetAccessControl($env:JB_TEST_LAUNCHER_PATH)',
      '$rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))',
      'if ($rules.Count -ne 1 -or $rules[0].IdentityReference -ne $sid) { exit 1 }',
    ].join('\n')
    const permissions = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', aclCheck],
      {
        env: { ...process.env, JB_TEST_LAUNCHER_PATH: launcher },
        windowsHide: true,
        stdio: 'pipe',
      },
    )
    assert.equal(
      permissions.status,
      0,
      'only the current Windows user should have an access rule on the launcher',
    )
  }
})

function decodeQrImage(html) {
  const svg = html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0]
  assert.ok(svg, 'expected an embedded QR image')
  const dimensions = svg.match(/viewBox="0 0 (\d+) (\d+)"/)
  assert.ok(dimensions)
  const [, width, height] = dimensions.map(Number)
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255)
  // Each closed path segment is a black square on the SVG's white background.
  for (const square of svg.matchAll(/M(\d+),(\d+)l(\d+),0 /g)) {
    const [, x, y, size] = square.map(Number)
    for (let row = y; row < y + size; row++) {
      for (let column = x; column < x + size; column++) {
        const start = 4 * (row * width + column)
        pixels.fill(0, start, start + 3)
      }
    }
  }
  const scan = jsQR(pixels, width, height)
  assert.ok(scan, 'a separate offline reader should decode the QR image')
  return new URL(scan.data)
}

test('the phone QR opens inquiries with its own one-hour grant and preserves the PC launcher', async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'jb-staff-phone-test-'),
  )
  const desktop = path.join(directory, '운영-기기-연결.html')
  const phone = path.join(directory, '휴대폰-문의-연결.html')
  t.after(async () => {
    await rm(desktop, { force: true })
    await rm(phone, { force: true })
    await rmdir(directory)
  })
  const grants = []
  const register = (hash, until) => grants.push({ hash, until })
  await issueStaffDevice(directory, register)
  const desktopHtml = await readFile(desktop, 'utf8')
  const started = Date.now()
  assert.equal(
    await issueStaffDevice(directory, register, { phone: true }),
    phone,
  )
  const html = await readFile(phone, 'utf8')
  const scanned = decodeQrImage(html)
  assert.equal(
    scanned.origin,
    'https://jbgolf-connection.jbgolfacademy.workers.dev',
  )
  assert.equal(scanned.pathname, '/')
  assert.equal(scanned.search, '')
  const match = /^#staff-device\/([a-zA-Z0-9_-]{43})\/inquiries$/.exec(
    scanned.hash,
  )
  assert.ok(
    match,
    'the QR should contain the one-time grant and open inquiries',
  )
  assert.ok(
    createHash('sha256').update(match[1]).digest('base64url') ===
      grants[1].hash,
  )
  assert.ok(grants[1].hash !== grants[0].hash)
  const hour = 60 * 60 * 1000
  assert.ok(
    grants[1].until >= started + hour && grants[1].until <= Date.now() + hour,
  )
  const deadline = new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'long',
    timeStyle: 'medium',
    timeZone: 'Asia/Seoul',
  }).format(grants[1].until)
  assert.ok(html.includes(deadline + ' (한국시간)'))
  assert.ok(
    !html.includes(match[1]),
    'the ticket should only appear within the QR pixels',
  )
  assert.ok(
    !/<a\b|<script\b|\b(?:href|src)=/i.test(html),
    'the phone launcher should not load external resources or contain activation links',
  )
  await assert.rejects(
    issueStaffDevice(
      directory,
      () => {
        throw Error('offline')
      },
      { phone: true },
    ),
    /offline/,
  )
  assert.ok(
    (await readFile(phone, 'utf8')) === html,
    'failed registration should preserve the prior QR',
  )
  assert.ok(
    (await readFile(desktop, 'utf8')) === desktopHtml,
    'phone issuance should preserve the PC launcher',
  )
  assert.deepEqual(
    (await readdir(directory)).sort(),
    [path.basename(desktop), path.basename(phone)].sort(),
  )
})
