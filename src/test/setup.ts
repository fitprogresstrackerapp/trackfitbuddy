import { configure } from '@testing-library/react'

/*
 * Page tests render the real router, so the first test of a file cold-loads a
 * lazy route chunk. Under a full parallel run that can take longer than
 * Testing Library's 1 s default wait and fail a correct test, and on a cold
 * transform cache (fresh checkout, CI) it can take several seconds. Assertions
 * are unchanged; they only get a realistic time to become true. The matching
 * per-test limit is `testTimeout` in vitest.config.ts.
 */
configure({ asyncUtilTimeout: 15_000 })
