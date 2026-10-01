import { normalizeBotActionRequest } from "./bot.js";
import {
	createBotLineState,
	createHandContextState,
	createPlayerSpotState,
	INITIAL_DECK,
	resolveTurnAction,
} from "./gameEngine.js";
import { decideLegacyBot } from "./legacyBotSeat.js";
import { CASH_BOT_STYLE_IDS, drawCashBotStyles } from "./shared/botStyles.js";
import { projectSeatObservation } from "./shared/seatObservation.js";

function assertEquals(actual, expected, message = "") {
	const actualJson = JSON.stringify(actual);
	const expectedJson = JSON.stringify(expected);
	if (actualJson !== expectedJson) {
		throw new Error(
			`${message}\nExpected: ${expectedJson}\nActual:   ${actualJson}`,
		);
	}
}

Deno.test("normalizeBotActionRequest returns null for missing decisions", () => {
	assertEquals(normalizeBotActionRequest(null), null);
	assertEquals(normalizeBotActionRequest(undefined), null);
});

Deno.test("normalizeBotActionRequest keeps non-amount actions", () => {
	for (const action of ["fold", "check", "call", "allin"]) {
		assertEquals(
			normalizeBotActionRequest({ action, amount: 500 }),
			{ action },
		);
	}
});

Deno.test("normalizeBotActionRequest parses raise amount", () => {
	assertEquals(
		normalizeBotActionRequest({ action: "raise", amount: "125" }),
		{ action: "raise", amount: 125 },
	);
});

Deno.test("normalizeBotActionRequest rejects invalid raise amount", () => {
	assertEquals(normalizeBotActionRequest({ action: "raise", amount: "abc" }), null);
	assertEquals(normalizeBotActionRequest({ action: "raise", amount: "125abc" }), null);
	assertEquals(normalizeBotActionRequest({ action: "raise", amount: 125.5 }), null);
});

Deno.test("normalizeBotActionRequest rejects unknown actions", () => {
	assertEquals(normalizeBotActionRequest({ action: "bet", amount: 100 }), null);
});

function createCashBotPlayer(seatIndex, chips) {
	return {
		name: `Seat ${seatIndex}`,
		seatIndex,
		chips,
		roundBet: seatIndex === 1 ? 10 : seatIndex === 2 ? 20 : 0,
		totalBet: seatIndex === 1 ? 10 : seatIndex === 2 ? 20 : 0,
		folded: false,
		allIn: false,
		dealer: seatIndex === 0,
		smallBlind: seatIndex === 1,
		bigBlind: seatIndex === 2,
		holeCards: ["AS", "AH"],
		botLine: createBotLineState(),
		spotState: createPlayerSpotState(),
		stats: Object.fromEntries([
			"hands", "handsWon", "vpip", "pfr", "calls", "aggressiveActs", "reveals",
			"showdowns", "showdownsWon", "folds", "foldsPreflop", "foldsPostflop", "allins",
		].map((key) => [key, 0])),
	};
}

function createCashBotState(depthBB = 20) {
	return {
		gameMode: "cash",
		handId: 1,
		nextDecisionId: 1,
		blindLevel: 0,
		currentPhaseIndex: 0,
		currentBet: 20,
		pot: 30,
		smallBlind: 10,
		bigBlind: 20,
		chipUnit: 1,
		raisesThisRound: 0,
		lastRaise: 20,
		communityCards: [],
		players: Array.from({ length: 6 }, (_, seatIndex) =>
			createCashBotPlayer(seatIndex, depthBB * 20 - (seatIndex === 1 ? 10 : seatIndex === 2 ? 20 : 0))
		),
		activeSeatIndex: 3,
		handContext: createHandContextState(),
	};
}

Deno.test("cash bot opens a 20BB premium without a tournament-zone shove", () => {
	const state = createCashBotState();
	const player = state.players[3];
	const observation = projectSeatObservation(state, player.seatIndex);
	assertEquals(observation.gameMode, "cash");
	const result = decideLegacyBot(observation, player.botLine);
	assertEquals(result.decision, { action: "raise", amount: 44 });
	if (!resolveTurnAction(state, player, normalizeBotActionRequest(result.decision))) {
		throw new Error("Cash open was not legal");
	}
});

Deno.test("cash bot checks for free when the last opponent is all-in", () => {
	const state = createCashBotState();
	const player = state.players[3];
	state.players.forEach((seat) => {
		seat.folded = seat !== player && seat !== state.players[0];
	});
	state.players[0].allIn = true;
	state.players[0].chips = 0;
	state.currentPhaseIndex = 2;
	state.currentBet = 0;
	state.pot = 200;
	state.communityCards = ["KS", "7C", "8D", "4H"];
	player.holeCards = ["2S", "3D"];
	const result = decideLegacyBot(projectSeatObservation(state, player.seatIndex), player.botLine);
	assertEquals(result.decision, { action: "check" });
	if (!resolveTurnAction(state, player, normalizeBotActionRequest(result.decision))) {
		throw new Error("Free check was not legal");
	}
});

Deno.test("deep cash five-bet can use a legal non-all-in size", () => {
	const state = createCashBotState(200);
	const player = state.players[0];
	state.players.forEach((seat) => {
		seat.folded = seat !== player && seat !== state.players[2];
	});
	player.roundBet = 200;
	player.totalBet = 200;
	player.chips = 3800;
	player.spotState.actedThisStreet = true;
	state.players[2].roundBet = 400;
	state.players[2].totalBet = 400;
	state.players[2].chips = 3600;
	state.currentBet = 400;
	state.pot = 600;
	state.lastRaise = 200;
	state.raisesThisRound = 3;
	state.activeSeatIndex = player.seatIndex;
	state.handContext.preflopRaiseCount = 3;
	state.handContext.preflopAggressorSeatIndex = 2;
	const result = decideLegacyBot(projectSeatObservation(state, player.seatIndex), player.botLine);
	if (result.decision.action !== "raise" || result.decision.amount >= player.chips) {
		throw new Error(`Expected a non-all-in five-bet, got ${JSON.stringify(result.decision)}`);
	}
	if (!resolveTurnAction(state, player, normalizeBotActionRequest(result.decision))) {
		throw new Error("Deep five-bet was not legal");
	}
});

Deno.test("deep cash five-bet releases a suited connector to heavy action", () => {
	const state = createCashBotState(200);
	const player = state.players[0];
	state.players.forEach((seat) => {
		seat.folded = seat !== player && seat !== state.players[2];
	});
	player.holeCards = ["TS", "9S"];
	player.roundBet = 200;
	player.totalBet = 200;
	player.chips = 3800;
	player.spotState.actedThisStreet = true;
	state.players[2].roundBet = 400;
	state.players[2].totalBet = 400;
	state.players[2].chips = 3600;
	state.currentBet = 400;
	state.pot = 600;
	state.lastRaise = 200;
	state.raisesThisRound = 3;
	state.activeSeatIndex = player.seatIndex;
	state.handContext.preflopRaiseCount = 3;
	state.handContext.preflopAggressorSeatIndex = 2;
	const result = decideLegacyBot(projectSeatObservation(state, player.seatIndex), player.botLine);
	assertEquals(result.decision, { action: "fold" });
});

Deno.test("cash bot does not reraise a weak private pair on a paired river", () => {
	const state = createCashBotState(100);
	const player = state.players[0];
	state.players.forEach((seat) => {
		seat.folded = seat !== player && seat !== state.players[2];
	});
	player.holeCards = ["2S", "AC"];
	player.roundBet = 0;
	player.chips = 2000;
	state.players[2].roundBet = 471;
	state.players[2].chips = 2000;
	state.currentPhaseIndex = 3;
	state.currentBet = 471;
	state.pot = 1195;
	state.lastRaise = 471;
	state.raisesThisRound = 1;
	state.communityCards = ["QS", "2D", "QD", "4C", "7H"];
	state.activeSeatIndex = player.seatIndex;
	const result = decideLegacyBot(projectSeatObservation(state, player.seatIndex), player.botLine);
	if (result.decision.action === "raise" || result.decision.action === "allin") {
		throw new Error(`Weak paired-board hand reraised: ${JSON.stringify(result.decision)}`);
	}
	if (!resolveTurnAction(state, player, normalizeBotActionRequest(result.decision))) {
		throw new Error("Paired-board response was not legal");
	}
});

Deno.test("cash bot releases the lower full house after repeated raises", () => {
	const state = createCashBotState(200);
	const player = state.players[0];
	state.players.forEach((seat) => {
		seat.folded = seat !== player && seat !== state.players[2];
	});
	player.holeCards = ["6C", "AD"];
	player.roundBet = 366;
	player.chips = 3600;
	state.players[2].roundBet = 867;
	state.players[2].chips = 3200;
	state.currentPhaseIndex = 3;
	state.currentBet = 867;
	state.pot = 1445;
	state.lastRaise = 501;
	state.raisesThisRound = 2;
	state.communityCards = ["8S", "6S", "8H", "QD", "6H"];
	state.activeSeatIndex = player.seatIndex;
	const result = decideLegacyBot(projectSeatObservation(state, player.seatIndex), player.botLine);
	assertEquals(result.decision, { action: "fold" });
});

Deno.test("cash bot styles are randomly assigned without repeats until the pool cycles", () => {
	const first = drawCashBotStyles(6, () => 0.25);
	const second = drawCashBotStyles(6, () => 0.25);
	assertEquals(first, second);
	assertEquals(new Set(first.slice(0, 4)).size, CASH_BOT_STYLE_IDS.length);
	assertEquals(first.length, 6);
});

Deno.test("cash bot styles produce different legal heads-up opening patterns", () => {
	const originalRandom = Math.random;
	const counts = Object.fromEntries(CASH_BOT_STYLE_IDS.map((style) => [style, {
		raise: 0, call: 0, fold: 0, invalid: 0,
	}]));
	try {
		Math.random = () => 0.75;
		for (let first = 0; first < INITIAL_DECK.length; first++) {
			for (let second = first + 1; second < INITIAL_DECK.length; second++) {
				for (const style of CASH_BOT_STYLE_IDS) {
					const state = createCashBotState(100);
					state.players = state.players.slice(0, 2);
					state.players[0].dealer = true;
					state.players[0].smallBlind = true;
					state.players[0].bigBlind = false;
					state.players[0].roundBet = 10;
					state.players[0].totalBet = 10;
					state.players[1].dealer = false;
					state.players[1].smallBlind = false;
					state.players[1].bigBlind = true;
					state.players[1].roundBet = 20;
					state.players[1].totalBet = 20;
					state.activeSeatIndex = 0;
					const player = state.players[0];
					player.botStyle = style;
					player.holeCards = [INITIAL_DECK[first], INITIAL_DECK[second]];
					const result = decideLegacyBot(projectSeatObservation(state, 0), player.botLine);
					const request = normalizeBotActionRequest(result.decision);
					if (!request || !resolveTurnAction(state, player, request)) {
						counts[style].invalid++;
					} else if (request.action in counts[style]) {
						counts[style][request.action]++;
					}
				}
			}
		}
	} finally {
		Math.random = originalRandom;
	}
	for (const style of CASH_BOT_STYLE_IDS) {
		assertEquals(counts[style].invalid, 0, style);
	}
	if (!(counts.pressure.raise > counts.balanced.raise &&
		counts.balanced.raise > counts["tight-value"].raise &&
		counts["loose-passive"].call > counts.balanced.call)) {
		throw new Error(`Cash styles did not diverge as intended: ${JSON.stringify(counts)}`);
	}
});
