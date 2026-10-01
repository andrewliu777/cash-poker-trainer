# Firebase release

The project has no build step. Firebase Hosting serves the static files in this directory. A local edit stays local until you deploy it. After a successful deploy, the public `PROJECT_ID.web.app` site uses the new files; anyone with the link can create an account, and Firestore rules keep each account's records private.

## Local development

On a Mac with Python 3, double-click `start-local.command` or run `python3 -m http.server 8877 --bind 127.0.0.1` in this directory. Open `http://127.0.0.1:8877/`. A `file://` address can block JavaScript modules, leaving Menu and table controls inactive. Data stored under the file address does not automatically appear at the local HTTP address. Google sign-in on localhost may also require adding the development host in Firebase Authentication's authorized domains; the hosted address is the release target.

## One-time setup

1. Create a Firebase project on the Spark plan. Add a Web app and copy its **project ID** and **Web API key** into `js/training/firebaseConfig.js`. These are public client configuration values; do not put service-account credentials here.
2. In Authentication, enable **Email/Password** and **Google**. In Firestore Database, create the default database. Enable the default Hosting site. Do not enable test-mode rules for release.
3. Install the Firebase CLI on your computer and run `firebase login`.
4. In this directory, run:

   ```sh
   firebase deploy --only hosting,firestore:rules --project PROJECT_ID
   ```

The first deployment must include the rules. Check that another signed-in account cannot read documents under `users/{your_uid}/hands` or `users/{your_uid}/state` before sharing the link.

## Each later update

From this directory:

```sh
firebase deploy --only hosting --project PROJECT_ID
```

To update the database rules, include `firestore:rules` again. A GitHub-based automatic deploy is optional; this repository does not require it.

## Data behavior

- The app requires a verified email account when Firebase is configured. Email/password accounts use an email verification link; Google accounts are verified by the provider. On a previously signed-in device, the saved account can still play offline; pending changes sync when the connection returns and **Sync now** is used.
- On phones, use the `PROJECT_ID.firebaseapp.com` Hosting address for Google redirect sign-in. Other Hosting addresses use the Google popup flow.
- Completed hands and notes are stored under the account's Firestore path. Active sessions are synced separately for the free table and each practice link. If two devices edit the same active session, the Account menu asks which copy to keep.
- Old unscoped browser data stays on the device. Each account can explicitly import it once. A sign-out does not delete local account data, so the same account can resume offline later.
- Export hand histories regularly as a backup. A Firestore document cannot exceed 1 MiB; unusually large single-hand records will fail to sync and show an error in the Account menu.
- Different devices share data through Firestore when online. Separate users on the same browser should use separate accounts. Browser preferences, such as sound and bot pace, remain local to each device.

Real sign-in, rules, and two-device sync need a Firebase project to test; placeholder configuration leaves the existing local-only app working.

Firebase references: [Hosting quickstart](https://firebase.google.com/docs/hosting/quickstart/),
[CLI setup](https://firebase.google.com/docs/cli),
[Firestore REST authentication](https://firebase.google.com/docs/firestore/use-rest-api), and
[Security Rules with Auth](https://firebase.google.com/docs/rules/rules-and-auth).
