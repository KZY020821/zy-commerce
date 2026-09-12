/**
 * Order status state machine (spec §6, §10).
 *
 * The enum lives in Prisma; the *rules* live here so they are unit-testable
 * and enforced in exactly one place. Every status change must go through
 * `assertTransition` before an OrderStatusEvent is written.
 */
import { OrderStatus } from "@/generated/prisma/enums";

export { OrderStatus };

/** Happy-path progression, in order. */
export const ORDER_STATUS_FLOW: readonly OrderStatus[] = [
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.PAID,
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

/**
 * Allowed transitions. CANCELLED and REFUNDED are terminal.
 *
 * Decision (flagged per spec §6): DELIVERED → REFUNDED is permitted so that
 * post-delivery returns can be recorded without a schema change. DELIVERED is
 * otherwise terminal. Nothing may ever move backwards along the flow.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING_PAYMENT: [OrderStatus.PAID, OrderStatus.CANCELLED],
  PAID: [OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.CANCELLED, OrderStatus.REFUNDED],
  PROCESSING: [OrderStatus.SHIPPED, OrderStatus.CANCELLED, OrderStatus.REFUNDED],
  SHIPPED: [OrderStatus.DELIVERED, OrderStatus.REFUNDED],
  DELIVERED: [OrderStatus.REFUNDED],
  CANCELLED: [],
  REFUNDED: [],
};

export const TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.CANCELLED,
  OrderStatus.REFUNDED,
]);

export class OrderStatusTransitionError extends Error {
  readonly from: OrderStatus;
  readonly to: OrderStatus;
  constructor(from: OrderStatus, to: OrderStatus) {
    super(`Invalid order status transition: ${from} → ${to}`);
    this.name = "OrderStatusTransitionError";
    this.from = from;
    this.to = to;
  }
}

/**
 * Own keys only: `in` would also accept names every object inherits, so
 * "constructor" or "toString" from a form field would pass as a status.
 */
export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && Object.hasOwn(ALLOWED_TRANSITIONS, value);
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw new OrderStatusTransitionError(from, to);
}

/** Statuses an order in `from` may move to next (for admin UI dropdowns). */
export function nextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** True when the order has been paid for at some point (drives stock decrement, emails, etc.). */
export function isPaidStatus(status: OrderStatus): boolean {
  return status !== OrderStatus.PENDING_PAYMENT && status !== OrderStatus.CANCELLED;
}

export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  PENDING_PAYMENT: "Pending payment",
  PAID: "Paid",
  PROCESSING: "Processing",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};
