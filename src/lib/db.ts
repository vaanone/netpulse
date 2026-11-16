import { PrismaClient } from '@prisma/client'
import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

// The SQLite database lives at <project root>/db/custom.db and is committed to
// git (it ships with the seeded default admin). Prisma resolves *relative*
// `file:` URLs against prisma/schema.prisma, so a relative DATABASE_URL (or no
// .env at all on a fresh clone) points at prisma/db/custom.db — a directory
// that does not exist — and every query fails with SQLITE_CANTOPEN (error 14).
// Canonicalize missing/relative URLs to the absolute tracked location.
function ensureDatabaseUrl(): void {
  const url = process.env.DATABASE_URL?.trim() ?? ''
  if (url && !url.startsWith('file:')) return // non-SQLite URL — leave untouched
  if (url.startsWith('file:')) {
    const raw = url.slice('file:'.length).split('?')[0].trim()
    if (raw && isAbsolute(raw)) return // explicit absolute SQLite path — respect it
  }
  const target = join(process.cwd(), 'db', 'custom.db')
  mkdirSync(dirname(target), { recursive: true })
  process.env.DATABASE_URL = 'file:' + target.split('\\').join('/')
}

ensureDatabaseUrl()

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
