import { chooseBotAction } from "./bot.js";

export function decideLegacyBot(observation, memory) {
	const players = observation.players.map((player) => ({
		...player,
		stats: { ...player.stats },
		spotState: { ...player.spotState },
	}));
	const player = players.find((currentPlayer) => currentPlayer.seatIndex === observation.seatIndex);
	if (!player) {
		throw new RangeError("Bot seat is missing from observation");
	}
	player.holeCards = observation.holeCards.slice();
	player.botStyle = observation.botStyle;
	player.botLine = structuredClone(memory);
	const botState = {
		gameMode: observation.gameMode,
		blindLevel: observation.blindLevel,
		currentBet: observation.currentBet,
		pot: observation.pot,
		smallBlind: observation.smallBlind,
		bigBlind: observation.bigBlind,
		chipUnit: observation.chipUnit,
		raisesThisRound: observation.raisesThisRound,
		currentPhaseIndex: observation.currentPhaseIndex,
		players,
		lastRaise: observation.lastRaise,
		communityCards: observation.communityCards.slice(),
		handContext: {
			...observation.handContext,
			streetCheckCounts: { ...observation.handContext.streetCheckCounts },
			streetAggressiveActionCounts: { ...observation.handContext.streetAggressiveActionCounts },
		},
		handId: observation.handId,
		nextDecisionId: observation.decisionId,
	};
	const decision = chooseBotAction(player, botState);
	return {
		decision,
		nextMemory: player.botLine,
		nextDecisionId: Math.max(observation.decisionId + 1, botState.nextDecisionId),
	};
}
