import {
	INITIAL_DECK,
	createBotLineState,
	createHandContextState,
	createPlayerSpotState,
	runEngineTournament,
} from "../js/gameEngine.js";
import { normalizeBotActionRequest } from "../js/bot.js";
import { decideLegacyBot } from "../js/legacyBotSeat.js";
import { getPlayerActionState } from "../js/shared/actionModel.js";
import { projectSeatObservation } from "../js/shared/seatObservation.js";

function createBot(index, startingChips) {
	return {
		name: `Bot ${index}`,
		isBot: true,
		seatIndex: index,
		chips: startingChips,
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

function createState({ smallBlind, bigBlind, chipUnit, startingChips }) {
	const players = Array.from({ length: 6 }, (_, index) => createBot(index, startingChips));
	return {
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
		smallBlind,
		bigBlind,
		chipUnit,
		lastRaise: bigBlind,
		handContext: createHandContextState(),
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
		return request;
	}
	return getPlayerActionState(gameState, player).canCheck
		? { action: "check" }
		: { action: "fold" };
}

let handCount = 0;
for (let run = 0; run < 100; run++) {
	let seed = run + 1;
	Math.random = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 4294967296;
	};
	const config = run % 2 === 0
		? { smallBlind: 10, bigBlind: 20, chipUnit: 10, startingChips: 2000 }
		: { smallBlind: 50, bigBlind: 100, chipUnit: 1, startingChips: 10000 };
	const state = createState(config);
	const result = runEngineTournament(state, chooseAction, { maxHands: 200 });
	if (result.type !== "game-over" && result.type !== "max-hands") {
		const invalid = result.stoppedHand?.invalidAction;
		throw new Error(JSON.stringify({
			run,
			handId: result.stoppedHand?.handId,
			type: result.type,
			request: invalid?.actionRequest,
			player: invalid?.player?.name,
			chips: invalid?.player?.chips,
			currentBet: state.currentBet,
			lastRaise: state.lastRaise,
		}));
	}
	const remainingChips = state.players.reduce((sum, player) => sum + player.chips, 0);
	if (remainingChips !== config.startingChips * 6 || state.pot !== 0) {
		throw new Error(`Chips not conserved in run ${run}: ${remainingChips} + ${state.pot}`);
	}
	handCount += result.handCount;
}
console.log(`100 seeded tournaments completed; ${handCount} hands; chips conserved.`);
