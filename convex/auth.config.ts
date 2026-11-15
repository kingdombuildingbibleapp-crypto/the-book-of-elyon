// Tells Convex to trust the sign-in tokens Convex Auth issues. Without this
// file every reader looks signed out.
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
