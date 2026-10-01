# Cash Poker Trainer guide

This is an unofficial, non-commercial adaptation of [Poker by Tehes](https://github.com/Tehes/poker),
originally created by Tino Sabetta. It is a modified version and is not affiliated with or
endorsed by the original creator.

This version supports 2–6 seat no-limit Texas Hold'em cash practice with one human and
rule-based bot opponents. It uses play chips, fixed blinds, and no rake. Bots are opponents for
practice, not strategy graders.

## Play

1. Open the published Cash Poker Trainer website and sign in with Google or email/password.
   A new email/password account must verify its address before play.
2. Remove unwanted seats with the seat close controls. Enter your name at one seat and press
   **Start Cash Session** to play; unnamed seats become bots. Starting without a name asks you to
   enter one. To watch a full six-bot table, choose **Menu → Watch 6 bots** instead. Each bot
   receives one of four random styles at session start and keeps it for the session, including
   after a saved game is continued.
3. Set an even big blind; the small blind is half of it. Choose a buy-in depth from 20 to 500 BB and optional between-hand top-up
   threshold. Start the session. Use **Menu** in the top right to pause after a hand, resume, top up,
   or end the session. During a hand, **End after hand** finishes that hand before cashing out;
   the menu can cancel a scheduled end. The center of the table keeps the current hand controls.

Menu shows **Bot pace** (Natural / Instant) and **Sound** (On / Off) as visible choices. With
Instant selected, folding your only human seat quickly finishes the remaining bot play and shows
**New Hand** or **New sample**. Menu rows with an arrow open another view or play mode.

With automatic top-up off, running out of chips opens a prompt after the hand. **Top up** refills
your stack to the configured buy-in without starting another hand. **Not now** leaves the session
between hands; choosing **New Hand** while still out of chips opens the prompt again.

During your turn, the **Pot size** shortcuts set 10%, 33%, 50%, 100%, or 150% of the pot. Facing a
bet, the percentage applies to the pot after your call, then adds that call to the amount you must
put in. Sizes below the minimum legal bet or raise are disabled; sizes above the contestable cap
use the maximum legal amount. A shortcut only sets the slider and action label—you still confirm
with the action button.

Facing the first preflop raise, the shortcuts change to **3× open** and **4× open**. These set the
total raise-to amount to three or four times the current open, including any blind you already
posted. An unavailable size is disabled. **All-in** selects your full stack when legal; when the
opponents' remaining stacks cap your raise, the shortcut reads **Max**. These are amount choices,
not strategy recommendations, and still require pressing the action button.

When all betting is complete with at least two live players and cards still to come, your live
seat can choose **Run Once** or **Run Twice**. Two runs keep any board cards already dealt, then
deal different remaining cards from the same deck. Each contested pot, including side pots, is
split between the boards before winners are determined. An odd chip goes to the first board.
Hands where your seat has folded, and bot-only tables, run once automatically.

## Review and backup

After a hand with a net chip loss, the result prompt offers **New Hand** and **Copy Text**. You can
still open the hand from Menu later.

After a hand, open **Menu → Hand history & replay**. Choose a session and hand, then use the replay
slider or event list to revisit the hand. The replay skips hole-card notifications; each step shows
the board and actions known at that time, your own dealt cards once dealt, and only opponent cards
already revealed. Open **Hand text** to add a color
tag and note, then use **Copy Text** to paste the selected hand into an LLM conversation, or
**Download .txt**. The text shows the hero's cards, public board,
actions, chip amounts and BB equivalents, and only opponent cards that were actually revealed.
Two-run hands show both boards and their per-board pot results in replay and hand text.

## Similar spot practice

In replay, select one of your action events and choose **Mark this decision**. A marked first-in
preflop decision can start **Practice similar samples** after the current hand finishes. The first
supported spots have an unopened pot: earlier opponents may only have folded. Their prior folds
are scripted to recreate that public situation. Similarity uses seat count, position, each seat's
starting stack and bot style, blinds, pot, amount to call, and the ordered prior folds. Each sample
restores those conditions, then shuffles a fresh deck; hole cards are not matched. After your
decision, bots play normally.
Choose **New sample** after the hand to reset the situation, or **Menu → Return to free table**.
Other decision types can be marked for review but do not yet start practice.

Practice has its own saved continuation. Local practice hand histories record the sample number,
reset count, and deck seed. Seat-view JSON backups and copied hand text keep the mode, source,
filters, and sample identity but omit the seed because it could reveal unrevealed cards. The seed
describes the fresh deck, not the bot's later random choices. Practice stacks are play samples and
never change the free-table bankroll or net result. There is no strategy grade or GTO score.
Completed old hands do not contain enough hidden state to branch the original hand exactly.

The same panel contains **JSON backup and restore**. The backup includes all completed hands on
this browser profile and their saved tags, notes, decision marks, and practice labels. It is meant
for preserving this app's history before clearing browser data or changing devices. Restore accepts
this app's backup format, validates hands and annotations, and adds missing records without overwriting existing hands or
notes. Older backups without annotations remain valid. This import is not a general poker-site hand
history importer. Restored hands appear in the session and hand selectors.

With the default placeholder configuration, hand histories and notes live in this browser's
IndexedDB; an unfinished session also has a local continuation snapshot. When Firebase is
configured, a verified account keeps these records in separate local account storage and syncs
them across devices through Firestore. See [FIREBASE-RELEASE.md](FIREBASE-RELEASE.md) for setup,
deployment, and conflict handling. Export a JSON backup before clearing site data. Complete
audit data and unrevealed opponent cards are not included in the hero-view backup.

## Phone release status

The table has a phone layout and an installable web app manifest. A hosted HTTPS link will let a
phone open it without the development computer running. On iPhone, open that link in Safari and
choose **Share → Add to Home Screen**; on Android, use the browser's install or home-screen option.
The app can continue offline after its assets have been cached on that device.

Account login and cross-device sync are implemented behind Firebase configuration. Until a Firebase
project is configured, deployed, and tested on two devices, browser storage remains isolated by browser profile. The
JSON backup can move completed hand histories manually but does not carry a live session.

## Scope

The private training mode does not connect to the original project's remote multiplayer service.
There is no rake, automatic GTO scoring, or LLM-controlled seat in this version.
