import { configure } from '@testing-library/react'

/*
 * Page tests render the real router, so the first test of a file cold-loads a
 * lazy route chunk. Under a full parallel run that can take longer than
 * Testing Library's 1 s default wait and fail a correct test. Assertions are
 * unchanged; they only get a realistic time to become true.
 */
configure({ asyncUtilTimeout: 5000 })
