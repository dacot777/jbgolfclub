import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, rmdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
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
