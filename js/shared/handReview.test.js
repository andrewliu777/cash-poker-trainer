import { appendHandEvent, createHandHistory } from "./handHistory.js";
import {
	buildHandReplayFrame,
	buildHandReviewIndex,
	buildHandReplaySteps,
	createHistorySessionId,
	formatHistorySessionLabel,
	getHeroHandNet,
	getReplaySeatPositions,
} from "./handReview.js";

function assertEquals(actual, expected) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}

function completedHand(botCards = ["KS", "KH"], turnCard = "7H") {
	let history = createHandHistory({
		sessionId: "session-a",
		handId: 3,
		dealerSeatIndex: 0,
		smallBlind: 10,
		bigBlind: 20,
		chipUnit: 10,
		players: [
			{ seatIndex: 0, name: "Hero", chips: 100 },
			{ seatIndex: 1, name: "Bot", chips: 100, isBot: true },
		],
	});
	const add = (type, data, visibility) => {
		history = appendHandEvent(history, type, data, visibility);
	};
	add("blind.posted", { seatIndex: 0, blind: "small", paid: 10, streetTotalTo: 10, potAfter: 10 });
	add("blind.posted", { seatIndex: 1, blind: "big", paid: 20, streetTotalTo: 20, potAfter: 30 });
	add("hole.dealt", { seatIndex: 0, cards: ["AS", "AH"] }, { kind: "seat", seatIndex: 0 });
	add("hole.dealt", { seatIndex: 1, cards: botCards }, { kind: "seat", seatIndex: 1 });
	add("action.applied", {
		seatIndex: 0, decisionId: 1, street: "preflop", kind: "call", paid: 10,
		streetTotalTo: 20, potAfter: 40, allIn: false,
	});
	add("action.applied", {
		seatIndex: 1, decisionId: 2, street: "preflop", kind: "check", paid: 0,
		streetTotalTo: 20, potAfter: 40, allIn: false,
	});
	add("board.dealt", { street: "flop", cards: ["2C", "3D", "4S"] });
	add("board.dealt", { street: "turn", cards: [turnCard] });
	add("board.dealt", { street: "river", cards: ["9C"] });
	add("hole.revealed", { seatIndex: 1, cards: botCards });
	add("pot.settled", {
		totalPot: 40, hadShowdown: true,
		payouts: [{ seatIndex: 0, amount: 40 }],
	});
	add("hand.ended", {
		endingStacks: [{ seatIndex: 0, chips: 120 }, { seatIndex: 1, chips: 80 }],
	});
	return history;
}

Deno.test("review index exposes current and imported sessions with newest hand first", () => {
	const histories = [
		{ sessionId: "old", handId: 2 },
		{ sessionId: "current", handId: 1 },
		{ sessionId: "old", handId: 7 },
	];
	assertEquals(buildHandReviewIndex(histories, "current"), [
		{ sessionId: "current", hands: [{ key: "current:1", handId: 1 }] },
		{ sessionId: "old", hands: [{ key: "old:7", handId: 7 }, { key: "old:2", handId: 2 }] },
	]);
});

Deno.test("new session IDs display a date while old IDs keep their short label", () => {
	const id = createHistorySessionId(new Date("2026-09-30T12:34:56Z"), "unique");
	assertEquals(id, "2026-09-30T12-34-56Z-unique");
	if (!formatHistorySessionLabel(id, true).includes("2026")) {
		throw new Error("Timestamped session should show its date");
	}
	assertEquals(formatHistorySessionLabel("abcdef12-rest", false), "Session abcdef12");
	const ordered = buildHandReviewIndex([
		{ sessionId: "2026-09-29T09-00-00Z-old", handId: 1 },
		{ sessionId: "2026-09-30T09-00-00Z-new", handId: 1 },
	]);
	assertEquals(ordered[0].sessionId, "2026-09-30T09-00-00Z-new");
});

Deno.test("loss prompt uses the hero's net chip change for the completed hand", () => {
	const winningHand = completedHand();
	assertEquals(getHeroHandNet(winningHand), 20);
	const losingHand = structuredClone(winningHand);
	losingHand.events.at(-1).data.endingStacks[0].chips = 80;
	assertEquals(getHeroHandNet(losingHand), -20);
	const evenHand = structuredClone(winningHand);
	evenHand.events.at(-1).data.endingStacks[0].chips = 100;
	assertEquals(getHeroHandNet(evenHand), 0);
	assertEquals(getHeroHandNet({
		...winningHand,
		seats: winningHand.seats.map((seat) => ({ ...seat, isBot: true })),
	}), null);
});

Deno.test("replay skips hole-card notifications while keeping cards visible for decisions", () => {
	const history = completedHand();
	assertEquals(buildHandReplaySteps(history), [0, 1, 2, 5, 6, 7, 8, 9, 10, 11, 12]);
	assertEquals(buildHandReplayFrame(history, 0).seats[0].cards, ["AS", "AH"]);
	const preflop = buildHandReplayFrame(history, 4);
	assertEquals(preflop.board, []);
	assertEquals(preflop.seats[0].cards, ["AS", "AH"]);
	assertEquals(preflop.seats[1].cards, [null, null]);
	assertEquals(preflop.events.length, 2);
	assertEquals(preflop.currentEvent, "Bot posts BB 20");
	assertEquals(buildHandReplayFrame(history, 5).seats[0].cards, ["AS", "AH"]);
	assertEquals(buildHandReplayFrame(history, 5).events.at(-1).label, "Hero calls 10");
	assertEquals(buildHandReplayFrame(history, 5).activeSeatIndex, 0);
	assertEquals(buildHandReplayFrame(history, 5).activeAction, "CALL 10");
	const beforeReveal = buildHandReplayFrame(history, 9);
	assertEquals(beforeReveal.board, ["2C", "3D", "4S", "7H", "9C"]);
	assertEquals(beforeReveal.seats[1].cards, [null, null]);
	assertEquals(buildHandReplayFrame(history, 10).seats[1].cards, ["KS", "KH"]);
	assertEquals(buildHandReplayFrame(history, history.events.length).ended, true);
});

Deno.test("replay keeps hero at bottom and seats around the same table positions", () => {
	const seats = [
		{ seatIndex: 3 }, { seatIndex: 4, isHero: true }, { seatIndex: 5 },
		{ seatIndex: 0 }, { seatIndex: 1 }, { seatIndex: 2 },
	];
	assertEquals(Array.from(getReplaySeatPositions(seats).entries()), [
		[3, 5], [4, 0], [5, 1], [0, 2], [1, 3], [2, 4],
	]);
	assertEquals(Array.from(getReplaySeatPositions(seats.slice(1, 3)).entries()), [
		[4, 0], [5, 3],
	]);
	assertEquals(Array.from(getReplaySeatPositions([
		{ seatIndex: 1 }, { seatIndex: 2, isDealer: true }, { seatIndex: 3 },
	]).entries()), [[1, 4], [2, 0], [3, 2]]);
});

Deno.test("opponent secrets and future board cards do not affect an earlier replay step", () => {
	const original = buildHandReplayFrame(completedHand(), 6);
	const changed = buildHandReplayFrame(completedHand(["QS", "QH"], "8H"), 6);
	assertEquals(original, changed);
});
