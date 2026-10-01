import {
	INITIAL_DECK,
	createBotLineState,
	createCashSessionConfig,
	createHandContextState,
	createPlayerSpotState,
	resolveTurnAction,
	runEngineHand,
} from "../js/gameEngine.js";
import { normalizeBotActionRequest, setBotDecisionSink } from "../js/bot.js";
import { decideLegacyBot } from "../js/legacyBotSeat.js";
import { getPlayerActionState } from "../js/shared/actionModel.js";
import { CASH_BOT_STYLE_VERSION, drawCashBotStyles } from "../js/shared/botStyles.js";
import { projectSeatObservation } from "../js/shared/seatObservation.js";

const BLIND = 20;
const DEPTHS_BB = [20, 40, 60, 100, 150, 200];
const HANDS_PER_DEPTH = 1000;

function createPlayer(seatIndex, buyInChips) {
	return {
		name: `Bot ${seatIndex}`,
		isBot: true,
		seatIndex,
		chips: buyInChips,
		cashInvested: buyInChips,
		holeCards: [null, null],
		visibleHoleCards: [false, false],
		dealer: false,
		smallBlind: false,
		bigBlind: false,
		folded: false,
		allIn: false,
		totalBet: 0,
		roundBet: 0,
		stats: Object.fromEntries([
			"hands", "handsWon", "vpip", "pfr", "calls", "aggressiveActs", "reveals",
			"showdowns", "showdownsWon", "folds", "foldsPreflop", "foldsPostflop", "allins",
		].map((key) => [key, 0])),
		botLine: createBotLineState(),
		spotState: createPlayerSpotState(),
	};
}

function createState(depthBB) {
	const cashSession = createCashSessionConfig({
		smallBlind: BLIND / 2,
		bigBlind: BLIND,
		buyInBB: depthBB,
		topUpThresholdBB: depthBB - 1,
	});
	const players = Array.from({ length: 6 }, (_, seatIndex) =>
		createPlayer(seatIndex, cashSession.buyInChips)
	);
	const styles = drawCashBotStyles(players.length, () => 0.3);
	players.forEach((player, index) => {
		player.botStyle = styles[index];
		player.botStyleVersion = CASH_BOT_STYLE_VERSION;
	});
	return {
		gameMode: "cash",
		cashSession,
		currentPhaseIndex: 0,
		currentBet: 0,
		pot: 0,
		activeSeatIndex: null,
		pendingSeatDecision: null,
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
		smallBlind: cashSession.smallBlind,
		bigBlind: cashSession.bigBlind,
		chipUnit: cashSession.chipUnit,
		lastRaise: cashSession.bigBlind,
		handContext: createHandContextState(),
	};
}

function seedRandom(seed) {
	let state = seed >>> 0;
	Math.random = () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 4294967296;
	};
}

function runDepth(depthBB) {
	const state = createState(depthBB);
	const actions = { fold: 0, check: 0, call: 0, raise: 0, allin: 0 };
	const allInsByStreet = [0, 0, 0, 0];
	const preflopAllInExamples = [];
	const highRaiseExamples = [];
	let maxRaisesThisRound = 0;
	const maxRaisesByStreet = [0, 0, 0, 0];
	const highActionExamples = [];
	let lastDecision = null;
	setBotDecisionSink((decision) => {
		lastDecision = decision;
	});
	const invalidExamples = [];
	for (let handId = 1; handId <= HANDS_PER_DEPTH; handId++) {
		seedRandom(20261030 + depthBB * 10000 + handId);
		const result = runEngineHand(state, (gameState, player) => {
			const botResult = decideLegacyBot(
				projectSeatObservation(gameState, player.seatIndex), player.botLine,
			);
			gameState.nextDecisionId = botResult.nextDecisionId;
			const request = normalizeBotActionRequest(botResult.decision);
			if (request && resolveTurnAction(gameState, player, request)) {
				player.botLine = botResult.nextMemory;
				actions[request.action]++;
				if (request.action === "allin") {
					allInsByStreet[gameState.currentPhaseIndex]++;
					if (gameState.currentPhaseIndex === 0 && preflopAllInExamples.length < 10) {
						preflopAllInExamples.push({
							handId,
							seatIndex: player.seatIndex,
							holeCards: player.holeCards.slice(),
							chips: player.chips,
							currentBet: gameState.currentBet,
							raisesThisRound: gameState.raisesThisRound,
							branch: lastDecision.decisionBranch,
						});
					}
				}
				maxRaisesThisRound = Math.max(maxRaisesThisRound, gameState.raisesThisRound);
				maxRaisesByStreet[gameState.currentPhaseIndex] = Math.max(
					maxRaisesByStreet[gameState.currentPhaseIndex], gameState.raisesThisRound,
				);
				if (gameState.raisesThisRound >= 5 && highActionExamples.length < 10) {
					highActionExamples.push({
						handId,
						street: gameState.currentPhaseIndex,
						board: gameState.communityCards.slice(),
						holeCards: player.holeCards.slice(),
						action: request.action,
						amount: request.amount ?? 0,
						pot: gameState.pot,
						currentBet: gameState.currentBet,
						raisesThisRound: gameState.raisesThisRound,
						branch: lastDecision.decisionBranch,
					});
				}
				if (gameState.currentPhaseIndex === 0 && gameState.raisesThisRound >= 5 &&
					highRaiseExamples.length < 10) {
					highRaiseExamples.push({
						handId,
						holeCards: player.holeCards.slice(),
						action: request.action,
						currentBet: gameState.currentBet,
						raisesThisRound: gameState.raisesThisRound,
						preflopRaiseCount: gameState.handContext.preflopRaiseCount,
					});
				}
				return request;
			}
			if (invalidExamples.length < 5) {
				invalidExamples.push({
					handId,
					seatIndex: player.seatIndex,
					phase: gameState.currentPhaseIndex,
					decision: botResult.decision,
					legal: getPlayerActionState(gameState, player),
				});
			}
			const legal = getPlayerActionState(gameState, player);
			return legal.canCheck ? { action: "check" } : { action: "fold" };
		}, { handId });
		if (result.type !== "showdown") {
			throw new Error(`Depth ${depthBB} hand ${handId} ended with ${result.type}`);
		}
		const net = state.allPlayers.reduce((sum, player) => sum + player.chips - player.cashInvested, 0);
		if (net !== 0 || state.pot !== 0 || state.bigBlind !== BLIND) {
			throw new Error(`Cash invariant failed at depth ${depthBB}, hand ${handId}`);
		}
	}
	setBotDecisionSink(null);
	return {
		depthBB, hands: HANDS_PER_DEPTH,
		styles: state.allPlayers.map((player) => player.botStyle),
		actions, allInsByStreet, maxRaisesThisRound,
		maxRaisesByStreet, preflopAllInExamples, highRaiseExamples, highActionExamples, invalidExamples,
	};
}

const originalRandom = Math.random;
try {
	console.log(JSON.stringify({ depths: DEPTHS_BB.map(runDepth) }, null, 2));
} finally {
	Math.random = originalRandom;
}
