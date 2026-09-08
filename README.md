# StrictlyNFC Owner

Invite-only iOS and Android companion app for Strictly partner gyms. It uses the same Supabase gym memberships and Cloudflare owner APIs as the web dashboard.

## Owner flow

1. Strictly approves or invites an owner account.
2. The owner signs in and selects their gym.
3. They choose an existing machine or add one from the equipment catalog.
4. The app reserves a public machine URL, writes it to an NTAG215 sticker, then reads the sticker back.
5. The tag is marked active only after the URL is verified.
6. Members tap the sticker and open the existing fast web machine experience. They do not need the owner app.

## Local device build

This app uses native NFC and cannot run in Expo Go. Use a development build on a physical NFC-capable phone.

```sh
npm install
npx expo prebuild
npx expo run:ios --device
# or
npx expo run:android --device
```

Use Node 20.19.4 or newer.

## Store builds

```sh
npx eas-cli login
npx eas-cli build:configure
npx eas-cli build --platform ios --profile production
npx eas-cli build --platform android --profile production
```

The current identifiers are:

- iOS: `com.strictlyinc.nfcowner`
- Android: `com.strictlyinc.nfcowner`

Before submitting, create the matching app records, confirm the NFC capability is enabled for the Apple identifier, connect EAS credentials, and test write + verify with a physical NTAG215 sticker on both platforms.

## Data and security

- No public sign-up is exposed.
- Supabase sessions are stored in the platform app sandbox.
- Every owner API call uses the signed-in access token.
- The backend validates active gym membership and requires owner/manager access for changes.
- The Supabase publishable key in the app is intentionally public; privileged credentials remain on the server.
