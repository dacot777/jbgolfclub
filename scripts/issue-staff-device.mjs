import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const site = 'https://jbgolf-connection.jbgolfacademy.workers.dev'
const launcherName = '운영-기기-연결.html'
const day = 24 * 60 * 60 * 1000

function checkOutsideRepo(directory) {
  const relative = path.relative(root, directory)
  if (
    !relative.startsWith('..' + path.sep) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  )
    throw new Error('운영 기기 연결 파일은 저장소 외부에만 저장할 수 있습니다.')
}

async function preparePrivateDirectory(directory) {
  checkOutsideRepo(directory)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if (!(await lstat(directory)).isDirectory())
    throw new Error('운영 기기 폴더 경로를 확인해주세요.')
  checkOutsideRepo(await realpath(directory))
  if (process.platform !== 'win32') {
    await chmod(directory, 0o700)
    return
  }
  // Node's numeric modes on Windows do not restrict the ACL. Apply it before writing the link.
  const rules = [
    "$ErrorActionPreference = 'Stop'",
    '$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    '$acl = [IO.Directory]::GetAccessControl($env:JB_STAFF_DEVICE_DIRECTORY, [Security.AccessControl.AccessControlSections]::Access)',
    "$acl.SetSecurityDescriptorSddlForm(('D:P(A;OICI;FA;;;{0})' -f $sid), [Security.AccessControl.AccessControlSections]::Access)",
    '[IO.Directory]::SetAccessControl($env:JB_STAFF_DEVICE_DIRECTORY, $acl)',
  ].join('\n')
  const security = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', rules],
    {
      env: { ...process.env, JB_STAFF_DEVICE_DIRECTORY: directory },
      stdio: 'pipe',
      windowsHide: true,
    },
  )
  if (security.status !== 0)
    throw new Error('운영 기기 파일 폴더의 비공개 권한을 설정할 수 없습니다.')
}

export async function issueStaffDevice(directory, registerDigest) {
  await preparePrivateDirectory(directory)
  const token = randomBytes(32).toString('base64url')
  const digest = createHash('sha256').update(token).digest('base64url')
  const expiresAt = Date.now() + day
  const launcher = path.join(directory, launcherName)
  const pending = path.join(
    directory,
    '.staff-' + randomBytes(12).toString('hex') + '.tmp',
  )
  const html = `<!doctype html>
<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'">
<title>JB 골프 운영 기기 연결</title>
<main><h1>JB 골프 운영 기기 연결</h1>
<p>캘린더와 문의를 관리할 브라우저에서 아래 링크를 한 번 열어주세요.</p>
<p><a href="${site}/#staff-device/${token}" rel="noreferrer">이 브라우저를 운영 기기로 연결</a></p>
<p>연결 링크는 발급 후 24시간 동안 한 번 사용할 수 있습니다.</p></main></html>
`
  try {
    await writeFile(pending, html, { flag: 'wx', mode: 0o600 })
    await registerDigest(digest, expiresAt)
    await rename(pending, launcher)
  } finally {
    await rm(pending, { force: true })
  }
  return launcher
}

function registerRemote(digest, expiresAt) {
  const command = `INSERT INTO staff_activation_grants(token_hash,expires_at) VALUES('${digest}',${expiresAt})`
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'node_modules/wrangler/bin/wrangler.js'),
      'd1',
      'execute',
      'DB',
      '--config',
      'wrangler.production.jsonc',
      '--remote',
      '--command',
      command,
      '--json',
    ],
    {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    },
  )
  if (result.status !== 0)
    throw new Error(
      'Cloudflare에 운영 기기를 등록할 수 없습니다. Wrangler 로그인과 D1 마이그레이션을 확인해주세요.',
    )
  const [statement] = JSON.parse(result.stdout)
  if (!statement?.success || statement.meta?.changes !== 1)
    throw new Error('Cloudflare의 운영 기기 등록 결과를 확인할 수 없습니다.')
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== '--remote')
      throw new Error('사용법: node scripts/issue-staff-device.mjs --remote')
    const base =
      process.platform === 'win32'
        ? process.env.LOCALAPPDATA
        : process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share')
    if (!base || !path.isAbsolute(base))
      throw new Error('사용자 전용 데이터 폴더를 확인해주세요.')
    const launcher = await issueStaffDevice(
      path.join(base, 'JBGolfWorkspace'),
      registerRemote,
    )
    console.log(launcher)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
