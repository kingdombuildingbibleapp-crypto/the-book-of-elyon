# Publishing The Book of Elyon on Google Play and the App Store

The apps are [Capacitor](https://capacitorjs.com) shells around the live site
(`capacitor.config.ts` points them at https://bookofelyon.org), the same way
the Kingdom Building Study Bible works. Website updates reach the apps at
once. Only native changes (name, icon, splash screen) need a new build.

| | |
|---|---|
| App name | Book of Elyon |
| Package / bundle ID | `org.bookofelyon.app` (can't change after the first upload) |
| Icon and splash sources | `assets/` (regenerate with `npx capacitor-assets generate`) |
| Privacy policy URL | https://bookofelyon.org/#privacy |
| Terms URL | https://bookofelyon.org/#terms |
| Support URL | https://bookofelyon.org |
| Category | Books & Reference (Google Play) / Reference or Books (Apple) |
| Price | Free, no ads, no in-app purchases |
| Copyright / publisher | © 2026 CoraMar Holdings, Inc. (use this in both stores' copyright and developer-name fields) |

## Accounts you need

- **Google Play Console:** https://play.google.com/console, a one-time $25 fee.
  New personal accounts must run a closed test with at least 12 testers for
  14 days before going to production.
- **Apple Developer Program:** https://developer.apple.com/programs, $99 a year.

## Build for Android (Google Play)

1. Install [Android Studio](https://developer.android.com/studio).
2. In `~/the-book-of-elyon`: `git pull && npm install && npx cap sync android && npx cap open android`
3. In Android Studio: **Build → Generate Signed App Bundle or APK → Android App Bundle**.
   Create a new upload key the first time and **back up the .jks file and its passwords**:
   without them you can never update the app.
4. Upload the `.aab` (in `android/app/release/`) in Play Console → your app → Testing → Closed testing.
5. For each update, raise `versionCode` (and `versionName`) in `android/app/build.gradle`.

## Build for iPhone and iPad (App Store)

1. Install Xcode from the Mac App Store.
2. In `~/the-book-of-elyon`: `git pull && npm install && npx cap sync ios && npx cap open ios`
3. In Xcode, select the **App** target → **Signing & Capabilities**, tick
   "Automatically manage signing" and choose your team.
4. Create the app in [App Store Connect](https://appstoreconnect.apple.com) with
   bundle ID `org.bookofelyon.app`.
5. In Xcode: choose **Any iOS Device**, then **Product → Archive → Distribute App → App Store Connect**.
6. In App Store Connect, add the build to TestFlight, then submit for review.
7. For each update, raise the version and build number in the App target's **General** tab.

## Store listing text

**Short description (Google, 80 characters max):**
Scripture in the order it was written, with Hebrew worship and daily study.

**Subtitle (Apple, 30 characters max):**
Scripture in the order written

**Full description:**

The Book of Elyon gathers 82 books (the Hebrew Bible, the Apocrypha, 1 Enoch,
Jubilees and the New Testament) and arranges them in the order scholars
believe they were written, from the oldest psalms to the letters of the
second century. Read straight through and watch a thousand years of
scripture unfold.

- Three public-domain translations: King James Version, Douay-Rheims, and R.H. Charles's Enoch and Jubilees
- An introduction to every book, with its date and the reasons behind it
- Double-tap any verse for a plain-language explanation and related passages
- Ask Me: ask questions about any verse, book or subject
- Today: a verse for the day, a word from a Hebrew or Messianic teacher, and worship sung in Hebrew
- Eight study plans, from the Four Gospels in 30 days to the whole book in a year
- 22 topics with their Hebrew words: Shalom, Covenant, Sabbath, the Names of God and more
- Your own notes on any verse, saved to your account

Free, with no ads.

**Keywords (Apple, 100 characters):**
bible,scripture,enoch,jubilees,apocrypha,hebrew,chronological,kjv,study,devotional,messianic

## Screenshots

Take them from the website in a phone-sized browser window, or on a phone or
simulator: the cover, a chapter, a verse breakdown, Today, Study Plans and a topic.

- Google: at least 2 phone screenshots, plus a 1024 × 500 feature graphic.
- Apple: 6.9" iPhone screenshots (1320 × 2868), and 13" iPad ones if iPad stays enabled.

## Privacy questions in the store consoles

Answer from https://bookofelyon.org/#privacy:

- **Data collected (only with an account):** name, email address, and user
  content (notes, study plan progress). Used for app functionality and
  account management. Not shared or sold, not used for tracking, encrypted
  in transit.
- **AI questions:** sent to Anthropic to generate the answer and not stored
  with the user's identity.
- **Account deletion:** in the app (account menu → Delete account) and by
  email. Google also asks for a deletion web URL: https://bookofelyon.org/#privacy
- **Ads:** none. **Tracking:** none (Apple: "Data Not Used to Track You").
- **Sign-in for reviewers:** create a demo account on the site and give
  its email and password in the review notes.

## Review notes for Apple (guideline 4.2, minimum functionality)

Apple sometimes rejects apps that are "just a website". When you submit,
point out what goes beyond a website: accounts with synced notes and study
plan progress, AI verse explanations, the Today page, and an offline screen
(`app-shell/`) when there's no connection.
