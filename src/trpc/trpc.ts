import { initTRPC } from '@trpc/server'

const t = initTRPC.create()

export const router = t.router
export const publicProcedure = t.procedure
// privateProcedure is now the same as publicProcedure since auth is removed
export const privateProcedure = t.procedure
