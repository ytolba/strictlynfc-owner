# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

- Gym members who want to tap a machine, learn it, log sets, and keep progress without first creating an account.
- Approved gym owners and staff who manage machines, NFC tags, videos, invitations, and floor analytics.
- Strictly administrators who onboard partner gyms and preserve secure tenant boundaries.

## Product Purpose

StrictlyVision turns physical gym equipment into a connected workout experience. Members tap or scan an NFC tag to open the correct machine, understand how to use it, log work, and retain exercise-specific history. Owners use the same app to operate their connected equipment system and understand how their floor is used.

Success means the member flow is faster than manually finding an exercise, owner access remains invite-only, and one account can switch roles without weakening gym authorization.

## Positioning

StrictlyVision connects a real machine identity, a member's exercise history, and gym-level operational intelligence through one NFC layer while keeping a useful web fallback.

## Operating Context

- Members use the app one-handed on a busy gym floor, often with poor connectivity and only seconds between sets.
- An NFC scan determines the physical gym and machine; multi-exercise stations ask for the movement separately.
- The first saved set starts a resumable workout. Finishing produces a concise workout summary.
- Owners configure equipment, program NTAG stickers on NFC-capable phones, and review usage from the same authenticated account.
- Vault Fitness Club is the first public partner gym and supplies the initial 41-equipment catalog and black/gold machine branding.

## Capabilities and Constraints

- Opening choice: “I’m training” or “I manage a gym.”
- Member mode supports Supabase anonymous identities, email and social account upgrades, NFC scanning, manual station codes, daily workouts, history, preferred gyms, units, export, and deletion.
- Owner mode preserves the current dashboard, analytics, machine management, video uploads, invitations, and NFC programming.
- Owner access is determined only by active `gym_memberships` authorization or protected application metadata, never editable user metadata.
- Existing `/t/...` and `/vaultclub/...` URLs remain valid browser fallbacks and become verified native deep links when the app is installed.
- Offline set logs carry unique client IDs and synchronize without duplication.
- V1 does not request location permission. Partner gyms are browsed from known public locations.
- iOS and Android identifiers are `com.strictlyinc.strictlyvision`.

## Brand Commitments

- Product name: StrictlyVision.
- The overall shell uses Strictly’s established strictlyinc.com identity — near-black #08090A, off-white #F4F5F4, Space Grotesk, and lime #CDF564 reserved for primary actions and live data — with the existing minimal StrictlyVision mark.
- Machine experiences adopt the selected gym’s logo and accent colors without replacing the familiar Strictly navigation and interaction model.
- Copy is direct, calm, athletic, and operational. Avoid hype and unexplained technical language.

## Evidence on Hand

- Existing owner-only Expo app and production owner APIs.
- Existing StrictlyVision icon and mark assets in `assets/`.
- Existing web NFC member experience and backward-compatible NFC routes on strictlyinc.com.
- Vault Fitness Club’s equipment catalog, exercise instructions, muscle data, and current demonstration coverage in the Strictly website repository.
- No new testimonials, performance claims, or physical-gym membership claims may be invented.

## Product Principles

1. A scan should reach useful action in seconds.
2. Guest use is real use; account creation protects progress rather than gating the product.
3. Physical station identity and selected exercise identity stay separate.
4. Owner power never leaks into member authentication.
5. Offline and missing-media states are honest, recoverable, and never endless.

## Accessibility & Inclusion

- Support iOS Dynamic Type and Android font scaling without clipping critical actions.
- Maintain 44 pt iOS and 48 dp Android touch targets.
- Do not rely on color alone for state, equipment status, or muscle-map meaning.
- Provide manual station entry for iPads and devices without NFC.
