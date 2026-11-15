import Resend from "@auth/core/providers/resend";
import { Resend as ResendAPI } from "resend";
import { generateRandomString, type RandomReader } from "@oslojs/crypto/random";

// "Forgot password?": emails an 8-digit code through Resend.
// Needs AUTH_RESEND_KEY on the Convex deployment (set it with
// `npx convex env set AUTH_RESEND_KEY=re_... --prod`); never in source or the page.
// Sends from bookofelyon.org, which must be verified in Resend.
const FROM = "The Book of Elyon <noreply@bookofelyon.org>";

export const ResendOTPPasswordReset = Resend({
  id: "resend-otp-password-reset",
  apiKey: process.env.AUTH_RESEND_KEY,
  maxAge: 15 * 60, // the code works for 15 minutes
  async generateVerificationToken() {
    const random: RandomReader = {
      read(bytes) {
        crypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>);
      },
    };
    return generateRandomString(random, "0123456789", 8);
  },
  async sendVerificationRequest({ identifier: email, provider, token }) {
    const resend = new ResendAPI(provider.apiKey);
    const { error } = await resend.emails.send({
      from: FROM,
      to: [email],
      subject: "Your Book of Elyon password reset code",
      text:
        `Shalom,\n\nYour password reset code is: ${token}\n\n` +
        `Enter this code on bookofelyon.org to choose a new password. It works for 15 minutes.\n\n` +
        `If you didn't ask to reset your password, you can ignore this email; your password stays the same.\n\n` +
        `The Book of Elyon`,
      html:
        `<div style="font-family:Georgia,serif;max-width:480px;margin:auto;color:#2a2520">` +
        `<p style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#8a5a2b">The Book of Elyon</p>` +
        `<p>Shalom,</p><p>Your password reset code is:</p>` +
        `<p style="font-size:30px;letter-spacing:.2em;font-weight:bold;color:#8a5a2b">${token}</p>` +
        `<p>Enter this code on <a href="https://bookofelyon.org" style="color:#8a5a2b">bookofelyon.org</a> to choose a new password. It works for 15 minutes.</p>` +
        `<p style="color:#7a6f62;font-size:14px">If you didn't ask to reset your password, you can ignore this email; your password stays the same.</p></div>`,
    });
    if (error) throw new Error("Could not send the password reset email.");
  },
});
