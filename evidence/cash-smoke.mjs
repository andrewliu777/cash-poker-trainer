import {
	INITIAL_DECK,
	createBotLineState,
	createCashSessionConfig,
	createHandContextState,
	createPlayerSpotState,
	runEngineHand,
} from "../js/gameEngine.js";
import { normalizeBotActionRequest } from "../js/bot.js";
import { decideLegacyBot } from "../js/legacyBotSeat.js";
import { getPlayerActionState } from "../js/shared/actionModel.js";
import { projectSeatObservation } from "../js/shared/seatObservation.js";

function createBot(seatIndex, chips) {
	return {
		name: `Bot ${seatIndex}`,
		isBot: true,
		seatIndex,
		chips,
		cashInvested: chips,
		holeCards: [null, null],
		visibleHoleCards: [false, false],
		dealer: false,
		smallBlind: false,
		bigBlind: false,
		folded: false,
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
		botLine: createBotLineState(),
		spotState: createPlayerSpotState(),
	};
}

function chooseAction(gameState, player) {
	const botResult = decideLegacyBot(
		projectSeatObservation(gameState, player.seatIndex),
		player.botLine,
	);
	gameState.nextDecisionId = botResult.nextDecisionId;
	const request = normalizeBotActionRequest(botResult.decision);
	if (request) {
		player.botLine = botResult.nextMemory;
	}
	return request ?? (getPlayerActionState(gameState, player).canCheck
		? { action: "check" }
		: { action: "fold" });
}

let completedHands = 0;
let topUps = 0;
for (let run = 0; run < 10; run++) {
	let seed = run + 1;
	Math.random = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 4294967296;
	};
	const config = createCashSessionConfig({
		smallBlind: 50,
		bigBlind: 100,
		buyInBB: 100,
		topUpThresholdBB: 40,
	});
	const players = Array.from({ length: 6 }, (_, seatIndex) => createBot(seatIndex, config.buyInChips));
	const state = {
		gameMode: "cash",
		cashSession: config,
		currentPhaseIndex: 0,
		currentBet: 0,
		pot: 0,
		activeSeatIndex: null,
		handId: 0,
		nextDecisionId: 1,
		blindLevel: 0,
		gameStarted: true,
		gameFinished: false,
		openCardsMode: false,
		spectatorMode: true,
		raisesThisRound: 0,
		handInProgress: false,
		deck: INITIAL_DECK.slice(),
		cardGraveyard: [],
		communityCards: [],
		players,
		allPlayers: players.slice(),
		chipTransfer: null,
		pendingAction: null,
		smallBlind: config.smallBlind,
		bigBlind: config.bigBlind,
		chipUnit: config.chipUnit,
		lastRaise: config.bigBlind,
		handContext: createHandContextState(),
	};
	for (let handId = 1; handId <= 100; handId++) {
		const result = runEngineHand(state, chooseAction, { handId });
		if (result.type !== "showdown") {
			throw new Error(JSON.stringify({
				run,
				handId,
				type: result.type,
				request: result.invalidAction?.actionRequest,
				player: result.invalidAction?.player?.name,
			}));
		}
		const chips = state.allPlayers.reduce((sum, player) => sum + player.chips, 0);
		const invested = state.allPlayers.reduce((sum, player) => sum + player.cashInvested, 0);
		if (chips !== invested || state.pot !== 0 || state.smallBlind !== 50 || state.bigBlind !== 100) {
			throw new Error(`Cash accounting or blinds changed in run ${run}, hand ${handId}`);
		}
		topUps += result.nextHandPlan.cashTransactions.length;
		completedHands++;
	}
}
console.log(`${completedHands} cash hands completed; ${topUps} top-ups; chips and blinds conserved.`);
