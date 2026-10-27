/**
 * EventBus: typed subscriptions, once/off, listener error isolation and
 * subscription mutation during dispatch.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { EventBus } from "../dist/events.js";

type TestEvents = {
  ping: number;
  pong: string;
};

test("on receives payloads until unsubscribed", () => {
  const bus = new EventBus<TestEvents>();
  const received: number[] = [];
  const unsubscribe = bus.on("ping", (payload) => received.push(payload));

  bus.emit("ping", 1);
  bus.emit("ping", 2);
  unsubscribe();
  bus.emit("ping", 3);

  assert.deepEqual(received, [1, 2]);
  assert.equal(bus.listenerCount("ping"), 0);
});

test("off removes only the matching listener", () => {
  const bus = new EventBus<TestEvents>();
  const first: number[] = [];
  const second: number[] = [];
  const firstListener = (payload: number): void => {
    first.push(payload);
  };

  bus.on("ping", firstListener);
  bus.on("ping", (payload) => second.push(payload));
  bus.off("ping", firstListener);
  bus.emit("ping", 7);

  assert.deepEqual(first, []);
  assert.deepEqual(second, [7]);

  // Removing an unknown listener is a no-op.
  bus.off("ping", firstListener);
});

test("once fires a single time and can be removed early", () => {
  const bus = new EventBus<TestEvents>();
  const received: string[] = [];
  bus.once("pong", (payload) => received.push(payload));

  bus.emit("pong", "a");
  bus.emit("pong", "b");
  assert.deepEqual(received, ["a"]);

  let never = 0;
  const unsubscribe = bus.once("pong", () => {
    never += 1;
  });
  unsubscribe();
  bus.emit("pong", "c");
  assert.equal(never, 0);
});

test("off also removes a listener registered through once", () => {
  const bus = new EventBus<TestEvents>();
  let calls = 0;
  const listener = (): void => {
    calls += 1;
  };
  bus.once("ping", listener);
  bus.off("ping", listener);
  bus.emit("ping", 1);
  assert.equal(calls, 0);
});

test("a throwing listener does not break the other listeners", () => {
  const errors: Array<{ error: unknown; event: string }> = [];
  const bus = new EventBus<TestEvents>((error, event) => {
    errors.push({ error, event: String(event) });
  });
  const received: number[] = [];

  bus.on("ping", () => {
    throw new Error("listener exploded");
  });
  bus.on("ping", (payload) => received.push(payload));

  assert.doesNotThrow(() => bus.emit("ping", 5));
  assert.deepEqual(received, [5]);
  assert.equal(errors.length, 1);
  assert.equal((errors[0]?.error as Error).message, "listener exploded");
  assert.equal(errors[0]?.event, "ping");
});

test("without an onError callback listener errors are swallowed", () => {
  const bus = new EventBus<TestEvents>();
  bus.on("ping", () => {
    throw new Error("boom");
  });
  assert.doesNotThrow(() => bus.emit("ping", 1));
});

test("a throwing once listener is still unsubscribed", () => {
  const bus = new EventBus<TestEvents>();
  let calls = 0;
  bus.once("ping", () => {
    calls += 1;
    throw new Error("once boom");
  });
  bus.emit("ping", 1);
  bus.emit("ping", 2);
  assert.equal(calls, 1);
  assert.equal(bus.listenerCount("ping"), 0);
});

test("subscriptions may be mutated while emitting", () => {
  const bus = new EventBus<TestEvents>();
  const order: string[] = [];
  let unsubscribeFirst = (): void => {};

  unsubscribeFirst = bus.on("ping", () => {
    order.push("first");
    unsubscribeFirst();
    bus.on("ping", () => order.push("late"));
  });
  bus.on("ping", () => order.push("second"));

  bus.emit("ping", 1);
  assert.deepEqual(order, ["first", "second"], "the late listener is not called for the running emit");

  order.length = 0;
  bus.emit("ping", 2);
  assert.deepEqual(order, ["second", "late"], "the next emit sees the updated subscription set");
});

test("a listener may emit re-entrantly", () => {
  const bus = new EventBus<TestEvents>();
  const received: number[] = [];
  bus.on("ping", (payload) => {
    received.push(payload);
    if (payload === 1) bus.emit("ping", 2);
  });

  bus.emit("ping", 1);
  assert.deepEqual(received, [1, 2]);
});

test("clear removes every listener", () => {
  const bus = new EventBus<TestEvents>();
  let calls = 0;
  bus.on("ping", () => {
    calls += 1;
  });
  bus.on("pong", () => {
    calls += 1;
  });
  bus.clear();
  bus.emit("ping", 1);
  bus.emit("pong", "x");
  assert.equal(calls, 0);
});

test("events are isolated between bus instances", () => {
  const first = new EventBus<TestEvents>();
  const second = new EventBus<TestEvents>();
  let firstCalls = 0;
  let secondCalls = 0;
  first.on("ping", () => {
    firstCalls += 1;
  });
  second.on("ping", () => {
    secondCalls += 1;
  });

  first.emit("ping", 1);
  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 0);
});
