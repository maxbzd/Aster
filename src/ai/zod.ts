import * as z from 'zod/v4'

/**
 * zod 4 compiles each schema into a function with `new Function` when the browser allows it. The content policy does
 * not (no `unsafe-eval`, and Trusted Types refuse string-to-code), so zod would try, fail and leave a violation report
 * on every start. "jitless" makes it validate without generating code; the difference is not measurable for schemas
 * this small.
 */
z.config({ jitless: true })

export * from 'zod/v4'
