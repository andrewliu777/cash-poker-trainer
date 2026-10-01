# Firebase release

The project has no build step. Firebase Hosting serves the static files in this directory. A local edit stays local until you deploy it. The published sites are [cash-poker-trainer.web.app](https://cash-poker-trainer.web.app) and [cash-poker-trainer.firebaseapp.com](https://cash-poker-trainer.firebaseapp.com). Anyone with the link can create an account; Firestore rules keep each account's records private.

## Local development

On a Mac with Python 3, double-click `start-local.command` or run `python3 -m http.server 8877 --bind 127.0.0.1` in this directory. Open `http://127.0.0.1:8877/`. A `file://` address can block JavaScript modules, leaving Menu and table controls inactive. Data stored under the file address does not automatically appear at the local HTTP address. Google sign-in on localhost may also require adding the development host in Firebase Authentication's authorized domains; the hosted address is the release target.

## One-time setup

1. Create a Firebase project on the Spark plan. Add a Web app and copy its **project ID** and **Web API key** into `js/training/firebaseConfig.js`. These are public client configuration values; do not put service-account credentials here.
2. In Authentication, enable **Email/Password** and **Google**. In Firestore Database, create the default database. Enable the default Hosting site. Do not enable test-mode rules for release.
3. For Google sign-in on `cash-poker-trainer.web.app`, confirm that domain is listed in Authentication → Settings → Authorized domains. In Google Cloud Console → Google Auth Platform → Clients, edit this project's existing Web OAuth client: add `https://cash-poker-trainer.web.app/__/auth/handler` to **Authorized redirect URIs** and `https://cash-poker-trainer.web.app` to **Authorized JavaScript origins**. Keep the existing `firebaseapp.com` entries.
4. Install the Firebase CLI on your computer and run `firebase login`.
5. In this directory, run:

   ```sh
   firebase deploy --only hosting,firestore:rules --project cash-poker-trainer
   ```

The first deployment must include the rules. Check that another signed-in account cannot read documents under `users/{your_uid}/hands` or `users/{your_uid}/state` before sharing the link.

## Public configuration and credential alerts

`js/training/firebaseConfig.js` is public browser configuration and is served to every visitor. Firebase permits its Web API key to be checked into source control; it does not authorize access to account records. Firestore Security Rules enforce that access. Do not put service-account JSON, OAuth client secrets, private keys, or user tokens in this file.

If GitHub flags the Web API key, review it in Google Cloud Console → APIs & Services → Credentials. Confirm that **API restrictions** restrict it to Firebase-related APIs required by this app. Keep the required Authentication and Firestore APIs; do not allow unrelated services such as **Generative Language API** on this public key. Do not close the alert solely because the key appears in Firebase configuration. See [Firebase's API-key guidance](https://firebase.google.com/docs/projects/api-keys).

`.gitignore` excludes common private credential files from new commits. Hosting has its own exclusions because it can publish files that Git ignores. Neither exclusion removes previously committed secrets from Git history. If a private credential is exposed, revoke or rotate it before removing it from source and history.

### Restrictions applied to this project

The Browser key's API allowlist was reduced to Cloud Datastore, Cloud Firestore, Firebase App Check, Firebase Management, Firebase Rules, Identity Toolkit, and Token Service. Its website allowlist is:

- `https://cash-poker-trainer.web.app/*`
- `https://cash-poker-trainer.firebaseapp.com/*`
- `http://localhost:8877/*`
- `http://127.0.0.1:8877/*`

The local addresses are for development; a separate Firebase development project is preferable before broader public use. Other local ports, `file://`, and other hosting domains will not pass the key restriction. Do not widen this list to all websites to fix a login error. Browser referrer checks reduce misuse from other websites but can be spoofed by direct HTTP clients.

Identity Toolkit `Queries per minute` is limited to **600 per project** and `Queries per minute per user` to **30**. These are service quotas, not an app-level account throttle. Google's default quota identity is the authenticated principal, falling back to the client IP when none is available; users behind a shared network can share that bucket ([quota documentation](https://docs.cloud.google.com/apis/docs/capping-api-usage)). They bound request volume, but an attacker can still consume a quota and affect legitimate sign-in. Review these values if the user base grows. The project remains on Spark; do not attach billing or upgrade to Blaze as part of security setup.

### App Check rollout

The project's Web app was registered with a production score-based reCAPTCHA Enterprise key on 2026-10-01, and its public site key is configured in source. **Firestore and Authentication enforcement remain off until the updated client is deployed and real-device requests are verified.** Registration alone does not block abuse. For forks, an empty `FIREBASE_APP_CHECK_SITE_KEY` means App Check is not active.

1. Enable reCAPTCHA Enterprise API and accept its service terms. Create a **score-based Web site key** with domain verification enabled, allowing only `cash-poker-trainer.web.app` and `cash-poker-trainer.firebaseapp.com`. Do not enable testing mode or turn off domain verification. Stay within the provider's free quota without attaching billing.
2. Register the Web app in Firebase → App Check using that site key. Keep the default one-hour token TTL and initial risk threshold. Set the public site key in `js/training/firebaseConfig.js`, and confirm `FIREBASE_WEB_APP_ID` matches the registered app.
3. Deploy Hosting first while Firestore remains in monitoring mode. The client initializes App Check before Google Auth and sends `X-Firebase-AppCheck` on the REST authentication, token refresh, and Firestore requests. It stops cloud requests if configured attestation fails. Previously verified local accounts can still play offline.
4. Test email/password and Google login, restore after reload, and cloud sync on desktop and iPhone Chrome. Confirm verified requests appear in App Check metrics. Then enable enforcement for **Cloud Firestore**. Confirm requests without valid App Check tokens are rejected and normal sync still works.
5. Authentication enforcement additionally requires **Firebase Authentication with Identity Platform**. Review that upgrade's free-plan limits and terms before enabling it; it is separate from the Blaze billing upgrade. Do not describe authentication as App Check protected until its enforcement is enabled and tested.

For localhost after App Check is configured, create and register a private debug token in App Check's Web app menu. Store it only in the local browser's session storage under `poker:app-check-debug-token:v1`, then reload. Do not put the debug token in source, commit it, or allow localhost in the production reCAPTCHA key. Clear the session-storage value after testing. Production hosts never read this local debug setting.

App Check is an abuse-reduction layer, not proof that every requester is benign. Keep verified-email, owner-only Firestore rules in place and leave unused login providers disabled. See [App Check Web setup](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider) and [Firebase Auth security guidance](https://firebase.google.com/docs/auth/faq-and-troubleshooting#app-check).

## Each later update

From this directory:

```sh
firebase deploy --only hosting --project cash-poker-trainer
```

To update the database rules, include `firestore:rules` again. A GitHub-based automatic deploy is optional; this repository does not require it.

## Data behavior

- The app requires a verified email account when Firebase is configured. Email/password accounts use an email verification link; Google accounts are verified by the provider. On a previously signed-in device, the saved account can still play offline; pending changes sync when the connection returns and **Sync now** is used.
- On phones, use `cash-poker-trainer.web.app` for Google redirect sign-in after its OAuth callback is authorized. The app uses the same domain for its Firebase auth handler there. Desktop browsers use the Google popup flow.
- Completed hands and notes are stored under the account's Firestore path. Active sessions are synced separately for the free table and each practice link. If two devices edit the same active session, the Account menu asks which copy to keep.
- Old unscoped browser data stays on the device. Each account can explicitly import it once. A sign-out does not delete local account data, so the same account can resume offline later.
- Export hand histories regularly as a backup. A Firestore document cannot exceed 1 MiB; unusually large single-hand records will fail to sync and show an error in the Account menu.
- Different devices share data through Firestore when online. Separate users on the same browser should use separate accounts. Browser preferences, such as sound and bot pace, remain local to each device.

Verify email/password, Google sign-in, two-device sync, and cross-account isolation with real accounts before relying on cloud copies alone.

Firebase references: [Hosting quickstart](https://firebase.google.com/docs/hosting/quickstart/),
[CLI setup](https://firebase.google.com/docs/cli),
[Firestore REST authentication](https://firebase.google.com/docs/firestore/use-rest-api), and
[Security Rules with Auth](https://firebase.google.com/docs/rules/rules-and-auth).
