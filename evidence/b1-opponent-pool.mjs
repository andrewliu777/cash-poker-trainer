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
import { projectSeatObservation } from "../js/shared/seatObservation.js";
import { Hand } from "../js/pokersolver.js";

const BLIND = 20;
const HANDS_PER_BLOCK = 100;
const BLOCKS = 60;
const DEPTHS_BB = [20, 100, 200];
const OPPONENTS = ["tight-value", "loose-pressure"];
const BASE_SEED = Number(process.argv.find((argument) => argument.startsWith("--seed="))?.split("=")[1] ?? 20261030);
const INCLUDE_DETAILS = process.argv.includes("--details");
const RANKS = "23456789TJQKA";

function createPlayer(seatIndex, buyInChips, candidateSeat) {
	return {
		name: seatIndex === candidateSeat ? "Cash bot" : "Frozen opponent",
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

function getPreflopScore(holeCards) {
	const ranks = holeCards.map((card) => RANKS.indexOf(card[0]) + 2).sort((a, b) => b - a);
	const pair = ranks[0] === ranks[1];
	const suited = holeCards[0][1] === holeCards[1][1];
	return (pair ? 6 + ranks[0] * 0.3 : ranks[0] * 0.35 + ranks[1] * 0.15) +
		(suited ? 0.6 : 0) +
		(!pair && ranks[0] - ranks[1] === 1 ? 0.3 : 0);
}

function getPostflopValue(player, board) {
	const hand = Hand.solve([...player.holeCards, ...board]);
	const boardHigh = Math.max(...board.map((card) => RANKS.indexOf(card[0]) + 2));
	const holeRanks = player.holeCards.map((card) => RANKS.indexOf(card[0]) + 2);
	const topPair = holeRanks.includes(boardHigh) ||
		(holeRanks[0] === holeRanks[1] && holeRanks[0] > boardHigh);
	return { rank: hand.rank, topPair };
}

function makeRaise(gameState, player, legal, targetTo) {
	const amount = Math.max(legal.minRaise, Math.round(targetTo - player.roundBet));
	if (amount > legal.maxRaiseAmount) {
		return null;
	}
	return amount === player.chips ? { action: "allin" } : { action: "raise", amount };
}

function chooseProbeAction(gameState, player, style) {
	const legal = getPlayerActionState(gameState, player);
	const facingBet = legal.needToCall > 0;
	const loose = style === "loose-pressure";
	if (gameState.currentPhaseIndex === 0) {
		const score = getPreflopScore(player.holeCards);
		const raised = gameState.currentBet > BLIND;
		const valueRaise = score >= (raised ? loose ? 7.4 : 8.0 : loose ? 6.2 : 7.0);
		if (legal.canRaise && valueRaise) {
			const targetTo = raised ? gameState.currentBet * (loose ? 3.2 : 3.0) : BLIND * (loose ? 2.7 : 2.5);
			const raise = makeRaise(gameState, player, legal, targetTo);
			if (raise) {
				return raise;
			}
		}
		if (!facingBet) {
			return { action: "check" };
		}
		if (score >= (raised ? loose ? 5.8 : 6.4 : loose ? 4.4 : 5.4) &&
			legal.needToCall <= player.chips * (raised ? 0.28 : 0.2)) {
			return { action: "call" };
		}
		return { action: "fold" };
	}
	const { rank, topPair } = getPostflopValue(player, gameState.communityCards);
	const strong = rank >= 3 || topPair;
	const betRatio = legal.needToCall / Math.max(BLIND, gameState.pot);
	if (legal.canRaise && !facingBet && (strong || loose && Math.random() < 0.22)) {
		const raise = makeRaise(gameState, player, legal, Math.max(BLIND, gameState.pot * (loose ? 0.65 : 0.55)));
		if (raise) {
			return raise;
		}
	}
	if (legal.canRaise && facingBet && rank >= 4 && betRatio <= 0.8) {
		const raise = makeRaise(gameState, player, legal, gameState.currentBet + gameState.pot * 0.7);
		if (raise) {
			return raise;
		}
	}
	if (!facingBet) {
		return { action: "check" };
	}
	if (rank >= 3 || topPair && betRatio <= (loose ? 1.2 : 0.8) ||
		loose && rank === 2 && betRatio <= 0.35) {
		return { action: "call" };
	}
	return { action: "fold" };
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
	const candidateActions = { fold: 0, check: 0, call: 0, raise: 0, allin: 0 };
	const candidateActionsByStreet = Array.from({ length: 4 }, () =>
		({ fold: 0, check: 0, call: 0, raise: 0, allin: 0 })
	);
	const worstLosses = [];
	const netByEnding = Object.fromEntries([
		"fold-preflop", "fold-flop", "fold-turn", "fold-river", "continued",
	].map((key) => [key, { hands: 0, netBB: 0 }]));
	const netByPreflopRoute = Object.fromEntries([
		"raised", "called", "passive",
	].map((key) => [key, { hands: 0, netBB: 0 }]));
	const netByBlind = { SB: { hands: 0, netBB: 0 }, BB: { hands: 0, netBB: 0 } };
	const preflopActionsByBlind = {
		SB: { fold: 0, check: 0, call: 0, raise: 0, allin: 0 },
		BB: { fold: 0, check: 0, call: 0, raise: 0, allin: 0 },
	};
	let lastDecision = null;
	setBotDecisionSink((decision) => {
		lastDecision = decision;
	});
	for (let index = 0; index < HANDS_PER_BLOCK; index++) {
		const handId = index + 1;
		const netBefore = candidate.chips - candidate.cashInvested;
		const handActions = [];
		let heroFoldStreet = null;
		let heroPreflopRoute = "passive";
		let heroBlind = null;
		seedRandom(BASE_SEED + blockIndex * HANDS_PER_BLOCK + index);
		const result = runEngineHand(state, (gameState, player) => {
			if (player !== candidate) {
				const action = chooseProbeAction(gameState, player, style);
				handActions.push({
					seat: "opponent", phase: gameState.currentPhaseIndex,
					board: gameState.communityCards.slice(), hole: player.holeCards.slice(),
					pot: gameState.pot, currentBet: gameState.currentBet,
					chips: player.chips, action,
				});
				return action;
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
				candidateActions[request.action]++;
				candidateActionsByStreet[gameState.currentPhaseIndex][request.action]++;
				heroBlind = player.smallBlind ? "SB" : "BB";
				if (gameState.currentPhaseIndex === 0) {
					preflopActionsByBlind[heroBlind][request.action]++;
				}
				if (request.action === "fold") {
					heroFoldStreet = gameState.currentPhaseIndex;
				}
				if (gameState.currentPhaseIndex === 0) {
					if (request.action === "raise" || request.action === "allin") {
						heroPreflopRoute = "raised";
					} else if (request.action === "call" && heroPreflopRoute !== "raised") {
						heroPreflopRoute = "called";
					}
				}
				handActions.push({
					seat: "candidate", phase: gameState.currentPhaseIndex,
					board: gameState.communityCards.slice(), hole: player.holeCards.slice(),
					pot: gameState.pot, currentBet: gameState.currentBet,
					chips: player.chips, action: request,
					branch: lastDecision.decisionBranch,
					adjustment: lastDecision.finalAdjustment,
				});
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
		const netChangeBB = (candidate.chips - candidate.cashInvested - netBefore) / BLIND;
		const ending = heroFoldStreet === null
			? "continued"
			: ["fold-preflop", "fold-flop", "fold-turn", "fold-river"][heroFoldStreet];
		netByEnding[ending].hands++;
		netByEnding[ending].netBB += netChangeBB;
		netByPreflopRoute[heroPreflopRoute].hands++;
		netByPreflopRoute[heroPreflopRoute].netBB += netChangeBB;
		const finalHeroBlind = heroBlind ?? (candidate.smallBlind ? "SB" : "BB");
		netByBlind[finalHeroBlind].hands++;
		netByBlind[finalHeroBlind].netBB += netChangeBB;
		if (netChangeBB <= -10) {
			worstLosses.push({ blockIndex, handId, candidateSeat, netChangeBB, actions: handActions });
			worstLosses.sort((a, b) => a.netChangeBB - b.netChangeBB);
			worstLosses.length = Math.min(5, worstLosses.length);
		}
		const net = state.allPlayers.reduce((sum, player) => sum + player.chips - player.cashInvested, 0);
		if (net !== 0 || state.pot !== 0 || state.bigBlind !== BLIND) {
			throw new Error(`Cash invariant failed on hand ${handId}`);
		}
	}
	setBotDecisionSink(null);
	return {
		netBB: (candidate.chips - candidate.cashInvested) / BLIND,
		fallbackCount,
		fallbackExamples,
		candidateDecisions,
		candidateRaises,
		candidateAllIns,
		candidateActions,
		candidateActionsByStreet,
		netByEnding,
		netByPreflopRoute,
		netByBlind,
		preflopActionsByBlind,
		worstLosses,
	};
}

function summarize(depthBB, style) {
	const pairResults = [];
	let fallbackCount = 0;
	const fallbackExamples = [];
	let candidateDecisions = 0;
	let candidateRaises = 0;
	let candidateAllIns = 0;
	const candidateActions = { fold: 0, check: 0, call: 0, raise: 0, allin: 0 };
	const candidateActionsByStreet = Array.from({ length: 4 }, () =>
		({ fold: 0, check: 0, call: 0, raise: 0, allin: 0 })
	);
	const worstLosses = [];
	const netByEnding = Object.fromEntries([
		"fold-preflop", "fold-flop", "fold-turn", "fold-river", "continued",
	].map((key) => [key, { hands: 0, netBB: 0 }]));
	const netByPreflopRoute = Object.fromEntries([
		"raised", "called", "passive",
	].map((key) => [key, { hands: 0, netBB: 0 }]));
	const netByBlind = { SB: { hands: 0, netBB: 0 }, BB: { hands: 0, netBB: 0 } };
	const preflopActionsByBlind = {
		SB: { fold: 0, check: 0, call: 0, raise: 0, allin: 0 },
		BB: { fold: 0, check: 0, call: 0, raise: 0, allin: 0 },
	};
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
			for (const action of Object.keys(candidateActions)) {
				candidateActions[action] += result.candidateActions[action];
				for (let street = 0; street < 4; street++) {
					candidateActionsByStreet[street][action] += result.candidateActionsByStreet[street][action];
				}
			}
			worstLosses.push(...result.worstLosses);
			for (const key of Object.keys(netByEnding)) {
				netByEnding[key].hands += result.netByEnding[key].hands;
				netByEnding[key].netBB += result.netByEnding[key].netBB;
			}
			for (const key of Object.keys(netByPreflopRoute)) {
				netByPreflopRoute[key].hands += result.netByPreflopRoute[key].hands;
				netByPreflopRoute[key].netBB += result.netByPreflopRoute[key].netBB;
			}
			for (const blind of ["SB", "BB"]) {
				netByBlind[blind].hands += result.netByBlind[blind].hands;
				netByBlind[blind].netBB += result.netByBlind[blind].netBB;
				for (const action of Object.keys(preflopActionsByBlind[blind])) {
					preflopActionsByBlind[blind][action] += result.preflopActionsByBlind[blind][action];
				}
			}
		}
	}
	const mean = pairResults.reduce((sum, value) => sum + value, 0) / pairResults.length;
	const variance = pairResults.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
		(pairResults.length - 1);
	const margin = 1.96 * Math.sqrt(variance / pairResults.length);
	worstLosses.sort((a, b) => a.netChangeBB - b.netChangeBB);
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
		candidateActions,
		candidateActionsByStreet,
		netByEnding,
		netByPreflopRoute,
		netByBlind,
		preflopActionsByBlind,
		worstLosses: INCLUDE_DETAILS ? worstLosses.slice(0, 10) : undefined,
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
