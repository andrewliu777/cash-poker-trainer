# Cash Poker Trainer

**An unofficial, non-commercial adaptation of [Poker by Tehes](https://github.com/Tehes/poker), originally created by Tino Sabetta.** This project changes the original game into a cash poker practice table. It is not affiliated with or endorsed by the original creator.

Cash Poker Trainer is a browser-based no-limit Texas Hold'em trainer for 2–6 seats. Play against rule-based bots or watch a six-bot table. The chips are for practice; there is no rake or real-money play.

## What you can do

- **Play cash sessions:** choose the big blind, buy-in depth and top-up settings. The small blind is half the big blind. Bot pace and sound are adjustable during play.
- **Practice all-in decisions:** when betting is complete and cards remain, choose to run the board once or twice. Both runs use undealt cards from the same deck, and contested pots are split across the boards.
- **Review hands:** step through actions on a table replay, inspect session statistics, add notes and marks, and copy or download a hand history. A losing hand offers **Copy Text** at the result screen.
- **Revisit similar spots:** mark a supported first-in preflop decision and practice fresh hands from the same public table situation. These samples do not change the free-table bankroll.
- **Keep your records:** sign in with Google or a verified email/password account to sync completed hands, notes, and active sessions through Firebase. You can also export and restore a JSON backup.

The bots use heuristics. **This app does not contain a solver or grade decisions against GTO solutions.**

## Play on a phone

The hosted web app can be opened in a phone browser without leaving a computer running. On iPhone, open it in Safari and choose **Share → Add to Home Screen**. On Android, use the browser's install or home-screen option. After the first online load, the app's cached assets can open offline; account changes sync when a connection returns.

Sign in to the **same Firebase account** on each device to share records. Email/password and Google accounts are identified by Firebase user ID; using the same email with two sign-in methods does not by itself guarantee that they are linked. Browser preferences such as sound and bot pace stay on each device. If two devices change the same active session, the app asks which copy to keep.

## More information

- [Player guide](README-cash-trainer.md): controls, replay, similar-spot practice, backups, and data behavior.
- [Firebase release guide](FIREBASE-RELEASE.md): configuration, security rules, and deployment.

## Original project and license

This modified version gives prominent credit to [Poker by Tehes](https://github.com/Tehes/poker) and its original author, **Tino Sabetta**, in this README and in the app. The original project's [Tehes Poker Source-Available License](LICENSE.txt) remains in the repository. It permits personal, educational, and non-commercial use under its terms, including attribution for public redistribution. This is a source-available license, not an open-source license.
