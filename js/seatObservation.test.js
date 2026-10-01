import {
	beginSeatDecision,
	createBotLineState,
	createHandContextState,
	createPlayerSpotState,
	submitSeatDecision,
} from "./gameEngine.js";
import { decideLegacyBot } from "./legacyBotSeat.js";
import { projectSeatObservation } from "./shared/seatObservation.js";

function assertEquals(actual, expected) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}

function createPlayer(seatIndex, holeCards) {
	return {
		name: `Seat ${seatIndex}`,
		seatIndex,
		chips: 1000,
		roundBet: seatIndex === 0 ? 10 : 20,
		totalBet: seatIndex === 0 ? 10 : 20,
		folded: false,
		allIn: false,
		dealer: seatIndex === 0,
		smallBlind: seatIndex === 0,
		bigBlind: seatIndex === 1,
		holeCards,
		visibleHoleCards: [true, true],
		winProbability: seatIndex === 0 ? 95 : 5,
		botLine: createBotLineState(),
		spotState: createPlayerSpotState(),
		stats: {
			hands: 10,
			handsWon: 2,
			vpip: 3,
			pfr: 1,
			calls: 2,
			aggressiveActs: 1,
			reveals: 0,
			showdowns: 1,
			showdownsWon: 0,
			folds: 2,
			foldsPreflop: 1,
			foldsPostflop: 1,
			allins: 0,
		},
	};
}

function createState() {
	return {
		handId: 7,
		nextDecisionId: 3,
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
		deck: ["2C", "3D", "4H"],
		cardGraveyard: ["5S"],
		players: [createPlayer(0, ["AH", "AD"]), createPlayer(1, ["KC", "KD"])],
		handContext: createHandContextState(),
	};
}

Deno.test("seat observation excludes other hole cards, future cards, probabilities, and agent memory", () => {
	const state = createState();
	state.players[0].botStyle = "pressure";
	state.players[1].botStyle = "tight-value";
	const first = projectSeatObservation(state, 0);
	assertEquals(first.botStyle, "pressure");
	state.players[1].holeCards = ["7S", "8S"];
	state.players[1].botStyle = "loose-passive";
	state.players[1].visibleHoleCards = [false, false];
	state.players[1].winProbability = 99;
	state.players[1].botLine.checkRaiseIntent = { secret: "hidden plan" };
	state.deck = ["QS", "JS"];
	state.cardGraveyard = ["9S"];
	const second = projectSeatObservation(state, 0);
	assertEquals(first, second);
	assertEquals(first.holeCards, ["AH", "AD"]);
	if (JSON.stringify(first).includes("KC") || JSON.stringify(first).includes("hidden plan")) {
		throw new Error("Private opponent information entered the observation");
	}
	first.players[1].stats.vpip = 999;
	first.holeCards[0] = "2C";
	assertEquals(state.players[1].stats.vpip, 3);
	assertEquals(state.players[0].holeCards[0], "AH");
});

Deno.test("legacy bot action is unchanged by opponent secrets under the same random stream", () => {
	const state = createState();
	const originalRandom = Math.random;
	try {
		Math.random = () => 0.25;
		const first = decideLegacyBot(
			projectSeatObservation(state, 0),
			state.players[0].botLine,
		);
		state.players[1].holeCards = ["7S", "8S"];
		state.players[1].winProbability = 99;
		state.deck = ["QS", "JS"];
		const second = decideLegacyBot(
			projectSeatObservation(state, 0),
			state.players[0].botLine,
		);
		assertEquals(first, second);
	} finally {
		Math.random = originalRandom;
	}
});

Deno.test("seat decision rejects invalid, stale, duplicate, and wrong-seat requests", () => {
	const state = createState();
	const hero = state.players[0];
	const villain = state.players[1];
	const oldTicket = beginSeatDecision(state, hero);
	assertEquals(projectSeatObservation(state, 0).decisionId, oldTicket.decisionId);
	assertEquals(submitSeatDecision(state, hero, oldTicket, { action: "raise", raiseTo: 30 }), null);
	assertEquals(submitSeatDecision(state, villain, oldTicket, { action: "call" }), null);
	assertEquals(state.pendingSeatDecision, oldTicket);
	const currentTicket = beginSeatDecision(state, hero);
	assertEquals(submitSeatDecision(state, hero, oldTicket, { action: "call" }), null);
	assertEquals(submitSeatDecision(state, hero, currentTicket, { action: "raise", raiseTo: 50 }).amount, 40);
	assertEquals(state.pendingSeatDecision, null);
	assertEquals(submitSeatDecision(state, hero, currentTicket, { action: "raise", raiseTo: 50 }), null);
	const nextTicket = beginSeatDecision(state, villain);
	state.handId++;
	assertEquals(submitSeatDecision(state, villain, nextTicket, { action: "check" }), null);
});
