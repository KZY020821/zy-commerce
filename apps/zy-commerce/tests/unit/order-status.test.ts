import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  isOrderStatus,
  isPaidStatus,
  isTerminal,
  nextStatuses,
  ORDER_STATUS_FLOW,
  ORDER_STATUS_LABELS,
  OrderStatus,
  OrderStatusTransitionError,
} from "@/lib/orders/status";

const S = OrderStatus;

describe("order status state machine", () => {
  it("allows the happy path in order", () => {
    for (let i = 0; i < ORDER_STATUS_FLOW.length - 1; i++) {
      expect(canTransition(ORDER_STATUS_FLOW[i]!, ORDER_STATUS_FLOW[i + 1]!)).toBe(true);
    }
  });

  it("never allows moving backwards along the flow", () => {
    for (let i = 0; i < ORDER_STATUS_FLOW.length; i++) {
      for (let j = 0; j < i; j++) {
        expect(canTransition(ORDER_STATUS_FLOW[i]!, ORDER_STATUS_FLOW[j]!), `${ORDER_STATUS_FLOW[i]}→${ORDER_STATUS_FLOW[j]}`).toBe(false);
      }
    }
  });

  it("rejects the spec's explicit example: DELIVERED → PENDING_PAYMENT", () => {
    expect(canTransition(S.DELIVERED, S.PENDING_PAYMENT)).toBe(false);
    expect(() => assertTransition(S.DELIVERED, S.PENDING_PAYMENT)).toThrow(OrderStatusTransitionError);
  });

  it("does not allow skipping payment", () => {
    expect(canTransition(S.PENDING_PAYMENT, S.PROCESSING)).toBe(false);
    expect(canTransition(S.PENDING_PAYMENT, S.SHIPPED)).toBe(false);
    expect(canTransition(S.PENDING_PAYMENT, S.DELIVERED)).toBe(false);
    expect(canTransition(S.PENDING_PAYMENT, S.REFUNDED)).toBe(false);
  });

  it("allows cancellation before shipping and refunds after payment", () => {
    expect(canTransition(S.PENDING_PAYMENT, S.CANCELLED)).toBe(true);
    expect(canTransition(S.PAID, S.CANCELLED)).toBe(true);
    expect(canTransition(S.PROCESSING, S.CANCELLED)).toBe(true);
    expect(canTransition(S.SHIPPED, S.CANCELLED)).toBe(false);
    expect(canTransition(S.PAID, S.REFUNDED)).toBe(true);
    expect(canTransition(S.SHIPPED, S.REFUNDED)).toBe(true);
    expect(canTransition(S.DELIVERED, S.REFUNDED)).toBe(true);
  });

  it("treats CANCELLED and REFUNDED as terminal", () => {
    for (const from of [S.CANCELLED, S.REFUNDED]) {
      expect(isTerminal(from)).toBe(true);
      expect(nextStatuses(from)).toEqual([]);
      for (const to of Object.values(S)) expect(canTransition(from, to)).toBe(false);
    }
  });

  it("never allows a self-transition", () => {
    for (const s of Object.values(S)) expect(canTransition(s, s)).toBe(false);
  });

  it("assertTransition passes silently on valid moves", () => {
    expect(() => assertTransition(S.PAID, S.PROCESSING)).not.toThrow();
  });

  it("error carries from/to for diagnostics", () => {
    try {
      assertTransition(S.SHIPPED, S.PAID);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(OrderStatusTransitionError);
      expect((e as OrderStatusTransitionError).from).toBe(S.SHIPPED);
      expect((e as OrderStatusTransitionError).to).toBe(S.PAID);
    }
  });
});

describe("status helpers", () => {
  it("recognises only real statuses — not names inherited from Object.prototype", () => {
    expect(isOrderStatus("PAID")).toBe(true);
    expect(isOrderStatus("paid")).toBe(false);
    expect(isOrderStatus(42)).toBe(false);
    for (const inherited of ["constructor", "toString", "hasOwnProperty", "__proto__"]) expect(isOrderStatus(inherited), inherited).toBe(false);
  });

  it("knows which statuses are terminal, paid, and where each can go next", () => {
    expect(isTerminal(OrderStatus.CANCELLED)).toBe(true);
    expect(isTerminal(OrderStatus.DELIVERED)).toBe(false);
    expect(isPaidStatus(OrderStatus.PENDING_PAYMENT)).toBe(false);
    expect(isPaidStatus(OrderStatus.CANCELLED)).toBe(false);
    expect(isPaidStatus(OrderStatus.REFUNDED)).toBe(true);
    expect(nextStatuses(OrderStatus.SHIPPED)).toEqual([OrderStatus.DELIVERED, OrderStatus.REFUNDED]);
    expect(Object.keys(ORDER_STATUS_LABELS).sort()).toEqual(Object.values(OrderStatus).sort());
  });
});
