import { INITIAL_DECK } from "../gameEngine.js";
import {
	appendHandEvent,
	createHandHistory,
	projectSeatHandHistory,
	replayHandHistory,
} from "../shared/handHistory.js";
import { deriveSimilarSpot, shuffleWithSeed } from "./similarSpot.js";

function assertEquals(actual, expected) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}

function createCompletedHistory(seatCount, heroSeatIndex, steps, winnerSeatIndex,
	startingChips = 1000) {
	const players = Array.from({ length: seatCount }, (_, seatIndex) => ({
		seatIndex,
		name: seatIndex === heroSeatIndex ? "Hero" : `Bot ${seatIndex}`,
		isBot: seatIndex !== heroSeatIndex,
		botStyle: seatIndex === heroSeatIndex ? null : "balanced",
		botStyleVersion: seatIndex === heroSeatIndex ? null : 1,
		chips: startingChips,
	}));
	let history = createHandHistory({
		sessionId: "similar-spot-test",
		handId: 1,
		dealerSeatIndex: 0,
		smallBlind: 10,
		bigBlind: 20,
		chipUnit: 1,
		players,
	});
	const stacks = new Map(players.map((player) => [player.seatIndex, startingChips]));
	const streetBets = new Map(players.map((player) => [player.seatIndex, 0]));
	const contributions = new Map(players.map((player) => [player.seatIndex, 0]));
	const folded = new Set();
	const actionSeqs = [];
	let pot = 0;
	let street = "preflop";
	let decisionId = 1;
	const add = (type, data, visibility) => {
		history = appendHandEvent(history, type, data, visibility);
	};
	for (const [seatIndex, blind, paid] of [[seatCount > 2 ? 1 : 0, "small", 10],
		[seatCount > 2 ? 2 : 1, "big", 20]]) {
		stacks.set(seatIndex, stacks.get(seatIndex) - paid);
		streetBets.set(seatIndex, paid);
		contributions.set(seatIndex, paid);
		pot += paid;
		add("blind.posted", { seatIndex, blind, paid, streetTotalTo: paid, potAfter: pot });
	}
	for (const player of players) {
		const cards = INITIAL_DECK.slice(player.seatIndex * 2, player.seatIndex * 2 + 2);
		add("hole.dealt", { seatIndex: player.seatIndex, cards },
			{ kind: "seat", seatIndex: player.seatIndex });
	}
	let nextBoardCardIndex = seatCount * 2;
	for (const step of steps) {
		if (step.type === "board") {
			const count = step.street === "flop" ? 3 : 1;
			add("board.dealt", {
				street: step.street,
				cards: INITIAL_DECK.slice(nextBoardCardIndex, nextBoardCardIndex + count),
			});
			nextBoardCardIndex += count;
			street = step.street;
			for (const seatIndex of streetBets.keys()) {
				streetBets.set(seatIndex, 0);
			}
			continue;
		}
		const paid = step.paid ?? 0;
		const seatIndex = step.seatIndex;
		stacks.set(seatIndex, stacks.get(seatIndex) - paid);
		streetBets.set(seatIndex, streetBets.get(seatIndex) + paid);
		contributions.set(seatIndex, contributions.get(seatIndex) + paid);
		pot += paid;
		if (step.kind === "fold") {
			folded.add(seatIndex);
		}
		add("action.applied", {
			seatIndex,
			decisionId: decisionId++,
			street,
			kind: step.kind,
			paid,
			streetTotalTo: streetBets.get(seatIndex),
			potAfter: pot,
			allIn: stacks.get(seatIndex) === 0,
		});
		actionSeqs.push(history.events.length);
	}

	const rankedContributions = Array.from(contributions).sort((a, b) => b[1] - a[1]);
	const uncalled = rankedContributions[0][1] - rankedContributions[1][1];
	if (uncalled > 0 && !folded.has(rankedContributions[0][0])) {
		const seatIndex = rankedContributions[0][0];
		stacks.set(seatIndex, stacks.get(seatIndex) + uncalled);
		pot -= uncalled;
		add("uncalled.returned", { seatIndex, amount: uncalled, potAfter: pot });
	}
	const payout = pot;
	stacks.set(winnerSeatIndex, stacks.get(winnerSeatIndex) + payout);
	add("pot.settled", {
		totalPot: payout,
		hadShowdown: false,
		payouts: [{ seatIndex: winnerSeatIndex, amount: payout }],
	});
	add("hand.ended", {
		endingStacks: players.map((player) => ({
			seatIndex: player.seatIndex,
			chips: stacks.get(player.seatIndex),
		})),
	});
	assertEquals(replayHandHistory(history).ended, true);
	return { history, actionSeqs };
}

Deno.test("similar spot derives a three-seat first action from a completed hero-view hand", () => {
	const { history, actionSeqs } = createCompletedHistory(3, 0, [
		{ seatIndex: 0, kind: "raise", paid: 60 },
		{ seatIndex: 1, kind: "fold" },
		{ seatIndex: 2, kind: "fold" },
	], 0);
	const source = projectSeatHandHistory(history, 0);
	const spot = deriveSimilarSpot(source, actionSeqs[0]);
	assertEquals(spot, {
		mode: "similar_sample",
		source: {
			handKey: "similar-spot-test:1",
			decisionSeq: actionSeqs[0],
			decisionId: 1,
		},
		filters: {
			smallBlind: 10,
			bigBlind: 20,
			chipUnit: 1,
			dealerSeatIndex: 0,
			heroSeatIndex: 0,
			seats: source.seats.map((seat) => ({
				seatIndex: seat.seatIndex,
				name: seat.name,
				isBot: seat.isBot,
				botStyle: seat.botStyle,
				botStyleVersion: seat.botStyleVersion,
				startingChips: seat.startingChips,
			})),
			priorFoldSeatIndexes: [],
			pot: 30,
			heroToCall: 20,
		},
	});
});

Deno.test("similar spot keeps six-seat fold prefix and blind commitment", () => {
	const { history, actionSeqs } = createCompletedHistory(6, 5, [
		{ seatIndex: 3, kind: "fold" },
		{ seatIndex: 4, kind: "fold" },
		{ seatIndex: 5, kind: "fold" },
		{ seatIndex: 0, kind: "fold" },
		{ seatIndex: 1, kind: "fold" },
	], 2);
	const spot = deriveSimilarSpot(history, actionSeqs[2]);
	assertEquals(spot.filters.priorFoldSeatIndexes, [3, 4]);
	assertEquals(spot.filters.pot, 30);
	assertEquals(spot.filters.heroToCall, 20);
	assertEquals(spot.filters.seats.length, 6);
});

Deno.test("similar spot preserves filters across table sizes and starting depths", () => {
	for (const startingBB of [20, 100, 200]) {
		for (const seatCount of [3, 6]) {
			const heroSeatIndex = seatCount === 3 ? 0 : 5;
			const steps = seatCount === 3 ? [
				{ seatIndex: 0, kind: "raise", paid: 60 },
				{ seatIndex: 1, kind: "fold" },
				{ seatIndex: 2, kind: "fold" },
			] : [
				{ seatIndex: 3, kind: "fold" },
				{ seatIndex: 4, kind: "fold" },
				{ seatIndex: 5, kind: "fold" },
				{ seatIndex: 0, kind: "fold" },
				{ seatIndex: 1, kind: "fold" },
			];
			const { history, actionSeqs } = createCompletedHistory(seatCount, heroSeatIndex,
				steps, seatCount === 3 ? 0 : 2, startingBB * 20);
			const source = projectSeatHandHistory(history, heroSeatIndex);
			const spot = deriveSimilarSpot(source, actionSeqs[seatCount === 3 ? 0 : 2]);
			if (!spot) {
				throw new Error(`Missing ${seatCount}-seat, ${startingBB} BB practice spot`);
			}
			assertEquals(spot.filters.seats.length, seatCount);
			assertEquals(spot.filters.seats.map((seat) => seat.startingChips),
				Array(seatCount).fill(startingBB * 20));
			assertEquals(spot.filters.priorFoldSeatIndexes, seatCount === 3 ? [] : [3, 4]);
			assertEquals(spot.filters.pot, 30);
			assertEquals(spot.filters.heroToCall, 20);
		}
	}
});

Deno.test("similar spot rejects a preceding bot call or raise", () => {
	for (const [kind, paid] of [["call", 20], ["raise", 40]]) {
		const { history, actionSeqs } = createCompletedHistory(6, 5, [
			{ seatIndex: 3, kind, paid },
			{ seatIndex: 4, kind: "fold" },
			{ seatIndex: 5, kind: "fold" },
			{ seatIndex: 0, kind: "fold" },
			{ seatIndex: 1, kind: "fold" },
			{ seatIndex: 2, kind: "fold" },
		], 3);
		assertEquals(deriveSimilarSpot(history, actionSeqs[2]), null);
	}
});

Deno.test("similar spot rejects a postflop hero decision", () => {
	const { history, actionSeqs } = createCompletedHistory(2, 0, [
		{ seatIndex: 0, kind: "call", paid: 10 },
		{ seatIndex: 1, kind: "check" },
		{ type: "board", street: "flop" },
		{ seatIndex: 1, kind: "check" },
		{ seatIndex: 0, kind: "check" },
		{ type: "board", street: "turn" },
		{ seatIndex: 1, kind: "check" },
		{ seatIndex: 0, kind: "check" },
		{ type: "board", street: "river" },
		{ seatIndex: 1, kind: "check" },
		{ seatIndex: 0, kind: "check" },
	], 0);
	assertEquals(deriveSimilarSpot(history, actionSeqs[3]), null);
});

Deno.test("similar spot rejects missing hero cards and wrong preflop action order", () => {
	const first = createCompletedHistory(3, 0, [
		{ seatIndex: 0, kind: "fold" },
		{ seatIndex: 1, kind: "fold" },
	], 2);
	const hiddenHero = structuredClone(projectSeatHandHistory(first.history, 0));
	hiddenHero.events.find((event) => event.type === "hole.dealt" &&
		event.data.seatIndex === 0).data.cards = [null, null];
	assertEquals(replayHandHistory(hiddenHero).ended, true);
	assertEquals(deriveSimilarSpot(hiddenHero, first.actionSeqs[0]), null);

	const wrongOrder = createCompletedHistory(6, 5, [
		{ seatIndex: 4, kind: "fold" },
		{ seatIndex: 3, kind: "fold" },
		{ seatIndex: 5, kind: "fold" },
		{ seatIndex: 0, kind: "fold" },
		{ seatIndex: 1, kind: "fold" },
	], 2);
	assertEquals(deriveSimilarSpot(wrongOrder.history, wrongOrder.actionSeqs[2]), null);
});

Deno.test("similar spot sorts source seats and rejects seat-index gaps", () => {
	const { history, actionSeqs } = createCompletedHistory(3, 0, [
		{ seatIndex: 0, kind: "fold" },
		{ seatIndex: 1, kind: "fold" },
	], 2);
	const reordered = structuredClone(history);
	reordered.seats.reverse();
	assertEquals(replayHandHistory(reordered).ended, true);
	assertEquals(deriveSimilarSpot(reordered, actionSeqs[0]).filters.seats.map((seat) =>
		seat.seatIndex), [0, 1, 2]);

	const gap = structuredClone(history);
	gap.seats[2].seatIndex = 3;
	for (const event of gap.events) {
		if (event.data.seatIndex === 2) {
			event.data.seatIndex = 3;
		}
		if (event.visibility.seatIndex === 2) {
			event.visibility.seatIndex = 3;
		}
		if (event.type === "hand.ended") {
			event.data.endingStacks[2].seatIndex = 3;
		}
		if (event.type === "pot.settled") {
			event.data.payouts[0].seatIndex = 3;
		}
	}
	assertEquals(replayHandHistory(gap).ended, true);
	assertEquals(deriveSimilarSpot(gap, actionSeqs[0]), null);
});

Deno.test("similar spot rejects a legacy chip unit that the cash table cannot recreate", () => {
	const { history, actionSeqs } = createCompletedHistory(3, 0, [
		{ seatIndex: 0, kind: "fold" },
		{ seatIndex: 1, kind: "fold" },
	], 2);
	const legacy = structuredClone(history);
	legacy.chipUnit = 10;
	assertEquals(replayHandHistory(legacy).ended, true);
	assertEquals(deriveSimilarSpot(legacy, actionSeqs[0]), null);
});

Deno.test("similar spot rejects unknown bot versions and practice hands as sources", () => {
	const { history, actionSeqs } = createCompletedHistory(3, 0, [
		{ seatIndex: 0, kind: "fold" },
		{ seatIndex: 1, kind: "fold" },
	], 2);
	const oldBot = structuredClone(history);
	oldBot.seats[1].botStyleVersion = null;
	assertEquals(deriveSimilarSpot(oldBot, actionSeqs[0]), null);
	const practiceHistory = structuredClone(history);
	practiceHistory.practice = { mode: "similar_sample" };
	assertEquals(deriveSimilarSpot(practiceHistory, actionSeqs[0]), null);
});

Deno.test("seeded shuffle mutates in place and repeats a sample for the same seed", () => {
	const initial = INITIAL_DECK.slice();
	const first = initial.slice();
	const second = initial.slice();
	const other = initial.slice();
	if (shuffleWithSeed(first, 20260930) !== first) {
		throw new Error("Seeded shuffle must return the original array");
	}
	shuffleWithSeed(second, 20260930);
	shuffleWithSeed(other, 20260931);
	assertEquals(first, second);
	if (JSON.stringify(first) === JSON.stringify(initial) ||
		JSON.stringify(first) === JSON.stringify(other)) {
		throw new Error("Different seeds should produce different deck samples");
	}
});
