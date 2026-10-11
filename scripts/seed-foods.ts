/**
 * Loads the starter food catalogue (supabase/seeds/starter-foods.json) into the
 * shared food database. A one-time operator action on a trusted machine; it is
 * never run by a migration, a deployment or the app.
 *
 *   npm run foods:seed -- --local --dry-run     # local stack: list what would be added
 *   npm run foods:seed -- --local
 *
 *   # Hosted project: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment
 *   npm run foods:seed -- --dry-run
 *   npm run foods:seed
 *
 * Idempotent: foods that already exist (same name) are skipped, never changed.
 * Foods are added as approximate values. Nothing is deleted.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { createClient } from '@supabase/supabase-js'

import type { Database } from '../src/types/database.ts'
import { catalogueSchema, inconsistentFoods, seedFoodCatalogue } from './lib/food-catalogue.ts'
import { readLocalServerEnv } from './lib/local-env.ts'

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      local: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
  })

  const file = resolve(import.meta.dirname, '../supabase/seeds/starter-foods.json')
  const catalogue = catalogueSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
  const inconsistent = inconsistentFoods(catalogue.foods)
  if (inconsistent.length > 0) {
    throw new Error(`Calories do not match the macros for: ${inconsistent.join(', ')}`)
  }

  let url: string
  let serviceRoleKey: string
  if (values.local) {
    const env = readLocalServerEnv()
    url = env.supabaseUrl
    serviceRoleKey = env.serviceRoleKey
  } else {
    url = process.env.SUPABASE_URL ?? ''
    serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
    if (!url || !serviceRoleKey) {
      throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or pass --local)')
    }
  }

  const db = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const result = await seedFoodCatalogue(db, catalogue.foods, { dryRun: values['dry-run'] })

  const target = new URL(url).host
  if (values['dry-run']) {
    console.log(`Dry run against ${target}: ${String(result.added.length)} foods would be added.`)
    for (const name of result.added) console.log(`  + ${name}`)
  } else {
    console.log(`Added ${String(result.added.length)} foods to ${target}.`)
  }
  console.log(`${String(result.skipped)} already present and left unchanged.`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unexpected error')
  process.exitCode = 1
})
