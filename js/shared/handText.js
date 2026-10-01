import { projectSeatHandHistory, replayHandHistory } from "./handHistory.js";

const SUITS = { C: "♣", D: "♦", H: "♥", S: "♠" };
const POSITION_LABELS = {
	2: ["BTN/SB", "BB"],
	3: ["BTN", "SB", "BB"],
	4: ["BTN", "SB", "BB", "CO"],
	5: ["BTN", "SB", "BB", "UTG", "CO"],
	6: ["BTN", "SB", "BB", "UTG", "HJ", "CO"],
};
const TAG_LABELS = {
	yellow: "黄色",
	red: "红色",
	green: "绿色",
};
const STREET_LABELS = {
	flop: "Flop",
	turn: "Turn",
	river: "River",
};

function formatCard(card) {
	return card ? `${card[0]}${SUITS[card[1]]}` : "未知";
}

function formatAmount(amount, bigBlind) {
	const bb = Number((amount / bigBlind).toFixed(2));
	return `${amount} chips (${bb} BB)`;
}

export function getPositionLabels(history) {
	const labels = new Map();
	const seats = history.seats;
	const dealerIndex = seats.findIndex((seat) => seat.seatIndex === history.dealerSeatIndex);
	const positions = POSITION_LABELS[seats.length];
	if (!positions || dealerIndex < 0) {
		throw new RangeError("Unsupported hand positions");
	}
	positions.forEach((position, offset) => {
		labels.set(seats[(dealerIndex + offset) % seats.length].seatIndex, position);
	});
	return labels;
}

export function formatHandText(history, annotation = {}) {
	const heroSeat = history.seats.find((seat) => !seat.isBot) ?? null;
	const heroSeatIndex = heroSeat?.seatIndex ?? null;
	const visible = projectSeatHandHistory(history, heroSeatIndex);
	if (!replayHandHistory(visible).ended) {
		throw new RangeError("Only completed hands can be formatted");
	}
	const positions = getPositionLabels(visible);
	const stacks = new Map(visible.seats.map((seat) => [seat.seatIndex, seat.startingChips]));
	const heroCards = visible.events.find((event) =>
		event.type === "hole.dealt" && event.data.seatIndex === heroSeatIndex
	)?.data.cards ?? null;
	const lines = [
		visible.practice
			? `Game: 同类新样本重练 · ${visible.seats.length}人 · 无抽水 · 不计自由桌收益`
			: `Game: 常规局 · ${visible.seats.length}人 · 无抽水`,
		`Hand: ${visible.handId}`,
		`Blinds: SB ${visible.smallBlind} / BB ${visible.bigBlind}`,
		heroSeat
			? `Hero: ${positions.get(heroSeatIndex)} — ${heroCards.map(formatCard).join(" ")}`
			: "Hero: 无真人座位",
	];
	if (visible.practice) {
		lines.push(`Practice source: ${visible.practice.source.handKey} · decision step ${visible.practice.source.decisionSeq}`);
		lines.push(`Sample: ${visible.practice.sampleOrdinal} · reset ${visible.practice.resetIndex} · fresh deck`);
		lines.push("Scripted prior folds; later bot choices are new. No strategy score.");
	}
	if (heroSeat) {
		lines.push(`起手筹码: ${formatAmount(heroSeat.startingChips, visible.bigBlind)}`);
	}
	lines.push("", "=== Preflop ===");

	let pot = 0;
	let streetMax = 0;
	const board = [];
	let secondBoard = null;
	const reveals = new Map();
	let settled = false;

	for (const event of visible.events) {
		const data = event.data;
		if (event.type === "blind.posted") {
			stacks.set(data.seatIndex, stacks.get(data.seatIndex) - data.paid);
			streetMax = Math.max(streetMax, data.streetTotalTo);
			pot = data.potAfter;
			lines.push(`${positions.get(data.seatIndex)} posts ${data.blind === "small" ? "SB" : "BB"} ` +
				formatAmount(data.paid, visible.bigBlind));
		} else if (event.type === "action.applied") {
			const previousMax = streetMax;
			stacks.set(data.seatIndex, stacks.get(data.seatIndex) - data.paid);
			streetMax = Math.max(streetMax, data.streetTotalTo);
			pot = data.potAfter;
			let action;
			if (data.kind === "fold") {
				action = "Folds";
			} else if (data.kind === "check") {
				action = "Checks";
			} else if (data.kind === "call") {
				action = `Calls ${formatAmount(data.paid, visible.bigBlind)}`;
			} else if (data.kind === "allin") {
				action = data.streetTotalTo > previousMax
					? `Raises all-in to ${formatAmount(data.streetTotalTo, visible.bigBlind)}`
					: `Calls all-in for ${formatAmount(data.paid, visible.bigBlind)}`;
			} else {
				action = previousMax === 0
					? `Bets ${formatAmount(data.streetTotalTo, visible.bigBlind)}`
					: `Raises to ${formatAmount(data.streetTotalTo, visible.bigBlind)}`;
			}
			lines.push(`${positions.get(data.seatIndex)} ${action} · 后手 ` +
				formatAmount(stacks.get(data.seatIndex), visible.bigBlind));
		} else if (event.type === "runout.chosen") {
			secondBoard = data.sharedCards.slice();
			lines.push("", `Run it twice · shared ${secondBoard.length} board cards`);
		} else if (event.type === "board.dealt") {
			lines.push(`Pot: ${formatAmount(pot, visible.bigBlind)}`);
			const currentBoard = data.run === 2 ? secondBoard : board;
			currentBoard.push(...data.cards);
			lines.push("", `=== ${data.run === 2 ? "Run 2 · " : secondBoard ? "Run 1 · " : ""}${STREET_LABELS[data.street]} ===`);
			lines.push(`Board: ${currentBoard.map(formatCard).join(" ")}`);
			streetMax = 0;
		} else if (event.type === "hole.revealed") {
			reveals.set(data.seatIndex, [
				...(reveals.get(data.seatIndex) ?? []),
				...data.cards,
			]);
		} else if (event.type === "uncalled.returned") {
			stacks.set(data.seatIndex, stacks.get(data.seatIndex) + data.amount);
			pot = data.potAfter;
			lines.push(`${positions.get(data.seatIndex)} receives uncalled ` +
				formatAmount(data.amount, visible.bigBlind));
		} else if (event.type === "pot.settled") {
			lines.push(`Pot: ${formatAmount(data.totalPot, visible.bigBlind)}`);
			lines.push("", data.hadShowdown ? "=== Showdown ===" : "=== Result ===");
			if (heroSeat && heroCards) {
				lines.push(`${positions.get(heroSeatIndex)}: ${heroCards.map(formatCard).join(" ")}`);
			}
			for (const [seatIndex, cards] of reveals) {
				if (seatIndex !== heroSeatIndex) {
					lines.push(`${positions.get(seatIndex)}: ${cards.map(formatCard).join(" ")}`);
				}
			}
			for (const payout of data.payouts) {
				lines.push(`${positions.get(payout.seatIndex)} wins ` +
					formatAmount(payout.amount, visible.bigBlind));
			}
			if (secondBoard) {
				lines.push(`Run 1: ${board.map(formatCard).join(" ")}`);
				lines.push(`Run 2: ${secondBoard.map(formatCard).join(" ")}`);
				for (const result of data.potResults ?? []) {
					if (result.run) {
						lines.push(`Run ${result.run}: ${result.players.join(" & ")} wins ` +
							formatAmount(result.amount, visible.bigBlind));
						}
				}
			}
			settled = true;
		}
	}
	if (!settled) {
		throw new RangeError("Missing hand settlement");
	}
	const tag = TAG_LABELS[annotation.tag];
	const note = typeof annotation.note === "string" ? annotation.note.trim() : "";
	if (tag) {
		lines.push("", `Tag: ${tag}`);
	}
	if (note) {
		lines.push("", "备注：", note);
	}
	return `${lines.join("\n")}\n`;
}
