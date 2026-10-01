import { appendHandEvent, createHandHistory, replayHandHistory } from "./handHistory.js";
import { summarizeHeroHandGroups } from "./handStats.js";

function assertEquals(actual, expected) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}

function createFinishedHand({ outcome, startingChips = 1000, practice = false, handId = 1 }) {
	const heroSeatIndex = outcome === "big-blind-wins" ? 1 : 0;
	const players = [0, 1].map((seatIndex) => seatIndex === heroSeatIndex
		? { seatIndex, name: "Hero", chips: startingChips }
		: { seatIndex, name: "Bot", chips: startingChips, isBot: true,
			botStyle: "balanced", botStyleVersion: 1 });
	const practiceMetadata = practice ? {
		mode: "similar_sample",
		source: { handKey: "source:1", decisionSeq: 3, decisionId: 1 },
		filters: {
			smallBlind: 10, bigBlind: 20, chipUnit: 10, dealerSeatIndex: 0,
			heroSeatIndex, seats: players.map((player) => ({
				seatIndex: player.seatIndex, name: player.name, isBot: !!player.isBot,
				botStyle: player.botStyle ?? null, botStyleVersion: player.botStyleVersion ?? null,
				startingChips,
			})),
			priorFoldSeatIndexes: [], pot: 30, heroToCall: 10,
		},
		sampleId: "sample-1", sampleOrdinal: 1, resetIndex: 0, deckSeed: 123,
	} : null;
	let history = createHandHistory({
		sessionId: practice ? "practice-test" : "free-test", handId,
		dealerSeatIndex: 0, smallBlind: 10, bigBlind: 20, chipUnit: 10,
		players, practice: practiceMetadata,
	});
	const add = (type, data, visibility) => {
		history = appendHandEvent(history, type, data, visibility);
	};
	add("blind.posted", { seatIndex: 0, blind: "small", paid: 10, streetTotalTo: 10, potAfter: 10 });
	add("blind.posted", { seatIndex: 1, blind: "big", paid: 20, streetTotalTo: 20, potAfter: 30 });
	add("hole.dealt", { seatIndex: 0, cards: ["AS", "AH"] }, { kind: "seat", seatIndex: 0 });
	add("hole.dealt", { seatIndex: 1, cards: ["KS", "KH"] }, { kind: "seat", seatIndex: 1 });
	if (outcome === "big-blind-wins") {
		add("action.applied", { seatIndex: 0, decisionId: 1, street: "preflop",
			kind: "fold", paid: 0, streetTotalTo: 10, potAfter: 30, allIn: false });
		add("uncalled.returned", { seatIndex: 1, amount: 10, potAfter: 20 });
		add("pot.settled", { totalPot: 20, hadShowdown: false,
			payouts: [{ seatIndex: 1, amount: 20 }] });
		add("hand.ended", { endingStacks: [
			{ seatIndex: 0, chips: startingChips - 10 },
			{ seatIndex: 1, chips: startingChips + 10 },
		] });
	} else if (outcome === "raise-wins") {
		add("action.applied", { seatIndex: 0, decisionId: 1, street: "preflop",
			kind: "raise", paid: 50, streetTotalTo: 60, potAfter: 80, allIn: false });
		add("action.applied", { seatIndex: 1, decisionId: 2, street: "preflop",
			kind: "fold", paid: 0, streetTotalTo: 20, potAfter: 80, allIn: false });
		add("uncalled.returned", { seatIndex: 0, amount: 40, potAfter: 40 });
		add("pot.settled", { totalPot: 40, hadShowdown: false,
			payouts: [{ seatIndex: 0, amount: 40 }] });
		add("hand.ended", { endingStacks: [
			{ seatIndex: 0, chips: startingChips + 20 },
			{ seatIndex: 1, chips: startingChips - 20 },
		] });
	} else {
		add("action.applied", { seatIndex: 0, decisionId: 1, street: "preflop",
			kind: "fold", paid: 0, streetTotalTo: 10, potAfter: 30, allIn: false });
		add("uncalled.returned", { seatIndex: 1, amount: 10, potAfter: 20 });
		add("pot.settled", { totalPot: 20, hadShowdown: false,
			payouts: [{ seatIndex: 1, amount: 20 }] });
		add("hand.ended", { endingStacks: [
			{ seatIndex: 0, chips: startingChips - 10 },
			{ seatIndex: 1, chips: startingChips + 10 },
		] });
	}
	assertEquals(replayHandHistory(history).ended, true);
	return history;
}

Deno.test("grouped stats keep practice separate and count actual preflop opportunities", () => {
	const histories = [
		createFinishedHand({ outcome: "fold", handId: 1 }),
		createFinishedHand({ outcome: "big-blind-wins", handId: 2 }),
		createFinishedHand({ outcome: "raise-wins", handId: 3 }),
		createFinishedHand({ outcome: "fold", startingChips: 600, practice: true }),
	];
	const groups = summarizeHeroHandGroups(histories);
	const free = groups.find((row) => row.dimension === "Mode" && row.mode === "Free table");
	const samples = groups.find((row) => row.dimension === "Mode" && row.mode === "Similar samples");
	assertEquals([free.hands, free.netBB, free.vpip, free.pfr],
		[3, 1, { count: 1, opportunities: 2 }, { count: 1, opportunities: 2 }]);
	assertEquals([samples.hands, samples.netBB, samples.vpip, samples.pfr],
		[1, -0.5, { count: 0, opportunities: 1 }, { count: 0, opportunities: 1 }]);
	assertEquals(groups.find((row) => row.dimension === "Position" &&
		row.mode === "Free table" && row.group === "BB").vpip,
		{ count: 0, opportunities: 0 });
	assertEquals(groups.find((row) => row.dimension === "Starting depth" &&
		row.mode === "Similar samples").group, "<40 BB");
	assertEquals(groups.find((row) => row.dimension === "Starting depth" &&
		row.mode === "Free table").group, "40–99 BB");
});

Deno.test("grouped stats omit unfinished and bot-only hands", () => {
	const finished = createFinishedHand({ outcome: "fold" });
	const unfinished = structuredClone(finished);
	unfinished.events.pop();
	const botOnly = structuredClone(finished);
	botOnly.seats[0].isBot = true;
	const rows = summarizeHeroHandGroups([unfinished, botOnly]);
	assertEquals(rows, []);
});
