import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

// Email and password accounts. The sign-up form also sends a name, kept on
// the user's profile so the site can greet them.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        return {
          email: String(params.email ?? "").trim().toLowerCase(),
          name: String(params.name ?? "").trim().slice(0, 80),
        };
      },
    }),
  ],
});
