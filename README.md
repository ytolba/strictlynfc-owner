# StrictlyVision

StrictlyVision is the combined member and gym-owner iOS/Android app for Strictly’s connected fitness platform.

## What is included

### Member mode

- Guest-first entry backed by a Supabase anonymous session when available
- In-app NFC scanning plus a station-code fallback for iPad and non-NFC devices
- Native machine pages with video, instructions, muscle map, set logging, and personal history
- Separate exercise history for power racks and other multi-exercise stations
- Resumable daily workouts with sets, exercises, volume, and finish summaries
- Offline set queue with unique client IDs so retries do not create duplicates
- Vault Fitness Club as the first partner gym, with all 41 connected equipment entries
- Multiple preferred gyms, pounds/kilograms, Apple/Google/email account options, export, and in-app deletion

### Owner mode

- Existing invite-only owner authentication and gym switching
- Dashboard and usage analytics
- Machine management and demonstration-video uploads
- Owner/manager invitations
- NFC tag assignment, writing, and read-back verification

## Local development

This app uses native NFC and cannot run fully in Expo Go. Use a development build on a physical NFC-capable phone for tag reads/writes. The rest of the UI can be exercised in an iOS or Android simulator using the manual station-code path.

```sh
npm install
npx expo prebuild
npx expo run:ios --device
# or
npx expo run:android --device
```

Use Node 20.19.4 or newer. The project currently targets:

- iOS bundle: `com.strictlyinc.strictlyvision`
- Android package: `com.strictlyinc.strictlyvision`
- URL scheme: `strictlyvision://`

## Backend rollout

The paired Strictly Worker/Supabase update adds partner-gym discovery, cloud workout sessions, idempotent set synchronization, data export, account deletion, and the Apple/Android association endpoints. Apply the matching Supabase migration before deploying the Worker.

Before production App Link testing, set the Worker’s `ANDROID_APP_CERT_SHA256` environment value to the Play/App Signing SHA-256 fingerprint. The Apple association file already uses team ID `67A2H77882` and the StrictlyVision bundle identifier.

## Store readiness checklist

- Enable NFC Tag Reading and Sign in with Apple on the paid Apple Developer team.
- Configure the same iOS/Android identifiers in EAS, App Store Connect, Play Console, and OAuth providers.
- Add `strictlyvision://auth/callback` to the Supabase Auth redirect allow-list.
- Verify Google and Apple providers in Supabase production settings.
- Test guest, member, approved owner, revoked owner, and multi-gym accounts.
- Test `/t/...` and `/vaultclub/...` as cold and warm Universal/App Link launches.
- Provide reviewer demo accounts and use the manual station-code path so review does not require NFC hardware.
- Confirm privacy disclosures cover account details, workout history, NFC interactions, and analytics; no location permission is requested in v1.
