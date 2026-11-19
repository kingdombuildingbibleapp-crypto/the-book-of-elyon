# Store assets for The Book of Elyon

Made from the real site (bookofelyon.org) with a demo account that has
Elyon Plus. The AI answers shown are samples written to match what the
app produces. Rebuild them after big design changes.

## Apple App Store (App Store Connect → your app → version → Previews and Screenshots)

| Folder / file | Where it goes |
|---|---|
| `apple-iphone-6.9in/` (7 × 1320×2868) | **iPhone 6.9" Display**. Apple scales these down for smaller iPhones. |
| `apple-ipad-13in/` (7 × 2064×2752) | **iPad 13" Display**. Required while the app supports iPad. |
| `videos/apple-app-preview-iphone-886x1920.mp4` | **App Preview** for iPhone 6.9" (29.5 s, H.264, 30 fps). Optional, up to 3 per size. |

The app icon (1024×1024) is already in the Xcode project (`ios/App/App/Assets.xcassets`).

## Google Play (Play Console → Grow → Store presence → Main store listing)

| Folder / file | Where it goes |
|---|---|
| `google-play-graphics/app-icon-512.png` | **App icon** (512×512) |
| `google-play-graphics/feature-graphic-1024x500.png` | **Feature graphic** (required) |
| `google-play-phone/` (7 × 1080×1920) | **Phone screenshots** (2 to 8) |
| `google-play-tablet-10in/` (7 × 1600×2560) | **10-inch tablet screenshots** (optional). Can also be used for 7-inch tablets. |
| `videos/youtube-promo-1920x1080.mp4` | Upload to YouTube (Public or Unlisted, ads off), then paste the YouTube link in **Video**. Google Play only accepts YouTube links. |

## Screenshot order and captions

1. Scripture in the order it was written
2. Double-tap any verse to understand it
3. A thousand years of scripture, straight through
4. A verse, a word and Hebrew worship every day
5. Ask anything about a verse, a book or a word
6. Study plans that keep your place
7. 108 names of God

The listing text (descriptions, keywords) is in `docs/APP-STORES.md`.
