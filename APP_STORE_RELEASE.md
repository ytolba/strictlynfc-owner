# StrictlyVision App Store release

## Review notes

StrictlyVision has two entry paths: member and invited gym owner. Member mode works without creating a permanent account. On an iPad or device without NFC, tap **Scan a machine** on Today. The QR code scanner opens; tap **Enter the station code instead**, enter station code **14**, and tap **Open station**. The camera is used only to read QR codes on gym equipment.

Apple Health is optional. The authorization request is reached only from **I’m training → Profile → Apple Health → Connect**. Connect opens the system permission request immediately; there is no custom skip or dismiss action. StrictlyVision reads workout time, heart rate, and active energy and can write a completed strength workout after the member finishes it. Turning the connection off in Profile stops future Health reads and writes inside StrictlyVision.

Location is optional and requested only after **Gyms → Use my location**. Members can browse gyms without granting location.

Permanent and automatically created guest accounts can be deleted in **Profile**. Signed-in members can also export their data there. Invited owners can delete their account directly in **Owner tools → Account → Delete account**.

Owner tools are invite-only. Provide App Review with an approved owner demo account if owner screens are included in the submitted build.

## App Store Connect checklist

- App name and screenshots describe **StrictlyVision**, not StrictlyNFC Owner.
- Privacy Policy URL: `https://strictlyinc.com/privacy`
- Support URL: `https://strictlyinc.com/support`
- Declare workout history, user ID/account data, product interaction, precise location when requested, and Health/Fitness data exactly as used.
- Mark data as **not used for tracking**. The app contains no advertising SDK and does not use ATT.
- Explain that Health data is used only to provide the member's workout history and is not used for advertising or marketing.
- Do not list subscriptions or in-app purchases; this app contains no purchase flow.
- Supply the owner demo credentials and station code **14** in Review Information.
- Confirm the Apple Health, Sign in with Apple, NFC Tag Reading, and Associated Domains capabilities are enabled for `com.strictlyinc.strictlyvision`.
- Upload iPhone and iPad screenshots showing the member experience, not only login or splash screens.

## Before upload

Run `npm run typecheck`, `npx expo-doctor`, and a Release archive in Xcode. Test guest logging while offline, finishing a workout, account deletion, declined Health access, declined location access, station code 14 on iPad (via the QR scanner's code entry), camera permission declined, and owner login with the review account.
