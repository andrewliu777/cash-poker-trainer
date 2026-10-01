import {
	INITIAL_DECK,
	createBotLineState,
	createCashSessionConfig,
	createHandContextState,
	createPlayerSpotState,
	resolveTurnAction,
	runEngineHand,
} from "../js/gameEngine.js";
import { normalizeBotActionRequest } from "../js/bot.js";
import { decideLegacyBot } from "../js/legacyBotSeat.js";
import { getPlayerActionState } from "../js/shared/actionModel.js";
import { projectSeatObservation } from "../js/shared/seatObservation.js";

const BLIND = 20;
const HANDS_PER_BLOCK = 100;
const BLOCKS = 10;
const DEPTHS_BB = [20, 100, 200];
const OPPONENTS = ["station", "pressure"];
const BASE_SEED = 20260929;

function createPlayer(seatIndex, buyInChips, candidateSeat) {
	return {
		name: seatIndex === candidateSeat ? "Legacy bot" : "Probe opponent",
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

function createState(depthBB, candidateSeat) {
	const cashSession = createCashSessionConfig({
		smallBlind: BLIND / 2,
		bigBlind: BLIND,
		buyInBB: depthBB,
		topUpThresholdBB: depthBB - 1,
	});
	const players = [0, 1].map((seatIndex) =>
		createPlayer(seatIndex, cashSession.buyInChips, candidateSeat)
	);
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

function chooseProbeAction(gameState, player, style) {
	const legal = getPlayerActionState(gameState, player);
	if (style === "pressure" && legal.canRaise && gameState.raisesThisRound === 0) {
		const targetTo = gameState.currentPhaseIndex === 0
			? 3 * BLIND
			: Math.max(BLIND, Math.floor(gameState.pot / 2));
		const amount = Math.max(
			legal.minRaise,
			targetTo - player.roundBet,
		);
		if (amount <= legal.maxRaiseAmount) {
			return { action: "raise", amount };
		}
	}
	return legal.canCheck ? { action: "check" } : { action: "call" };
}

function seedRandom(seed) {
	let state = seed >>> 0;
	Math.random = () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 4294967296;
	};
}

function runBlock(depthBB, style, blockIndex, candidateSeat) {
	const state = createState(depthBB, candidateSeat);
	const candidate = state.allPlayers[candidateSeat];
	let fallbackCount = 0;
	const fallbackExamples = [];
	let candidateDecisions = 0;
	let candidateRaises = 0;
	let candidateAllIns = 0;
	for (let index = 0; index < HANDS_PER_BLOCK; index++) {
		const handId = index + 1;
		seedRandom(BASE_SEED + blockIndex * HANDS_PER_BLOCK + index);
		const result = runEngineHand(state, (gameState, player) => {
			if (player !== candidate) {
				return chooseProbeAction(gameState, player, style);
			}
			candidateDecisions++;
			const botResult = decideLegacyBot(
				projectSeatObservation(gameState, player.seatIndex),
				player.botLine,
			);
			gameState.nextDecisionId = botResult.nextDecisionId;
			const request = normalizeBotActionRequest(botResult.decision);
			if (request && resolveTurnAction(gameState, player, request)) {
				player.botLine = botResult.nextMemory;
				if (request.action === "raise") {
					candidateRaises++;
				}
				if (request.action === "allin") {
					candidateAllIns++;
				}
				return request;
			}
			fallbackCount++;
			const legal = getPlayerActionState(gameState, player);
			if (fallbackExamples.length < 3) {
				fallbackExamples.push({
				blockIndex,
				handId,
				seatIndex: player.seatIndex,
				phaseIndex: gameState.currentPhaseIndex,
				chips: player.chips,
				roundBet: player.roundBet,
				currentBet: gameState.currentBet,
				lastRaise: gameState.lastRaise,
				decision: botResult.decision,
				legal,
				});
			}
			return legal.canCheck ? { action: "check" } : { action: "fold" };
		}, { handId });
		if (result.type !== "showdown") {
			throw new Error(`Hand ${handId} ended with ${result.type}`);
		}
		const net = state.allPlayers.reduce((sum, player) => sum + player.chips - player.cashInvested, 0);
		if (net !== 0 || state.pot !== 0 || state.bigBlind !== BLIND) {
			throw new Error(`Cash invariant failed on hand ${handId}`);
		}
	}
	return {
		netBB: (candidate.chips - candidate.cashInvested) / BLIND,
		fallbackCount,
		fallbackExamples,
		candidateDecisions,
		candidateRaises,
		candidateAllIns,
	};
}

function summarize(depthBB, style) {
	const pairResults = [];
	let fallbackCount = 0;
	const fallbackExamples = [];
	let candidateDecisions = 0;
	let candidateRaises = 0;
	let candidateAllIns = 0;
	for (let blockIndex = 0; blockIndex < BLOCKS; blockIndex++) {
		const first = runBlock(depthBB, style, blockIndex, 0);
		const second = runBlock(depthBB, style, blockIndex, 1);
		pairResults.push((first.netBB + second.netBB) / (2 * HANDS_PER_BLOCK) * 100);
		for (const result of [first, second]) {
			fallbackCount += result.fallbackCount;
			fallbackExamples.push(...result.fallbackExamples);
			candidateDecisions += result.candidateDecisions;
			candidateRaises += result.candidateRaises;
			candidateAllIns += result.candidateAllIns;
		}
	}
	const mean = pairResults.reduce((sum, value) => sum + value, 0) / pairResults.length;
	const variance = pairResults.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
		(pairResults.length - 1);
	const margin = 1.96 * Math.sqrt(variance / pairResults.length);
	return {
		depthBB,
		style,
		hands: 2 * BLOCKS * HANDS_PER_BLOCK,
		bbPer100: Number(mean.toFixed(2)),
		indicative95PercentInterval: [
			Number((mean - margin).toFixed(2)),
			Number((mean + margin).toFixed(2)),
		],
		fallbackCount,
		fallbackExamples: fallbackExamples.slice(0, 5),
		candidateDecisions,
		candidateRaises,
		candidateAllIns,
	};
}

const originalRandom = Math.random;
try {
	const results = DEPTHS_BB.flatMap((depthBB) =>
		OPPONENTS.map((style) => summarize(depthBB, style))
	);
	console.log(JSON.stringify({
		seed: BASE_SEED,
		blocks: BLOCKS,
		handsPerBlock: HANDS_PER_BLOCK,
		results,
	}, null, 2));
} finally {
	Math.random = originalRandom;
}
