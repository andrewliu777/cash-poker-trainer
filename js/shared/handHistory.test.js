import {
	appendHandEvent,
	createHandHistory,
	exportSeatHandHistories,
	parseSeatHandBackup,
	parseSeatHandHistories,
	projectSeatHandHistory,
	replayHandHistory,
} from "./handHistory.js";
import { formatHandText } from "./handText.js";
import { buildHandReplayFrame } from "./handReview.js";

function assertEquals(actual, expected) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}

function createSidePotHistory(practice = null) {
	let history = createHandHistory({
		sessionId: "session-test",
		handId: 1,
		dealerSeatIndex: 0,
		smallBlind: 10,
		bigBlind: 20,
		chipUnit: 10,
		players: [
			{ seatIndex: 0, name: "Hero", chips: 100 },
			{
				seatIndex: 1, name: "Bot 1", chips: 200, isBot: true,
				botStyle: "pressure", botStyleVersion: 1,
			},
			{ seatIndex: 2, name: "Bot 2", chips: 300, isBot: true,
				botStyle: "balanced", botStyleVersion: 1 },
		],
		practice,
	});
	const add = (type, data, visibility) => {
		history = appendHandEvent(history, type, data, visibility);
	};
	add("blind.posted", { seatIndex: 1, blind: "small", paid: 10, streetTotalTo: 10, potAfter: 10 });
	add("blind.posted", { seatIndex: 2, blind: "big", paid: 20, streetTotalTo: 20, potAfter: 30 });
	add("hole.dealt", { seatIndex: 0, cards: ["AS", "AH"] }, { kind: "seat", seatIndex: 0 });
	add("hole.dealt", { seatIndex: 1, cards: ["KS", "KH"] }, { kind: "seat", seatIndex: 1 });
	add("hole.dealt", { seatIndex: 2, cards: ["QS", "QH"] }, { kind: "seat", seatIndex: 2 });
	add("action.applied", {
		seatIndex: 0, decisionId: 1, street: "preflop", kind: "allin", paid: 100,
		streetTotalTo: 100, potAfter: 130, allIn: true,
	});
	add("action.applied", {
		seatIndex: 1, decisionId: 2, street: "preflop", kind: "call", paid: 90,
		streetTotalTo: 100, potAfter: 220, allIn: false,
	});
	add("action.applied", {
		seatIndex: 2, decisionId: 3, street: "preflop", kind: "raise", paid: 180,
		streetTotalTo: 200, potAfter: 400, allIn: false,
	});
	add("action.applied", {
		seatIndex: 1, decisionId: 4, street: "preflop", kind: "allin", paid: 100,
		streetTotalTo: 200, potAfter: 500, allIn: true,
	});
	add("board.dealt", { street: "flop", cards: ["2C", "3D", "4S"] });
	add("board.dealt", { street: "turn", cards: ["7H"] });
	add("board.dealt", { street: "river", cards: ["9C"] });
	add("hole.revealed", { seatIndex: 1, cards: ["KS", "KH"] });
	add("pot.settled", {
		totalPot: 500,
		hadShowdown: true,
		payouts: [{ seatIndex: 0, amount: 300 }, { seatIndex: 2, amount: 200 }],
	});
	add("hand.ended", {
		endingStacks: [
			{ seatIndex: 0, chips: 300 },
			{ seatIndex: 1, chips: 0 },
			{ seatIndex: 2, chips: 300 },
		],
	});
	return history;
}

function createTwoRunoutHistory() {
	const original = createSidePotHistory();
	let history = { ...original, events: [] };
	const add = (type, data, visibility) => {
		history = appendHandEvent(history, type, data, visibility);
	};
	for (const event of original.events.slice(0, 9)) {
		add(event.type, event.data, event.visibility);
	}
	add("runout.chosen", { count: 2, sharedCards: [] });
	for (const event of original.events.slice(9, 12)) {
		add(event.type, event.data);
	}
	add("board.dealt", { street: "flop", cards: ["QC", "QD", "5C"], run: 2 });
	add("board.dealt", { street: "turn", cards: ["6D"], run: 2 });
	add("board.dealt", { street: "river", cards: ["8S"], run: 2 });
	add("hole.revealed", { seatIndex: 1, cards: ["KS", "KH"] });
	add("pot.settled", {
		totalPot: 500,
		hadShowdown: true,
		payouts: [
			{ seatIndex: 0, amount: 150 },
			{ seatIndex: 1, amount: 100 },
			{ seatIndex: 2, amount: 250 },
		],
		potResults: [
			{ players: ["Hero"], amount: 150, hand: "Pair", isRefundOnly: false, run: 1 },
			{ players: ["Bot 2"], amount: 150, hand: "Four of a Kind", isRefundOnly: false, run: 2 },
			{ players: ["Bot 1"], amount: 100, hand: "Pair", isRefundOnly: false, run: 1 },
			{ players: ["Bot 2"], amount: 100, hand: "Four of a Kind", isRefundOnly: false, run: 2 },
		],
		runoutBoards: [["2C", "3D", "4S", "7H", "9C"], ["QC", "QD", "5C", "6D", "8S"]],
	});
	add("hand.ended", { endingStacks: [
		{ seatIndex: 0, chips: 150 },
		{ seatIndex: 1, chips: 100 },
		{ seatIndex: 2, chips: 350 },
	] });
	return history;
}

function createPracticeMetadata() {
	return {
		mode: "similar_sample",
		source: { handKey: "source-session:3", decisionSeq: 6, decisionId: 1 },
		filters: {
			smallBlind: 10, bigBlind: 20, chipUnit: 10,
			dealerSeatIndex: 0, heroSeatIndex: 0,
			seats: [
				{ seatIndex: 0, name: "Hero", isBot: false, botStyle: null,
					botStyleVersion: null, startingChips: 100 },
				{ seatIndex: 1, name: "Bot 1", isBot: true, botStyle: "pressure",
					botStyleVersion: 1, startingChips: 200 },
				{ seatIndex: 2, name: "Bot 2", isBot: true, botStyle: "balanced",
					botStyleVersion: 1, startingChips: 300 },
			],
			priorFoldSeatIndexes: [], pot: 30, heroToCall: 20,
		},
		sampleId: "sample-1",
		sampleOrdinal: 1,
		resetIndex: 0,
		deckSeed: 0xFFFFFFFF,
	};
}

Deno.test("hand history replays a three-way all-in with a side pot", () => {
	const history = createSidePotHistory();
	const beforeAction = replayHandHistory(history, 5);
	assertEquals(beforeAction.pot, 30);
	assertEquals(beforeAction.board, []);
	assertEquals(beforeAction.holeCards.length, 3);
	assertEquals(beforeAction.ended, false);
	const state = replayHandHistory(history);
	assertEquals(state.ended, true);
	assertEquals(state.board, ["2C", "3D", "4S", "7H", "9C"]);
	assertEquals(state.stacks, [
		{ seatIndex: 0, chips: 300 },
		{ seatIndex: 1, chips: 0 },
		{ seatIndex: 2, chips: 300 },
	]);
	assertEquals(history.events.map((event) => event.seq),
		Array.from({ length: history.events.length }, (_, index) => index + 1));
	const beforeReveal = buildHandReplayFrame(history, 12);
	assertEquals(beforeReveal.pot, 500);
	assertEquals(beforeReveal.seats.map((seat) => seat.cards), [
		["AS", "AH"], [null, null], [null, null],
	]);
	const finalFrame = buildHandReplayFrame(history, history.events.length);
	assertEquals(finalFrame.seats.map((seat) => seat.stack), [300, 0, 300]);
	assertEquals(finalFrame.seats.map((seat) => seat.streetBet), [0, 0, 0]);
	assertEquals(finalFrame.seats.map((seat) => seat.cards), [
		["AS", "AH"], ["KS", "KH"], [null, null],
	]);
});

Deno.test("two runouts replay, export, and show separate boards without leaking cards", () => {
	const history = createTwoRunoutHistory();
	const state = replayHandHistory(history);
	assertEquals(state.ended, true);
	assertEquals(state.board, ["2C", "3D", "4S", "7H", "9C"]);
	assertEquals(state.secondBoard, ["QC", "QD", "5C", "6D", "8S"]);
	assertEquals(state.stacks.map((seat) => seat.chips), [150, 100, 350]);
	const imported = parseSeatHandHistories(exportSeatHandHistories([history]));
	assertEquals(replayHandHistory(imported[0]).secondBoard, state.secondBoard);
	const text = formatHandText(imported[0]);
	for (const phrase of ["Run it twice", "Run 1:", "Run 2:", "Run 2: Bot 2 wins"]) {
		if (!text.includes(phrase)) {
			throw new Error(`Missing runout text: ${phrase}`);
		}
	}
	const frame = buildHandReplayFrame(history, history.events.length);
	assertEquals(frame.secondBoard, state.secondBoard);
	const duplicate = structuredClone(history);
	duplicate.events.find((event) => event.type === "board.dealt" && event.data.run === 2)
		.data.cards[0] = "AS";
	let rejected = false;
	try {
		replayHandHistory(duplicate);
	} catch {
		rejected = true;
	}
	assertEquals(rejected, true);
});

Deno.test("a flop all-in reuses only the shared flop on the second board", () => {
	const history = structuredClone(createTwoRunoutHistory());
	const choiceIndex = history.events.findIndex((event) => event.type === "runout.chosen");
	const [choice] = history.events.splice(choiceIndex, 1);
	choice.data.sharedCards = ["2C", "3D", "4S"];
	const flopIndex = history.events.findIndex((event) =>
		event.type === "board.dealt" && event.data.street === "flop");
	history.events.splice(flopIndex + 1, 0, choice);
	const secondFlopIndex = history.events.findIndex((event) =>
		event.type === "board.dealt" && event.data.run === 2 && event.data.street === "flop");
	history.events.splice(secondFlopIndex, 1);
	history.events.find((event) => event.type === "pot.settled").data.runoutBoards[1] =
		["2C", "3D", "4S", "6D", "8S"];
	history.events.forEach((event, index) => { event.seq = index + 1; });
	assertEquals(replayHandHistory(history).secondBoard, ["2C", "3D", "4S", "6D", "8S"]);
});

Deno.test("seat export hides opponent cards until the reveal event", () => {
	const history = createSidePotHistory();
	const heroView = projectSeatHandHistory(history, 0);
	assertEquals(heroView.events[3].data.cards, [null, null]);
	assertEquals(heroView.events[4].data.cards, [null, null]);
	assertEquals(heroView.events.find((event) => event.type === "hole.revealed").data.cards, ["KS", "KH"]);
	assertEquals(heroView.seats[1].botStyle, "pressure");
	assertEquals(heroView.seats[1].botStyleVersion, 1);
	assertEquals(replayHandHistory(heroView).ended, true);
	if (JSON.stringify(heroView).includes("QS") || JSON.stringify(heroView).includes("QH")) {
		throw new Error("Unrevealed opponent cards leaked into seat export");
	}
});

Deno.test("single-hand text uses the hero view, actual amounts, tag, and note", () => {
	const text = formatHandText(createSidePotHistory(), {
		tag: "yellow",
		note: "3-bet heads-up",
	});
	for (const part of [
		"Hero: BTN — A♠ A♥",
		"SB posts SB 10 chips (0.5 BB)",
		"BTN Raises all-in to 100 chips (5 BB)",
		"Pot: 500 chips (25 BB)",
		"SB: K♠ K♥",
		"Tag: 黄色",
		"备注：\n3-bet heads-up",
	]) {
		if (!text.includes(part)) {
			throw new Error(`Missing hand text: ${part}`);
		}
	}
	if (text.includes("Q♠") || text.includes("Q♥") || text.includes("Run it")) {
		throw new Error("Single-run text included unrevealed cards or a second runout");
	}
});

Deno.test("history rejects duplicate cards, duplicate decisions, and missing chips", () => {
	const history = createSidePotHistory();
	const duplicateCard = structuredClone(history);
	duplicateCard.events[4].data.cards[0] = "AS";
	const duplicateDecision = structuredClone(history);
	duplicateDecision.events[7].data.decisionId = 2;
	const missingChips = structuredClone(history);
	missingChips.events.at(-2).data.payouts[0].amount = 290;
	for (const invalid of [duplicateCard, duplicateDecision, missingChips]) {
		let rejected = false;
		try {
			replayHandHistory(invalid);
		} catch {
			rejected = true;
		}
		if (!rejected) {
			throw new Error("Invalid history was accepted");
		}
	}
});

Deno.test("seat export round-trips without hidden cards or changed chips", () => {
	const history = createSidePotHistory();
	const file = exportSeatHandHistories([history]);
	const imported = parseSeatHandHistories(file);
	assertEquals(imported.length, 1);
	assertEquals(exportSeatHandHistories(imported), file);
	assertEquals(replayHandHistory(imported[0]).stacks, replayHandHistory(history).stacks);
	if (file.includes("QS") || file.includes("QH")) {
		throw new Error("Unrevealed cards leaked into exported file");
	}
	const damaged = JSON.parse(file);
	damaged.hands[0].history.events.at(-2).data.totalPot = 490;
	let rejected = false;
	try {
		parseSeatHandHistories(JSON.stringify(damaged));
	} catch {
		rejected = true;
	}
	assertEquals(rejected, true);
});

Deno.test("backup restores notes without changing an older hands-only backup", () => {
	const history = createSidePotHistory();
	const key = history.sessionId + ":" + history.handId;
	const file = exportSeatHandHistories([history], [
		{ key, tag: "yellow", note: "Review this turn", privateDraft: "DO NOT EXPORT" },
		{ key: "other-session:7", tag: "red", note: "Unrelated" },
	]);
	const restored = parseSeatHandBackup(file);
	assertEquals(restored.histories.length, 1);
	assertEquals(restored.annotations, [{ key, tag: "yellow", note: "Review this turn" }]);
	if (file.includes("DO NOT EXPORT") || file.includes("Unrelated")) {
		throw new Error("Backup included unrelated or undeclared note data");
	}
	const oldFile = JSON.parse(exportSeatHandHistories([history]));
	delete oldFile.annotations;
	assertEquals(parseSeatHandBackup(JSON.stringify(oldFile)).annotations, []);
});

Deno.test("practice history and a decision-only marker survive seat backup", () => {
	const practice = createPracticeMetadata();
	const history = createSidePotHistory(practice);
	const key = `${history.sessionId}:${history.handId}`;
	assertEquals(history.practice, practice);
	assertEquals(Object.prototype.hasOwnProperty.call(createSidePotHistory(), "practice"), false);
	const file = exportSeatHandHistories([history], [
		{ key, tag: "", note: "", decisionSeq: 6, privateDraft: "DO NOT EXPORT" },
	]);
	const restored = parseSeatHandBackup(file);
	const publicPractice = { ...practice };
	delete publicPractice.deckSeed;
	assertEquals(restored.histories[0].practice, publicPractice);
	assertEquals(restored.annotations, [{ key, tag: "", note: "", decisionSeq: 6 }]);
	assertEquals(replayHandHistory(restored.histories[0]).ended, true);
	const text = formatHandText(history);
	if (file.includes("DO NOT EXPORT") || file.includes('"deckSeed"') ||
		text.includes("4294967295") || text.includes("deck seed")) {
		throw new Error("Private practice fields reached the backup or hand text");
	}
});

Deno.test("practice projection drops undeclared fields and rejects invalid backup metadata", () => {
	const history = structuredClone(createSidePotHistory(createPracticeMetadata()));
	history.practice.futureDeck = ["SECRET-FUTURE-CARD"];
	history.practice.source.botMemory = "SECRET-BOT-MEMORY";
	history.practice.filters.futureDeck = ["SECRET-FUTURE-CARD"];
	history.practice.filters.seats[1].botMemory = "SECRET-BOT-MEMORY";
	const file = exportSeatHandHistories([history]);
	if (file.includes("SECRET-FUTURE-CARD") || file.includes("SECRET-BOT-MEMORY")) {
		throw new Error("Undeclared practice fields reached the seat export");
	}
	const publicPractice = createPracticeMetadata();
	delete publicPractice.deckSeed;
	assertEquals(parseSeatHandBackup(file).histories[0].practice, publicPractice);
	const invalid = JSON.parse(file);
	invalid.hands[0].history.practice.futureDeck = ["SECRET-FUTURE-CARD"];
	let rejected = false;
	try {
		parseSeatHandBackup(JSON.stringify(invalid));
	} catch {
		rejected = true;
	}
	assertEquals(rejected, true);
	for (const invalidField of ["deckSeed", "futureDeck"]) {
		const badExport = JSON.parse(file);
		badExport.hands[0].history.practice.filters[invalidField] = ["AS"];
		let filterRejected = false;
		try {
			parseSeatHandBackup(JSON.stringify(badExport));
		} catch {
			filterRejected = true;
		}
		assertEquals(filterRejected, true);
	}
	const leakedSeed = JSON.parse(file);
	leakedSeed.hands[0].history.practice.deckSeed = 0;
	let seedRejected = false;
	try {
		parseSeatHandBackup(JSON.stringify(leakedSeed));
	} catch {
		seedRejected = true;
	}
	assertEquals(seedRejected, true);
	for (const deckSeed of [-1, 0x100000000, 1.5]) {
		const badPractice = { ...createPracticeMetadata(), deckSeed };
		let creationRejected = false;
		try {
			createSidePotHistory(badPractice);
		} catch {
			creationRejected = true;
		}
		assertEquals(creationRejected, true);
	}
});

Deno.test("backup rejects notes for another hand and duplicate annotation keys", () => {
	const history = createSidePotHistory();
	const file = JSON.parse(exportSeatHandHistories([history]));
	for (const annotations of [
		[{ key: "other:1", tag: "red", note: "Bad key" }],
		[{ key: "session-test:1", tag: "blue", note: "Bad tag" }],
		[{ key: "session-test:1", tag: "yellow", note: "A" },
			{ key: "session-test:1", tag: "red", note: "B" }],
		[{ key: "session-test:1", tag: "", note: "", decisionSeq: 0 }],
	]) {
		let rejected = false;
		try {
			parseSeatHandBackup(JSON.stringify({ ...file, annotations }));
		} catch {
			rejected = true;
		}
		assertEquals(rejected, true);
	}
});

Deno.test("seat export copies only declared fields", () => {
	const history = structuredClone(createSidePotHistory());
	history.futureDeck = ["SECRET-FUTURE-CARD"];
	history.events[3].data.privateNote = "SECRET-OPPONENT-MEMORY";
	const file = exportSeatHandHistories([history]);
	if (file.includes("SECRET-FUTURE-CARD") || file.includes("SECRET-OPPONENT-MEMORY")) {
		throw new Error("Undeclared private fields reached the seat export");
	}
});

Deno.test("hand header keeps preblind stacks and between-hand top-ups", () => {
	const history = createHandHistory({
		sessionId: "session-top-up",
		handId: 2,
		dealerSeatIndex: 1,
		smallBlind: 10,
		bigBlind: 20,
		chipUnit: 10,
		players: [
			{ seatIndex: 0, name: "Hero", chips: 200 },
			{ seatIndex: 1, name: "Bot", chips: 200, isBot: true },
		],
		cashTransactionsBeforeHand: [
			{ type: "manual_top_up", seatIndex: 0, amount: 60, handId: 1 },
			{ type: "auto_top_up", seatIndex: 1, amount: 120, handId: 2 },
		],
	});
	assertEquals(history.seats.map((seat) => seat.startingChips), [200, 200]);
	assertEquals(history.cashTransactionsBeforeHand.map((transaction) => transaction.amount), [60, 120]);
	assertEquals(replayHandHistory(history).pot, 0);
});

Deno.test("uncalled chips return before the contested pot is awarded", () => {
	let history = createHandHistory({
		sessionId: "session-uncalled",
		handId: 1,
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
	add("hole.dealt", { seatIndex: 1, cards: ["KS", "KH"] }, { kind: "seat", seatIndex: 1 });
	add("action.applied", {
		seatIndex: 0, decisionId: 1, street: "preflop", kind: "allin", paid: 90,
		streetTotalTo: 100, potAfter: 120, allIn: true,
	});
	add("action.applied", {
		seatIndex: 1, decisionId: 2, street: "preflop", kind: "fold", paid: 0,
		streetTotalTo: 20, potAfter: 120, allIn: false,
	});
	add("uncalled.returned", { seatIndex: 0, amount: 80, potAfter: 40 });
	add("pot.settled", { totalPot: 40, hadShowdown: false, payouts: [{ seatIndex: 0, amount: 40 }] });
	add("hand.ended", {
		endingStacks: [{ seatIndex: 0, chips: 120 }, { seatIndex: 1, chips: 80 }],
	});
	assertEquals(replayHandHistory(history).stacks, [
		{ seatIndex: 0, chips: 120 },
		{ seatIndex: 1, chips: 80 },
	]);
	if (!formatHandText(history).includes("receives uncalled 80 chips (4 BB)")) {
		throw new Error("Uncalled return was missing from text");
	}
	const returned = buildHandReplayFrame(history, 7);
	assertEquals(returned.pot, 40);
	assertEquals(returned.seats[1].cards, [null, null]);
	const finalFrame = buildHandReplayFrame(history, history.events.length);
	assertEquals(finalFrame.seats.map((seat) => seat.stack), [120, 80]);
	assertEquals(finalFrame.seats[1].cards, [null, null]);
});
