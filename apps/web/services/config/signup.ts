import { getConfig } from './config'

// Prakto Akademi: nobody creates an account here. Accounts come from
// "Fortsätt med Prakto-konto" (or an admin), so every sign-up entry point is
// hidden and /signup redirects to /login. The API enforces the same rule with
// LEARNHOUSE_SELF_SIGNUP_DISABLED (apps/api/src/routers/users.py).
export const isSelfSignupDisabled = (): boolean =>
  getConfig('NEXT_PUBLIC_LEARNHOUSE_SELF_SIGNUP_DISABLED') === 'true'
