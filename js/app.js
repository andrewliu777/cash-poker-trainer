/* ==================================================================================================
MODULE BOUNDARY: Main Table Runtime
================================================================================================== */

// CURRENT STATE: Coordinates browser-facing game flow, bots, sync, local persistence, timers,
// analytics, and DOM effects. Showdown resolution/commit state, hand-end/next-hand transition
// state, browserless hand/tournament runners, hand-start setup, turn-action resolution,
// betting-round start state, betting-round progress decisions, and street progression decisions
// are extracted; browser orchestration remains here.
// TARGET STATE: app.js should stay as the browser-facing orchestrator only. Pure poker rules and
// state transforms should live in gameEngine.js, while reusable UI, sync, and control primitives
// should live in shared/*.
// PUT HERE: Engine orchestration, notifications, timers, sync, local save/restore, analytics, bot
// playback, and flow-specific DOM wiring.
// DO NOT PUT HERE: Pure poker rules, reusable action math, sync schema helpers, or generic
// render-only helpers.
// PREFERENCE: Extend the existing modules before introducing new ones.

/* --------------------------------------------------------------------------------------------------
Imports
---------------------------------------------------------------------------------------------------*/

import {
	enqueueBotAction,
	normalizeBotActionRequest,
	setBotPlaybackMode,
} from "./bot.js";
import { decideLegacyBot } from "./legacyBotSeat.js";
import {
	advanceDealer,
	beginSeatDecision,
	calculateWinProbabilities,
	createBettingRoundProgressState,
	createBettingRoundStartPlan,
	createCashSessionConfig,
	createHandContextState,
	createHandEndPlan,
	createNextHandTransitionPlan,
	createPlayerSpotState,
	createShowdownCommitPlan,
	dealCommunityCardsForPhase,
	dealHoleCardsForNewHand,
	getBettingRoundStartExit,
	getBlindLevelUpdateForHand,
	getBotRevealDecision,
	getCurrentPhase,
	getNextBettingRoundStep,
	getNextPhasePlan,
	getPlayerActionFollowUpEffects,
	getResolvedTurnContinuation,
	getVisibleSolvedHand,
	INITIAL_BIG_BLIND,
	INITIAL_DECK,
	INITIAL_SMALL_BLIND,
	isAllInRunout,
	postBlinds,
	planSecondRunout,
	planCashTopUp,
	recordPlayerActionStats,
	resolveShowdown,
	submitSeatDecision,
} from "./gameEngine.js";
import QrCreator from "./qr-creator.js";
import {
	getActionButtonLabel,
	getPlayerActionState,
	toSeatDecisionRequest,
} from "./shared/actionModel.js";
import { createHumanTurnController } from "./shared/humanTurnController.js";
import { CASH_BOT_STYLE_VERSION, drawCashBotStyles } from "./shared/botStyles.js";
import {
	appendHandEvent,
	createHandHistory,
	exportSeatHandHistories,
	parseSeatHandBackup,
	replayHandHistory,
} from "./shared/handHistory.js";
import { summarizeHeroHandGroups } from "./shared/handStats.js";
import {
	buildHandReplayFrame,
	buildHandReviewIndex,
	buildHandReplaySteps,
	createHistorySessionId,
	formatHistorySessionLabel,
	getHeroHandNet,
	getReplaySeatPositions,
} from "./shared/handReview.js";
import { formatHandText } from "./shared/handText.js";
import { projectSeatObservation } from "./shared/seatObservation.js";
import { initSound, isSoundMuted, playTurnChime, setSoundMuted } from "./shared/sound.js";
import {
	buildPublicPlayerView,
	buildSyncView,
} from "./shared/syncViewModel.js";
import {
	clearSeatActionVisualState,
	clearChipTransferAnimation,
	clearRenderedSeat,
	renderChipStacks,
	renderChipTransferAnimation,
	renderCommunityCards as renderTableCommunityCards,
	renderHostSeat,
	renderNotificationBar,
	renderSeatActiveState,
	renderSeatActiveStates,
	renderSeatResolvedAction,
	renderSeatRotation,
	renderSeatSetupState,
} from "./shared/tableViewRenderer.js";
import { initServiceWorker } from "./serviceWorkerRegistration.js";
import {
	getHandHistoryKey,
	importHandHistories,
	readHandAnnotation,
	readAllHandAnnotations,
	readAllHandHistories,
	readLegacyHandData,
	saveHandAnnotation,
	saveHandHistory,
	setHandStoreAccount,
} from "./training/handStore.js";
import { cloudSessionDocumentPath, createCloudSync } from "./training/cloudSync.js";
import { createFirebaseClient } from "./training/firebaseClient.js";
import { FIREBASE_CONFIGURED } from "./training/firebaseConfig.js";
import { deriveSimilarSpot, shuffleWithSeed } from "./training/similarSpot.js";
import { APP_VERSION } from "./version.js";

/* --------------------------------------------------------------------------------------------------
Configuration And DOM References
---------------------------------------------------------------------------------------------------*/

const startButton = document.querySelector("#start-button");
const cashSetup = document.querySelector("#cash-setup");
const cashBigBlindInput = document.querySelector("#cash-big-blind");
const cashSmallBlindPreview = document.querySelector("#cash-small-blind-preview");
const cashBuyInBBInput = document.querySelector("#cash-buy-in-bb");
const cashTopUpBBInput = document.querySelector("#cash-top-up-bb");
const cashAutoTopUpInput = document.querySelector("#cash-auto-top-up");
const cashStatus = document.querySelector("#cash-status");
const practiceContext = document.querySelector("#practice-context");
const tableMenuButton = document.querySelector("#table-menu-button");
const tableMenu = document.querySelector("#table-menu");
const tableMenuWrap = document.querySelector(".table-menu-wrap");
const menuStartTools = document.querySelector("#menu-start-tools");
const menuTableTools = document.querySelector("#menu-table-tools");
const watchBotsButton = document.querySelector("#watch-bots-button");
const menuSessionTools = document.querySelector("#menu-session-tools");
const endSessionConfirm = document.querySelector("#end-session-confirm");
const endSessionConfirmText = document.querySelector("#end-session-confirm-text");
const endSessionCancelButton = document.querySelector("#end-session-cancel-button");
const endSessionConfirmButton = document.querySelector("#end-session-confirm-button");
const cashTopUpButton = document.querySelector("#cash-top-up-button");
const cashPauseButton = document.querySelector("#cash-pause-button");
const cashEndButton = document.querySelector("#cash-end-button");
const practiceReturnButton = document.querySelector("#practice-return-button");
const cashLastHandButton = document.querySelector("#cash-last-hand-button");
const cashExportHandsButton = document.querySelector("#cash-export-hands-button");
const cashImportHandsButton = document.querySelector("#cash-import-hands-button");
const cashImportHandsFile = document.querySelector("#cash-import-hands-file");
const handTextOverlay = document.querySelector("#hand-text-overlay");
const handSessionSelect = document.querySelector("#hand-session-select");
const handHistorySelect = document.querySelector("#hand-history-select");
const handReplayTab = document.querySelector("#hand-replay-tab");
const handTextTab = document.querySelector("#hand-text-tab");
const handReplayView = document.querySelector("#hand-replay-view");
const handTextView = document.querySelector("#hand-text-view");
const handReplayPrev = document.querySelector("#hand-replay-prev");
const handReplayStep = document.querySelector("#hand-replay-step");
const handReplayCount = document.querySelector("#hand-replay-count");
const handMarkDecisionButton = document.querySelector("#hand-mark-decision-button");
const handStartPracticeButton = document.querySelector("#hand-start-practice-button");
const handPracticeStatus = document.querySelector("#hand-practice-status");
const handReplayNext = document.querySelector("#hand-replay-next");
const handReplayHeading = document.querySelector("#hand-replay-heading");
const handReplayTable = document.querySelector(".hand-replay-table");
const handReplayFelt = document.querySelector(".hand-replay-felt");
const handReplayBoard = document.querySelector("#hand-replay-board");
const handReplayPot = document.querySelector("#hand-replay-pot");
const handReplaySeats = document.querySelector("#hand-replay-seats");
const handReplayEvents = document.querySelector("#hand-replay-events");
const handTextTag = document.querySelector("#hand-text-tag");
const handTextNote = document.querySelector("#hand-text-note");
const handTextPreview = document.querySelector("#hand-text-preview");
const handTextCopyButton = document.querySelector("#hand-text-copy-button");
const handTextDownloadButton = document.querySelector("#hand-text-download-button");
const handTextCloseButton = document.querySelector("#hand-text-close-button");
const newRoundControls = document.querySelector("#new-round-controls");
const startButtonLabel = document.querySelector("#start-button-label");
const newRoundCountdown = document.querySelector("#new-round-countdown");
const newRoundCountdownValue = document.querySelector(
	"#new-round-countdown-value",
);
const newRoundCancelButton = document.querySelector("#new-round-cancel-button");
const instructionsButton = document.querySelector("#instructions-button");
const rotateIcons = document.querySelectorAll(".seat .rotate");
const closeButtons = document.querySelectorAll(".close");
const notification = document.querySelector("#notification");
const foldButton = document.querySelector("#fold-button");
const actionButton = document.querySelector("#action-button");
const amountControls = document.querySelector("#amount-controls");
const amountDecrementButton = document.querySelector(
	"#amount-decrement-button",
);
const statsButton = document.querySelector("#stats-button");
const logButton = document.querySelector("#log-button");
const fastForwardButton = document.querySelector("#fast-forward-button");
const potEl = document.getElementById("pot");
const communityCardSlots = document.querySelectorAll(
	"#community-cards .cardslot",
);
const secondRunoutEl = document.querySelector("#second-runout");
const secondRunoutSlots = document.querySelectorAll("#second-runout .cardslot");
const tableRenderTarget = {
	potEl,
	chipTransferTimer: null,
	activeChipTransferId: null,
	activeChipTransferState: null,
};
const overlayBackdrop = document.querySelector("#overlay-backdrop");
const runoutChoiceOverlay = document.querySelector("#runout-choice-overlay");
const runOnceButton = document.querySelector("#run-once-button");
const runTwiceButton = document.querySelector("#run-twice-button");
const resumeGameOverlay = document.querySelector("#resume-game-overlay");
const resumeContinueButton = document.querySelector("#resume-continue-button");
const resumeNewButton = document.querySelector("#resume-new-button");
const cashTopUpOverlay = document.querySelector("#cash-top-up-overlay");
const cashTopUpDetails = document.querySelector("#cash-top-up-details");
const cashTopUpLaterButton = document.querySelector("#cash-top-up-later-button");
const cashTopUpConfirmButton = document.querySelector("#cash-top-up-confirm-button");
const lossExportOverlay = document.querySelector("#loss-export-overlay");
const lossExportDetails = document.querySelector("#loss-export-details");
const lossExportNewHandButton = document.querySelector("#loss-export-new-hand-button");
const lossExportCopyButton = document.querySelector("#loss-export-copy-button");
const statsOverlay = document.querySelector("#stats-overlay");
const statsCloseButton = document.querySelector("#stats-close-button");
const statsTableBody = document.querySelector("#stats-table-body");
const statsPracticeNote = document.querySelector("#stats-practice-note");
const statsGroupedBody = document.querySelector("#stats-grouped-body");
const statsGroupedStatus = document.querySelector("#stats-grouped-status");
const logOverlay = document.querySelector("#log-overlay");
const logCloseButton = document.querySelector("#log-close-button");
const soundOnInput = document.querySelector("#sound-on");
const soundOffInput = document.querySelector("#sound-off");
const botPaceNaturalInput = document.querySelector("#bot-pace-natural");
const botPaceInstantInput = document.querySelector("#bot-pace-instant");
const instructionsOverlay = document.querySelector("#instructions-overlay");
const instructionsCloseButton = document.querySelector(
	"#instructions-close-button",
);
const logList = document.querySelector("#log-list");
const amountSlider = document.querySelector("#amount-slider");
const amountIncrementButton = document.querySelector(
	"#amount-increment-button",
);
const potPresetButtons = Array.from(document.querySelectorAll("#pot-presets button"));
const sliderOutput = document.querySelector("output");
const seatRefs = Array.from(document.querySelectorAll(".seat")).map((
	seatEl,
	seatSlot,
) => ({
	seatSlot,
	seatEl,
	nameEl: seatEl.querySelector("h3"),
	totalEl: seatEl.querySelector(".chips .total"),
	betEl: seatEl.querySelector(".chips .bet"),
	stackChipEls: seatEl.querySelectorAll(".stack-visual img"),
	dealerEl: seatEl.querySelector(".dealer"),
	smallBlindEl: seatEl.querySelector(".small-blind"),
	bigBlindEl: seatEl.querySelector(".big-blind"),
	rotateEl: seatEl.querySelector(".rotate"),
	closeEl: seatEl.querySelector(".close"),
	winProbabilityEl: seatEl.querySelector(".win-probability"),
	handStrengthEl: seatEl.querySelector(".hand-strength"),
	cardEls: seatEl.querySelectorAll(".card"),
	qrContainer: seatEl.querySelector(".qr"),
	qrLink: seatEl.querySelector(".qr-link"),
	remoteLink: seatEl.querySelector(".remote-table-link"),
	winnerReactionEl: seatEl.querySelector(".winner-reaction"),
	winnerReactionTimer: null,
	actionLabelTimer: null,
	playerSeatIndex: null,
	clearActionLabelState: null,
	clearWinnerReactionState: null,
}));
const overlays = {
	stats: {
		el: statsOverlay,
		beforeOpen: () => {
			renderStatsOverlay();
			void renderGroupedHandStats();
		},
	},
	hand: {
		el: handTextOverlay,
		beforeClose: () => {
			void persistViewedHandAnnotation();
		},
	},
	resume: {
		el: resumeGameOverlay,
		blocking: true,
	},
	runoutChoice: {
		el: runoutChoiceOverlay,
		blocking: true,
	},
	topUp: {
		el: cashTopUpOverlay,
		beforeClose: () => {
			if (cashTopUpOverlay.contains(document.activeElement)) {
				(startButton.classList.contains("hidden") ? tableMenuButton : startButton).focus();
			}
		},
	},
	lossExport: {
		el: lossExportOverlay,
		blocking: true,
	},
	log: {
		el: logOverlay,
		canOpen: () => !!logList && logList.childElementCount > 0,
	},
	instructions: {
		el: instructionsOverlay,
	},
};

/* --------------------------------------------------------------------------------------------------
Runtime Flags And Mutable UI State
---------------------------------------------------------------------------------------------------*/

const MAX_ITEMS = 8;
const notifArr = [];
const pendingNotif = [];
let isNotifProcessing = false;
let notifTimer = null;
const DEFAULT_NOTIF_INTERVAL = 750;
let NOTIF_INTERVAL = DEFAULT_NOTIF_INTERVAL;
const FAST_FORWARD_NOTIF_INTERVAL = 0;
const DEFAULT_ACTION_LABEL_DURATION = 3000;
let ACTION_LABEL_DURATION = DEFAULT_ACTION_LABEL_DURATION;
const FAST_FORWARD_ACTION_LABEL_DURATION = 180;
const DEFAULT_RUNOUT_PHASE_DELAY = 3000;
let RUNOUT_PHASE_DELAY = DEFAULT_RUNOUT_PHASE_DELAY;
const FAST_FORWARD_RUNOUT_PHASE_DELAY = 320;
const FAST_FORWARD_CHIP_TRANSFER_DURATION = 160;
const FAST_FORWARD_CHIP_TRANSFER_STEPS = 8;
const DEFAULT_CHIP_TRANSFER_STEPS = 30;
const WINNER_REACTION_DURATION = 2000;
const NEW_ROUND_COUNTDOWN_SECONDS = 20;
const NEW_ROUND_COUNTDOWN_INTERVAL = 1000;
const SAVED_GAME_SCHEMA_VERSION = 1;
const practiceUrlParams = new URLSearchParams(globalThis.location.search);
const practiceSourceKey = practiceUrlParams.get("practice");
const practiceDecisionSeq = Number(practiceUrlParams.get("decision"));
const IS_PRACTICE_PAGE = practiceSourceKey !== null;
const LEGACY_SAVED_GAME_STORAGE_KEY = IS_PRACTICE_PAGE
	? `poker:saved-practice:v1:${encodeURIComponent(practiceSourceKey)}:${practiceDecisionSeq}`
	: "poker:saved-game:v1";
const LEGACY_COMPLETED_HAND_OUTBOX_KEY = "poker:completed-hand-outbox:v1";
let SAVED_GAME_STORAGE_KEY = LEGACY_SAVED_GAME_STORAGE_KEY;
let COMPLETED_HAND_OUTBOX_KEY = LEGACY_COMPLETED_HAND_OUTBOX_KEY;
let cloudSync = null;
let cloudSyncTimer = null;
let pendingFullCloudSync = false;
let accountClient = null;
let accountOffline = false;
const BOT_PACE_STORAGE_KEY = "poker:instant-bots";
let instantBotPlayback = false;
let viewedHandHistory = null;
let handReviewHistories = new Map();
let handReviewIndex = [];
let handReplaySeq = 0;
let markedDecisionSeq = null;
let selectedPracticePlan = null;
let handSelectionToken = 0;
let groupedStatsRenderToken = 0;
let handAnnotationSavePromise = Promise.resolve();

const HISTORY_LOG = false; // Set to true to enable history logging in the console
let DEBUG_FLOW = false; // Set to true for verbose game-flow logging
const CHIP_UNIT = 10;

const speedModeParam = new URLSearchParams(globalThis.location.search).get(
	"speedmode",
);
const SPEED_MODE = !IS_PRACTICE_PAGE && speedModeParam !== null && speedModeParam !== "0" &&
	speedModeParam !== "false";
if (SPEED_MODE) {
	NOTIF_INTERVAL = 0;
	ACTION_LABEL_DURATION = 0;
	RUNOUT_PHASE_DELAY = 0;
	DEBUG_FLOW = true;
}

const STATE_SYNC_ENDPOINT = "https://poker.tehes.deno.net/state";
const ACTION_SYNC_ENDPOINT = "https://poker.tehes.deno.net/action";
let tableId = null;
const STATE_SYNC_DELAY = 750;
const ACTION_POLL_INTERVAL = 1000;
let stateSyncTimer = null;
let stateSyncTimerDelay = null;
let runoutPhaseTimer = null;
let runoutCount = 0;
let secondRunoutBoard = [];
let chipTransferFinishTimer = null;
let newRoundCountdownTimer = null;
let newRoundCountdownSeconds = 0;
let summaryButtonsVisible = false;
let handFastForwardActive = false;
let autoplayToGameEnd = false;
let nextChipTransferId = 1;
let pendingSavedGameSnapshot = null;
let currentFlowState = { type: "setup" };
let currentGameSaveEligible = false;
let activeHandHistory = null;
let historyCashTransactionCount = 0;
let handOutboxFlushPromise = null;

let totalHands = 0;
let hadHumansAtStart = false;

/* --------------------------------------------------------------------------------------------------
Game Constants And Game State
---------------------------------------------------------------------------------------------------*/

const WINNER_REACTION_EMOJIS = {
	reveal: ["😉", "😜", "🤭"],
	uncontested: ["😎", "😏", "😌"],
	split: ["🤝"],
	lucky: ["🥹", "😆", "😮‍💨"],
	comeback: ["💪", "😅"],
	monsterHand: ["🤩", "🥳"],
	strongHand: ["😁", "😄", "😬"],
	bigPot: ["🤑"],
	fallback: ["🙂", "😊"],
};
const WINNER_REACTION_MONSTER_HANDS = new Set([
	"Full House",
	"Four of a Kind",
	"Straight Flush",
]);
const WINNER_REACTION_STRONG_HANDS = new Set(["Straight", "Flush"]);
const WINNER_REACTION_LUCKY_MIN_GAP = 15;
const CARD_SUIT_SYMBOLS = {
	C: "♣",
	D: "♦",
	H: "♥",
	S: "♠",
};

const gameState = {
	gameMode: "cash",
	cashSession: null,
	currentPhaseIndex: 0,
	currentBet: 0,
	pot: 0,
	activeSeatIndex: null,
	pendingSeatDecision: null,
	handId: 0,
	nextDecisionId: 1,
	blindLevel: 0,
	gameStarted: false,
	gameFinished: false,
	openCardsMode: false,
	spectatorMode: false,
	raisesThisRound: 0,
	handInProgress: false,
	deck: INITIAL_DECK.slice(),
	cardGraveyard: [],
	communityCards: [],
	players: [],
	allPlayers: [],
	chipTransfer: null,
	pendingAction: null,
	smallBlind: INITIAL_SMALL_BLIND,
	bigBlind: INITIAL_BIG_BLIND,
	chipUnit: CHIP_UNIT,
	lastRaise: INITIAL_BIG_BLIND,
	handContext: createHandContextState(),
};

gameState.toJSON = function () {
	return {
		gameMode: this.gameMode,
		cashSession: this.cashSession ? { ...this.cashSession } : null,
		currentPhaseIndex: this.currentPhaseIndex,
		currentBet: this.currentBet,
		pot: this.pot,
		lastRaise: this.lastRaise,
		smallBlind: this.smallBlind,
		bigBlind: this.bigBlind,
		chipUnit: this.chipUnit,
		raisesThisRound: this.raisesThisRound,
		blindLevel: this.blindLevel,
		handContext: this.handContext ? { ...this.handContext } : null,
		communityCards: this.communityCards.slice(),
		pendingAction: this.pendingAction ? { ...this.pendingAction } : null,
		players: this.players,
		timestamp: Date.now(),
	};
};

/* --------------------------------------------------------------------------------------------------
Saved Game Persistence
---------------------------------------------------------------------------------------------------*/

function getLocalStorage() {
	try {
		return globalThis.localStorage ?? null;
	} catch (error) {
		console.warn("saved game storage unavailable", error);
		return null;
	}
}

function readCompletedHandOutbox() {
	const storage = getLocalStorage();
	if (!storage) {
		return [];
	}
	try {
		const value = JSON.parse(storage.getItem(COMPLETED_HAND_OUTBOX_KEY) ?? "[]");
		return Array.isArray(value) ? value : [];
	} catch (error) {
		console.warn("completed hand outbox read failed", error);
		return [];
	}
}

function queueCompletedHandHistory(history) {
	const storage = getLocalStorage();
	if (!storage) {
		void saveHandHistory(history).catch((error) => console.warn("hand history save failed", error));
		return;
	}
	const outbox = readCompletedHandOutbox();
	const key = getHandHistoryKey(history);
	if (!outbox.some((entry) => getHandHistoryKey(entry) === key)) {
		try {
			storage.setItem(COMPLETED_HAND_OUTBOX_KEY, JSON.stringify([...outbox, history]));
		} catch (error) {
			console.warn("completed hand outbox write failed", error);
			void saveHandHistory(history).catch((saveError) => console.warn("hand history save failed", saveError));
			return;
		}
	}
	void flushCompletedHandOutbox().then(() => scheduleCloudSync(true));
}

function flushCompletedHandOutbox() {
	if (handOutboxFlushPromise) {
		return handOutboxFlushPromise;
	}
	handOutboxFlushPromise = (async () => {
		const storage = getLocalStorage();
		if (!storage) {
			return;
		}
		while (true) {
			const outbox = readCompletedHandOutbox();
			if (outbox.length === 0) {
				return;
			}
			await saveHandHistory(outbox[0]);
			const currentOutbox = readCompletedHandOutbox();
			if (currentOutbox[0] && getHandHistoryKey(currentOutbox[0]) === getHandHistoryKey(outbox[0])) {
				storage.setItem(COMPLETED_HAND_OUTBOX_KEY, JSON.stringify(currentOutbox.slice(1)));
			}
		}
	})().catch((error) => {
		console.warn("completed hand outbox flush failed", error);
	}).finally(() => {
		handOutboxFlushPromise = null;
	});
	return handOutboxFlushPromise;
}

async function loadCompletedHandHistories() {
	await flushCompletedHandOutbox();
	let histories = [];
	try {
		histories = await readAllHandHistories();
	} catch (error) {
		console.warn("hand history database read failed", error);
	}
	const byKey = new Map(histories.map((history) => [getHandHistoryKey(history), history]));
	readCompletedHandOutbox().forEach((history) => byKey.set(getHandHistoryKey(history), history));
	if (activeHandHistory?.events.at(-1)?.type === "hand.ended") {
		byKey.set(getHandHistoryKey(activeHandHistory), activeHandHistory);
	}
	return Array.from(byKey.values());
}

async function exportCashHandHistories() {
	try {
		await handAnnotationSavePromise;
		const [histories, annotations] = await Promise.all([
			loadCompletedHandHistories(), readAllHandAnnotations(),
		]);
		if (histories.length === 0) {
			enqueueNotification("No completed hands to export yet.");
			return;
		}
		const blob = new Blob([exportSeatHandHistories(histories, annotations)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `cash-training-hands-${new Date().toISOString().slice(0, 10)}.json`;
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		enqueueNotification(`Exported ${histories.length} hand${histories.length === 1 ? "" : "s"} from your view.`);
	} catch (error) {
		console.warn("hand history export failed", error);
		enqueueNotification("Could not export hand histories.");
	}
}

async function importCashHandHistories() {
	const file = cashImportHandsFile.files?.[0];
	cashImportHandsFile.value = "";
	if (!file) {
		return;
	}
	try {
		if (file.size > 25_000_000) {
			throw new RangeError("Hand history file is too large");
		}
		const { histories, annotations } = parseSeatHandBackup(await file.text());
		await importHandHistories(histories, annotations);
		scheduleCloudSync(true);
		const preferredHistory = viewedHandHistory ?? histories.at(-1);
		await refreshHandReview(preferredHistory ? getHandHistoryKey(preferredHistory) : null);
		enqueueNotification(`Restored ${histories.length} hand${histories.length === 1 ? "" : "s"} and ` +
			`${annotations.length} note${annotations.length === 1 ? "" : "s"}.`);
	} catch (error) {
		console.warn("hand history import failed", error);
		enqueueNotification("Could not import hand histories. Check the file format and amounts.");
	}
}

function renderViewedHandText() {
	const available = viewedHandHistory !== null;
	handTextTag.disabled = !available;
	handTextNote.disabled = !available;
	handTextCopyButton.disabled = !available;
	handTextDownloadButton.disabled = !available;
	handTextPreview.textContent = available
		? formatHandText(viewedHandHistory, {
			tag: handTextTag.value,
			note: handTextNote.value,
		})
		: "No completed hand in this session yet.";
}

function createReplayCard(card) {
	const cardEl = document.createElement("span");
	cardEl.className = `hand-replay-card${card ? "" : " unknown"}`;
	if (card) {
		const suit = { C: "♣", D: "♦", H: "♥", S: "♠" }[card[1]];
		cardEl.textContent = `${card[0]}${suit}`;
		cardEl.classList.toggle("red", card[1] === "D" || card[1] === "H");
	} else {
		cardEl.title = "Face-down card";
	}
	return cardEl;
}

function appendReplayBoardRow(container, cards, label) {
	const row = document.createElement("div");
	row.className = "hand-replay-board-row";
	if (label) {
		const rowLabel = document.createElement("span");
		rowLabel.className = "hand-replay-board-label";
		rowLabel.textContent = label;
		row.append(rowLabel);
	}
	for (let index = 0; index < 5; index += 1) {
		if (cards[index]) row.append(createReplayCard(cards[index]));
		else {
			const emptyCard = document.createElement("span");
			emptyCard.className = "hand-replay-card empty";
			row.append(emptyCard);
		}
	}
	container.append(row);
}

function setHandReviewTab(tab) {
	const replay = tab === "replay";
	handReplayView.classList.toggle("hidden", !replay);
	handTextView.classList.toggle("hidden", replay);
	handReplayTab.classList.toggle("selected", replay);
	handTextTab.classList.toggle("selected", !replay);
	handReplayTab.setAttribute("aria-pressed", String(replay));
	handTextTab.setAttribute("aria-pressed", String(!replay));
}

function renderHandPracticeTools() {
	const heroSeatIndex = viewedHandHistory?.seats.find((seat) => !seat.isBot)?.seatIndex ?? null;
	const selectedEvent = viewedHandHistory?.events[handReplaySeq - 1] ?? null;
	const selectedHeroDecision = selectedEvent?.type === "action.applied" &&
		selectedEvent.data.seatIndex === heroSeatIndex;
	handMarkDecisionButton.disabled = !selectedHeroDecision;
	handMarkDecisionButton.textContent = selectedHeroDecision && selectedEvent.seq === markedDecisionSeq
		? "Clear decision mark" : "Mark this decision";
	selectedPracticePlan = viewedHandHistory && markedDecisionSeq
		? deriveSimilarSpot(viewedHandHistory, markedDecisionSeq) : null;
	handStartPracticeButton.disabled = !selectedPracticePlan || gameState.handInProgress;
	const markedStep = markedDecisionSeq && viewedHandHistory
		? buildHandReplaySteps(viewedHandHistory).indexOf(markedDecisionSeq) : null;
	if (!viewedHandHistory) {
		handReplayTable.classList.add("hidden");
		handReplayFelt.classList.remove("two-runs");
		handPracticeStatus.textContent = "Select one of your actions to mark a decision.";
	} else if (!markedDecisionSeq) {
		handPracticeStatus.textContent = "Select one of your actions to mark a decision.";
	} else if (!selectedPracticePlan) {
		handPracticeStatus.textContent = `Step ${markedStep} is marked. ` +
			"Similar samples currently support first-in preflop decisions after folds only.";
	} else {
		const filters = selectedPracticePlan.filters;
		const stackBB = Number((filters.seats.find((seat) =>
			seat.seatIndex === filters.heroSeatIndex
		).startingChips / filters.bigBlind).toFixed(1));
		handPracticeStatus.textContent = `Marked step ${markedStep}: ${filters.seats.length} seats, ` +
			`${stackBB} BB starting stack, ${filters.priorFoldSeatIndexes.length} scripted prior folds. ` +
			(gameState.handInProgress
				? "Finish the current hand to start a new random sample."
				: "New cards and bot decisions; no strategy score or free-table profit.");
	}
}

function renderHandReplay() {
	handReplayBoard.replaceChildren();
	handReplaySeats.replaceChildren();
	handReplayEvents.replaceChildren();
	if (!viewedHandHistory) {
		handReplayHeading.textContent = "No completed hand yet.";
		handReplayPot.textContent = "";
		handReplayCount.textContent = "0 / 0";
		handReplayStep.max = "0";
		handReplayStep.value = "0";
		handReplayStep.disabled = true;
		handReplayPrev.disabled = true;
		handReplayNext.disabled = true;
		renderHandPracticeTools();
		return;
	}
	handReplayTable.classList.remove("hidden");
	const frame = buildHandReplayFrame(viewedHandHistory, handReplaySeq);
	handReplayFelt.classList.toggle("two-runs", frame.secondBoard !== null);
	const steps = buildHandReplaySteps(viewedHandHistory);
	const stepIndex = steps.indexOf(handReplaySeq);
	handReplayStep.disabled = false;
	handReplayStep.max = String(steps.length - 1);
	handReplayStep.value = String(stepIndex);
	handReplayCount.textContent = `${stepIndex + 1} / ${steps.length}`;
	handReplayStep.style.setProperty("--replay-progress", `${stepIndex / (steps.length - 1) * 100}%`);
	handReplayPrev.disabled = stepIndex === 0;
	handReplayNext.disabled = stepIndex === steps.length - 1;
	const streetEl = document.createElement("span");
	streetEl.className = "hand-replay-street";
	streetEl.textContent = frame.street.toUpperCase();
	const actionEl = document.createElement("span");
	actionEl.className = "hand-replay-current-action";
	actionEl.textContent = frame.currentEvent;
	handReplayHeading.replaceChildren(streetEl, actionEl);
	handReplayPot.textContent = frame.ended ? "HAND COMPLETE" : `POT ${frame.pot}`;
	appendReplayBoardRow(handReplayBoard, frame.board, frame.secondBoard ? "RUN 1" : null);
	if (frame.secondBoard) appendReplayBoardRow(handReplayBoard, frame.secondBoard, "RUN 2");
	const seatPositions = getReplaySeatPositions(frame.seats);
	for (const seat of frame.seats) {
		const seatEl = document.createElement("div");
		seatEl.className = `hand-replay-seat${seat.folded ? " folded" : ""}` +
			`${seat.isHero ? " hero" : ""}${seat.seatIndex === frame.activeSeatIndex ? " active" : ""}`;
		seatEl.dataset.position = String(seatPositions.get(seat.seatIndex));
		const nameEl = document.createElement("div");
		nameEl.className = "hand-replay-seat-name";
		nameEl.textContent = `${seat.name}${seat.isHero ? " · You" : ""}`;
		if (seat.isDealer) {
			const dealerEl = document.createElement("span");
			dealerEl.className = "hand-replay-dealer";
			dealerEl.textContent = "D";
			nameEl.append(dealerEl);
		}
		const cardsEl = document.createElement("div");
		cardsEl.className = "hand-replay-seat-cards";
		cardsEl.append(...seat.cards.map(createReplayCard));
		const metaEl = document.createElement("div");
		metaEl.className = "hand-replay-seat-meta";
		metaEl.textContent = `${seat.stack} chips`;
		seatEl.append(nameEl, cardsEl, metaEl);
		if (seat.streetBet) {
			const betEl = document.createElement("span");
			betEl.className = "hand-replay-bet";
			betEl.textContent = `● ${seat.streetBet}`;
			seatEl.append(betEl);
		}
		if (!seat.isHero && seat.seatIndex === frame.activeSeatIndex && frame.activeAction) {
			const actionBadge = document.createElement("span");
			actionBadge.className = "hand-replay-seat-action";
			actionBadge.textContent = frame.activeAction;
			seatEl.append(actionBadge);
		} else if (seat.folded && !(seat.isHero && seat.streetBet)) {
			const foldedBadge = document.createElement("span");
			foldedBadge.className = "hand-replay-seat-action";
			foldedBadge.textContent = "FOLDED";
			seatEl.append(foldedBadge);
		}
		handReplaySeats.append(seatEl);
	}
	for (const event of frame.events) {
		const item = document.createElement("li");
		const button = document.createElement("button");
		button.type = "button";
		button.textContent = event.label;
		button.classList.toggle("current", event.seq === frame.seq);
		button.addEventListener("click", () => {
			handReplaySeq = event.seq;
			renderHandReplay();
		});
		item.append(button);
		handReplayEvents.append(item);
	}
	renderHandPracticeTools();
}

function populateHandHistorySelect(sessionId, preferredKey = null) {
	const session = handReviewIndex.find((entry) => entry.sessionId === sessionId);
	handHistorySelect.replaceChildren();
	for (const hand of session?.hands ?? []) {
		const option = document.createElement("option");
		option.value = hand.key;
		option.textContent = handReviewHistories.get(hand.key)?.practice
			? `Hand ${hand.handId} · Similar sample`
			: `Hand ${hand.handId}`;
		handHistorySelect.append(option);
	}
	handHistorySelect.disabled = !session;
	if (preferredKey && session?.hands.some((hand) => hand.key === preferredKey)) {
		handHistorySelect.value = preferredKey;
	}
}

async function selectReviewedHand(key) {
	const token = ++handSelectionToken;
	await persistViewedHandAnnotation();
	if (token !== handSelectionToken) {
		return;
	}
	viewedHandHistory = handReviewHistories.get(key) ?? null;
	handReplaySeq = 0;
	handReplayView.scrollTop = 0;
	markedDecisionSeq = null;
	handTextTag.value = "";
	handTextNote.value = "";
	if (viewedHandHistory) {
		try {
			await handAnnotationSavePromise;
			const annotation = await readHandAnnotation(key);
			if (token !== handSelectionToken) {
				return;
			}
			handTextTag.value = annotation.tag;
			handTextNote.value = annotation.note;
			markedDecisionSeq = annotation.decisionSeq ?? null;
		} catch (error) {
			console.warn("hand annotation read failed", error);
		}
	}
	try {
		renderViewedHandText();
		renderHandReplay();
	} catch (error) {
		console.warn("hand review render failed", error);
		viewedHandHistory = null;
		renderViewedHandText();
		renderHandReplay();
		enqueueNotification("Could not replay the selected hand.");
	}
}

async function refreshHandReview(preferredKey = null) {
	const histories = await loadCompletedHandHistories();
	handReviewHistories = new Map(histories.map((history) => [getHandHistoryKey(history), history]));
	handReviewIndex = buildHandReviewIndex(histories, gameState.cashSession?.historySessionId);
	handSessionSelect.replaceChildren();
	for (const session of handReviewIndex) {
		const option = document.createElement("option");
		option.value = session.sessionId;
		const label = formatHistorySessionLabel(
			session.sessionId,
			session.sessionId === gameState.cashSession?.historySessionId,
		);
		const practice = handReviewHistories.get(session.hands[0]?.key)?.practice;
		option.textContent = `${practice ? "Similar samples · " : ""}${label} · ` +
			`${session.hands.length} hand${session.hands.length === 1 ? "" : "s"}`;
		handSessionSelect.append(option);
	}
	handSessionSelect.disabled = handReviewIndex.length === 0;
	const chosenSession = handReviewIndex.find((session) =>
		session.hands.some((hand) => hand.key === preferredKey)
	) ?? handReviewIndex[0];
	handSessionSelect.value = chosenSession?.sessionId ?? "";
	populateHandHistorySelect(chosenSession?.sessionId, preferredKey);
	await selectReviewedHand(handHistorySelect.value);
}

async function openHandReview() {
	viewedHandHistory = null;
	handReviewHistories = new Map();
	handReviewIndex = [];
	handSessionSelect.replaceChildren();
	handHistorySelect.replaceChildren();
	handTextTag.value = "";
	handTextNote.value = "";
	renderViewedHandText();
	handReplaySeq = 0;
	markedDecisionSeq = null;
	renderHandReplay();
	setHandReviewTab("replay");
	openOverlay("hand");
	try {
		await refreshHandReview();
	} catch (error) {
		console.warn("hand review load failed", error);
		enqueueNotification("Could not load hand history.");
	}
}

async function persistViewedHandAnnotation() {
	if (!viewedHandHistory) {
		return;
	}
	const key = getHandHistoryKey(viewedHandHistory);
	const annotation = {
		tag: handTextTag.value,
		note: handTextNote.value,
		decisionSeq: markedDecisionSeq,
	};
	handAnnotationSavePromise = handAnnotationSavePromise.catch(() => {}).then(() =>
		saveHandAnnotation(key, annotation)
	);
	try {
		await handAnnotationSavePromise;
		scheduleCloudSync(true);
	} catch (error) {
		console.warn("hand annotation save failed", error);
		enqueueNotification("Could not save the hand note.");
	}
}

async function copyViewedHandText() {
	if (!viewedHandHistory) {
		return;
	}
	await persistViewedHandAnnotation();
	try {
		await navigator.clipboard.writeText(handTextPreview.textContent);
		enqueueNotification("Hand text copied.");
	} catch (error) {
		console.warn("hand text copy failed", error);
		enqueueNotification("Could not copy. Select the text or download it.");
	}
}

function downloadHandTextFile(history, text) {
	const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	const sessionLabel = history.sessionId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "session";
	link.download = `cash-hand-${sessionLabel}-${history.handId}.txt`;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
	enqueueNotification("Hand text downloaded.");
}

async function downloadViewedHandText() {
	if (!viewedHandHistory) {
		return;
	}
	await persistViewedHandAnnotation();
	downloadHandTextFile(viewedHandHistory, handTextPreview.textContent);
}

function clonePlainValue(value, fallback = null) {
	if (value === undefined) {
		return fallback;
	}
	try {
		return JSON.parse(JSON.stringify(value));
	} catch (error) {
		console.warn("saved game clone failed", error);
		return fallback;
	}
}

function normalizeNumber(value, fallback) {
	return Number.isFinite(value) ? value : fallback;
}

function createStatsSnapshot(stats = {}) {
	return {
		hands: normalizeNumber(stats.hands, 0),
		handsWon: normalizeNumber(stats.handsWon, 0),
		vpip: normalizeNumber(stats.vpip, 0),
		pfr: normalizeNumber(stats.pfr, 0),
		calls: normalizeNumber(stats.calls, 0),
		aggressiveActs: normalizeNumber(stats.aggressiveActs, 0),
		reveals: normalizeNumber(stats.reveals, 0),
		showdowns: normalizeNumber(stats.showdowns, 0),
		showdownsWon: normalizeNumber(stats.showdownsWon, 0),
		folds: normalizeNumber(stats.folds, 0),
		foldsPreflop: normalizeNumber(stats.foldsPreflop, 0),
		foldsPostflop: normalizeNumber(stats.foldsPostflop, 0),
		allins: normalizeNumber(stats.allins, 0),
	};
}

function createBotLineSnapshot(botLine = {}) {
	return {
		preflopAggressor: botLine.preflopAggressor === true,
		cbetIntent: botLine.cbetIntent ?? null,
		barrelIntent: botLine.barrelIntent ?? null,
		cbetMade: botLine.cbetMade === true,
		barrelMade: botLine.barrelMade === true,
		nonValueAggressionMade: botLine.nonValueAggressionMade === true,
		checkRaiseIntent: clonePlainValue(botLine.checkRaiseIntent, null),
		passiveValueCheckIntent: clonePlainValue(
			botLine.passiveValueCheckIntent,
			null,
		),
	};
}

function createPlayerSnapshot(player) {
	return {
		cashInvested: normalizeNumber(player.cashInvested, 0),
		cashLeft: player.cashLeft === true,
		name: player.name,
		isBot: player.isBot === true,
		botStyle: player.botStyle ?? null,
		botStyleVersion: player.botStyleVersion ?? null,
		seatSlot: player.seatSlot,
		winnerReactionEmoji: player.winnerReactionEmoji || "",
		winnerReactionUntil: normalizeNumber(player.winnerReactionUntil, 0),
		isWinner: player.isWinner === true,
		actionState: player.actionState ? { ...player.actionState } : null,
		winProbability: typeof player.winProbability === "number"
			? player.winProbability
			: null,
		lastNonFinalWinProbability:
			typeof player.lastNonFinalWinProbability === "number"
				? player.lastNonFinalWinProbability
				: null,
		seatIndex: player.seatIndex,
		holeCards: Array.isArray(player.holeCards)
			? player.holeCards.slice(0, 2)
			: [null, null],
		visibleHoleCards: Array.isArray(player.visibleHoleCards)
			? player.visibleHoleCards.slice(0, 2)
			: [false, false],
		dealer: player.dealer === true,
		smallBlind: player.smallBlind === true,
		bigBlind: player.bigBlind === true,
		folded: player.folded === true,
		chips: normalizeNumber(player.chips, 0),
		allIn: player.allIn === true,
		totalBet: normalizeNumber(player.totalBet, 0),
		roundBet: normalizeNumber(player.roundBet, 0),
		stats: createStatsSnapshot(player.stats),
		botLine: createBotLineSnapshot(player.botLine),
		spotState: {
			...createPlayerSpotState(),
			...clonePlainValue(player.spotState, {}),
		},
	};
}

function createGameStateSnapshot() {
	return {
		gameMode: gameState.gameMode,
		cashSession: clonePlainValue(gameState.cashSession, null),
		currentPhaseIndex: gameState.currentPhaseIndex,
		currentBet: gameState.currentBet,
		pot: gameState.pot,
		activeSeatIndex: gameState.activeSeatIndex,
		handId: gameState.handId,
		nextDecisionId: gameState.nextDecisionId,
		blindLevel: gameState.blindLevel,
		gameStarted: gameState.gameStarted,
		gameFinished: gameState.gameFinished,
		openCardsMode: gameState.openCardsMode,
		spectatorMode: gameState.spectatorMode,
		raisesThisRound: gameState.raisesThisRound,
		handInProgress: gameState.handInProgress,
		deck: gameState.deck.slice(),
		cardGraveyard: gameState.cardGraveyard.slice(),
		communityCards: gameState.communityCards.slice(),
		activeSeatIndexes: gameState.players.map((player) => player.seatIndex),
		players: gameState.players.map(createPlayerSnapshot),
		allPlayers: gameState.allPlayers.map(createPlayerSnapshot),
		chipTransfer: clonePlainValue(gameState.chipTransfer, null),
		pendingAction: gameState.pendingAction ? { ...gameState.pendingAction } : null,
		smallBlind: gameState.smallBlind,
		bigBlind: gameState.bigBlind,
		chipUnit: gameState.chipUnit,
		lastRaise: gameState.lastRaise,
		handContext: clonePlainValue(gameState.handContext, createHandContextState()),
	};
}

function getLogEntriesSnapshot() {
	if (!logList) {
		return [];
	}
	return Array.from(logList.children).map((entry) => entry.textContent || "");
}

function hasExactlyOneHumanPlayer(players = []) {
	return Array.isArray(players) &&
		players.filter((player) => player?.isBot !== true).length === 1;
}

function hasExactlyOneHumanInSession() {
	return hasExactlyOneHumanPlayer(
		gameState.gameMode === "cash" ? gameState.allPlayers : gameState.players,
	);
}

function createSavedGameSnapshot() {
	return {
		schemaVersion: SAVED_GAME_SCHEMA_VERSION,
		savedAt: Date.now(),
		appVersion: APP_VERSION,
		tableId,
		runtimeState: {
			totalHands,
			hadHumansAtStart,
			currentGameSaveEligible,
			summaryButtonsVisible,
			handFastForwardActive,
			autoplayToGameEnd,
			nextChipTransferId,
			notifications: notifArr.slice(),
			pendingNotifications: pendingNotif.slice(),
			logEntries: getLogEntriesSnapshot(),
			historyCashTransactionCount,
			runoutCount,
			secondRunoutBoard: secondRunoutBoard.slice(),
		},
		flowState: clonePlainValue(currentFlowState, { type: "unknown" }),
		gameState: createGameStateSnapshot(),
		handHistory: clonePlainValue(activeHandHistory, null),
	};
}

function shouldSaveCurrentGame() {
	return !SPEED_MODE &&
		currentGameSaveEligible === true &&
		gameState.gameStarted === true &&
		gameState.gameFinished !== true &&
		hasExactlyOneHumanInSession();
}

function shouldRemoveCurrentGameSave() {
	return currentGameSaveEligible === true &&
		gameState.gameStarted === true &&
		(
			gameState.gameFinished === true ||
			!hasExactlyOneHumanInSession()
		);
}

function removeSavedGameSnapshot() {
	const storage = getLocalStorage();
	if (!storage) {
		return;
	}
	try {
		storage.removeItem(SAVED_GAME_STORAGE_KEY);
		scheduleCloudSync();
	} catch (error) {
		console.warn("saved game remove failed", error);
	}
}

function saveCurrentGameSnapshot() {
	if (!shouldSaveCurrentGame()) {
		if (shouldRemoveCurrentGameSave()) {
			removeSavedGameSnapshot();
		}
		return;
	}

	const storage = getLocalStorage();
	if (!storage) {
		return;
	}

	try {
		storage.setItem(
			SAVED_GAME_STORAGE_KEY,
			JSON.stringify(createSavedGameSnapshot()),
		);
		scheduleCloudSync();
	} catch (error) {
		console.warn("saved game write failed", error);
	}
}

function isValidSavedGameSnapshot(snapshot) {
	return snapshot?.schemaVersion === SAVED_GAME_SCHEMA_VERSION &&
		snapshot?.gameState?.gameStarted === true &&
		snapshot?.gameState?.gameFinished !== true &&
		(snapshot.gameState.gameMode !== "cash" ||
			(Number.isSafeInteger(snapshot.gameState.cashSession?.buyInChips) &&
				Array.isArray(snapshot.gameState.cashSession.transactions))) &&
		(IS_PRACTICE_PAGE
			? snapshot.gameState.cashSession?.practice?.source?.handKey === practiceSourceKey &&
				snapshot.gameState.cashSession.practice.source.decisionSeq === practiceDecisionSeq
			: !snapshot.gameState.cashSession?.practice) &&
		Array.isArray(snapshot.gameState.allPlayers) &&
		Array.isArray(snapshot.gameState.players) &&
		hasExactlyOneHumanPlayer(
			snapshot.gameState.gameMode === "cash"
				? snapshot.gameState.allPlayers
				: snapshot.gameState.players,
		) &&
		snapshot.flowState &&
		typeof snapshot.flowState.type === "string";
}

function readSavedGameSnapshot() {
	if (SPEED_MODE) {
		return null;
	}

	const storage = getLocalStorage();
	if (!storage) {
		return null;
	}

	try {
		const rawSnapshot = storage.getItem(SAVED_GAME_STORAGE_KEY);
		if (!rawSnapshot) {
			return null;
		}
		const snapshot = JSON.parse(rawSnapshot);
		if (isValidSavedGameSnapshot(snapshot)) {
			return snapshot;
		}
		storage.removeItem(SAVED_GAME_STORAGE_KEY);
	} catch (error) {
		console.warn("saved game read failed", error);
		removeSavedGameSnapshot();
	}
	return null;
}

function setCurrentFlowState(flowState) {
	currentFlowState = clonePlainValue(flowState, { type: "unknown" });
}

function createActiveTurnFlowState(player, cycles, progressState) {
	return {
		type: "active-turn",
		phaseIndex: gameState.currentPhaseIndex,
		seatIndex: player.seatIndex,
		cycles,
		progressState: {
			nextIndex: progressState.nextIndex,
			cycles: progressState.cycles,
		},
	};
}

function normalizeSavedProgressState(progressState) {
	if (
		!progressState ||
		!Number.isFinite(progressState.nextIndex) ||
		!Number.isFinite(progressState.cycles)
	) {
		return null;
	}
	return {
		nextIndex: progressState.nextIndex,
		cycles: progressState.cycles,
	};
}

function normalizeSavedPlayer(player) {
	return {
		cashInvested: normalizeNumber(player?.cashInvested, 0),
		cashLeft: player?.cashLeft === true,
		name: typeof player?.name === "string" ? player.name : "Player",
		isBot: player?.isBot === true,
		botStyle: player?.botStyle ?? null,
		botStyleVersion: player?.botStyleVersion ?? null,
		seatSlot: normalizeNumber(player?.seatSlot, normalizeNumber(player?.seatIndex, 0)),
		winnerReactionEmoji: typeof player?.winnerReactionEmoji === "string"
			? player.winnerReactionEmoji
			: "",
		winnerReactionUntil: normalizeNumber(player?.winnerReactionUntil, 0),
		isWinner: player?.isWinner === true,
		actionState: player?.actionState ? { ...player.actionState } : null,
		winProbability: typeof player?.winProbability === "number"
			? player.winProbability
			: null,
		lastNonFinalWinProbability:
			typeof player?.lastNonFinalWinProbability === "number"
				? player.lastNonFinalWinProbability
				: null,
		seatIndex: normalizeNumber(player?.seatIndex, 0),
		holeCards: Array.isArray(player?.holeCards)
			? player.holeCards.slice(0, 2)
			: [null, null],
		visibleHoleCards: Array.isArray(player?.visibleHoleCards)
			? player.visibleHoleCards.slice(0, 2)
			: [false, false],
		dealer: player?.dealer === true,
		smallBlind: player?.smallBlind === true,
		bigBlind: player?.bigBlind === true,
		folded: player?.folded === true,
		chips: normalizeNumber(player?.chips, 0),
		allIn: player?.allIn === true,
		totalBet: normalizeNumber(player?.totalBet, 0),
		roundBet: normalizeNumber(player?.roundBet, 0),
		stats: createStatsSnapshot(player?.stats),
		botLine: createBotLineSnapshot(player?.botLine),
		spotState: {
			...createPlayerSpotState(),
			...clonePlainValue(player?.spotState, {}),
		},
	};
}

function restoreRuntimeState(runtimeState = {}) {
	totalHands = normalizeNumber(runtimeState.totalHands, 0);
	hadHumansAtStart = runtimeState.hadHumansAtStart === true;
	currentGameSaveEligible = runtimeState.currentGameSaveEligible === true;
	handFastForwardActive = runtimeState.handFastForwardActive === true;
	autoplayToGameEnd = runtimeState.autoplayToGameEnd === true;
	nextChipTransferId = normalizeNumber(runtimeState.nextChipTransferId, 1);
	historyCashTransactionCount = normalizeNumber(runtimeState.historyCashTransactionCount, 0);
	runoutCount = [1, 2].includes(runtimeState.runoutCount) ? runtimeState.runoutCount : 0;
	secondRunoutBoard = Array.isArray(runtimeState.secondRunoutBoard)
		? runtimeState.secondRunoutBoard.slice() : [];

	notifArr.splice(
		0,
		notifArr.length,
		...(Array.isArray(runtimeState.notifications)
			? runtimeState.notifications.slice(0, MAX_ITEMS)
			: []),
	);
	pendingNotif.splice(
		0,
		pendingNotif.length,
		...(Array.isArray(runtimeState.pendingNotifications)
			? runtimeState.pendingNotifications
			: []),
	);

	if (logList) {
		logList.replaceChildren();
		const logEntries = Array.isArray(runtimeState.logEntries)
			? runtimeState.logEntries
			: notifArr;
		logEntries.forEach((message) => {
			const logEntry = document.createElement("div");
			logEntry.textContent = message;
			logList.appendChild(logEntry);
		});
	}

	renderNotificationBar(notification, notifArr);
	setSummaryButtonsVisible(runtimeState.summaryButtonsVisible === true);
}

function restoreGameState(savedGameState) {
	const allPlayers = savedGameState.allPlayers.map(normalizeSavedPlayer);
	const playerBySeatIndex = new Map(
		allPlayers.map((player) => [player.seatIndex, player]),
	);
	const activeSeatIndexes = Array.isArray(savedGameState.activeSeatIndexes)
		? savedGameState.activeSeatIndexes
		: savedGameState.players.map((player) => player.seatIndex);
	const activePlayers = activeSeatIndexes
		.map((seatIndex) => playerBySeatIndex.get(seatIndex))
		.filter((player) => player !== undefined);

	Object.assign(gameState, {
		gameMode: savedGameState.gameMode === "cash" ? "cash" : "tournament",
		cashSession: clonePlainValue(savedGameState.cashSession, null),
		currentPhaseIndex: normalizeNumber(savedGameState.currentPhaseIndex, 0),
		currentBet: normalizeNumber(savedGameState.currentBet, 0),
		pot: normalizeNumber(savedGameState.pot, 0),
		activeSeatIndex: savedGameState.activeSeatIndex ?? null,
		pendingSeatDecision: null,
		handId: normalizeNumber(savedGameState.handId, 0),
		nextDecisionId: normalizeNumber(savedGameState.nextDecisionId, 1),
		blindLevel: normalizeNumber(savedGameState.blindLevel, 0),
		gameStarted: savedGameState.gameStarted === true,
		gameFinished: savedGameState.gameFinished === true,
		openCardsMode: savedGameState.openCardsMode === true,
		spectatorMode: savedGameState.spectatorMode === true,
		raisesThisRound: normalizeNumber(savedGameState.raisesThisRound, 0),
		handInProgress: savedGameState.handInProgress === true,
		deck: Array.isArray(savedGameState.deck)
			? savedGameState.deck.slice()
			: INITIAL_DECK.slice(),
		cardGraveyard: Array.isArray(savedGameState.cardGraveyard)
			? savedGameState.cardGraveyard.slice()
			: [],
		communityCards: Array.isArray(savedGameState.communityCards)
			? savedGameState.communityCards.slice()
			: [],
		players: activePlayers,
		allPlayers,
		chipTransfer: clonePlainValue(savedGameState.chipTransfer, null),
		pendingAction: null,
		smallBlind: normalizeNumber(savedGameState.smallBlind, INITIAL_SMALL_BLIND),
		bigBlind: normalizeNumber(savedGameState.bigBlind, INITIAL_BIG_BLIND),
		chipUnit: normalizeNumber(savedGameState.chipUnit, CHIP_UNIT),
		lastRaise: normalizeNumber(savedGameState.lastRaise, INITIAL_BIG_BLIND),
		handContext: {
			...createHandContextState(),
			...clonePlainValue(savedGameState.handContext, {}),
		},
	});
}

function resetRuntimeBeforeRestore() {
	if (notifTimer) {
		clearTimeout(notifTimer);
		notifTimer = null;
	}
	if (stateSyncTimer !== null) {
		clearTimeout(stateSyncTimer);
		stateSyncTimer = null;
		stateSyncTimerDelay = null;
	}
	if (runoutPhaseTimer) {
		clearTimeout(runoutPhaseTimer);
		runoutPhaseTimer = null;
	}
	clearNewRoundCountdown({ notify: false });
	clearChipTransferFinishTimer();
	clearChipTransferAnimation(tableRenderTarget);
	humanTurnController.hide();
	isNotifProcessing = false;
}

function renderRestoredGameState() {
	seatRefs.forEach((seatRef) => {
		clearRenderedSeat(seatRef);
		seatRef.playerSeatIndex = null;
		seatRef.clearActionLabelState = null;
		seatRef.clearWinnerReactionState = null;
		renderSeatSetupState(seatRef, {
			visible: false,
			isBot: false,
			nameEditable: false,
			controlsVisible: false,
		});
	});

	gameState.players.forEach((player) => {
		bindSeatRefPlayer(player);
		renderSeatSetupState(getSeatRef(player), {
			visible: true,
			isBot: player.isBot,
			nameEditable: false,
			controlsVisible: false,
		});
		renderPlayerSeat(player);
		if (
			!player.isBot &&
			gameState.handInProgress &&
			!gameState.openCardsMode &&
			!player.folded &&
			player.holeCards.every(Boolean)
		) {
			showPlayerQr(player, player.holeCards[0], player.holeCards[1]);
		} else {
			hidePlayerQr(player);
		}
	});

	renderPot();
	renderTableCommunityCards(communityCardSlots, gameState.communityCards);
	renderSecondRunoutBoard();
	renderPlayerChipStacks();
	updateFastForwardButton();
	renderStatsOverlay();
	syncLogUi();
	instructionsButton.classList.add("hidden");
	renderCashControls();
	startButton.classList.toggle("hidden", gameState.handInProgress === true);
	if (!gameState.handInProgress) {
		setStartButtonLabel(gameState.cashSession?.practice ? "New sample" :
			gameState.gameMode === "cash" ? "New Hand" : "New Round");
	}
}

function restoreTableUrl() {
	tableId = null;
	syncTableUrlWithState();
}

function resumeRestoredFlow(flowState = {}) {
	setCurrentFlowState(flowState);
	if (flowState.type === "chip-transfer") {
		gameState.chipTransfer = null;
		clearChipTransferAnimation(tableRenderTarget);
		finishHandAfterShowdown();
		return;
	}
	if (flowState.type === "runout") {
		if (runoutCount === 0 && isAllInRunout(gameState.players, gameState.currentBet) &&
			gameState.communityCards.length < 5) {
			queueRunoutPhaseAdvance("restored-runout");
		} else {
			setPhase();
		}
		return;
	}
	if (flowState.type === "runout-choice") {
		openOverlay("runoutChoice");
		runOnceButton.focus();
		return;
	}
	if (flowState.type === "active-turn" && gameState.handInProgress) {
		startButton.classList.add("hidden");
		startBettingRound({
			resetRound: false,
			progressState: normalizeSavedProgressState(flowState.progressState),
			resumeTurn: {
				seatIndex: flowState.seatIndex,
				cycles: normalizeNumber(flowState.cycles, 0),
			},
		});
		return;
	}
	if (gameState.handInProgress) {
		startButton.classList.add("hidden");
		startBettingRound({ resetRound: false });
		return;
	}

	setCurrentFlowState({ type: "between-hands" });
	setSummaryButtonsVisible(true);
	setStartButtonLabel(gameState.cashSession?.practice ? "New sample" :
		gameState.gameMode === "cash" ? "New Hand" : "New Round");
	startButton.classList.remove("hidden");
	renderCashControls();
	if (gameState.gameMode !== "cash") {
		startNewRoundCountdown();
	}
	saveCurrentGameSnapshot();
	showCashTopUpPrompt();
}

function restoreSavedGame(snapshot) {
	resetRuntimeBeforeRestore();
	restoreRuntimeState(snapshot.runtimeState);
	restoreGameState(snapshot.gameState);
	if (snapshot.runtimeState?.historyCashTransactionCount === undefined) {
		historyCashTransactionCount = gameState.cashSession?.transactions?.length ?? 0;
	}
	activeHandHistory = null;
	if (snapshot.handHistory?.handId === gameState.handId) {
		try {
			replayHandHistory(snapshot.handHistory);
			activeHandHistory = snapshot.handHistory;
			if (activeHandHistory.events.at(-1)?.type === "hand.ended") {
				queueCompletedHandHistory(activeHandHistory);
			}
		} catch (error) {
			console.warn("saved hand history invalid", error);
		}
	}
	currentGameSaveEligible = hasExactlyOneHumanInSession();
	restoreTableUrl();
	renderRestoredGameState();
	syncRuntimePlayback();
	resumeRestoredFlow(snapshot.flowState);
	queueStateSync(0);
}

function openResumeGameOverlay(snapshot) {
	if (!resumeGameOverlay) {
		return;
	}
	pendingSavedGameSnapshot = snapshot;
	openOverlay("resume");
}

function closeResumeGameOverlay() {
	pendingSavedGameSnapshot = null;
	if (!resumeGameOverlay) {
		return;
	}
	resumeGameOverlay.classList.add("hidden");
	syncOverlayBackdrop();
}

function continueSavedGame() {
	const snapshot = pendingSavedGameSnapshot;
	if (!snapshot) {
		return;
	}
	removeSavedGameSnapshot();
	closeResumeGameOverlay();
	restoreSavedGame(snapshot);
}

function discardSavedGame() {
	removeSavedGameSnapshot();
	closeResumeGameOverlay();
	if (IS_PRACTICE_PAGE) {
		void beginPracticeFromRequest();
	}
}

function handlePageLifecycleSave() {
	if (suppressLifecycleSave) {
		return;
	}
	saveCurrentGameSnapshot();
}

/* --------------------------------------------------------------------------------------------------
Low-Level Utilities And Formatting Helpers
---------------------------------------------------------------------------------------------------*/

function logHistory(msg) {
	if (HISTORY_LOG) console.log(msg);
}

function logFlow(msg, data) {
	if (DEBUG_FLOW) {
		const ts = new Date().toISOString().slice(11, 23);
		if (data !== undefined) {
			console.log("%c" + ts, "color:#888", msg, data);
		} else {
			console.log("%c" + ts, "color:#888", msg);
		}
	}
}

function logSpeedmodeEvent(type, payload) {
	if (!SPEED_MODE) {
		return;
	}
	console.log("speedmode_event", { type, ...payload });
}

function clearBotCheckRaiseIntent(player, reason) {
	const intent = player.botLine?.checkRaiseIntent;
	if (!intent) {
		return;
	}

	logSpeedmodeEvent("bot_check_raise_intent_clear", {
		handId: gameState.handId ?? 0,
		player: player.name,
		seatIndex: player.seatIndex,
		reason,
		street: intent.street,
		edge: intent.edge,
		rawHandRank: intent.rawHandRank,
		rawHand: intent.rawHand,
		textureRisk: intent.textureRisk,
		structureTag: intent.structureTag,
		plannedAmount: intent.plannedAmount,
	});
	player.botLine.checkRaiseIntent = null;
}

function clearBotCheckRaiseIntents(reason) {
	gameState.players.forEach((player) =>
		clearBotCheckRaiseIntent(player, reason)
	);
}

function clearBotPassiveValueCheckIntent(player, reason) {
	const intent = player.botLine?.passiveValueCheckIntent;
	if (!intent) {
		return;
	}

	logSpeedmodeEvent("bot_passive_value_check_intent_clear", {
		handId: gameState.handId ?? 0,
		player: player.name,
		seatIndex: player.seatIndex,
		reason,
		street: intent.street,
		edge: intent.edge,
		rawHandRank: intent.rawHandRank,
		rawHand: intent.rawHand,
		textureRisk: intent.textureRisk,
		structureTag: intent.structureTag,
		plannedAmount: intent.plannedAmount,
	});
	player.botLine.passiveValueCheckIntent = null;
}

function clearBotPassiveValueCheckIntents(reason) {
	gameState.players.forEach((player) =>
		clearBotPassiveValueCheckIntent(player, reason)
	);
}

function buildSpeedmodeHandStartPlayers(players) {
	return players.map((player) => ({
		name: player.name,
		seatIndex: player.seatIndex,
		chipsStart: player.chips,
	}));
}

function buildSpeedmodeTotalBetByPlayer(contributors) {
	return contributors.reduce((totals, player) => {
		totals[player.name] = player.totalBet;
		return totals;
	}, {});
}

function buildSpeedmodeTotalBetBySeatIndex(contributors) {
	return contributors.reduce((totals, player) => {
		totals[player.seatIndex] = player.totalBet;
		return totals;
	}, {});
}

function buildSpeedmodePayoutByPlayer(totalPayoutByPlayer) {
	const payouts = {};
	for (const [player, amount] of totalPayoutByPlayer.entries()) {
		payouts[player.name] = amount;
	}
	return payouts;
}

function buildSpeedmodePayoutBySeatIndex(totalPayoutByPlayer) {
	const payouts = {};
	for (const [player, amount] of totalPayoutByPlayer.entries()) {
		payouts[player.seatIndex] = amount;
	}
	return payouts;
}

function createPageUrl(pageName) {
	const base = globalThis.location.origin +
		globalThis.location.pathname.replace(/[^/]*$/, "");
	return new URL(`${base}${pageName}`);
}

function formatPercent(numerator, denominator) {
	if (denominator === 0) {
		return "-";
	}
	return `${Math.round((numerator / denominator) * 100)}%`;
}

function getRandomItem(items) {
	return items[Math.floor(Math.random() * items.length)];
}

/* --------------------------------------------------------------------------------------------------
Seat And Player Binding Helpers
---------------------------------------------------------------------------------------------------*/

function getSeatRef(target) {
	if (typeof target === "number") {
		return seatRefs[target] ?? null;
	}
	if (!target) {
		return null;
	}
	if (target.seatEl) {
		return target;
	}
	if (typeof target.seatSlot === "number") {
		return seatRefs[target.seatSlot] ?? null;
	}
	return null;
}

function setPlayerActionState(player, actionName, labelUntil, amount = 0) {
	if (!player || !actionName) {
		clearPlayerActionState(player);
		return;
	}
	player.actionState = gameState.gameMode === "cash"
		? { name: actionName, amount, streetTotalTo: player.roundBet, persistent: true }
		: { name: actionName, labelUntil };
}

function clearPlayerActionState(player) {
	if (!player) {
		return;
	}
	player.actionState = null;
}

function clearPlayerWinnerReactionState(player) {
	player.winnerReactionEmoji = "";
	player.winnerReactionUntil = 0;
}

function bindSeatRefPlayer(player) {
	const seatRef = getSeatRef(player);
	if (!seatRef) {
		return;
	}
	seatRef.playerSeatIndex = player.seatIndex;
	seatRef.clearActionLabelState = () => clearPlayerActionState(player);
	seatRef.clearWinnerReactionState = () =>
		clearPlayerWinnerReactionState(player);
}

function buildPlayerSeatState(
	player,
	communityCards = getCommunityCardCodes(),
) {
	const publicPlayerView = buildPublicPlayerView(
		player,
		communityCards,
		gameState,
	);
	const winProbabilityLabel = publicPlayerView.showWinProbability &&
			typeof publicPlayerView.winProbability === "number"
		? `${Math.round(publicPlayerView.winProbability)}%`
		: "";

	return {
		name: publicPlayerView.name,
		chips: publicPlayerView.chips,
		roundBet: publicPlayerView.roundBet,
		visibleCardCodes: publicPlayerView.publicHoleCards,
		dealer: publicPlayerView.dealer,
		smallBlind: publicPlayerView.smallBlind,
		bigBlind: publicPlayerView.bigBlind,
		folded: publicPlayerView.folded,
		allIn: publicPlayerView.allIn,
		active: gameState.activeSeatIndex === player.seatIndex,
		winner: publicPlayerView.winner,
		handStrengthLabel: publicPlayerView.handStrengthLabel,
		winProbabilityLabel,
		actionState: publicPlayerView.actionState,
		winnerReaction: publicPlayerView.winnerReaction,
	};
}

function renderPlayerSeat(player, communityCards = getCommunityCardCodes()) {
	const seatRef = getSeatRef(player);
	if (!seatRef) {
		return;
	}
	renderHostSeat(seatRef, buildPlayerSeatState(player, communityCards));
}

function renderPlayerResolvedAction(player) {
	const seatRef = getSeatRef(player);
	if (!seatRef) {
		return;
	}
	renderSeatResolvedAction(seatRef, {
		playerName: player.name,
		actionName: player.actionState?.name,
		labelUntil: player.actionState?.labelUntil,
		amount: player.actionState?.amount,
		streetTotalTo: player.actionState?.streetTotalTo,
		persistent: player.actionState?.persistent,
		isFolded: player.folded,
	});
}

function getPlayerSeatRenderData(playerList = gameState.players) {
	return playerList
		.map((player) => {
			const seatRef = getSeatRef(player);
			if (!seatRef) {
				return null;
			}
			return {
				seatIndex: player.seatIndex,
				chips: player.chips,
				totalEl: seatRef.totalEl,
				stackChipEls: seatRef.stackChipEls,
			};
		})
		.filter((playerView) => playerView !== null);
}

function renderPlayerChipStacks(playerList = gameState.players) {
	renderChipStacks(getPlayerSeatRenderData(playerList));
}

function renderPlayerTotal(player) {
	renderPlayerSeat(player);
}

function setPlayerSeatName(player, text) {
	const nameEl = getSeatRef(player)?.nameEl ?? null;
	if (!nameEl) {
		return;
	}
	nameEl.textContent = text;
}

function showPlayerQr(player, card1, card2) {
	const seatRef = getSeatRef(player);
	if (!seatRef?.qrContainer || !seatRef.qrLink || !seatRef.remoteLink) {
		return;
	}

	seatRef.qrContainer.classList.remove("hidden");
	const holeCardsUrl = createPageUrl("hole-cards.html");
	holeCardsUrl.searchParams.set("card1", card1);
	holeCardsUrl.searchParams.set("card2", card2);
	holeCardsUrl.searchParams.set("name", player.name);
	holeCardsUrl.searchParams.set("chips", `${player.chips}`);
	holeCardsUrl.searchParams.set("seatIndex", `${player.seatIndex}`);
	if (tableId !== null) {
		holeCardsUrl.searchParams.set("tableId", tableId);
	}
	holeCardsUrl.searchParams.set("t", `${Date.now()}`);
	const url = holeCardsUrl.toString();
	seatRef.qrLink.replaceChildren();
	seatRef.qrLink.href = url;
	QrCreator.render({
		text: url,
		size: 200,
		fill: "#333",
		background: "#fff",
		radius: 0,
	}, seatRef.qrLink);

	if (tableId !== null) {
		const remoteTableUrl = createPageUrl("remoteTable.html");
		remoteTableUrl.searchParams.set("tableId", tableId);
		remoteTableUrl.searchParams.set("seatIndex", `${player.seatIndex}`);
		seatRef.remoteLink.href = remoteTableUrl.toString();
		seatRef.remoteLink.classList.remove("hidden");
	} else {
		seatRef.remoteLink.removeAttribute("href");
		seatRef.remoteLink.classList.add("hidden");
	}

	seatRef.qrContainer.dataset.url = url;
}

function hidePlayerQr(player) {
	const seatRef = getSeatRef(player);
	if (!seatRef?.qrContainer || !seatRef.qrLink || !seatRef.remoteLink) {
		return;
	}

	seatRef.qrContainer.classList.add("hidden");
	seatRef.qrLink.replaceChildren();
	seatRef.qrLink.removeAttribute("href");
	seatRef.remoteLink.removeAttribute("href");
	seatRef.remoteLink.classList.add("hidden");
	delete seatRef.qrContainer.dataset.url;
}

function resetPlayerRoundBet(player) {
	player.roundBet = 0;
	renderPlayerSeat(player);
}

function clearPlayerActionLabel(player) {
	clearPlayerActionState(player);
	renderPlayerResolvedAction(player);
}

function applyPlayerPatches(playerPatches) {
	playerPatches.forEach(({ player, patch }) => {
		Object.assign(player, patch);
	});
}

function applyGameStatePatch(gameStatePatch) {
	Object.assign(gameState, gameStatePatch);
}

function applyHandContextPatch(handContextPatch) {
	if (!handContextPatch) {
		return;
	}
	if (!gameState.handContext) {
		gameState.handContext = createHandContextState();
	}
	Object.assign(gameState.handContext, handContextPatch);
}

function clearPlayerWinnerReaction(player) {
	clearPlayerWinnerReactionState(player);
	renderPlayerSeat(player);
}

function showPlayerWinnerReaction(player, emoji, visibleUntil) {
	player.winnerReactionEmoji = emoji;
	player.winnerReactionUntil = visibleUntil;
	renderPlayerSeat(player);
}

/* --------------------------------------------------------------------------------------------------
Render And Overlay Helpers
---------------------------------------------------------------------------------------------------*/

function renderPot() {
	potEl.textContent = gameState.pot;
}

function setCommunityCards(cardCodes) {
	gameState.communityCards = cardCodes.slice();
	renderTableCommunityCards(communityCardSlots, gameState.communityCards);
}

function renderSecondRunoutBoard() {
	secondRunoutEl.classList.toggle("hidden", runoutCount !== 2);
	if (runoutCount === 2) {
		renderTableCommunityCards(secondRunoutSlots, secondRunoutBoard);
	}
}

function setPlayerVisibleHoleCards(player, visibleHoleCards) {
	player.visibleHoleCards = visibleHoleCards.slice();
	renderPlayerHoleCards(player);
}

function renderPlayerHoleCards(player) {
	renderPlayerSeat(player);
}

function getStatsPlayers() {
	return gameState.allPlayers.slice().sort((a, b) => {
		if (b.chips !== a.chips) {
			return b.chips - a.chips;
		}
		return a.seatIndex - b.seatIndex;
	});
}

function createStatsCell(tagName, value) {
	const cell = document.createElement(tagName);
	cell.textContent = `${value}`;
	return cell;
}

function renderStatsOverlay() {
	if (!statsTableBody) {
		return;
	}
	const isPractice = !!gameState.cashSession?.practice;
	statsPracticeNote.classList.toggle("hidden", !isPractice);

	statsTableBody.replaceChildren();
	getStatsPlayers().forEach((player) => {
		const row = document.createElement("tr");
		row.appendChild(createStatsCell("th", player.name));
		row.appendChild(createStatsCell("td", player.chips));
		row.appendChild(createStatsCell(
			"td",
			gameState.gameMode === "cash" && !isPractice ? player.cashInvested ?? 0 : "–",
		));
		row.appendChild(createStatsCell(
			"td",
			gameState.gameMode === "cash" && !isPractice ? player.chips - (player.cashInvested ?? 0) : "–",
		));
		row.appendChild(createStatsCell("td", player.stats.hands));
		row.appendChild(createStatsCell("td", player.stats.handsWon));
		row.appendChild(
			createStatsCell(
				"td",
				formatPercent(player.stats.handsWon, player.stats.hands),
			),
		);
		row.appendChild(createStatsCell("td", player.stats.showdowns));
		row.appendChild(createStatsCell("td", player.stats.showdownsWon));
		row.appendChild(
			createStatsCell(
				"td",
				formatPercent(
					player.stats.showdownsWon,
					player.stats.showdowns,
				),
			),
		);
		row.appendChild(createStatsCell("td", player.stats.folds));
		row.appendChild(createStatsCell("td", player.stats.foldsPreflop));
		row.appendChild(createStatsCell("td", player.stats.foldsPostflop));
		row.appendChild(createStatsCell("td", player.stats.allins));
		statsTableBody.appendChild(row);
	});
}

async function renderGroupedHandStats() {
	if (!statsGroupedBody || !statsGroupedStatus) {
		return;
	}
	const token = ++groupedStatsRenderToken;
	statsGroupedBody.replaceChildren();
	statsGroupedStatus.textContent = "Loading saved hands…";
	statsGroupedStatus.classList.remove("hidden");
	try {
		const histories = await loadCompletedHandHistories();
		if (token !== groupedStatsRenderToken || statsOverlay.classList.contains("hidden")) {
			return;
		}
		const rows = summarizeHeroHandGroups(histories);
		if (rows.length === 0) {
			statsGroupedStatus.textContent = "No completed hands with a human seat yet.";
			return;
		}
		for (const group of rows) {
			const row = document.createElement("tr");
			const roundedNet = Number(group.netBB.toFixed(2));
			const signedNet = `${roundedNet > 0 ? "+" : ""}${roundedNet}`;
			const rate = ({ count, opportunities }) =>
				`${count}/${opportunities} (${opportunities ? formatPercent(count, opportunities) : "–"})`;
			for (const [index, value] of [
				group.dimension, group.mode, group.group, group.hands,
				signedNet, rate(group.vpip), rate(group.pfr),
			].entries()) {
				const cell = createStatsCell(index === 0 ? "th" : "td", value);
				if (index === 0) {
					cell.scope = "row";
				}
				row.appendChild(cell);
			}
			statsGroupedBody.appendChild(row);
		}
		statsGroupedStatus.classList.add("hidden");
	} catch (error) {
		if (token !== groupedStatsRenderToken || statsOverlay.classList.contains("hidden")) {
			return;
		}
		console.warn("Could not load grouped hand stats", error);
		statsGroupedStatus.textContent = "Could not load saved hand stats.";
	}
}

function syncOverlayBackdrop() {
	const isOverlayOpen = Object.values(overlays).some(({ el }) =>
		el && !el.classList.contains("hidden")
	);
	overlayBackdrop.classList.toggle("hidden", !isOverlayOpen);
}

function isBlockingOverlayOpen() {
	return Object.values(overlays).some((overlay) =>
		overlay.blocking === true &&
		overlay.el &&
		!overlay.el.classList.contains("hidden")
	);
}

function closeTableMenu(restoreFocus = false) {
	const wasOpen = !tableMenu.classList.contains("hidden");
	tableMenu.classList.add("hidden");
	tableMenuButton.setAttribute("aria-expanded", "false");
	endSessionConfirm.classList.add("hidden");
	if (wasOpen) {
		renderCashControls();
		if (restoreFocus) {
			tableMenuButton.focus();
		}
	}
}

function toggleTableMenu() {
	if (!tableMenu.classList.contains("hidden")) {
		closeTableMenu();
		return;
	}
	tableMenu.classList.remove("hidden");
	tableMenuButton.setAttribute("aria-expanded", "true");
	tableMenu.querySelector("button:not(.hidden)")?.focus();
}

function showEndSessionConfirm() {
	if (!gameState.gameStarted || gameState.gameFinished) {
		return;
	}
	if (gameState.cashSession.endAfterHand) {
		gameState.cashSession.endAfterHand = false;
		renderCashControls();
		saveCurrentGameSnapshot();
		return;
	}
	endSessionConfirmText.textContent = gameState.handInProgress
		? "End after this hand? The current hand will finish and completed hands will stay saved."
		: "End this session? Completed hands will stay saved.";
	endSessionConfirmButton.textContent = gameState.handInProgress ? "End after hand" : "End session";
	endSessionConfirm.classList.remove("hidden");
	cashEndButton.classList.add("hidden");
	endSessionCancelButton.focus();
}

function openOverlay(name) {
	const overlay = overlays[name];
	if (!overlay) {
		return;
	}
	if (overlay.canOpen && !overlay.canOpen()) {
		return;
	}
	closeTableMenu();
	Object.entries(overlays).forEach(([key, entry]) => {
		if (key !== name && entry.el && !entry.el.classList.contains("hidden")) {
			entry.beforeClose?.();
		}
		entry.el?.classList.toggle("hidden", key !== name);
	});
	overlay.beforeOpen?.();
	syncOverlayBackdrop();
}

function closeOverlay(name) {
	const overlay = overlays[name];
	if (!overlay || overlay.blocking === true) {
		return;
	}
	if (!overlay.el.classList.contains("hidden")) {
		overlay.beforeClose?.();
		overlay.el.classList.add("hidden");
	}
	syncOverlayBackdrop();
}

function closeAllOverlays() {
	closeTableMenu();
	Object.values(overlays).forEach(({ el, blocking, beforeClose }) => {
		if (blocking !== true && el && !el.classList.contains("hidden")) {
			beforeClose?.();
			el.classList.add("hidden");
		}
	});
	syncOverlayBackdrop();
}

function syncLogUi() {
	const hasLogHistory = !!logList && logList.childElementCount > 0;
	const showSummaryButtons = !SPEED_MODE && summaryButtonsVisible;

	statsButton.classList.toggle("hidden", !showSummaryButtons);
	logButton.classList.toggle("hidden", !showSummaryButtons || !hasLogHistory);
}

function setSummaryButtonsVisible(isVisible) {
	summaryButtonsVisible = isVisible;
	syncLogUi();
}

function setStartButtonLabel(text) {
	if (startButtonLabel) {
		startButtonLabel.textContent = text;
		startButtonLabel.classList.remove("hidden");
		return;
	}
	startButton.textContent = text;
}

function showNewRoundCountdown(seconds) {
	if (!newRoundCountdown || !newRoundCountdownValue) {
		setStartButtonLabel(`New Round in ${seconds}`);
		return;
	}
	newRoundCountdownValue.textContent = String(seconds);
	newRoundCountdown.classList.remove("hidden");
}

function clearNewRoundCountdown({ notify } = { notify: false }) {
	const wasActive = newRoundCountdownTimer !== null ||
		newRoundCountdownSeconds > 0;
	if (newRoundCountdownTimer !== null) {
		clearTimeout(newRoundCountdownTimer);
		newRoundCountdownTimer = null;
	}
	newRoundCountdownSeconds = 0;
	if (newRoundControls) {
		newRoundControls.classList.remove("new-round-countdown-active");
	}
	startButton.classList.remove("new-round-countdown-active");
	if (newRoundCountdown) {
		newRoundCountdown.classList.add("hidden");
	}
	if (newRoundCancelButton) {
		newRoundCancelButton.classList.add("hidden");
		newRoundCancelButton.classList.remove("new-round-countdown-active");
	}
	if (newRoundCountdownValue) {
		newRoundCountdownValue.textContent = String(
			NEW_ROUND_COUNTDOWN_SECONDS,
		);
	}
	if (!newRoundCountdown || !newRoundCountdownValue) {
		setStartButtonLabel("New Round");
	}
	if (notify && wasActive) {
		enqueueNotification("New round countdown canceled.");
	}
}

function tickNewRoundCountdown() {
	newRoundCountdownSeconds--;
	if (newRoundCountdownSeconds <= 0) {
		clearNewRoundCountdown({ notify: false });
		preFlop();
		return;
	}
	showNewRoundCountdown(newRoundCountdownSeconds);
	newRoundCountdownTimer = setTimeout(
		tickNewRoundCountdown,
		NEW_ROUND_COUNTDOWN_INTERVAL,
	);
}

function startNewRoundCountdown() {
	clearNewRoundCountdown({ notify: false });
	if (SPEED_MODE || autoplayToGameEnd) {
		return;
	}
	newRoundCountdownSeconds = NEW_ROUND_COUNTDOWN_SECONDS;
	showNewRoundCountdown(newRoundCountdownSeconds);
	if (newRoundControls) {
		newRoundControls.classList.add("new-round-countdown-active");
	}
	startButton.classList.add("new-round-countdown-active");
	if (newRoundCancelButton) {
		newRoundCancelButton.classList.remove("hidden");
		newRoundCancelButton.classList.add("new-round-countdown-active");
	}
	newRoundCountdownTimer = setTimeout(
		tickNewRoundCountdown,
		NEW_ROUND_COUNTDOWN_INTERVAL,
	);
}

function cancelNewRoundCountdown() {
	clearNewRoundCountdown({ notify: true });
}

/* --------------------------------------------------------------------------------------------------
Notification And Playback Helpers
---------------------------------------------------------------------------------------------------*/

function isInstantFoldRunoutActive() {
	const humanPlayers = getHumanPlayers();
	return instantBotPlayback && gameState.handInProgress && humanPlayers.length > 0 &&
		humanPlayers.every((player) => player.folded);
}

function isFastPlaybackActive() {
	return SPEED_MODE || isTurboPlaybackActive();
}

function isTurboPlaybackActive() {
	return handFastForwardActive || autoplayToGameEnd || isInstantFoldRunoutActive();
}

function getNotifInterval() {
	if (SPEED_MODE) {
		return 0;
	}
	if (isTurboPlaybackActive()) {
		return FAST_FORWARD_NOTIF_INTERVAL;
	}
	return NOTIF_INTERVAL;
}

function getActionLabelDuration() {
	if (SPEED_MODE) {
		return 0;
	}
	if (isTurboPlaybackActive()) {
		return FAST_FORWARD_ACTION_LABEL_DURATION;
	}
	return ACTION_LABEL_DURATION;
}

function getPlayerActionNotificationText(playerName, actionName, amount = 0) {
	switch (actionName) {
		case "fold":
			return `${playerName} folded.`;
		case "check":
			return `${playerName} checked.`;
		case "call":
			return `${playerName} called ${amount}.`;
		case "raise":
			return `${playerName} raised to ${amount}.`;
		case "allin":
			return `${playerName} is all-in.`;
		default:
			return `${playerName} did something…`;
	}
}

function logSkippedPlayerActionProbability(
	player,
	action,
	skipProbabilityLogReason,
) {
	switch (skipProbabilityLogReason) {
		case "allin-runout-preflop":
			logFlow("winProbability: preflop all-in runout pending", {
				action,
				name: player.name,
			});
			break;
		case "fold-preflop":
			logFlow("winProbability: preflop fold skipped", {
				name: player.name,
			});
			break;
	}
}

function getRunoutPhaseDelay() {
	if (SPEED_MODE || isInstantFoldRunoutActive()) {
		return 0;
	}
	if (isTurboPlaybackActive()) {
		return FAST_FORWARD_RUNOUT_PHASE_DELAY;
	}
	return RUNOUT_PHASE_DELAY;
}

function scheduleNextNotif() {
	if (notifTimer) {
		clearTimeout(notifTimer);
	}
	notifTimer = setTimeout(() => {
		notifTimer = null;
		showNextNotif();
	}, getNotifInterval());
}

function deliverNotification(msg) {
	// newest message first for tracking
	if (logList) {
		const logEntry = document.createElement("div");
		logEntry.textContent = msg;
		logList.prepend(logEntry);
	}
	notifArr.unshift(msg);
	if (notifArr.length > MAX_ITEMS) notifArr.pop();
	syncLogUi();
	queueStateSync();
	renderNotificationBar(notification, notifArr);
	logHistory(msg);
}

function flushPendingNotifications() {
	if (notifTimer) {
		clearTimeout(notifTimer);
		notifTimer = null;
	}
	if (pendingNotif.length === 0) {
		isNotifProcessing = false;
		return;
	}
	isNotifProcessing = true;
	while (pendingNotif.length > 0) {
		deliverNotification(pendingNotif.shift());
	}
	isNotifProcessing = false;
}

function refreshNotificationPlayback() {
	if (!isNotifProcessing || pendingNotif.length === 0) {
		return;
	}
	scheduleNextNotif();
}

function syncRuntimePlayback() {
	setBotPlaybackMode({
		fast: isTurboPlaybackActive(),
		instant: instantBotPlayback,
	});
	if (isFastPlaybackActive()) {
		flushPendingNotifications();
		return;
	}
	refreshNotificationPlayback();
}

function clearChipTransferFinishTimer() {
	if (chipTransferFinishTimer === null) {
		return;
	}
	clearTimeout(chipTransferFinishTimer);
	chipTransferFinishTimer = null;
}

function enqueueNotification(msg) {
	pendingNotif.push(msg);
	if (isFastPlaybackActive()) {
		flushPendingNotifications();
		return;
	}
	if (!isNotifProcessing) {
		showNextNotif();
	}
}

function showNextNotif() {
	if (pendingNotif.length === 0) {
		isNotifProcessing = false;
		notifTimer = null;
		return;
	}
	isNotifProcessing = true;
	deliverNotification(pendingNotif.shift());
	scheduleNextNotif();
}

function clearActionLabels() {
	gameState.players.forEach((player) => {
		clearPlayerActionLabel(player);
	});
}

function getHumanPlayers() {
	return gameState.players.filter((p) => !p.isBot);
}

function getHumansWithChipsCount() {
	return gameState.players.filter((p) => !p.isBot && p.chips > 0).length;
}

function updateFastForwardButton() {
	if (!fastForwardButton) {
		return;
	}
	const humanPlayers = getHumanPlayers();
	const noHumanCanAct = humanPlayers.length === 0 ||
		humanPlayers.every((player) => player.folded);
	const shouldShow = !SPEED_MODE &&
		hadHumansAtStart &&
		gameState.handInProgress &&
		!gameState.gameFinished &&
		!handFastForwardActive &&
		!autoplayToGameEnd &&
		!isInstantFoldRunoutActive() &&
		noHumanCanAct;
	fastForwardButton.classList.toggle("hidden", !shouldShow);
}

function resetRuntimeFastForward() {
	handFastForwardActive = false;
	autoplayToGameEnd = false;
	syncRuntimePlayback();
	updateFastForwardButton();
}

function activateFastForward() {
	if (
		!gameState.handInProgress || handFastForwardActive ||
		autoplayToGameEnd || SPEED_MODE
	) {
		return;
	}
	handFastForwardActive = true;
	syncRuntimePlayback();
	updateFastForwardButton();
	if (runoutPhaseTimer) {
		clearTimeout(runoutPhaseTimer);
		runoutPhaseTimer = null;
		setPhase();
	}
}

/* --------------------------------------------------------------------------------------------------
Remote State-Sync Helpers
---------------------------------------------------------------------------------------------------*/

function registerBotReveal(player) {
	if (player?.stats) {
		player.stats.reveals++;
	}
}

function hasStateSyncEnabled() {
	return tableId !== null;
}

function syncTableUrlWithState() {
	const tableUrl = new URL(globalThis.location.href);
	if (tableId === null) {
		tableUrl.searchParams.delete("tableId");
	} else {
		tableUrl.searchParams.set("tableId", tableId);
	}
	globalThis.history.replaceState(null, "", tableUrl.toString());
}

function initStateSyncForGame() {
	tableId = null;
	syncTableUrlWithState();
}

function createTurnToken() {
	return `${Date.now().toString(36)}${
		Math.random().toString(36).slice(2, 8)
	}`;
}

function setPendingAction(player) {
	if (
		!hasStateSyncEnabled() || !player || player.isBot || player.folded ||
		player.allIn
	) {
		if (gameState.pendingAction !== null) {
			gameState.pendingAction = null;
			queueStateSync(0);
		}
		return null;
	}

	const actionState = getPlayerActionState(gameState, player);
	const pendingAction = {
		seatIndex: player.seatIndex,
		turnToken: createTurnToken(),
		needToCall: actionState.needToCall,
		minAmount: actionState.minAmount,
		maxAmount: actionState.maxAmount,
		stackAmount: actionState.stackAmount,
		minRaise: actionState.minRaise,
		maxRaiseAmount: actionState.maxRaiseAmount,
		canCheck: actionState.canCheck,
		canRaise: actionState.canRaise,
		chipUnit: actionState.chipUnit,
		buttonLabel: getActionButtonLabel(actionState.minAmount, actionState),
	};
	gameState.pendingAction = pendingAction;
	queueStateSync(0);
	return pendingAction;
}

function clearPendingAction() {
	if (gameState.pendingAction === null) {
		return;
	}
	gameState.pendingAction = null;
	queueStateSync(0);
}

async function fetchPendingRemoteAction(turnToken) {
	if (!hasStateSyncEnabled() || !turnToken) {
		return null;
	}

	try {
		const url = `${ACTION_SYNC_ENDPOINT}?tableId=${
			encodeURIComponent(tableId)
		}&turnToken=${encodeURIComponent(turnToken)}`;
		const res = await fetch(url, {
			cache: "no-store",
		});
		if (res.status === 204) {
			return null;
		}
		if (!res.ok) {
			logFlow("remote action poll failed", { status: res.status });
			return null;
		}
		return await res.json();
	} catch (error) {
		logFlow("remote action poll failed", error);
		return null;
	}
}

async function sendTableState() {
	const payload = {
		tableId: tableId,
		view: buildSyncView(gameState, notifArr.slice(0, MAX_ITEMS)),
	};

	try {
		const res = await fetch(STATE_SYNC_ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		if (!res.ok) {
			throw new Error(`state sync failed with status ${res.status}`);
		}
	} catch (error) {
		logFlow("state sync failed", error);
		queueStateSync();
	}
}

function queueStateSync(delay = STATE_SYNC_DELAY) {
	if (!hasStateSyncEnabled()) {
		return;
	}

	const nextDelay = Math.max(0, delay);
	if (stateSyncTimer !== null) {
		if (stateSyncTimerDelay !== null && stateSyncTimerDelay <= nextDelay) {
			return;
		}
		clearTimeout(stateSyncTimer);
	}

	stateSyncTimerDelay = nextDelay;
	stateSyncTimer = setTimeout(() => {
		stateSyncTimer = null;
		stateSyncTimerDelay = null;
		sendTableState();
	}, nextDelay);
}

const humanTurnController = createHumanTurnController({
	foldButton,
	actionButton,
	amountControls,
	amountSlider,
	sliderOutput,
	decrementButton: amountDecrementButton,
	incrementButton: amountIncrementButton,
	potPresetButtons,
	actionPollInterval: ACTION_POLL_INTERVAL,
	actionStep: CHIP_UNIT,
	onControlsHidden: updateFastForwardButton,
	onNewTurn: () => {
		if (!hasStateSyncEnabled()) {
			playTurnChime();
		}
	},
	setActiveTurnPlayer,
	setPendingAction,
	clearPendingAction,
	fetchPendingRemoteAction,
	applyTurnAction,
	continueAfterResolvedTurn,
	getPlayerActionState: (player) => getPlayerActionState(gameState, player),
	getResolvedTurnMeta,
});

/* --------------------------------------------------------------------------------------------------
Card Visibility, Hand-Strength, Reveal, And Winner-Reaction Logic
---------------------------------------------------------------------------------------------------*/

function revealPlayerHoleCards(player) {
	setPlayerVisibleHoleCards(player, [true, true]);
}

function getCommunityCardCodes() {
	return gameState.communityCards.slice();
}

function recordCashHandEvent(type, data, visibility) {
	if (activeHandHistory) {
		activeHandHistory = appendHandEvent(activeHandHistory, type, data, visibility);
	}
}

function recordPublicHoleReveal(player, cards) {
	if (!activeHandHistory) {
		return;
	}
	const previouslyRevealed = new Set(activeHandHistory.events
		.filter((event) => event.type === "hole.revealed" && event.data.seatIndex === player.seatIndex)
		.flatMap((event) => event.data.cards));
	const newCards = cards.filter((card) => card && !previouslyRevealed.has(card));
	if (newCards.length > 0) {
		recordCashHandEvent("hole.revealed", {
			seatIndex: player.seatIndex,
			cards: newCards,
		});
	}
}

function revealActiveHoleCards() {
	gameState.players.filter((p) => !p.folded).forEach((p) => {
		revealPlayerHoleCards(p);
		recordPublicHoleReveal(p, p.holeCards);
		hidePlayerQr(p);
	});
	updateHandStrengthDisplays();
}

function formatCardLabel(cardCode) {
	if (!cardCode || cardCode.length < 2) {
		return "";
	}
	const rank = cardCode[0] === "T" ? "10" : cardCode[0];
	const suit = CARD_SUIT_SYMBOLS[cardCode[1]] || cardCode[1];
	return `${rank}${suit}`;
}

function applyBotReveal(player, revealDecision) {
	if (!revealDecision) {
		return;
	}
	recordPublicHoleReveal(player, revealDecision.codes);
	if (gameState.spectatorMode) {
		updateHandStrengthDisplays();
		return;
	}
	const revealedCards = new Set(revealDecision.codes);
	setPlayerVisibleHoleCards(
		player,
		player.holeCards.map((cardCode) => revealedCards.has(cardCode)),
	);
	hidePlayerQr(player);
	updateHandStrengthDisplays();
}

function getLuckyWinnerReactionGap(player, showdownPlayers = []) {
	const playerSnapshot = player?.lastNonFinalWinProbability;
	if (typeof playerSnapshot !== "number" || !Array.isArray(showdownPlayers)) {
		return null;
	}

	let hasOtherSnapshot = false;
	let highestSnapshot = playerSnapshot;
	showdownPlayers.forEach((showdownPlayer) => {
		if (showdownPlayer === player) {
			return;
		}
		const showdownSnapshot = showdownPlayer?.lastNonFinalWinProbability;
		if (typeof showdownSnapshot !== "number") {
			return;
		}
		hasOtherSnapshot = true;
		if (showdownSnapshot > highestSnapshot) {
			highestSnapshot = showdownSnapshot;
		}
	});

	if (!hasOtherSnapshot || playerSnapshot === highestSnapshot) {
		return null;
	}

	return highestSnapshot - playerSnapshot;
}

function getWinnerReactionEmoji(player, context) {
	if (context.revealedPlayers.has(player)) {
		return getRandomItem(WINNER_REACTION_EMOJIS.reveal);
	}

	if (context.activePlayerCount === 1) {
		return getRandomItem(WINNER_REACTION_EMOJIS.uncontested);
	}

	if (context.mainPotWinnerCount > 1) {
		return getRandomItem(WINNER_REACTION_EMOJIS.split);
	}

	if (context.hadShowdown) {
		const luckyGap = getLuckyWinnerReactionGap(
			player,
			context.showdownPlayers,
		);
		if (
			luckyGap !== null &&
			luckyGap >= WINNER_REACTION_LUCKY_MIN_GAP
		) {
			return getRandomItem(WINNER_REACTION_EMOJIS.lucky);
		}
	}

	const totalPayout = context.totalPayout;
	const stackBeforePayout = context.stackBeforePayout;
	const stackAfterPayout = stackBeforePayout + totalPayout;
	if (
		stackBeforePayout <= 6 * context.bigBlind &&
		stackAfterPayout >= 12 * context.bigBlind &&
		stackAfterPayout >= stackBeforePayout * 3
	) {
		return getRandomItem(WINNER_REACTION_EMOJIS.comeback);
	}

	if (context.hadShowdown) {
		const solvedHand = getVisibleSolvedHand(player, context.communityCards);
		if (solvedHand) {
			if (
				solvedHand.descr === "Royal Flush" ||
				WINNER_REACTION_MONSTER_HANDS.has(solvedHand.name)
			) {
				return getRandomItem(WINNER_REACTION_EMOJIS.monsterHand);
			}
			if (WINNER_REACTION_STRONG_HANDS.has(solvedHand.name)) {
				return getRandomItem(WINNER_REACTION_EMOJIS.strongHand);
			}
		}
	}

	if (totalPayout >= Math.max(12 * context.bigBlind, stackBeforePayout)) {
		return getRandomItem(WINNER_REACTION_EMOJIS.bigPot);
	}

	return getRandomItem(WINNER_REACTION_EMOJIS.fallback);
}

function triggerMainPotWinnerReactions(context) {
	if (isFastPlaybackActive() || context.mainPotWinners.length === 0) {
		return;
	}

	context.mainPotWinners.forEach((player) => {
		const totalPayout = context.totalPayoutByPlayer.get(player) || 0;
		if (totalPayout <= 0) {
			return;
		}
		const emoji = getWinnerReactionEmoji(player, {
			...context,
			totalPayout,
			stackBeforePayout: player.chips,
		});
		const visibleUntil = Date.now() + WINNER_REACTION_DURATION;
		player.winnerReactionEmoji = emoji;
		player.winnerReactionUntil = visibleUntil;
		showPlayerWinnerReaction(player, emoji, visibleUntil);
		queueStateSync(0);
	});
}

function updateHandStrengthDisplays() {
	const communityCards = getCommunityCardCodes();
	gameState.players.forEach((player) =>
		renderPlayerSeat(player, communityCards)
	);
}

function updateWinProbabilityDisplays() {
	const communityCards = getCommunityCardCodes();
	gameState.players.forEach((player) =>
		renderPlayerSeat(player, communityCards)
	);
}

function computeSpectatorWinProbabilities(reason = "") {
	if (
		!gameState.spectatorMode &&
		!isAllInRunout(gameState.players, gameState.currentBet)
	) {
		return;
	}
	if (gameState.currentPhaseIndex === 0) {
		logFlow("winProbability: preflop skipped", { reason });
		updateWinProbabilityDisplays();
		return;
	}

	const communityCards = getCommunityCardCodes();
	const missingCount = 5 - communityCards.length;
	if (missingCount < 0) {
		logFlow("winProbability: invalid board state", {
			communityCards,
			missingCount,
		});
		return;
	}

	const activePlayers = gameState.players.filter((p) => !p.folded);
	if (activePlayers.length === 0) {
		updateWinProbabilityDisplays();
		return;
	}

	gameState.players.forEach((p) => {
		p.winProbability = p.folded ? 0 : null;
	});
	const result = calculateWinProbabilities(
		gameState.players,
		communityCards,
		gameState.deck,
	);

	if (result.status === "invalid_board") {
		logFlow("winProbability: invalid board state", {
			communityCards,
			missingCount,
		});
		return;
	}

	if (result.status === "no_players") {
		updateWinProbabilityDisplays();
		return;
	}

	if (result.status === "too_many_boards") {
		logFlow("winProbability: skipped heavy enumeration", {
			phase: getCurrentPhase(gameState.currentPhaseIndex),
			reason,
			missingCount,
			totalBoards: result.totalBoards,
			deckSize: gameState.deck.length,
		});
		updateWinProbabilityDisplays();
		return;
	}

	if (result.status === "no_boards") {
		logFlow("winProbability: no boards to evaluate", {
			deckSize: gameState.deck.length,
			missingCount,
		});
		updateWinProbabilityDisplays();
		return;
	}

	result.activePlayers.forEach((player) => {
		player.winProbability = result.probabilities.get(player) ?? null;
		if (missingCount > 0 && typeof player.winProbability === "number") {
			player.lastNonFinalWinProbability = player.winProbability;
		}
	});

	updateWinProbabilityDisplays();

	logFlow("winProbability", {
		phase: getCurrentPhase(gameState.currentPhaseIndex),
		reason,
		missingCount,
		totalBoards: result.totalBoards,
		boards: result.boardsSeen,
		players: result.activePlayers.map((player) => ({
			name: player.name,
			winProbability: Number(player.winProbability.toFixed(2)),
		})),
	});
}

/* --------------------------------------------------------------------------------------------------
Game Setup And Hand Lifecycle
---------------------------------------------------------------------------------------------------*/

function readCashSetup() {
	const bigBlind = Number(cashBigBlindInput.value);
	return createCashSessionConfig({
		smallBlind: bigBlind / 2,
		bigBlind,
		buyInBB: Number(cashBuyInBBInput.value),
		topUpThresholdBB: Number(cashTopUpBBInput.value),
		autoTopUp: cashAutoTopUpInput.checked,
	});
}

function updateCashSetupStackPreview() {
	if (gameState.gameStarted) {
		return;
	}
	const bigBlind = Number(cashBigBlindInput.value);
	const buyInBB = Number(cashBuyInBBInput.value);
	const buyInChips = bigBlind * buyInBB;
	const validBigBlind = Number.isSafeInteger(bigBlind) && bigBlind >= 2 && bigBlind % 2 === 0;
	cashSmallBlindPreview.textContent = validBigBlind
		? `Small blind: ${bigBlind / 2}` : "Small blind: enter an even BB";
	if (!validBigBlind ||
		!Number.isSafeInteger(buyInBB) || buyInBB < 20 || buyInBB > 500 ||
		!Number.isSafeInteger(buyInChips)) {
		return;
	}
	seatRefs.forEach((seatRef) => {
		if (!seatRef.seatEl.classList.contains("hidden")) {
			seatRef.totalEl.textContent = `${buyInChips}`;
		}
	});
}

function getCashHuman() {
	return gameState.allPlayers.find((player) => !player.isBot) ?? null;
}

function renderCashControls() {
	const active = gameState.gameMode === "cash" && gameState.gameStarted;
	const practice = gameState.cashSession?.practice;
	cashSetup.classList.toggle("hidden", gameState.gameStarted || IS_PRACTICE_PAGE);
	cashStatus.classList.toggle("hidden", !active);
	menuStartTools.classList.toggle("hidden", gameState.gameStarted || IS_PRACTICE_PAGE);
	menuTableTools.classList.toggle("hidden", instructionsButton.classList.contains("hidden"));
	if (active) {
		const config = gameState.cashSession;
		const state = gameState.gameFinished ? " · Session ended" :
			config.endAfterHand ? " · Ending after hand" :
			config.paused ? (gameState.handInProgress ? " · Pausing after hand" : " · Paused") : "";
		cashStatus.textContent = practice
			? `Similar sample ${practice.sampleOrdinal} · ${config.smallBlind}/${config.bigBlind} chips · no score`
			: `${config.smallBlind}/${config.bigBlind} chips · ` +
				`${config.buyInBB} BB buy-in · no rake${state}`;
	}
	practiceContext.classList.toggle("hidden", !active || !practice);
	if (active && practice) {
		practiceContext.textContent = `${practice.filters.seats.length} seats · ` +
			`${practice.filters.priorFoldSeatIndexes.length} scripted folds before your decision · ` +
			"fresh deck; free-table bankroll unchanged";
	}
	menuSessionTools.classList.toggle("hidden", (!active || gameState.gameFinished) && !IS_PRACTICE_PAGE);
	practiceReturnButton.classList.toggle("hidden", !IS_PRACTICE_PAGE);
	const betweenHands = active && !gameState.handInProgress && !gameState.gameFinished;
	if (betweenHands && currentFlowState.type === "between-hands") {
		startButton.classList.toggle("hidden", gameState.cashSession.paused);
	}
	const human = getCashHuman();
	cashTopUpButton.classList.toggle(
		"hidden",
		!!practice || !betweenHands || !human || human.chips >= gameState.cashSession.buyInChips,
	);
	cashPauseButton.classList.toggle("hidden", !!practice || !active || gameState.gameFinished);
	cashEndButton.classList.toggle("hidden", !!practice || !active || gameState.gameFinished ||
		!endSessionConfirm.classList.contains("hidden"));
	if (active && !gameState.gameFinished) {
		cashEndButton.textContent = gameState.cashSession.endAfterHand
			? "Cancel end after hand"
			: (gameState.handInProgress ? "End after hand" : "End session");
		cashPauseButton.textContent = gameState.cashSession.paused
			? (gameState.handInProgress ? "Cancel Pause" : "Resume")
			: (gameState.handInProgress ? "Pause After Hand" : "Pause");
	}
}

function topUpCashHuman() {
	const human = getCashHuman();
	const plan = human ? planCashTopUp(gameState, human) : null;
	if (!plan) {
		return false;
	}
	Object.assign(human, plan.playerPatch);
	applyGameStatePatch(plan.gameStatePatch);
	renderSeatSetupState(getSeatRef(human), {
		visible: true,
		nameEditable: false,
		controlsVisible: false,
	});
	renderPlayerSeat(human);
	renderPlayerChipStacks();
	renderStatsOverlay();
	renderCashControls();
	enqueueNotification(`${human.name} topped up ${plan.transaction.amount} chips.`);
	saveCurrentGameSnapshot();
	return true;
}

function showCashTopUpPrompt() {
	if (gameState.gameMode !== "cash" || !gameState.gameStarted ||
		gameState.handInProgress || gameState.gameFinished || gameState.cashSession.autoTopUp ||
		gameState.cashSession.practice) {
		return false;
	}
	const human = getCashHuman();
	if (!human || human.chips > 0) {
		return false;
	}
	const plan = planCashTopUp(gameState, human);
	if (!plan) {
		return false;
	}
	cashTopUpDetails.textContent = `Add ${plan.transaction.amount} chips to return to your ` +
		`${gameState.cashSession.buyInBB} BB buy-in.`;
	cashTopUpConfirmButton.textContent = `Top up ${plan.transaction.amount}`;
	openOverlay("topUp");
	cashTopUpConfirmButton.focus();
	return true;
}

function showLossExportPrompt() {
	if (SPEED_MODE || !activeHandHistory) {
		return false;
	}
	const net = getHeroHandNet(activeHandHistory);
	if (net === null || net >= 0) {
		return false;
	}
	lossExportDetails.textContent = `You lost ${-net} chips this hand. ` +
		"Copy its hand text for review, or continue playing.";
	lossExportNewHandButton.textContent = gameState.gameFinished ? "New Session" :
		gameState.cashSession.practice ? "New sample" : "New Hand";
	openOverlay("lossExport");
	lossExportNewHandButton.focus();
	return true;
}

function dismissLossExportPrompt() {
	if (lossExportOverlay.classList.contains("hidden")) {
		return;
	}
	lossExportOverlay.classList.add("hidden");
	syncOverlayBackdrop();
	if (!showCashTopUpPrompt()) {
		(startButton.classList.contains("hidden") ? tableMenuButton : startButton).focus();
	}
}

function startAfterLossExportPrompt() {
	if (lossExportOverlay.classList.contains("hidden")) {
		return;
	}
	lossExportOverlay.classList.add("hidden");
	syncOverlayBackdrop();
	if (gameState.cashSession?.paused) {
		toggleCashPause();
	}
	if (IS_PRACTICE_PAGE) {
		startPracticeSample();
	} else {
		startGame();
	}
}

async function copyLossHandText() {
	if (lossExportCopyButton.disabled) {
		return;
	}
	lossExportCopyButton.disabled = true;
	try {
		await navigator.clipboard.writeText(formatHandText(activeHandHistory));
		if (!lossExportOverlay.classList.contains("hidden")) {
			enqueueNotification("Hand text copied.");
			dismissLossExportPrompt();
		}
	} catch (error) {
		console.warn("hand text copy failed", error);
		if (!lossExportOverlay.classList.contains("hidden")) {
			enqueueNotification("Could not copy. Check clipboard access and try again.");
		}
	} finally {
		lossExportCopyButton.disabled = false;
	}
}

function toggleCashPause() {
	if (gameState.gameMode !== "cash" || !gameState.gameStarted || gameState.gameFinished) {
		return;
	}
	gameState.cashSession = {
		...gameState.cashSession,
		paused: !gameState.cashSession.paused,
	};
	clearNewRoundCountdown({ notify: false });
	renderCashControls();
	enqueueNotification(gameState.cashSession.paused
		? (gameState.handInProgress ? "Session will pause after this hand." : "Session paused.")
		: "Session resumed.");
	saveCurrentGameSnapshot();
}

function endCashSession() {
	if (gameState.gameMode !== "cash" || !gameState.gameStarted || gameState.handInProgress) {
		return;
	}
	const cashOuts = gameState.allPlayers.map((player) => ({
		type: "cash_out",
		seatIndex: player.seatIndex,
		amount: player.chips,
		handId: gameState.handId,
	}));
	gameState.cashSession = {
		...gameState.cashSession,
		endAfterHand: false,
		endedAt: Date.now(),
		transactions: [...gameState.cashSession.transactions, ...cashOuts],
	};
	gameState.gameFinished = true;
	clearNewRoundCountdown({ notify: false });
	setStartButtonLabel("New Session");
	startButton.classList.remove("hidden");
	renderCashControls();
	renderStatsOverlay();
	setSummaryButtonsVisible(true);
	enqueueNotification("Cash session ended. Open Menu > Statistics for net results.");
	removeSavedGameSnapshot();
}

async function startSimilarPracticeFromReview() {
	if (!selectedPracticePlan || gameState.handInProgress) {
		return;
	}
	await persistViewedHandAnnotation();
	try {
		const annotation = await readHandAnnotation(selectedPracticePlan.source.handKey);
		if (annotation.decisionSeq !== selectedPracticePlan.source.decisionSeq) {
			throw new RangeError("Decision mark was not saved");
		}
	} catch (error) {
		console.warn("practice mark confirmation failed", error);
		enqueueNotification("Could not save this decision mark.");
		return;
	}
	saveCurrentGameSnapshot();
	if (gameState.gameStarted && !gameState.gameFinished && !readSavedGameSnapshot()) {
		enqueueNotification("Could not save the current table before practice.");
		return;
	}
	const url = new URL(globalThis.location.href);
	url.searchParams.set("practice", selectedPracticePlan.source.handKey);
	url.searchParams.set("decision", String(selectedPracticePlan.source.decisionSeq));
	url.searchParams.delete("tableId");
	url.searchParams.delete("speedmode");
	globalThis.location.assign(url.toString());
}

function returnToFreeTable() {
	saveCurrentGameSnapshot();
	const url = new URL(globalThis.location.href);
	url.searchParams.delete("practice");
	url.searchParams.delete("decision");
	url.searchParams.delete("tableId");
	globalThis.location.assign(url.toString());
}

function startPracticeSample() {
	const practice = gameState.cashSession?.practice;
	if (!practice || gameState.handInProgress) {
		return;
	}
	const seats = practice.filters.seats;
	for (const player of gameState.allPlayers) {
		const sourceSeat = seats.find((seat) => seat.seatIndex === player.seatIndex);
		player.chips = sourceSeat.startingChips;
		player.cashInvested = sourceSeat.startingChips;
		player.dealer = false;
		for (const key of Object.keys(player.stats)) {
			player.stats[key] = 0;
		}
	}
	const dealerIndex = seats.findIndex((seat) => seat.seatIndex === practice.filters.dealerSeatIndex);
	const previousDealerSeatIndex = seats[(dealerIndex + seats.length - 1) % seats.length].seatIndex;
	const seedValue = new Uint32Array(1);
	do {
		globalThis.crypto.getRandomValues(seedValue);
	} while (seedValue[0] === practice.deckSeed);
	gameState.cashSession = {
		...gameState.cashSession,
		lastDealerSeatIndex: previousDealerSeatIndex,
		practice: {
			...practice,
			sampleOrdinal: totalHands + 1,
			resetIndex: totalHands,
			sampleId: globalThis.crypto.randomUUID(),
			deckSeed: seedValue[0],
			scriptedFoldsApplied: 0,
		},
	};
	gameState.deck = INITIAL_DECK.slice();
	gameState.cardGraveyard = [];
	preFlop();
}

async function beginPracticeFromRequest() {
	try {
		if (!Number.isSafeInteger(practiceDecisionSeq) || practiceDecisionSeq < 1) {
			throw new RangeError("Invalid practice decision");
		}
		const [histories, annotation] = await Promise.all([
			loadCompletedHandHistories(), readHandAnnotation(practiceSourceKey),
		]);
		const history = histories.find((entry) => getHandHistoryKey(entry) === practiceSourceKey);
		const plan = history && annotation.decisionSeq === practiceDecisionSeq
			? deriveSimilarSpot(history, practiceDecisionSeq) : null;
		if (!plan) {
			throw new RangeError("Marked decision is unavailable for similar samples");
		}
		const filters = plan.filters;
		const cashConfig = createCashSessionConfig({
			smallBlind: filters.smallBlind,
			bigBlind: filters.bigBlind,
			buyInBB: 100,
			topUpThresholdBB: 0,
			autoTopUp: false,
		});
		resetRuntimeFastForward();
		gameState.gameMode = "cash";
		gameState.cashSession = cashConfig;
		gameState.smallBlind = filters.smallBlind;
		gameState.bigBlind = filters.bigBlind;
		gameState.chipUnit = filters.chipUnit;
		gameState.lastRaise = filters.bigBlind;
		gameState.handId = 0;
		gameState.nextDecisionId = 1;
		totalHands = 0;
		for (const seatRef of seatRefs) {
			const sourceSeat = filters.seats[seatRef.seatSlot];
			renderSeatSetupState(seatRef, { visible: !!sourceSeat });
			seatRef.nameEl.textContent = sourceSeat && !sourceSeat.isBot ? sourceSeat.name : "";
		}
		createPlayers(false);
		for (const player of gameState.players) {
			const sourceSeat = filters.seats[player.seatIndex];
			player.name = sourceSeat.name;
			player.botStyle = sourceSeat.botStyle;
			player.botStyleVersion = player.isBot ? CASH_BOT_STYLE_VERSION : null;
			player.chips = sourceSeat.startingChips;
			player.cashInvested = sourceSeat.startingChips;
			renderPlayerSeat(player);
		}
		gameState.cashSession = {
			...cashConfig,
			historySessionId: createHistorySessionId(),
			transactions: filters.seats.map((seat) => ({
				type: "buy_in",
				seatIndex: seat.seatIndex,
				amount: seat.startingChips,
				handId: 0,
			})),
			practice: {
				mode: "similar_sample",
				source: plan.source,
				filters,
				sampleOrdinal: 0,
				resetIndex: 0,
				sampleId: null,
				deckSeed: null,
				scriptedFoldsApplied: 0,
			},
		};
		activeHandHistory = null;
		historyCashTransactionCount = 0;
		hadHumansAtStart = true;
		currentGameSaveEligible = true;
		gameState.gameStarted = true;
		for (const seatRef of seatRefs) {
			renderSeatSetupState(seatRef, { nameEditable: false, controlsVisible: false });
		}
		instructionsButton.classList.add("hidden");
		initStateSyncForGame();
		renderCashControls();
		startPracticeSample();
	} catch (error) {
		console.warn("similar practice start failed", error);
		renderCashControls();
		enqueueNotification("Could not start this marked decision. Return to the free table from Menu.");
	}
}

function startGame(spectator = false) {
	if (gameState.gameMode === "cash" && gameState.gameFinished) {
		globalThis.location.reload();
		return;
	}
	if (!gameState.gameStarted) {
		const humanSeats = spectator ? [] : seatRefs.filter((seatRef) =>
			!seatRef.seatEl.classList.contains("hidden") &&
			seatRef.nameEl.textContent.trim() !== ""
		);
		if (!spectator && humanSeats.length === 0) {
			enqueueNotification("Enter your name at a seat to play, or choose Menu > Watch 6 bots.");
			seatRefs.find((seatRef) => !seatRef.seatEl.classList.contains("hidden"))?.nameEl.focus();
			return;
		}
		if (humanSeats.length > 1) {
			enqueueNotification("Local training supports one human player.");
			return;
		}
		let cashConfig;
		try {
			cashConfig = readCashSetup();
		} catch {
			enqueueNotification("Enter an even big blind, 20–500 BB buy-in, and a lower top-up threshold.");
			return;
		}
		resetRuntimeFastForward();
		gameState.gameMode = "cash";
		gameState.cashSession = cashConfig;
		totalHands = 0;
		gameState.handId = 0;
		gameState.nextDecisionId = 1;
		gameState.blindLevel = 0;
		gameState.smallBlind = cashConfig.smallBlind;
		gameState.bigBlind = cashConfig.bigBlind;
		gameState.chipUnit = cashConfig.chipUnit;
		gameState.lastRaise = cashConfig.bigBlind;
		gameState.handInProgress = false;
		createPlayers(spectator);
		gameState.cashSession = {
			...cashConfig,
			historySessionId: createHistorySessionId(),
			transactions: gameState.players.map((player) => ({
				type: "buy_in",
				seatIndex: player.seatIndex,
				amount: cashConfig.buyInChips,
				handId: 0,
			})),
		};
		activeHandHistory = null;
		historyCashTransactionCount = 0;
		hadHumansAtStart = gameState.players.some((p) => !p.isBot);
		currentGameSaveEligible = hasExactlyOneHumanInSession();

		if (gameState.players.length > 1) {
			seatRefs.forEach((seatRef) =>
				renderSeatSetupState(seatRef, {
					nameEditable: false,
					controlsVisible: false,
				})
			);
			startButton.classList.add("hidden");
			instructionsButton.classList.add("hidden");
			closeAllOverlays();
			gameState.gameStarted = true;
			initStateSyncForGame();
			renderCashControls();

			preFlop();
		} else {
			hadHumansAtStart = false;
			currentGameSaveEligible = false;
			seatRefs.forEach((seatRef) => {
				if (seatRef.nameEl.textContent === "") {
					renderSeatSetupState(seatRef, { visible: true });
				}
			});
			gameState.players = [];
			gameState.allPlayers = [];
			enqueueNotification("Not enough players");
		}
	} else {
		if (gameState.gameMode === "cash") {
			if (gameState.cashSession.paused) {
				enqueueNotification("Resume the session before starting another hand.");
				return;
			}
			const human = getCashHuman();
			if (human && human.chips <= 0 && !gameState.cashSession.autoTopUp) {
				showCashTopUpPrompt();
				return;
			}
		}
		preFlop();
	}
}

function createPlayers(spectator = false) {
	gameState.players = [];
	gameState.allPlayers = [];
	let botIndex = 1;
	for (const seatRef of seatRefs) {
		if (spectator) {
			seatRef.nameEl.textContent = "";
			renderSeatSetupState(seatRef, { visible: true });
		}
		seatRef.playerSeatIndex = null;
		seatRef.clearActionLabelState = null;
		seatRef.clearWinnerReactionState = null;
		if (seatRef.seatEl.classList.contains("hidden")) {
			continue;
		}
		if (seatRef.nameEl.textContent.trim() === "") {
			seatRef.nameEl.textContent = `Bot ${botIndex++}`;
			renderSeatSetupState(seatRef, { isBot: true });
		} else {
			renderSeatSetupState(seatRef, { isBot: false });
		}
	}

	const activeSeatRefs = seatRefs.filter((seatRef) =>
		!seatRef.seatEl.classList.contains("hidden")
	);
	const botStyles = drawCashBotStyles(activeSeatRefs.filter((seatRef) =>
		seatRef.seatEl.classList.contains("bot")
	).length);
	let nextBotStyleIndex = 0;
	for (const seatRef of activeSeatRefs) {
		const seatIndex = gameState.players.length;
		const isBot = seatRef.seatEl.classList.contains("bot");
		const playerState = {
			name: seatRef.nameEl.textContent,
			isBot,
			botStyle: isBot ? botStyles[nextBotStyleIndex++] : null,
			botStyleVersion: isBot ? CASH_BOT_STYLE_VERSION : null,
			seatSlot: seatRef.seatSlot,
			winnerReactionEmoji: "",
			winnerReactionUntil: 0,
			isWinner: false,
			actionState: null,
			winProbability: null,
			lastNonFinalWinProbability: null,
			seatIndex,
			holeCards: [null, null],
			visibleHoleCards: [false, false],
			dealer: false,
			smallBlind: false,
			bigBlind: false,
			folded: false,
			chips: gameState.cashSession.buyInChips,
			cashInvested: gameState.cashSession.buyInChips,
			cashLeft: false,
			allIn: false,
			totalBet: 0,
			roundBet: 0,
			stats: {
				hands: 0,
				handsWon: 0,
				vpip: 0,
				pfr: 0,
				calls: 0,
				aggressiveActs: 0,
				reveals: 0,
				showdowns: 0,
				showdownsWon: 0,
				folds: 0,
				foldsPreflop: 0,
				foldsPostflop: 0,
				allins: 0,
			},
			botLine: {
				preflopAggressor: false,
				cbetIntent: null,
				barrelIntent: null,
				cbetMade: false,
				barrelMade: false,
				nonValueAggressionMade: false,
				checkRaiseIntent: null,
				passiveValueCheckIntent: null,
			},
			spotState: createPlayerSpotState(),
		};
		bindSeatRefPlayer(playerState);
		gameState.players.push(playerState);
	}
	renderPlayerChipStacks();
	gameState.players.forEach((player) => {
		renderPlayerTotal(player);
		resetPlayerRoundBet(player);
		renderPlayerHoleCards(player);
	});
	gameState.allPlayers = gameState.players.slice();
}

function setDealer() {
	const dealerPlan = advanceDealer(
		gameState.players,
		Math.random(),
		gameState.gameMode === "cash" ? gameState.cashSession.lastDealerSeatIndex : null,
	);
	if (!dealerPlan) {
		return;
	}
	applyPlayerPatches(dealerPlan.playerPatches);
	gameState.players = dealerPlan.players;
	if (gameState.gameMode === "cash") {
		gameState.cashSession = {
			...gameState.cashSession,
			lastDealerSeatIndex: dealerPlan.dealer.seatIndex,
		};
	}
	if (dealerPlan.previousDealer) {
		renderPlayerSeat(dealerPlan.previousDealer);
	}
	renderPlayerSeat(dealerPlan.dealer);

	enqueueNotification(`${gameState.players[0].name} is Dealer.`);
}

function updateBlindLevelForCurrentHand() {
	const blindLevelUpdate = getBlindLevelUpdateForHand(totalHands, gameState);
	if (!blindLevelUpdate) {
		return;
	}

	applyGameStatePatch(blindLevelUpdate.gameStatePatch);
	if (blindLevelUpdate.blindsChanged) {
		enqueueNotification(
			`Blinds are now ${gameState.smallBlind}/${gameState.bigBlind}.`,
		);
	}
}

function setBlinds() {
	updateBlindLevelForCurrentHand();

	const blindPlan = postBlinds(gameState);
	applyPlayerPatches(blindPlan.playerPatches);
	applyGameStatePatch(blindPlan.gameStatePatch);
	recordCashHandEvent("blind.posted", {
		seatIndex: blindPlan.smallBlindPlayer.seatIndex,
		blind: "small",
		paid: blindPlan.smallBlindAmount,
		streetTotalTo: blindPlan.smallBlindPlayer.roundBet,
		potAfter: blindPlan.smallBlindAmount,
	});
	recordCashHandEvent("blind.posted", {
		seatIndex: blindPlan.bigBlindPlayer.seatIndex,
		blind: "big",
		paid: blindPlan.bigBlindAmount,
		streetTotalTo: blindPlan.bigBlindPlayer.roundBet,
		potAfter: gameState.pot,
	});
	blindPlan.playerPatches.forEach(({ player }) => {
		renderPlayerSeat(player);
	});
	renderPot();

	enqueueNotification(
		`${blindPlan.smallBlindPlayer.name} posted small blind of ${blindPlan.smallBlindAmount}.`,
	);
	enqueueNotification(
		`${blindPlan.bigBlindPlayer.name} posted big blind of ${blindPlan.bigBlindAmount}.`,
	);
}

function dealCards() {
	const practice = gameState.cashSession?.practice;
	const dealPlan = practice
		? dealHoleCardsForNewHand(gameState, (deck) => shuffleWithSeed(deck, practice.deckSeed))
		: dealHoleCardsForNewHand(gameState);
	applyPlayerPatches(dealPlan.playerPatches);
	applyGameStatePatch(dealPlan.gameStatePatch);

	dealPlan.dealtPlayers.forEach(({ player, card1, card2 }) => {
		recordCashHandEvent("hole.dealt", {
			seatIndex: player.seatIndex,
			cards: [card1, card2],
		}, { kind: "seat", seatIndex: player.seatIndex });
		renderPlayerHoleCards(player);
		if (!player.isBot) {
			if (gameState.openCardsMode) {
				hidePlayerQr(player);
			} else {
				showPlayerQr(player, card1, card2);
			}
		} else {
			hidePlayerQr(player);
		}
	});
}

// Execute the standard pre-flop steps: rotate dealer, post blinds, deal cards, start betting.
function preFlop() {
	// --- Hand Start And Reset ---------------------------------------------------
	runoutCount = 0;
	secondRunoutBoard = [];
	renderSecondRunoutBoard();
	setCurrentFlowState({ type: "hand-start" });
	clearNewRoundCountdown({ notify: false });
	totalHands++;
	if (runoutPhaseTimer) {
		clearTimeout(runoutPhaseTimer);
		runoutPhaseTimer = null;
	}
	clearChipTransferFinishTimer();
	clearChipTransferAnimation(tableRenderTarget);

	startButton.classList.add("hidden");
	closeAllOverlays();
	setSummaryButtonsVisible(false);
	clearActionLabels();
	clearActiveTurnPlayer(false);

	const nextHandPlan = createNextHandTransitionPlan(gameState, totalHands);
	applyPlayerPatches(nextHandPlan.playerPatches);
	applyGameStatePatch(nextHandPlan.gameStatePatch);

	nextHandPlan.playerPatches.forEach(({ player }) => {
		clearPlayerWinnerReaction(player);
		renderPlayerSeat(player);
		renderPlayerHoleCards(player);
		hidePlayerQr(player);
	});
	setCommunityCards(gameState.communityCards);
	if (gameState.gameMode === "cash") {
		nextHandPlan.cashTransactions.forEach((transaction) => {
			const player = gameState.allPlayers.find((seat) => seat.seatIndex === transaction.seatIndex);
			enqueueNotification(`${player.name} topped up ${transaction.amount} chips.`);
		});
	}

	nextHandPlan.bustedPlayers.forEach((player) => {
		if (gameState.gameMode === "cash") {
			renderSeatSetupState(getSeatRef(player), {
				visible: true,
				nameEditable: false,
				controlsVisible: false,
			});
			if (player.isBot) {
				enqueueNotification(`${player.name} needs a top-up to play.`);
			}
			return;
		}
		renderSeatSetupState(getSeatRef(player), { visible: false });
		enqueueNotification(`${player.name} is out of the game!`);
		logFlow("player_bust", { name: player.name });
		logSpeedmodeEvent("player_bust", {
			handId: gameState.handId,
			player: player.name,
			seatIndex: player.seatIndex,
		});
	});

	updateWinProbabilityDisplays();
	updateHandStrengthDisplays();
	renderCashControls();
	if (nextHandPlan.type === "waiting-for-players") {
		totalHands--;
		setStartButtonLabel("New Hand");
		startButton.classList.remove("hidden");
		setCurrentFlowState({ type: "between-hands" });
		renderCashControls();
		saveCurrentGameSnapshot();
		if (!showCashTopUpPrompt()) {
			enqueueNotification("At least two funded seats are needed for the next hand.");
		}
		return;
	}

	// --- Game Over Check ---------------------------------------------------------
	// GAME OVER: only one player left at the table
	if (nextHandPlan.type === "game-over") {
		const champion = nextHandPlan.champion;
		clearActiveTurnPlayer(false);
		enqueueNotification(`${champion.name} wins the game! 🏆`);
		// Reveal champion's stack
		renderPlayerTotal(champion);
		renderPlayerSeat(champion);
		logFlow("tournament_end", { champion: champion.name });
		clearPendingAction();
		humanTurnController.hide();
		resetRuntimeFastForward();
		if (!SPEED_MODE) {
			renderStatsOverlay();
			setSummaryButtonsVisible(true);
		}
		if (currentGameSaveEligible) {
			removeSavedGameSnapshot();
		}
		queueStateSync(0);
		return; // skip the rest of preFlop()
	}
	// ----------------------------------------------------------

	// --- Dealer, Blinds, Deal, And First Round ----------------------------------
	updateFastForwardButton();

	// Assign dealer
	setDealer();
	if (gameState.gameMode === "cash") {
		if (!gameState.cashSession.historySessionId) {
			gameState.cashSession.historySessionId = createHistorySessionId();
		}
		const cashTransactions = gameState.cashSession.transactions;
		activeHandHistory = createHandHistory({
			sessionId: gameState.cashSession.historySessionId,
			appVersion: APP_VERSION,
			handId: gameState.handId,
			dealerSeatIndex: gameState.players[0].seatIndex,
			smallBlind: gameState.smallBlind,
			bigBlind: gameState.bigBlind,
			chipUnit: gameState.chipUnit,
			players: gameState.players,
			cashTransactionsBeforeHand: cashTransactions.slice(historyCashTransactionCount),
			practice: gameState.cashSession.practice ? {
				mode: "similar_sample",
				source: gameState.cashSession.practice.source,
				filters: gameState.cashSession.practice.filters,
				sampleId: gameState.cashSession.practice.sampleId,
				sampleOrdinal: gameState.cashSession.practice.sampleOrdinal,
				resetIndex: gameState.cashSession.practice.resetIndex,
				deckSeed: gameState.cashSession.practice.deckSeed,
			} : null,
		});
		historyCashTransactionCount = cashTransactions.length;
	}

	// post blinds
	setBlinds();
	const handStartPlayers = buildSpeedmodeHandStartPlayers(gameState.players);

	// Shuffle and deal new hole cards
	dealCards();
	logSpeedmodeEvent("hand_start", {
		handId: gameState.handId,
		blindLevel: gameState.blindLevel,
		smallBlind: gameState.smallBlind,
		bigBlind: gameState.bigBlind,
		dealerSeatIndex: gameState.players.find((player) =>
			player.dealer
		)?.seatIndex ?? null,
		communityCards: [],
		players: handStartPlayers,
	});

	// Start first betting round (preflop)
	queueStateSync();
	startBettingRound();
}

function dealCommunityCards(amount) {
	const dealPlan = dealCommunityCardsForPhase(
		gameState,
		amount,
		communityCardSlots.length,
	);
	if (!dealPlan) {
		console.warn("Not enough empty slots for", amount);
		logFlow("dealCommunityCards: not enough slots");
		return;
	}
	applyGameStatePatch(dealPlan.gameStatePatch);
	recordCashHandEvent("board.dealt", {
		street: getCurrentPhase(gameState.currentPhaseIndex),
		cards: dealPlan.dealtCards,
	});
	renderTableCommunityCards(communityCardSlots, gameState.communityCards);
	updateHandStrengthDisplays();
	if (
		gameState.spectatorMode ||
		isAllInRunout(gameState.players, gameState.currentBet)
	) {
		computeSpectatorWinProbabilities("dealCommunityCards");
	}
}

function setPhase() {
	logFlow("setPhase", {
		phase: getCurrentPhase(gameState.currentPhaseIndex),
	});
	const phasePlan = getNextPhasePlan(gameState);
	if (phasePlan.botIntentResetReason) {
		clearBotCheckRaiseIntents(phasePlan.botIntentResetReason);
		clearBotPassiveValueCheckIntents(phasePlan.botIntentResetReason);
	}
	if (phasePlan.reason === "onlyActivePlayer") {
		return doShowdown();
	}

	applyGameStatePatch(phasePlan.gameStatePatch);
	applyHandContextPatch(phasePlan.handContextPatch);

	switch (phasePlan.phase) {
		case "flop":
			dealCommunityCards(phasePlan.cardsToDeal);
			enqueueNotification("Flop (3 cards) dealt.");
			startBettingRound();
			break;
		case "turn":
			dealCommunityCards(phasePlan.cardsToDeal);
			enqueueNotification("Turn (4th card) dealt.");
			startBettingRound();
			break;
		case "river":
			dealCommunityCards(phasePlan.cardsToDeal);
			enqueueNotification("River (5th card) dealt.");
			startBettingRound();
			break;
		case "showdown":
			doShowdown();
			break;
	}
	queueStateSync();
}

function queueRunoutPhaseAdvance(reason = "") {
	humanTurnController.hide();
	if (isAllInRunout(gameState.players, gameState.currentBet) &&
		gameState.communityCards.length < 5 && runoutCount === 0) {
		const human = getHumanPlayers().find((player) => !player.folded);
		if (human && !SPEED_MODE && !gameState.spectatorMode) {
			setCurrentFlowState({ type: "runout-choice", reason });
			openOverlay("runoutChoice");
			runOnceButton.focus();
			saveCurrentGameSnapshot();
			return;
		}
		runoutCount = 1;
	}
	setCurrentFlowState({
		type: "runout",
		reason,
		phaseIndex: gameState.currentPhaseIndex,
	});
	const runoutPhaseDelay = getRunoutPhaseDelay();
	if (
		!isAllInRunout(gameState.players, gameState.currentBet) ||
		runoutPhaseDelay === 0
	) {
		saveCurrentGameSnapshot();
		return setPhase();
	}
	if (runoutPhaseTimer) {
		return;
	}
	logFlow("delay runout phase", {
		reason,
		phase: getCurrentPhase(gameState.currentPhaseIndex),
		delay: runoutPhaseDelay,
	});
	runoutPhaseTimer = setTimeout(() => {
		runoutPhaseTimer = null;
		setPhase();
	}, runoutPhaseDelay);
	saveCurrentGameSnapshot();
}

function chooseRunout(count) {
	if (runoutChoiceOverlay.classList.contains("hidden") || ![1, 2].includes(count)) {
		return;
	}
	runoutCount = count;
	const sharedCards = gameState.communityCards.slice();
	secondRunoutBoard = count === 2 ? sharedCards.slice() : [];
	if (count === 2) {
		recordCashHandEvent("runout.chosen", {
			count: 2,
			sharedCards,
		});
	}
	runoutChoiceOverlay.classList.add("hidden");
	syncOverlayBackdrop();
	renderSecondRunoutBoard();
	queueRunoutPhaseAdvance("runout-choice");
}

function dealSecondRunout() {
	const plan = planSecondRunout(gameState, secondRunoutBoard);
	if (!plan) {
		throw new RangeError("Cannot deal a complete second runout from the remaining deck");
	}
	gameState.deck = plan.gameStatePatch.deck;
	gameState.cardGraveyard = plan.gameStatePatch.cardGraveyard;
	secondRunoutBoard = plan.board;
	for (const dealtStreet of plan.streets) {
		recordCashHandEvent("board.dealt", {
			street: dealtStreet.street,
			cards: dealtStreet.cards,
			run: 2,
		});
	}
	renderSecondRunoutBoard();
	enqueueNotification("Second board dealt.");
}

/* --------------------------------------------------------------------------------------------------
Turn Handling And Betting Round Flow
---------------------------------------------------------------------------------------------------*/

function notifyPlayerAction(player, action = "", amount = 0, actionMeta = {}) {
	recordPlayerActionStats(gameState, player, action, actionMeta);

	const msg = getPlayerActionNotificationText(player.name, action, amount);
	if (action) {
		setPlayerActionState(
			player,
			action,
			Date.now() + getActionLabelDuration(),
			amount,
		);
	} else {
		clearPlayerActionState(player);
	}

	renderPlayerResolvedAction(player);

	const followUpEffects = getPlayerActionFollowUpEffects(
		gameState,
		player,
		action,
	);
	if (followUpEffects.clearWinProbability) {
		player.winProbability = 0;
	}
	if (followUpEffects.revealActiveHoleCards) {
		revealActiveHoleCards();
	} else if (followUpEffects.refreshHandStrength) {
		updateHandStrengthDisplays();
	}
	if (followUpEffects.recomputeSpectatorWinProbabilities) {
		computeSpectatorWinProbabilities(followUpEffects.probabilityReason);
	} else if (followUpEffects.skipProbabilityLogReason) {
		logSkippedPlayerActionProbability(
			player,
			action,
			followUpEffects.skipProbabilityLogReason,
		);
	}
	queueStateSync(0);
	updateFastForwardButton();
	enqueueNotification(msg);
}

function setActiveTurnPlayer(player) {
	const previousActiveSeatIndex = gameState.activeSeatIndex;
	const ticket = beginSeatDecision(gameState, player);
	renderSeatActiveStates(seatRefs, gameState.activeSeatIndex);
	if (previousActiveSeatIndex !== player.seatIndex) {
		queueStateSync(0);
	}
	return ticket;
}

function clearActiveTurnPlayer(sync = true) {
	renderSeatActiveStates(seatRefs, null);
	gameState.pendingSeatDecision = null;
	if (gameState.activeSeatIndex === null) {
		return;
	}
	gameState.activeSeatIndex = null;
	if (sync) {
		queueStateSync(0);
	}
}

function continueAfterResolvedTurn({
	player,
	cycles,
	nextPlayer,
	logPrefix,
	advanceReason,
}) {
	const continuation = getResolvedTurnContinuation(gameState, cycles);
	if (continuation.type === "next") {
		logFlow(`${logPrefix} next`, { name: player.name });
		nextPlayer();
	} else if (continuation.type === "wait") {
		logFlow(`${logPrefix} wait`, { name: player.name });
		nextPlayer();
	} else {
		clearActiveTurnPlayer(false);
		logFlow(`${logPrefix} advance`, { name: player.name });
		queueRunoutPhaseAdvance(advanceReason);
	}
}

function getResolvedTurnMeta(resolvedAction) {
	if (resolvedAction?.action === "fold") {
		return {
			logPrefix: "fold",
			advanceReason: "fold",
		};
	}
	if (resolvedAction?.action === "allin") {
		return {
			logPrefix: "human",
			advanceReason: "human-allin",
		};
	}
	return {
		logPrefix: "human",
		advanceReason: "human",
	};
}

function applyResolvedTurnActionPatches(player, resolvedAction) {
	Object.assign(player, resolvedAction.playerPatch);
	Object.assign(gameState, resolvedAction.gameStatePatch);

	if (Object.keys(resolvedAction.playerPatch).length > 0) {
		renderPlayerSeat(player);
	}
	if (
		Object.prototype.hasOwnProperty.call(
			resolvedAction.gameStatePatch,
			"pot",
		)
	) {
		renderPot();
	}
}

function applyTurnAction(player, ticket, actionRequest) {
	const resolvedAction = submitSeatDecision(
		gameState,
		player,
		ticket,
		toSeatDecisionRequest(player, actionRequest),
	);
	if (!resolvedAction) {
		return null;
	}

	applyResolvedTurnActionPatches(player, resolvedAction);
	if (resolvedAction.action === "fold" && !player.isBot && isInstantFoldRunoutActive()) {
		syncRuntimePlayback();
	}
	recordCashHandEvent("action.applied", {
		seatIndex: player.seatIndex,
		decisionId: ticket.decisionId,
		street: getCurrentPhase(gameState.currentPhaseIndex),
		kind: resolvedAction.action,
		paid: resolvedAction.amount,
		streetTotalTo: player.roundBet,
		potAfter: gameState.pot,
		allIn: player.allIn,
	});
	notifyPlayerAction(
		player,
		resolvedAction.action,
		resolvedAction.amount,
		resolvedAction.actionMeta,
	);
	if (resolvedAction.action === "fold") {
		hidePlayerQr(player);
	}
	return resolvedAction;
}

function runBotTurn({ player, cycles, nextPlayer }) {
	const ticket = setActiveTurnPlayer(player);
	humanTurnController.hide();
	if (!player.actionState) {
		clearSeatActionVisualState(getSeatRef(player));
		if (!instantBotPlayback && !isFastPlaybackActive()) {
			setPlayerSeatName(player, "thinking …");
		}
	}

	enqueueBotAction(() => {
		const botResult = decideLegacyBot(
			projectSeatObservation(gameState, player.seatIndex),
			player.botLine,
		);
		gameState.nextDecisionId = botResult.nextDecisionId;
		const actionRequest = normalizeBotActionRequest(botResult.decision);
		let resolvedAction = applyTurnAction(player, ticket, actionRequest);
		if (resolvedAction) {
			player.botLine = botResult.nextMemory;
		}
		if (!resolvedAction) {
			logFlow("bot action fallback", {
				name: player.name,
				decision: botResult.decision?.action ?? null,
			});
			const fallbackActionState = getPlayerActionState(gameState, player);
			resolvedAction = applyTurnAction(
				player,
				ticket,
				fallbackActionState.canCheck
					? { action: "check" }
					: { action: "fold" },
			);
		}
		if (!resolvedAction) {
			return;
		}
		continueAfterResolvedTurn({
			player,
			cycles,
			nextPlayer,
			logPrefix: "bot",
			advanceReason: "bot",
		});
	});
}

function startBettingRound(options = {}) {
	// --- Round Reset -------------------------------------------------------------
	const shouldResetRound = options.resetRound !== false;
	if (shouldResetRound) {
		const roundStartPlan = createBettingRoundStartPlan(gameState);
		if (roundStartPlan.botIntentResetReason) {
			clearBotCheckRaiseIntents(roundStartPlan.botIntentResetReason);
			clearBotPassiveValueCheckIntents(roundStartPlan.botIntentResetReason);
		}
		applyPlayerPatches(roundStartPlan.playerPatches);
		applyGameStatePatch(roundStartPlan.gameStatePatch);
		applyHandContextPatch(roundStartPlan.handContextPatch);
		roundStartPlan.playerPatches.forEach(({ player, patch }) => {
			if ("roundBet" in patch) {
				renderPlayerSeat(player);
			}
		});
	}
	logFlow("startBettingRound", {
		phase: getCurrentPhase(gameState.currentPhaseIndex),
		currentBet: gameState.currentBet,
		lastRaise: gameState.lastRaise,
		order: gameState.players.map((p) => p.name),
		resume: !shouldResetRound,
	});
	// Clear action indicators from the previous betting round
	clearActiveTurnPlayer(false);
	if (shouldResetRound) {
		clearActionLabels();
		gameState.players.forEach((player) => {
			clearSeatActionVisualState(getSeatRef(player), { preserveAllIn: true });
		});
	}
	clearPendingAction();

	const startExit = getBettingRoundStartExit(gameState);
	if (startExit) {
		logFlow("skip betting round", {
			active: startExit.activePlayerCount,
			actionable: startExit.actionablePlayerCount,
		});
		clearActiveTurnPlayer(false);
		clearPendingAction();
		return queueRunoutPhaseAdvance(startExit.reason);
	}

	let progressState = normalizeSavedProgressState(options.progressState) ||
		createBettingRoundProgressState(gameState);
	const loggedStartPlayer = gameState.players.length > 0
		? gameState.players[progressState.nextIndex % gameState.players.length]
		: null;

	logFlow("betting start index", {
		index: progressState.nextIndex,
		player: loggedStartPlayer?.name ?? null,
	});

	// --- Turn Loop ----------------------------------------------------------------
	function nextPlayer() {
		const step = getNextBettingRoundStep(gameState, progressState);
		if (step.progressState) {
			progressState = step.progressState;
		}

		if (step.type === "advance" && step.reason === "nextPlayer") {
			logFlow("no actionable players, advance phase (nextPlayer)", {
				active: step.activePlayers.map((p) => ({
					name: p.name,
					allIn: p.allIn,
					roundBet: p.roundBet,
				})),
			});
			clearActiveTurnPlayer(false);
			clearPendingAction();
			return queueRunoutPhaseAdvance("nextPlayer");
		}

		logFlow(
			"nextPlayer",
			{
				index: step.index,
				cycles: step.previousCycles,
				name: step.player.name,
				folded: step.player.folded,
				allIn: step.player.allIn,
				roundBet: step.player.roundBet,
			},
		);

		if (step.reason === "foldedAllIn") {
			logFlow("skip folded/allin", { name: step.player.name });
			return setTimeout(nextPlayer, 0); // avoid recursive stack growth
		}

		if (step.reason === "waitUncalled") {
			logFlow("already matched bet", {
				name: step.player.name,
				cycles: step.cycles,
			});
			logFlow("wait uncalled", { name: step.player.name });
			return setTimeout(nextPlayer, 0); // schedule asynchronously to break call chain
		}

		if (step.type === "advance") {
			logFlow("already matched bet", {
				name: step.player.name,
				cycles: step.cycles,
			});
			logFlow("advance phase", { name: step.player.name });
			clearActiveTurnPlayer(false);
			clearPendingAction();
			return queueRunoutPhaseAdvance(step.reason);
		}

		if (step.reason === "firstPassMatched") {
			logFlow("already matched bet", {
				name: step.player.name,
				cycles: step.cycles,
			});
		}

		return runTurn(step.player, step.cycles, nextPlayer);
	}

	function runTurn(player, cycles, nextPlayer) {
		setCurrentFlowState(
			createActiveTurnFlowState(player, cycles, progressState),
		);
		const practice = gameState.cashSession?.practice;
		const scriptedFoldSeatIndex = practice?.filters.priorFoldSeatIndexes[practice.scriptedFoldsApplied];
		if (scriptedFoldSeatIndex === player.seatIndex && gameState.currentPhaseIndex === 0) {
			const ticket = setActiveTurnPlayer(player);
			const resolvedAction = applyTurnAction(player, ticket, { action: "fold" });
			if (resolvedAction) {
				practice.scriptedFoldsApplied++;
				saveCurrentGameSnapshot();
				setTimeout(() => continueAfterResolvedTurn({
					player, cycles, nextPlayer, logPrefix: "scripted-fold", advanceReason: "scripted-fold",
				}), 0);
			}
			return;
		}

		// --- Bot Branch --------------------------------------------------------------
		// If this is a bot, choose an action based on hand strength
		if (player.isBot) {
			runBotTurn({
				player,
				cycles,
				nextPlayer,
			});
			saveCurrentGameSnapshot();
			return;
		}

		// --- Human Branch ------------------------------------------------------------
		humanTurnController.runHumanTurn({
			player,
			cycles,
			nextPlayer,
		});
		saveCurrentGameSnapshot();
	}

	const resumeTurn = options.resumeTurn;
	if (
		resumeTurn &&
		Number.isFinite(resumeTurn.seatIndex) &&
		Number.isFinite(resumeTurn.cycles)
	) {
		const resumePlayer = gameState.players.find((player) =>
			player.seatIndex === resumeTurn.seatIndex
		);
		if (resumePlayer && !resumePlayer.folded && !resumePlayer.allIn) {
			runTurn(resumePlayer, resumeTurn.cycles, nextPlayer);
			return;
		}
	}

	nextPlayer();
}

/* --------------------------------------------------------------------------------------------------
Showdown And Payout Flow
---------------------------------------------------------------------------------------------------*/

// Build the synchronized payout transfer plan and let the shared table-view renderer
// animate the visible pot and stack counts from the final canonical state.
function getChipTransferStepCount() {
	if (isTurboPlaybackActive()) {
		return FAST_FORWARD_CHIP_TRANSFER_STEPS;
	}
	return DEFAULT_CHIP_TRANSFER_STEPS;
}

function getChipTransferDurationMs(amount) {
	if (isTurboPlaybackActive()) {
		return FAST_FORWARD_CHIP_TRANSFER_DURATION;
	}
	return Math.min(Math.max(amount * 20, 300), 3000);
}

function buildChipTransferState(transferQueue) {
	if (
		SPEED_MODE ||
		!Array.isArray(transferQueue) ||
		transferQueue.length === 0
	) {
		return null;
	}

	const startedAt = Date.now();
	return {
		id: nextChipTransferId++,
		startedAt,
		transfers: transferQueue.map((transfer) => ({
			seatIndex: transfer.player.seatIndex,
			amount: transfer.amount,
			durationMs: getChipTransferDurationMs(transfer.amount),
			stepCount: getChipTransferStepCount(),
		})),
	};
}

function applyChipTransferResults(commitPlan) {
	applyPlayerPatches(commitPlan.payoutPlayerPatches);
	applyGameStatePatch(commitPlan.payoutGameStatePatch);
}

function getChipTransferRemainingDuration(chipTransfer) {
	if (
		!chipTransfer || !Array.isArray(chipTransfer.transfers) ||
		chipTransfer.transfers.length === 0
	) {
		return 0;
	}

	const endAt = chipTransfer.transfers.reduce(
		(maxEndAt, transfer) =>
			Math.max(maxEndAt, chipTransfer.startedAt + transfer.durationMs),
		chipTransfer.startedAt,
	);
	return Math.max(0, Math.ceil(endAt - Date.now()));
}

function startChipTransferAnimation(commitPlan, onDone) {
	const transferQueue = commitPlan.transferQueue;
	if (!Array.isArray(transferQueue) || transferQueue.length === 0) {
		if (onDone) {
			onDone();
		}
		return;
	}

	clearChipTransferFinishTimer();
	clearChipTransferAnimation(tableRenderTarget);

	const chipTransfer = buildChipTransferState(transferQueue);
	gameState.chipTransfer = chipTransfer;
	applyChipTransferResults(commitPlan);

	if (!chipTransfer) {
		if (onDone) {
			onDone();
		}
		return;
	}

	renderChipTransferAnimation(tableRenderTarget, {
		finalPot: gameState.pot,
		players: getPlayerSeatRenderData(gameState.players),
		chipTransfer,
	});
	setCurrentFlowState({ type: "chip-transfer" });
	queueStateSync(0);
	saveCurrentGameSnapshot();

	chipTransferFinishTimer = setTimeout(() => {
		chipTransferFinishTimer = null;
		gameState.chipTransfer = null;
		clearChipTransferAnimation(tableRenderTarget);
		queueStateSync(0);
		if (onDone) {
			onDone();
		}
	}, getChipTransferRemainingDuration(chipTransfer));
}

function finishHandAfterShowdown() {
	const handEndPlan = createHandEndPlan(gameState);
	renderPlayerChipStacks();

	clearActiveTurnPlayer(false);
	applyGameStatePatch(handEndPlan.gameStatePatch);
	if (activeHandHistory && activeHandHistory.events.at(-1)?.type !== "hand.ended") {
		recordCashHandEvent("hand.ended", {
			endingStacks: gameState.players.map((player) => ({
				seatIndex: player.seatIndex,
				chips: player.chips,
			})),
		});
		replayHandHistory(activeHandHistory);
		queueCompletedHandHistory(activeHandHistory);
	}
	renderPot();

	humanTurnController.hide();
	if (gameState.gameMode === "cash") {
		handFastForwardActive = false;
		autoplayToGameEnd = false;
		syncRuntimePlayback();
		updateFastForwardButton();
		renderStatsOverlay();
		setSummaryButtonsVisible(true);
		setStartButtonLabel("New Hand");
		if (gameState.cashSession.practice) {
			setStartButtonLabel("New sample");
		}
		startButton.classList.remove("hidden");
		setCurrentFlowState({ type: "between-hands" });
		if (gameState.cashSession.endAfterHand) {
			endCashSession();
			showLossExportPrompt();
			return;
		}
		renderCashControls();
		saveCurrentGameSnapshot();
		if (!showLossExportPrompt() && !gameState.cashSession.practice) {
			showCashTopUpPrompt();
		}
		return;
	}
	if (SPEED_MODE) {
		queueStateSync();
		preFlop();
		return;
	}
	if (autoplayToGameEnd) {
		queueStateSync();
		preFlop();
		return;
	}
	if (handFastForwardActive && getHumansWithChipsCount() === 0) {
		handFastForwardActive = false;
		autoplayToGameEnd = true;
		syncRuntimePlayback();
		updateFastForwardButton();
		queueStateSync();
		preFlop();
		return;
	}
	handFastForwardActive = false;
	syncRuntimePlayback();
	updateFastForwardButton();
	renderStatsOverlay();
	setSummaryButtonsVisible(true);
	setStartButtonLabel("New Round");
	startButton.classList.remove("hidden");
	setCurrentFlowState({ type: "between-hands" });
	startNewRoundCountdown();
	queueStateSync();
	saveCurrentGameSnapshot();
}

function doShowdown() {
	// --- Active Players And Showdown State ---------------------------------------
	if (runoutCount === 2 && secondRunoutBoard.length < 5) {
		dealSecondRunout();
	}
	const communityCards = getCommunityCardCodes();
	const showdownResult = resolveShowdown(
		gameState.players,
		communityCards,
		gameState.chipUnit,
		runoutCount === 2 ? secondRunoutBoard : null,
	);
	const {
		activePlayers,
		contributors,
		hadShowdown,
		uncontestedWinner,
		mainPotWinners,
		winningPlayers,
		potResults,
		totalPayoutByPlayer,
		totalPot,
	} = showdownResult;
	const commitPlan = createShowdownCommitPlan(gameState, showdownResult);
	commitPlan.revealPlayers.forEach((player) => {
		recordPublicHoleReveal(player, player.holeCards);
	});
	const sortedContributors = contributors.slice().sort((a, b) => b.totalBet - a.totalBet);
	const largestContribution = sortedContributors[0]?.totalBet ?? 0;
	const secondContribution = sortedContributors[1]?.totalBet ?? 0;
	const uncalledPlayer = sortedContributors[0];
	const uncalledAmount = uncalledPlayer && !uncalledPlayer.folded &&
		largestContribution > secondContribution
		? largestContribution - secondContribution
		: 0;
	if (uncalledAmount > 0) {
		recordCashHandEvent("uncalled.returned", {
			seatIndex: uncalledPlayer.seatIndex,
			amount: uncalledAmount,
			potAfter: totalPot - uncalledAmount,
		});
	}
	recordCashHandEvent("pot.settled", {
		totalPot: totalPot - uncalledAmount,
		hadShowdown,
		payouts: Array.from(totalPayoutByPlayer, ([player, amount]) => ({
			seatIndex: player.seatIndex,
			amount: amount - (player === uncalledPlayer ? uncalledAmount : 0),
		})).filter((payout) => payout.amount > 0),
		potResults: potResults.filter((result) => result.isRefundOnly !== true)
			.map((result) => ({ ...result })),
		...(runoutCount === 2 ? { runoutBoards: [communityCards.slice(), secondRunoutBoard.slice()] } : {}),
	});
	logSpeedmodeEvent("hand_result", {
		handId: gameState.handId,
		communityCards: communityCards.slice(),
		hadShowdown,
		uncontestedWinner: uncontestedWinner?.name ?? null,
		uncontestedWinnerSeatIndex: uncontestedWinner?.seatIndex ?? null,
		mainPotWinners: mainPotWinners.map((player) => player.name),
		mainPotWinnerSeatIndexes: mainPotWinners.map((player) =>
			player.seatIndex
		),
		winningPlayers: winningPlayers.map((player) => player.name),
		winningSeatIndexes: winningPlayers.map((player) => player.seatIndex),
		potResults: potResults.map((result) => ({ ...result })),
		totalPayoutByPlayer: buildSpeedmodePayoutByPlayer(totalPayoutByPlayer),
		totalPayoutBySeatIndex: buildSpeedmodePayoutBySeatIndex(
			totalPayoutByPlayer,
		),
		totalBetByPlayer: buildSpeedmodeTotalBetByPlayer(contributors),
		totalBetBySeatIndex: buildSpeedmodeTotalBetBySeatIndex(contributors),
		totalPot,
	});

	applyPlayerPatches(commitPlan.playerPatches);
	commitPlan.playerPatches.forEach(({ player }) => {
		renderPlayerSeat(player);
	});
	commitPlan.revealPlayers.forEach((player) => {
		hidePlayerQr(player);
	});
	if (commitPlan.revealPlayers.length > 0) {
		updateHandStrengthDisplays();
	}
	commitPlan.mainPotWinners.forEach((player) => {
		renderSeatActiveState(getSeatRef(player), false);
	});

	if (uncontestedWinner) {
		const revealedPlayers = new Set();
		const revealDecision = getBotRevealDecision(
			uncontestedWinner,
			communityCards,
		);
		if (revealDecision) {
			revealedPlayers.add(uncontestedWinner);
			applyBotReveal(uncontestedWinner, revealDecision);
			registerBotReveal(uncontestedWinner);
			enqueueNotification(
				`${uncontestedWinner.name} reveals ${
					revealDecision.codes.map(formatCardLabel).join(" ")
				}`,
			);
		} else {
			hidePlayerQr(uncontestedWinner);
		}
		triggerMainPotWinnerReactions({
			activePlayerCount: activePlayers.length,
			bigBlind: gameState.bigBlind,
			communityCards,
			contributors,
			hadShowdown,
			mainPotWinnerCount: mainPotWinners.length,
			mainPotWinners,
			revealedPlayers,
			showdownPlayers: activePlayers,
			totalPayoutByPlayer,
		});
		enqueueNotification(`${uncontestedWinner.name} wins ${totalPot}!`);
		startChipTransferAnimation(commitPlan, () => {
			finishHandAfterShowdown();
		});
		return;
	}

	// Skip pure refund-only side pots in the log. They animate correctly, but they are not real wins.
	const filteredResults = potResults.filter((result) =>
		result.isRefundOnly !== true
	);

	// --- Notification Consolidation ----------------------------------------------
	// Consolidate notifications: if same player wins all pots, combine amounts
	if (filteredResults.length > 0) {
		const allSame = runoutCount !== 2 && filteredResults.every((r) =>
			r.players.length === 1 &&
			r.players[0] === filteredResults[0].players[0]
		);
		if (allSame) {
			const total = filteredResults.reduce((sum, r) => sum + r.amount, 0);
			let msg = `${filteredResults[0].players[0]} wins ${total}`;
			if (filteredResults[0].hand) {
				msg += ` with ${filteredResults[0].hand}`;
			}
			enqueueNotification(msg);
		} else {
			filteredResults.forEach((r) => {
				const runLabel = r.run ? `Run ${r.run}: ` : "";
				if (r.players.length === 1) {
					let msg = `${runLabel}${r.players[0]} wins ${r.amount}`;
					if (r.hand) msg += ` with ${r.hand}`;
					enqueueNotification(msg);
				} else {
					enqueueNotification(
						`${runLabel}${r.players.join(" & ")} split ${r.amount}`,
					);
				}
			});
		}
	}

	triggerMainPotWinnerReactions({
		activePlayerCount: activePlayers.length,
		bigBlind: gameState.bigBlind,
		communityCards,
		contributors,
		hadShowdown,
		mainPotWinnerCount: mainPotWinners.length,
		mainPotWinners,
		revealedPlayers: new Set(),
		showdownPlayers: activePlayers,
		totalPayoutByPlayer,
	});

	// --- Payout Animation --------------------------------------------------------
	// Build one synced transfer plan and let host and remote play the same animation locally.
	startChipTransferAnimation(commitPlan, () => {
		finishHandAfterShowdown();
	});
	return; // exit doShowdown early because UI flow continues in animation
}

/* --------------------------------------------------------------------------------------------------
Seat-Editing Helpers
---------------------------------------------------------------------------------------------------*/

function rotateSeat(ev) {
	const seatEl = ev.currentTarget.closest(".seat");
	const seatRef = seatRefs.find((currentSeatRef) => currentSeatRef.seatEl === seatEl);
	const rotation = Number.parseInt(seatEl?.dataset.rotation ?? "0", 10);
	renderSeatRotation(seatRef, rotation + 90);
}

function deletePlayer(ev) {
	const seatEl = ev.currentTarget.closest(".seat");
	const seatRef = seatRefs.find((currentSeatRef) => currentSeatRef.seatEl === seatEl);
	renderSeatSetupState(seatRef, { visible: false });
}

/* --------------------------------------------------------------------------------------------------
App Bootstrap And Public API
---------------------------------------------------------------------------------------------------*/

function init() {
	initSound();
	const soundMuted = isSoundMuted();
	soundOnInput.checked = !soundMuted;
	soundOffInput.checked = soundMuted;
	try {
		instantBotPlayback = getLocalStorage()?.getItem(BOT_PACE_STORAGE_KEY) === "1";
	} catch (error) {
		console.warn("bot pace preference read failed", error);
	}
	botPaceNaturalInput.checked = !instantBotPlayback;
	botPaceInstantInput.checked = instantBotPlayback;
	syncRuntimePlayback();

	// Prevent framing
	if (globalThis.top !== globalThis.self) {
		try {
			globalThis.top.location.href = globalThis.location.href;
		} catch {
			alert(
				"No framing allowed. Please visit: https://tehes.github.io/poker/",
			);
			throw new Error(
				"No framing allowed. Open the original: https://tehes.github.io/poker/",
			);
		}
	}

	document.addEventListener("touchstart", function () {}, false);
	document.addEventListener("keydown", (ev) => {
		if (ev.key === "Escape" && !isBlockingOverlayOpen()) {
			if (!tableMenu.classList.contains("hidden")) {
				closeTableMenu(true);
			} else {
				closeAllOverlays();
			}
		}
	}, false);
	tableMenuButton.addEventListener("click", toggleTableMenu, false);
	document.addEventListener("pointerdown", (ev) => {
		if (!tableMenu.classList.contains("hidden") && !tableMenuWrap.contains(ev.target)) {
			closeTableMenu();
		}
	}, false);
	startButton.addEventListener("click", () => {
		if (IS_PRACTICE_PAGE) {
			if (gameState.gameStarted) {
				startPracticeSample();
			} else {
				void beginPracticeFromRequest();
			}
		} else {
			startGame();
		}
	}, false);
	watchBotsButton.addEventListener("click", () => {
		closeTableMenu();
		startGame(true);
	}, false);
	cashBigBlindInput.addEventListener("input", updateCashSetupStackPreview, false);
	cashBuyInBBInput.addEventListener("input", updateCashSetupStackPreview, false);
	cashTopUpButton.addEventListener("click", () => {
		topUpCashHuman();
		closeTableMenu();
	}, false);
	cashTopUpLaterButton.addEventListener("click", () => closeOverlay("topUp"), false);
	cashTopUpConfirmButton.addEventListener("click", () => {
		if (topUpCashHuman()) {
			closeOverlay("topUp");
		}
	}, false);
	cashTopUpOverlay.addEventListener("keydown", (ev) => {
		if (ev.key !== "Tab") {
			return;
		}
		if (ev.shiftKey && document.activeElement === cashTopUpLaterButton) {
			ev.preventDefault();
			cashTopUpConfirmButton.focus();
		} else if (!ev.shiftKey && document.activeElement === cashTopUpConfirmButton) {
			ev.preventDefault();
			cashTopUpLaterButton.focus();
		}
	}, false);
	lossExportNewHandButton.addEventListener("click", startAfterLossExportPrompt, false);
	lossExportCopyButton.addEventListener("click", () => { void copyLossHandText(); }, false);
	runOnceButton.addEventListener("click", () => chooseRunout(1), false);
	runTwiceButton.addEventListener("click", () => chooseRunout(2), false);
	runoutChoiceOverlay.addEventListener("keydown", (ev) => {
		if (ev.key !== "Tab") {
			return;
		}
		if (ev.shiftKey && document.activeElement === runOnceButton) {
			ev.preventDefault();
			runTwiceButton.focus();
		} else if (!ev.shiftKey && document.activeElement === runTwiceButton) {
			ev.preventDefault();
			runOnceButton.focus();
		}
	}, false);
	lossExportOverlay.addEventListener("keydown", (ev) => {
		if (ev.key !== "Tab") {
			return;
		}
		if (ev.shiftKey && document.activeElement === lossExportNewHandButton) {
			ev.preventDefault();
			lossExportCopyButton.focus();
		} else if (!ev.shiftKey && document.activeElement === lossExportCopyButton) {
			ev.preventDefault();
			lossExportNewHandButton.focus();
		}
	}, false);
	cashPauseButton.addEventListener("click", () => {
		toggleCashPause();
		closeTableMenu();
	}, false);
	cashEndButton.addEventListener("click", showEndSessionConfirm, false);
	practiceReturnButton.addEventListener("click", returnToFreeTable, false);
	endSessionCancelButton.addEventListener("click", () => {
		endSessionConfirm.classList.add("hidden");
		renderCashControls();
		cashEndButton.focus();
	}, false);
	endSessionConfirmButton.addEventListener("click", () => {
		if (gameState.handInProgress) {
			gameState.cashSession.endAfterHand = true;
			renderCashControls();
			saveCurrentGameSnapshot();
		} else {
			endCashSession();
		}
		closeTableMenu();
	}, false);
	cashLastHandButton.addEventListener("click", () => { void openHandReview(); }, false);
	handSessionSelect.addEventListener("change", () => {
		populateHandHistorySelect(handSessionSelect.value);
		void selectReviewedHand(handHistorySelect.value);
	}, false);
	handHistorySelect.addEventListener("change", () => {
		void selectReviewedHand(handHistorySelect.value);
	}, false);
	handReplayTab.addEventListener("click", () => {
		void persistViewedHandAnnotation();
		setHandReviewTab("replay");
	}, false);
	handTextTab.addEventListener("click", () => setHandReviewTab("text"), false);
	handReplayPrev.addEventListener("click", () => {
		const steps = buildHandReplaySteps(viewedHandHistory);
		handReplaySeq = steps[steps.indexOf(handReplaySeq) - 1];
		renderHandReplay();
	}, false);
	handReplayNext.addEventListener("click", () => {
		const steps = buildHandReplaySteps(viewedHandHistory);
		handReplaySeq = steps[steps.indexOf(handReplaySeq) + 1];
		renderHandReplay();
	}, false);
	handReplayStep.addEventListener("input", () => {
		handReplaySeq = buildHandReplaySteps(viewedHandHistory)[Number(handReplayStep.value)];
		renderHandReplay();
	}, false);
	handMarkDecisionButton.addEventListener("click", () => {
		markedDecisionSeq = markedDecisionSeq === handReplaySeq ? null : handReplaySeq;
		renderHandReplay();
		void persistViewedHandAnnotation();
	}, false);
	handStartPracticeButton.addEventListener("click", () => {
		void startSimilarPracticeFromReview();
	}, false);
	handTextTag.addEventListener("change", () => {
		renderViewedHandText();
		void persistViewedHandAnnotation();
	}, false);
	handTextNote.addEventListener("input", renderViewedHandText, false);
	handTextNote.addEventListener("change", () => { void persistViewedHandAnnotation(); }, false);
	handTextCopyButton.addEventListener("click", () => { void copyViewedHandText(); }, false);
	handTextDownloadButton.addEventListener("click", () => { void downloadViewedHandText(); }, false);
	handTextCloseButton.addEventListener("click", () => closeOverlay("hand"), false);
	cashExportHandsButton.addEventListener("click", exportCashHandHistories, false);
	cashImportHandsButton.addEventListener("click", () => cashImportHandsFile.click(), false);
	cashImportHandsFile.addEventListener("change", importCashHandHistories, false);
	newRoundCancelButton.addEventListener(
		"click",
		cancelNewRoundCountdown,
		false,
	);
	instructionsButton.addEventListener(
		"click",
		() => openOverlay("instructions"),
		false,
	);
	[botPaceNaturalInput, botPaceInstantInput].forEach((input) => input.addEventListener("change", () => {
		if (!input.checked) {
			return;
		}
		instantBotPlayback = input.value === "instant";
		try {
			getLocalStorage()?.setItem(BOT_PACE_STORAGE_KEY, instantBotPlayback ? "1" : "0");
		} catch (error) {
			console.warn("bot pace preference save failed", error);
		}
		syncRuntimePlayback();
		updateFastForwardButton();
		if (isInstantFoldRunoutActive() && runoutPhaseTimer) {
			clearTimeout(runoutPhaseTimer);
			runoutPhaseTimer = null;
			setPhase();
		}
	}, false));
	[soundOnInput, soundOffInput].forEach((input) => input.addEventListener("change", () => {
		if (input.checked) {
			setSoundMuted(input.value === "off");
		}
	}, false));
	notification.addEventListener("click", () => openOverlay("log"), false);
	statsButton.addEventListener("click", () => openOverlay("stats"), false);
	logButton.addEventListener("click", () => openOverlay("log"), false);
	fastForwardButton.addEventListener("click", activateFastForward, false);
	statsCloseButton.addEventListener(
		"click",
		() => closeOverlay("stats"),
		false,
	);
	logCloseButton.addEventListener("click", () => closeOverlay("log"), false);
	instructionsCloseButton.addEventListener(
		"click",
		() => closeOverlay("instructions"),
		false,
	);
	resumeContinueButton?.addEventListener("click", continueSavedGame, false);
	resumeNewButton?.addEventListener("click", discardSavedGame, false);
	overlayBackdrop.addEventListener("click", () => {
		if (!isBlockingOverlayOpen()) {
			closeAllOverlays();
		}
	}, false);
	globalThis.addEventListener("pagehide", handlePageLifecycleSave, false);
	globalThis.addEventListener(
		"beforeunload",
		handlePageLifecycleSave,
		false,
	);
	document.addEventListener(
		"visibilitychange",
		() => {
			if (document.visibilityState === "hidden") {
				handlePageLifecycleSave();
			}
		},
		false,
	);
	humanTurnController.init();
	renderPot();
	renderTableCommunityCards(communityCardSlots, gameState.communityCards);

	for (const rotateIcon of rotateIcons) {
		rotateIcon.addEventListener("click", rotateSeat, false);
	}
	for (const closeButton of closeButtons) {
		closeButton.addEventListener("click", deletePlayer, false);
	}

	const savedGameSnapshot = readSavedGameSnapshot();
	const hadPendingHands = readCompletedHandOutbox().length > 0;
	void flushCompletedHandOutbox().then(() => {
		if (hadPendingHands) {
			scheduleCloudSync(true);
		}
	});
	if (IS_PRACTICE_PAGE) {
		startButton.classList.add("hidden");
		cashSetup.classList.add("hidden");
		renderCashControls();
	}
	if (savedGameSnapshot) {
		openResumeGameOverlay(savedGameSnapshot);
	} else if (IS_PRACTICE_PAGE) {
		void beginPracticeFromRequest();
	}
}

function setAccountStatus(message) {
	document.querySelector("#account-status").textContent = message;
}

let suppressLifecycleSave = false;

function showSessionConflict(show) {
	document.querySelector("#account-use-cloud-button").classList.toggle("hidden", !show);
	document.querySelector("#account-keep-local-button").classList.toggle("hidden", !show);
}

async function performCloudSync(showFeedback = false, full = true) {
	if (!cloudSync) {
		return;
	}
	try {
		const { sessionChanged } = await cloudSync.sync(full);
		showSessionConflict(false);
		accountOffline = false;
		setAccountStatus(`${accountClient.session.email} · Synced ${new Date().toLocaleTimeString()}`);
		if (showFeedback) {
			enqueueNotification("Account data synced.");
		}
		if (sessionChanged && gameInitialized) {
			suppressLifecycleSave = true;
			globalThis.location.reload();
		}
	} catch (error) {
		console.warn("account sync failed", error);
		if (error instanceof TypeError) {
			accountOffline = true;
		}
		showSessionConflict(error.message.startsWith("The session changed on two devices"));
		setAccountStatus(`${accountClient.session.email} · Sync failed: ${error.message}`);
		if (showFeedback) {
			enqueueNotification("Account sync failed. Check the Account menu.");
		}
	}
}

function scheduleCloudSync(full = false) {
	if (!cloudSync || accountOffline) {
		return;
	}
	pendingFullCloudSync ||= full;
	clearTimeout(cloudSyncTimer);
	cloudSyncTimer = setTimeout(() => {
		const syncFull = pendingFullCloudSync;
		pendingFullCloudSync = false;
		void performCloudSync(false, syncFull);
	}, 2000);
}

let gameInitialized = false;

async function importLegacyAccountData(uid) {
	const storage = getLocalStorage();
	const legacy = await readLegacyHandData();
	const annotations = legacy.annotations.filter((annotation) =>
		legacy.histories.some((history) => getHandHistoryKey(history) === annotation.key)
	);
	let legacyOutbox = [];
	try {
		const value = JSON.parse(storage.getItem(LEGACY_COMPLETED_HAND_OUTBOX_KEY) ?? "[]");
		legacyOutbox = Array.isArray(value) ? value : [];
	} catch (error) {
		console.warn("older hand outbox could not be read", error);
	}
	const rawSnapshot = storage.getItem(LEGACY_SAVED_GAME_STORAGE_KEY);
	if (!legacy.histories.length && !legacyOutbox.length && !rawSnapshot) {
		return false;
	}
	if (!globalThis.confirm("Import this browser's older hand records and saved session into this account? The original local data will remain in place.")) {
		return false;
	}
	await importHandHistories(legacy.histories, annotations);
	if (legacyOutbox.length && !storage.getItem(COMPLETED_HAND_OUTBOX_KEY)) {
		storage.setItem(COMPLETED_HAND_OUTBOX_KEY, JSON.stringify(legacyOutbox));
	}
	if (rawSnapshot && !storage.getItem(SAVED_GAME_STORAGE_KEY) && !accountOffline) {
		const remote = await accountClient.getDocument(cloudSessionDocumentPath(uid, SAVED_GAME_STORAGE_KEY));
		if (!remote || remote.fields?.payload?.stringValue === "null") {
			const snapshot = JSON.parse(rawSnapshot);
			if (isValidSavedGameSnapshot(snapshot)) {
				storage.setItem(SAVED_GAME_STORAGE_KEY, rawSnapshot);
			}
		}
	}
	return true;
}

async function bootstrap() {
	if (!FIREBASE_CONFIGURED) {
		init();
		gameInitialized = true;
		return;
	}
	const gate = document.querySelector("#account-gate");
	const message = document.querySelector("#account-gate-message");
	const form = document.querySelector("#account-form");
	const verifyActions = document.querySelector("#account-verify-actions");
	const email = document.querySelector("#account-email");
	const password = document.querySelector("#account-password");
	const storage = getLocalStorage();
	gate.classList.remove("hidden");
	if (!storage) {
		message.textContent = "This browser does not allow local storage. Enable it to use account sync.";
		return;
	}
	accountClient = createFirebaseClient({ storage });
	const showSignIn = () => {
		form.classList.remove("hidden");
		verifyActions.classList.add("hidden");
		message.textContent = "Sign in to keep your sessions and hands in sync across devices.";
	};
	const showVerify = () => {
		form.classList.add("hidden");
		verifyActions.classList.remove("hidden");
		message.textContent = `Check ${accountClient.session.email} for a verification link, then return here.`;
	};
	let activationPromise = null;
	const activate = (session) => {
		if (activationPromise) {
			return activationPromise;
		}
		activationPromise = (async () => {
			if (!session.verified || gameInitialized) {
				if (!session.verified) {
					showVerify();
				}
				return;
			}
			message.textContent = "Loading your private table…";
			const uid = session.uid;
			setHandStoreAccount(uid);
			SAVED_GAME_STORAGE_KEY = `${LEGACY_SAVED_GAME_STORAGE_KEY}:account:${uid}`;
			COMPLETED_HAND_OUTBOX_KEY = `${LEGACY_COMPLETED_HAND_OUTBOX_KEY}:account:${uid}`;
			accountOffline = session.offline === true;
			cloudSync = createCloudSync(accountClient, storage, uid, SAVED_GAME_STORAGE_KEY);
			const importMarker = `poker:legacy-import-prompted:v1:${uid}`;
			if (!storage.getItem(importMarker)) {
				try {
					await importLegacyAccountData(uid);
					storage.setItem(importMarker, "1");
				} catch (error) {
					console.warn("older local data import failed", error);
					message.textContent = `Could not import older local data: ${error.message}`;
					return;
				}
			}
			if (!accountOffline) {
				await performCloudSync();
			}
			setAccountStatus(accountOffline ? `${session.email} · Offline, changes stay on this device` :
				document.querySelector("#account-status").textContent);
			document.querySelector("#account-menu").classList.remove("hidden");
			gate.classList.add("hidden");
			init();
			gameInitialized = true;
		})().finally(() => { activationPromise = null; });
		return activationPromise;
	};
	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		message.textContent = "Signing in…";
		try {
			await activate(await accountClient.signIn(email.value.trim(), password.value));
		} catch (error) {
			console.warn("sign in failed", error);
			message.textContent = `Sign in failed: ${error.message}`;
		}
	});
	document.querySelector("#account-google-button").addEventListener("click", async () => {
		message.textContent = "Opening Google sign-in…";
		try {
			const session = await accountClient.signInWithGoogle();
			if (session) {
				await activate(session);
			}
		} catch (error) {
			console.warn("Google sign in failed", error);
			message.textContent = `Google sign-in failed: ${error.message}`;
		}
	});
	document.querySelector("#account-create-button").addEventListener("click", async () => {
		if (!form.reportValidity()) {
			return;
		}
		message.textContent = "Creating account…";
		try {
			await accountClient.signUp(email.value.trim(), password.value);
			await accountClient.sendVerification();
			showVerify();
		} catch (error) {
			console.warn("account creation failed", error);
			message.textContent = `Account creation failed: ${error.message}`;
		}
	});
	document.querySelector("#account-reset-button").addEventListener("click", async () => {
		if (!email.value.trim()) {
			message.textContent = "Enter your email address first.";
			return;
		}
		try {
			await accountClient.sendPasswordReset(email.value.trim());
			message.textContent = "If this email has an account, a password reset link has been sent.";
		} catch (error) {
			message.textContent = `Could not send a reset link: ${error.message}`;
		}
	});
	document.querySelector("#account-check-verify-button").addEventListener("click", async () => {
		message.textContent = "Checking email verification…";
		try {
			await activate(await accountClient.refreshVerification());
		} catch (error) {
			message.textContent = `Could not verify yet: ${error.message}`;
		}
	});
	document.querySelector("#account-resend-verify-button").addEventListener("click", async () => {
		try {
			await accountClient.sendVerification();
			showVerify();
		} catch (error) {
			message.textContent = `Could not send verification email: ${error.message}`;
		}
	});
	document.querySelector("#account-switch-button").addEventListener("click", () => {
		accountClient.signOut();
		showSignIn();
	});
	document.querySelector("#account-sync-button").addEventListener("click", () => { void performCloudSync(true); });
	document.querySelector("#account-use-cloud-button").addEventListener("click", async () => {
		if (!globalThis.confirm("Replace this device's active session with the cloud session? Your local session will be lost.")) {
			return;
		}
		try {
			await cloudSync.resolveSession(true);
			suppressLifecycleSave = true;
			globalThis.location.reload();
		} catch (error) {
			setAccountStatus(`Could not load cloud session: ${error.message}`);
		}
	});
	document.querySelector("#account-keep-local-button").addEventListener("click", async () => {
		if (!globalThis.confirm("Replace the cloud session with this device's current session? The other device's active session will be lost.")) {
			return;
		}
		try {
			await cloudSync.resolveSession(false);
			showSessionConflict(false);
			await performCloudSync(true);
		} catch (error) {
			setAccountStatus(`Could not keep local session: ${error.message}`);
		}
	});
	document.querySelector("#account-import-button").addEventListener("click", async () => {
		try {
			if (await importLegacyAccountData(accountClient.session.uid)) {
				await performCloudSync(true);
				globalThis.location.reload();
			}
		} catch (error) {
			setAccountStatus(`Import failed: ${error.message}`);
		}
	});
	document.querySelector("#account-sign-out-button").addEventListener("click", () => {
		saveCurrentGameSnapshot();
		accountClient.signOut();
		globalThis.location.reload();
	});
	try {
		const googleSession = await accountClient.restoreGoogleRedirect();
		if (googleSession) {
			await activate(googleSession);
			return;
		}
		const session = await accountClient.restore();
		if (session) {
			await activate(session);
		} else {
			showSignIn();
		}
	} catch (error) {
		console.warn("account restore failed", error);
		message.textContent = `Could not restore sign in: ${error.message}`;
	}
}

globalThis.poker = {
	init,
	get players() {
		return gameState.allPlayers;
	},
	get gameFinished() {
		return gameState.gameFinished;
	},
	get handInProgress() {
		return gameState.handInProgress;
	},
	get reveals() {
		return gameState.allPlayers.map((player) => ({
			name: player.name,
			reveals: player.stats.reveals,
		}));
	},
};

void bootstrap();

/* --------------------------------------------------------------------------------------------------
 * Service Worker configuration
 * - USE_SERVICE_WORKER: enable or disable SW for this project
 * - SERVICE_WORKER_VERSION: bump to force new SW and new cache
 * - AUTO_RELOAD_ON_SW_UPDATE: reload page once after an update
 -------------------------------------------------------------------------------------------------- */
const USE_SERVICE_WORKER = true;
const SERVICE_WORKER_VERSION = "2026-10-01-google-email-auth-5";
const AUTO_RELOAD_ON_SW_UPDATE = true;

initServiceWorker({
	useServiceWorker: USE_SERVICE_WORKER,
	serviceWorkerVersion: SERVICE_WORKER_VERSION,
	autoReloadOnUpdate: AUTO_RELOAD_ON_SW_UPDATE,
});
