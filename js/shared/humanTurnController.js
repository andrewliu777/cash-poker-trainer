/* ==================================================================================================
MODULE BOUNDARY: Shared Human Turn Controller
================================================================================================== */

// CURRENT STATE: Shared action-control shell for the host table, remote table, and private seat
// views. It submits local/remote human action requests, while betting-round progress decisions stay
// with the caller/engine boundary.
// TARGET STATE: Keep input wiring and control-state synchronization shared, while poker rules stay
// in actionModel and runtime flow ownership stays with the callers.
// LAYERS:
// 1) amount-only slider/button math
// 2) one shared interactive control shell
// 3) thin flow-specific wrappers for host and synced seat views
// DO NOT PUT HERE: Poker rules already covered by actionModel, sync schema helpers, or generic
// rendering primitives.

import {
	clampActionAmount,
	getActionButtonLabel,
	getActionRequestForAmount,
	getPotFractionActionAmount,
	getThreeBetActionAmount,
	isInvalidRaiseAmount,
	normalizeActionAmount,
} from "./actionModel.js";

export function shouldShowSeatActionControls(seatView, pendingAction, seatIndex) {
	return !!pendingAction &&
		pendingAction.seatIndex === seatIndex &&
		!seatView.folded &&
		!seatView.allIn;
}

export function getSeatPendingAction(tableView, seatIndex) {
	const tablePendingAction = tableView?.pendingAction ?? null;
	if (tablePendingAction?.seatIndex === seatIndex) {
		return tablePendingAction;
	}
	return null;
}

export function configureViewSwitchLink(linkEl, targetPath, tableId, seatIndex) {
	if (!linkEl || !tableId || seatIndex === null) {
		return;
	}
	linkEl.href = `${targetPath}?tableId=${encodeURIComponent(tableId)}&seatIndex=${seatIndex}`;
}

export function setViewSwitchLinkVisible(linkEl, isVisible) {
	if (!linkEl) {
		return;
	}
	linkEl.classList.toggle("hidden", !isVisible);
}

function getSliderStepAmount(amountSlider) {
	const parsedStep = Number.parseInt(amountSlider.step, 10);
	if (Number.isNaN(parsedStep) || parsedStep <= 0) {
		return 1;
	}
	return parsedStep;
}

function getSteppedActionAmount(currentAmount, actionState, sliderStep, direction) {
	const nextAmount = clampActionAmount(currentAmount + (direction * sliderStep), actionState);
	if (!isInvalidRaiseAmount(nextAmount, actionState)) {
		return nextAmount;
	}

	return direction > 0 ? normalizeActionAmount(nextAmount, actionState) : actionState.minAmount;
}

export function createActionAmountControls({
	actionButton,
	amountSlider,
	sliderOutput,
	decrementButton = null,
	incrementButton = null,
	potPresetButtons = [],
}) {
	let currentActionState = null;

	function setCurrentAmount(amount, { normalize = false } = {}) {
		if (!currentActionState) {
			return;
		}

		const parsedAmount = Number.isNaN(amount) ? currentActionState.minAmount : amount;
		const nextAmount = normalize
			? normalizeActionAmount(parsedAmount, currentActionState)
			: clampActionAmount(parsedAmount, currentActionState);

		amountSlider.value = nextAmount;
		sliderOutput.value = nextAmount;
		sliderOutput.classList.toggle(
			"invalid",
			isInvalidRaiseAmount(nextAmount, currentActionState),
		);
		actionButton.textContent = getActionButtonLabel(nextAmount, currentActionState);
	}

	function handleActionSliderInput() {
		setCurrentAmount(Number.parseInt(amountSlider.value, 10));
	}

	function handleActionSliderChange() {
		setCurrentAmount(Number.parseInt(amountSlider.value, 10), { normalize: true });
	}

	function stepAmount(direction) {
		if (!currentActionState) {
			return;
		}

		const currentAmount = clampActionAmount(
			Number.parseInt(amountSlider.value, 10),
			currentActionState,
		);
		const sliderStep = getSliderStepAmount(amountSlider);
		const nextAmount = getSteppedActionAmount(
			currentAmount,
			currentActionState,
			sliderStep,
			direction,
		);
		setCurrentAmount(nextAmount);
	}

	function handleDecrementClick() {
		stepAmount(-1);
	}

	function handleIncrementClick() {
		stepAmount(1);
	}

	function setEnabled(enabled) {
		const isThreeBet = currentActionState?.currentPhaseIndex === 0 &&
			currentActionState.raisesThisRound === 1;
		const presetGroup = potPresetButtons[0]?.parentElement;
		const presetLabel = presetGroup?.querySelector("#bet-preset-label");
		if (presetLabel) {
			presetLabel.textContent = isThreeBet ? "3-bet to" : "Pot size";
		}
		presetGroup?.classList.toggle("is-three-bet", isThreeBet);
		potPresetButtons.forEach((button) => {
			const isPotPreset = button.dataset.potPercent !== undefined;
			const isThreeBetPreset = button.dataset.threeBetMultiple !== undefined;
			button.classList.toggle("hidden", isPotPreset ? isThreeBet : isThreeBetPreset && !isThreeBet);
			if (button.dataset.actionMax !== undefined) {
				button.textContent = currentActionState?.maxAmount === currentActionState?.stackAmount
					? "All-in" : "Max";
				button.disabled = !enabled || !currentActionState?.canRaise;
			} else if (isThreeBetPreset) {
				const multiple = Number.parseInt(button.dataset.threeBetMultiple, 10);
				button.disabled = !enabled || getThreeBetActionAmount(currentActionState, multiple) === null;
			} else {
				const percent = Number.parseInt(button.dataset.potPercent, 10);
				button.disabled = !enabled || getPotFractionActionAmount(currentActionState, percent) === null;
			}
		});
	}

	function init() {
		amountSlider.addEventListener("input", handleActionSliderInput);
		amountSlider.addEventListener("change", handleActionSliderChange);
		decrementButton?.addEventListener("click", handleDecrementClick);
		incrementButton?.addEventListener("click", handleIncrementClick);
		potPresetButtons.forEach((button) => {
			button.addEventListener("click", () => {
				let amount;
				if (button.dataset.actionMax !== undefined) {
					amount = currentActionState?.canRaise ? currentActionState.maxAmount : null;
				} else if (button.dataset.threeBetMultiple !== undefined) {
					const multiple = Number.parseInt(button.dataset.threeBetMultiple, 10);
					amount = getThreeBetActionAmount(currentActionState, multiple);
				} else {
					const percent = Number.parseInt(button.dataset.potPercent, 10);
					amount = getPotFractionActionAmount(currentActionState, percent);
				}
				if (amount !== null) {
					setCurrentAmount(amount);
				}
			});
		});
	}

	function clear() {
		currentActionState = null;
		sliderOutput.classList.remove("invalid");
		setEnabled(false);
	}

	function render(actionState, { actionStep = amountSlider.step, resetAmount = false } = {}) {
		currentActionState = actionState;
		if (!currentActionState) {
			clear();
			return;
		}
		potPresetButtons[0]?.parentElement?.classList.toggle("hidden", !currentActionState.canRaise);

		amountSlider.min = currentActionState.minAmount;
		amountSlider.max = currentActionState.maxAmount;
		amountSlider.step = actionStep;

		if (resetAmount) {
			amountSlider.value = currentActionState.minAmount;
		}

		setCurrentAmount(Number.parseInt(amountSlider.value, 10));
	}

	return {
		init,
		clear,
		render,
		setEnabled,
	};
}

function createTurnActionUi({
	visibleElements,
	foldButton,
	actionButton,
	amountSlider,
	sliderOutput,
	decrementButton = null,
	incrementButton = null,
	potPresetButtons = [],
	actionStep = 10,
	onHidden = null,
}) {
	let isInitialized = false;
	let currentActionState = null;
	let currentOnSubmit = null;
	let currentOnFold = null;
	const amountControls = createActionAmountControls({
		actionButton,
		amountSlider,
		sliderOutput,
		decrementButton,
		incrementButton,
		potPresetButtons,
	});

	// Keep all DOM-only control behavior in one place so host and remote flows cannot drift.

	function setVisible(isVisible) {
		visibleElements.forEach((el) => {
			if (!el) {
				return;
			}
			el.classList.toggle("hidden", !isVisible);
		});
	}

	function setEnabled(enabled) {
		foldButton.disabled = !enabled;
		actionButton.disabled = !enabled;
		amountSlider.disabled = !enabled;
		if (decrementButton) {
			decrementButton.disabled = !enabled;
		}
		if (incrementButton) {
			incrementButton.disabled = !enabled;
		}
		amountControls.setEnabled(enabled);
	}

	function handlePrimaryAction() {
		if (!currentActionState || typeof currentOnSubmit !== "function") {
			return;
		}

		const amount = Number.parseInt(amountSlider.value, 10);
		if (Number.isNaN(amount)) {
			return;
		}

		const actionRequest = getActionRequestForAmount(amount, currentActionState);
		currentOnSubmit(actionRequest);
	}

	function handleFoldAction() {
		if (typeof currentOnFold !== "function") {
			return;
		}
		currentOnFold();
	}

	function init() {
		if (isInitialized) {
			return;
		}

		amountControls.init();
		foldButton.addEventListener("click", handleFoldAction);
		actionButton.addEventListener("click", handlePrimaryAction);
		isInitialized = true;
		hide();
	}

	function show(actionState, {
		resetAmount = false,
		enabled = true,
		onSubmit = null,
		onFold = null,
	} = {}) {
		if (!isInitialized) {
			init();
		}

		currentActionState = actionState;
		currentOnSubmit = onSubmit;
		currentOnFold = onFold;
		setVisible(true);
		amountControls.render(actionState, {
			actionStep: actionState.chipUnit ?? actionStep,
			resetAmount,
		});
		setEnabled(enabled);
	}

	function hide() {
		currentActionState = null;
		currentOnSubmit = null;
		currentOnFold = null;
		setVisible(false);
		amountControls.clear();
		setEnabled(false);
		onHidden?.();
	}

	return {
		init,
		show,
		hide,
		setEnabled,
	};
}

export function createHumanTurnController({
	foldButton,
	actionButton,
	amountControls,
	amountSlider,
	sliderOutput,
	decrementButton = null,
	incrementButton = null,
	potPresetButtons = [],
	actionPollInterval = 1000,
	actionStep = 10,
	onControlsHidden = null,
	onNewTurn = null,
	setActiveTurnPlayer,
	setPendingAction,
	clearPendingAction,
	fetchPendingRemoteAction,
	applyTurnAction,
	continueAfterResolvedTurn,
	getPlayerActionState,
	getResolvedTurnMeta,
}) {
	// The host wrapper owns turn session state and polling.
	// The shared UI shell above only handles controls, listeners, and reset behavior.
	let activeTurnState = null;
	const turnActionUi = createTurnActionUi({
		visibleElements: [
			foldButton,
			actionButton,
			amountControls,
		],
		foldButton,
		actionButton,
		amountSlider,
		sliderOutput,
		decrementButton,
		incrementButton,
		potPresetButtons,
		actionStep,
		onHidden: onControlsHidden,
	});

	function clearRemoteActionTimer(turnState) {
		if (!turnState || turnState.remoteActionTimer === null) {
			return;
		}
		clearTimeout(turnState.remoteActionTimer);
		turnState.remoteActionTimer = null;
	}

	function releaseActiveTurn({ clearPending = false } = {}) {
		const turnState = activeTurnState;
		if (turnState) {
			turnState.cancelled = true;
			clearRemoteActionTimer(turnState);
			if (
				clearPending &&
				turnState.pendingAction &&
				turnState.pendingActionCleared !== true
			) {
				clearPendingAction();
				turnState.pendingActionCleared = true;
			}
			activeTurnState = null;
		}
		turnActionUi.hide();
	}

	function init() {
		turnActionUi.init();
	}

	function hide() {
		releaseActiveTurn({ clearPending: true });
	}

	function normalizeRemoteActionRequest(turnState, remoteAction) {
		if (
			!remoteAction ||
			remoteAction.seatIndex !== turnState.player.seatIndex ||
			remoteAction.turnToken !== turnState.pendingAction?.turnToken
		) {
			return null;
		}

		switch (remoteAction.action) {
			case "fold":
				return { action: "fold" };
			case "check":
				return turnState.actionState.canCheck
					? getActionRequestForAmount(0, turnState.actionState)
					: null;
			case "call":
				return turnState.actionState.needToCall > 0
					? getActionRequestForAmount(
						Math.min(turnState.actionState.needToCall, turnState.player.chips),
						turnState.actionState,
					)
					: null;
			case "allin":
				return turnState.player.chips > 0
					? { action: "allin", amount: turnState.player.chips }
					: null;
			case "raise": {
				const amount = remoteAction.amount;
				if (!Number.isSafeInteger(amount) || amount <= turnState.actionState.needToCall) {
					return null;
				}
				return { action: "raise", amount };
			}
			default:
				return null;
		}
	}

	function submitHumanTurn(turnState, actionRequest) {
		if (
			activeTurnState !== turnState ||
			turnState.turnResolved ||
			turnState.cancelled ||
			!actionRequest
		) {
			return false;
		}

		turnActionUi.setEnabled(false);
		const resolvedAction = applyTurnAction(turnState.player, turnState.ticket, actionRequest);
		if (!resolvedAction) {
			if (activeTurnState === turnState && turnState.cancelled !== true) {
				turnActionUi.setEnabled(true);
			}
			return false;
		}

		turnState.turnResolved = true;
		clearPendingAction();
		turnState.pendingActionCleared = true;
		activeTurnState = null;
		turnActionUi.hide();
		const turnMeta = getResolvedTurnMeta(resolvedAction);
		continueAfterResolvedTurn({
			player: turnState.player,
			cycles: turnState.cycles,
			nextPlayer: turnState.nextPlayer,
			logPrefix: turnMeta.logPrefix,
			advanceReason: turnMeta.advanceReason,
		});
		return true;
	}

	function scheduleRemoteActionPoll(turnState) {
		if (
			activeTurnState !== turnState ||
			turnState.turnResolved ||
			turnState.cancelled ||
			!turnState.pendingAction?.turnToken
		) {
			return;
		}
		turnState.remoteActionTimer = setTimeout(() => {
			pollRemoteAction(turnState);
		}, actionPollInterval);
	}

	async function pollRemoteAction(turnState) {
		turnState.remoteActionTimer = null;
		if (
			activeTurnState !== turnState ||
			turnState.turnResolved ||
			turnState.cancelled ||
			turnState.remoteActionInFlight ||
			!turnState.pendingAction?.turnToken
		) {
			return;
		}

		turnState.remoteActionInFlight = true;
		try {
			const remoteAction = await fetchPendingRemoteAction(turnState.pendingAction.turnToken);
			if (
				activeTurnState !== turnState ||
				turnState.turnResolved ||
				turnState.cancelled
			) {
				return;
			}
			const normalizedRequest = normalizeRemoteActionRequest(turnState, remoteAction);
			if (normalizedRequest) {
				submitHumanTurn(turnState, normalizedRequest);
				return;
			}
		} finally {
			turnState.remoteActionInFlight = false;
		}

		if (
			activeTurnState === turnState &&
			turnState.turnResolved !== true &&
			turnState.cancelled !== true
		) {
			scheduleRemoteActionPoll(turnState);
		}
	}

	function runHumanTurn({ player, cycles, nextPlayer }) {
		releaseActiveTurn({ clearPending: true });
		const ticket = setActiveTurnPlayer(player);
		onNewTurn?.(player);

		const turnState = {
			player,
			ticket,
			cycles,
			nextPlayer,
			actionState: getPlayerActionState(player),
			pendingAction: null,
			remoteActionTimer: null,
			remoteActionInFlight: false,
			turnResolved: false,
			cancelled: false,
			pendingActionCleared: false,
		};
		turnState.pendingAction = setPendingAction(player);
		activeTurnState = turnState;

		turnActionUi.show(turnState.actionState, {
			resetAmount: true,
			enabled: true,
			onSubmit: (actionRequest) => submitHumanTurn(turnState, actionRequest),
			onFold: () => submitHumanTurn(turnState, { action: "fold" }),
		});
		if (turnState.pendingAction?.turnToken) {
			scheduleRemoteActionPoll(turnState);
		}
	}

	return {
		init,
		hide,
		runHumanTurn,
	};
}

export function createSeatActionControls({
	tableId,
	seatIndex,
	actionEndpoint,
	actionStep = 10,
	visibleElements = [],
	foldButton,
	actionButton,
	amountSlider,
	sliderOutput,
	decrementButton = null,
	incrementButton = null,
	onActionError = null,
	onNewTurn = null,
}) {
	// Synced seat views only submit actions to the host/backend.
	// They reuse the same control shell, but do not own a local turn lifecycle.
	let currentPendingAction = null;
	let isSubmittingAction = false;
	const turnActionUi = createTurnActionUi({
		visibleElements,
		foldButton,
		actionButton,
		amountSlider,
		sliderOutput,
		decrementButton,
		incrementButton,
		actionStep,
	});

	async function submitActionRequest(actionRequest) {
		if (!currentPendingAction || !tableId || seatIndex === null || isSubmittingAction) {
			return;
		}

		isSubmittingAction = true;
		turnActionUi.setEnabled(false);

		try {
			const res = await fetch(actionEndpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					tableId,
					seatIndex,
					turnToken: currentPendingAction.turnToken,
					action: actionRequest.action,
					amount: actionRequest.amount ?? null,
				}),
			});
			if (!res.ok) {
				throw new Error(`action request failed with status ${res.status}`);
			}
		} catch (error) {
			console.warn("action request failed", error);
			isSubmittingAction = false;
			turnActionUi.setEnabled(true);
			if (typeof onActionError === "function") {
				onActionError(error);
			}
		}
	}

	function init() {
		turnActionUi.init();
	}

	function hide() {
		currentPendingAction = null;
		isSubmittingAction = false;
		turnActionUi.hide();
	}

	function render(seatView, pendingAction) {
		if (!shouldShowSeatActionControls(seatView, pendingAction, seatIndex)) {
			hide();
			return;
		}

		const isNewTurn = currentPendingAction?.turnToken !== pendingAction.turnToken;
		currentPendingAction = pendingAction;
		if (isNewTurn) {
			isSubmittingAction = false;
			onNewTurn?.();
		}
		turnActionUi.show(pendingAction, {
			resetAmount: isNewTurn,
			enabled: !isSubmittingAction,
			onSubmit: submitActionRequest,
			onFold: () => submitActionRequest({ action: "fold" }),
		});
	}

	return {
		init,
		hide,
		render,
	};
}
