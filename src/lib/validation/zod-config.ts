import { z } from 'zod'

/*
 * Zod's JIT parser compiles validators with `new Function`, and probes for it
 * once. The production Content-Security-Policy forbids eval (vercel.json:
 * script-src 'self'), so the JIT is disabled. This module must be imported
 * before any schema is created (first import in main.tsx).
 */
z.config({ jitless: true })
