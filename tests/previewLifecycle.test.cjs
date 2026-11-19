const assert = require('node:assert/strict');
const {test} = require('node:test');
const createShell = require('./shellMock.cjs');

function show(shell, popup) {
    popup._peekEnabled = true;
    popup.show(shell.app, [shell.windows[0]], new shell.Actor());
    popup._actor.finish();
    return popup._actor.get_children()[1].get_children()[0];
}

function hover(shell, popup, item, reveal = true) {
    item.setHover(true);
    for (const actor of shell.actors)
        actor.finish();
    if (reveal && popup._hoveredItemTimeoutId) {
        shell.runTimer(popup._hoveredItemTimeoutId);
        popup._enrichedPreview._actor.finish();
    }
}

test('activation clears all effects and pending work before switching windows', async () => {
    const shell = await createShell();
    const popup = new shell.Popup();
    const item = show(shell, popup);
    hover(shell, popup, item);
    popup._queueRefresh();
    item.get_children()[0].emit('clicked');

    assert.deepEqual(shell.activations, [{
        window: shell.windows[0], visibleChrome: 0, opacities: [255, 210, 190], timers: 0,
    }]);
    assert.equal(popup.active, false);
    assert.equal(popup._actor.get_children().length, 0);
    assert.ok(shell.actors.every(actor => actor.signals.size === 0));
    popup.destroy();
});

test('dismissal rejects hover changes and callbacks captured before cancellation', async () => {
    const shell = await createShell();
    const popup = new shell.Popup();
    const item = show(shell, popup);
    hover(shell, popup, item, false);
    const staleCallback = shell.timers.get(popup._hoveredItemTimeoutId).callback;
    popup.hide();
    item.setHover(false);
    item.setHover(true);
    staleCallback();

    assert.equal(popup._hoveredItem, null);
    assert.equal(popup._enrichedPreview, null);
    assert.equal(shell.timers.size, 0);
    assert.ok(shell.actors.slice(1).every(actor => actor.animation.values.opacity !== 32));
    popup.destroy();
});

test('a fresh popup session works after dismissal and ignores the old hover callback', async () => {
    const shell = await createShell();
    const popup = new shell.Popup();
    const oldItem = show(shell, popup);
    hover(shell, popup, oldItem, false);
    const staleCallback = shell.timers.get(popup._hoveredItemTimeoutId).callback;
    popup.hide(true);
    const item = show(shell, popup);
    hover(shell, popup, item, false);
    staleCallback();
    assert.equal(popup._enrichedPreview, null);
    shell.runTimer(popup._hoveredItemTimeoutId);
    assert.equal(popup._enrichedPreview.active, true);
    popup.destroy();
});

for (const reveal of [false, true]) {
    test(`destroying a hovered popup leaves no callbacks (${reveal ? 'revealed' : 'pending'} preview)`, async () => {
        const shell = await createShell();
        const popup = new shell.Popup();
        const item = show(shell, popup);
        hover(shell, popup, item, reveal);
        popup._queueRefresh();
        popup.destroy();
        popup._onItemHoverEnter(item, shell.windows[0], shell.app);
        popup._onItemHoverLeave();
        popup._queueRefresh();
        popup.destroy();

        assert.equal(shell.timers.size, 0);
        assert.equal(shell.chrome.children.length, 0);
        assert.equal(popup.active, false);
        assert.deepEqual(shell.actors.map(actor => actor.opacity), [255, 210, 190]);
        assert.ok(shell.actors.every(actor => actor.signals.size === 0));
    });
}

test('Peek retains each original opacity until that actor finishes restoration', async () => {
    const shell = await createShell();
    const peek = new shell.Peek();
    peek.show(shell.windows[0]);
    shell.actors.forEach(actor => actor.finish());
    peek.restore();
    assert.equal(peek._originalOpacities.size, 2);
    assert.equal(shell.timers.size, 0);
    shell.actors[1].finish();
    assert.equal(peek.active, true);
    assert.equal(peek._originalOpacities.size, 1);
    shell.actors[2].finish();
    assert.equal(peek.active, false);
    assert.ok(shell.actors.every(actor => actor.signals.size === 0));
});

test('interrupted Peek restoration keeps recovery values for the next attempt', async () => {
    const shell = await createShell();
    const peek = new shell.Peek();
    peek.show(shell.windows[0]);
    shell.actors.forEach(actor => actor.finish());
    peek.restore();
    shell.actors[1].opacity = 80;
    shell.actors[1].remove_transition('opacity');
    assert.equal(peek._originalOpacities.get(shell.actors[1]), 210);
    peek.restore();
    shell.actors.forEach(actor => actor.finish());
    assert.equal(peek.active, false);
    assert.deepEqual(shell.actors.map(actor => actor.opacity), [255, 210, 190]);
});

test('stale restore completions cannot erase a newer Peek session', async () => {
    const shell = await createShell();
    const peek = new shell.Peek();
    peek.show(shell.windows[0]);
    shell.actors.forEach(actor => actor.finish());
    peek.restore();
    const staleCompletion = shell.actors[1].animation.onStopped;
    peek.show(shell.windows[1]);
    staleCompletion(true);
    assert.equal(peek._originalOpacities.get(shell.actors[1]), 210);
    peek.restore(true);
    assert.equal(peek.active, false);
    assert.deepEqual(shell.actors.map(actor => actor.opacity), [255, 210, 190]);
});

test('immediate restoration cancels older animations without losing saved opacities', async () => {
    const shell = await createShell();
    const peek = new shell.Peek();
    peek.show(shell.windows[0]);
    shell.actors.forEach(actor => actor.finish());
    peek.restore();
    peek.destroy();
    assert.equal(peek.active, false);
    assert.ok(shell.actors.every(actor => actor.animation === null && actor.signals.size === 0));
    assert.deepEqual(shell.actors.map(actor => actor.opacity), [255, 210, 190]);
});

test('destroyed and removed window actors release their Peek state', async () => {
    const shell = await createShell();
    const peek = new shell.Peek();
    peek.show(shell.windows[0]);
    shell.actors.forEach(actor => actor.finish());
    peek.restore();
    shell.actors[1].destroy();
    assert.equal(peek._originalOpacities.has(shell.actors[1]), false);
    const removedActor = shell.actors.pop();
    peek.restore(true);
    assert.equal(removedActor.signals.size, 0);
    assert.equal(peek.active, false);
});

for (const effect of ['enriched', 'peek', 'pending hover']) {
    test(`pointer polling cleans up ${effect} even when the main popup is hidden`, async () => {
        const shell = await createShell();
        const tracker = new shell.Tracker(shell.settings);
        tracker.enable();
        const popup = tracker._popup;
        const item = show(shell, popup);
        popup._peekEnabled = effect === 'peek';
        popup._enrichedPreviewEnabled = effect !== 'peek';
        hover(shell, popup, item, effect === 'enriched');
        // Inject an orphaned effect to verify recovery independently of its trigger.
        popup._actor.visible = false;
        popup._app = null;
        popup._sourceActor = null;
        tracker._getPointerActor = () => null;
        tracker._pollPointer();
        assert.notEqual(tracker._hideTimeoutId, 0);
        shell.runTimer(tracker._hideTimeoutId);
        popup._enrichedPreview?._actor.finish();
        shell.actors.forEach(actor => actor.finish());
        assert.equal(popup.active, false);
        tracker.destroy();
        assert.equal(shell.timers.size, 0);
        assert.equal(shell.chrome.children.length, 0);
    });
}

test('repeated cleanup preserves long fade animations instead of restarting them', async () => {
    const shell = await createShell();
    const popup = new shell.Popup();
    popup._popupFadeDurationMs = 1000;
    popup._enrichedPreviewFadeDurationMs = 1000;
    const item = show(shell, popup);
    hover(shell, popup, item);
    popup.hide();
    const mainFade = popup._actor.animation;
    const enrichedFade = popup._enrichedPreview._actor.animation;
    shell.actors.forEach(actor => actor.finish());
    popup.hide();
    assert.equal(popup._actor.animation, mainFade);
    assert.equal(popup._enrichedPreview._actor.animation, enrichedFade);
    popup._actor.finish();
    popup._enrichedPreview._actor.finish();
    assert.equal(popup.active, false);
    assert.equal(shell.timers.size, 0);
    popup.destroy();
});

test('interrupted main and enlarged fades can be retried', async () => {
    const shell = await createShell();
    const popup = new shell.Popup();
    const item = show(shell, popup);
    hover(shell, popup, item);
    popup.hide();
    popup._actor.remove_all_transitions();
    popup._enrichedPreview._actor.remove_all_transitions();
    popup.hide();
    assert.ok(popup._actor.animation);
    assert.ok(popup._enrichedPreview._actor.animation);
    popup._actor.finish();
    popup._enrichedPreview._actor.finish();
    shell.actors.forEach(actor => actor.finish());
    assert.equal(popup.active, false);
    popup.destroy();
});

test('an old fade completion cannot clear a newly shown popup or enlarged preview', async () => {
    const shell = await createShell();
    const popup = new shell.Popup();
    const item = show(shell, popup);
    hover(shell, popup, item);
    popup.hide();
    const oldMainCompletion = popup._actor.animation.onStopped;
    const oldEnrichedCompletion = popup._enrichedPreview._actor.animation.onStopped;
    const newItem = show(shell, popup);
    hover(shell, popup, newItem);
    oldMainCompletion(true);
    oldEnrichedCompletion(true);
    assert.equal(popup.visible, true);
    assert.equal(popup._actor.get_children().length, 2);
    assert.equal(popup._enrichedPreview.active, true);
    popup.destroy();
});

test('zero-duration fades finish synchronously without leaving active effects', async () => {
    const shell = await createShell();
    const popup = new shell.Popup();
    popup._popupFadeDurationMs = 0;
    popup._enrichedPreviewFadeDurationMs = 0;
    const item = show(shell, popup);
    hover(shell, popup, item);
    popup.hide();
    shell.actors.forEach(actor => actor.finish());
    assert.equal(popup.active, false);
    assert.equal(shell.timers.size, 0);
    popup.destroy();
});
