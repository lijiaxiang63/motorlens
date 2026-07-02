// Generates a self-signed certificate for LAN HTTPS (camera access requires
// a secure origin on non-localhost hosts). Visiting devices will see a
// browser warning once — accept it to proceed.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const certDir = join(dirname(fileURLToPath(import.meta.url)), '..', '.certs')
const key = join(certDir, 'dev.key')
const crt = join(certDir, 'dev.crt')

if (existsSync(key) && existsSync(crt)) {
  console.log('[motorlens] using existing self-signed cert in .certs/')
} else {
  mkdirSync(certDir, { recursive: true })
  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt,
     '-days', '3650', '-subj', '/CN=motorlens.local'],
    { stdio: 'inherit' },
  )
  console.log('[motorlens] generated self-signed cert in .certs/')
}
