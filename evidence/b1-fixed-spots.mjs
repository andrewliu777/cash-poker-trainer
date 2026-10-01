import {
	INITIAL_DECK,
	createBotLineState,
	createHandContextState,
	createPlayerSpotState,
	resolveTurnAction,
} from "../js/gameEngine.js";
import { normalizeBotActionRequest, setBotDecisionSink } from "../js/bot.js";
import { decideLegacyBot } from "../js/legacyBotSeat.js";
import { projectSeatObservation } from "../js/shared/seatObservation.js";

const BLIND = 20;
const DEPTHS_BB = [20, 40, 60, 100, 150, 200];
const FLOP = ["KS", "7C", "8D"];

function createPlayer(seatIndex, depthBB, spot) {
	const preflopInvestment = spot === "three-way-flop" ? (seatIndex <= 2 ? 3 * BLIND : 0) :
		seatIndex === 1 ? BLIND / 2 : seatIndex === 2 ? BLIND : 0;
	const player = {
		name: `Seat ${seatIndex}`,
		seatIndex,
		chips: depthBB * BLIND - preflopInvestment,
		roundBet: spot === "three-way-flop" ? 0 : preflopInvestment,
		totalBet: preflopInvestment,
		folded: spot === "six-max-button" || spot === "three-way-flop"
			? seatIndex >= 3
			: false,
		allIn: false,
		dealer: seatIndex === 0,
		smallBlind: seatIndex === 1,
		bigBlind: seatIndex === 2,
		holeCards: [null, null],
		botLine: createBotLineState(),
		spotState: createPlayerSpotState(),
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
	};
	if (spot === "three-way-flop") {
		player.spotState.enteredPreflop = !player.folded;
		player.spotState.actedThisStreet = seatIndex === 1 || seatIndex === 2;
		player.botLine.preflopAggressor = seatIndex === 0;
	}
	return player;
}

function createState(depthBB, spot) {
	const players = spot === "heads-up-sb"
		? [createPlayer(0, depthBB, spot), createPlayer(1, depthBB, spot)]
		: Array.from({ length: 6 }, (_, seatIndex) => createPlayer(seatIndex, depthBB, spot));
	if (spot === "heads-up-sb") {
		players[0].smallBlind = true;
		players[0].roundBet = BLIND / 2;
		players[0].totalBet = BLIND / 2;
		players[0].chips = depthBB * BLIND - BLIND / 2;
		players[1].smallBlind = false;
		players[1].bigBlind = true;
		players[1].roundBet = BLIND;
		players[1].totalBet = BLIND;
		players[1].chips = depthBB * BLIND - BLIND;
	}
	const handContext = createHandContextState();
	if (spot === "three-way-flop") {
		handContext.preflopRaiseCount = 1;
		handContext.preflopAggressorSeatIndex = 0;
		handContext.streetCheckCounts.flop = 2;
	}
	return {
		gameMode: "cash",
		handId: 1,
		nextDecisionId: 1,
		blindLevel: 0,
		currentPhaseIndex: spot === "three-way-flop" ? 1 : 0,
		currentBet: spot === "three-way-flop" ? 0 : BLIND,
		pot: spot === "three-way-flop" ? 9 * BLIND : 1.5 * BLIND,
		smallBlind: BLIND / 2,
		bigBlind: BLIND,
		chipUnit: 1,
		raisesThisRound: 0,
		lastRaise: BLIND,
		communityCards: spot === "three-way-flop" ? FLOP.slice() : [],
		players,
		activeSeatIndex: spot === "six-max-utg" ? 3 : 0,
		handContext,
	};
}

function seedRandom(seed) {
	let state = seed >>> 0;
	Math.random = () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 4294967296;
	};
}

function scanSpot(depthBB, spot) {
	const seatIndex = spot === "six-max-utg" ? 3 : 0;
	const cards = INITIAL_DECK.filter((card) => spot !== "three-way-flop" || !FLOP.includes(card));
	const actions = { fold: 0, check: 0, call: 0, raise: 0, allin: 0, invalid: 0 };
	let totalRaiseBB = 0;
	const raiseSizesBB = [];
	const invalidExamples = [];
	const scoreDistribution = Array.from({ length: 21 }, () => 0);
	const limpScoreDistribution = Array.from({ length: 21 }, () => 0);
	const branches = {};
	const foldReasons = {};
	let combos = 0;
	let lastDecision = null;
	setBotDecisionSink((decision) => {
		lastDecision = decision;
	});
	for (let first = 0; first < cards.length; first++) {
		for (let second = first + 1; second < cards.length; second++) {
			const state = createState(depthBB, spot);
			const player = state.players[seatIndex];
			player.holeCards = [cards[first], cards[second]];
			seedRandom(20260929 + first * 53 + second);
			const botResult = decideLegacyBot(
				projectSeatObservation(state, seatIndex),
				player.botLine,
			);
			const request = normalizeBotActionRequest(botResult.decision);
			branches[lastDecision.decisionBranch ?? "unknown"] =
				(branches[lastDecision.decisionBranch ?? "unknown"] ?? 0) + 1;
			if (spot !== "three-way-flop") {
				const scoreBin = Math.max(0, Math.min(20, Math.floor(lastDecision.openRaiseScore * 2)));
				scoreDistribution[scoreBin]++;
				const limpScoreBin = Math.max(0, Math.min(20, Math.floor(lastDecision.openLimpScore * 2)));
				limpScoreDistribution[limpScoreBin]++;
				if (request?.action === "fold") {
					const reason = lastDecision.openLimpEligibilityReason ?? "none";
					foldReasons[reason] = (foldReasons[reason] ?? 0) + 1;
				}
			}
			if (!request || !resolveTurnAction(state, player, request)) {
				actions.invalid++;
				if (invalidExamples.length < 3) {
					invalidExamples.push({ cards: player.holeCards, decision: botResult.decision });
				}
			} else {
				actions[request.action]++;
				if (request.action === "raise") {
					totalRaiseBB += (player.roundBet + request.amount) / BLIND;
					raiseSizesBB.push((player.roundBet + request.amount) / BLIND);
				}
			}
			combos++;
		}
	}
	return {
		depthBB,
		spot,
		combos,
		actions,
		invalidExamples,
		branches,
		scoreDistribution,
		limpScoreDistribution,
		foldReasons,
		averageRaiseToBB: actions.raise > 0
			? Number((totalRaiseBB / actions.raise).toFixed(2))
			: null,
		raiseToBBRange: raiseSizesBB.length > 0
			? [Math.min(...raiseSizesBB), Math.max(...raiseSizesBB)]
			: null,
	};
}

const originalRandom = Math.random;
try {
	console.log(JSON.stringify({
		spots: DEPTHS_BB.flatMap((depthBB) =>
			["six-max-utg", "six-max-button", "heads-up-sb", "three-way-flop"].map((spot) =>
				scanSpot(depthBB, spot)
			)
		),
	}, null, 2));
} finally {
	setBotDecisionSink(null);
	Math.random = originalRandom;
}
