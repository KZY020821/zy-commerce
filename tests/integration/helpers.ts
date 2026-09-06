import type { Address, Cart, CartItem, Category, ChatConversation, Customer, Order, OrderItem, OrderStatusEvent, Payment, Product, ProductImage, ProductVariant, Tenant, User } from "@/generated/prisma/client";
import { unscopedDb } from "@/lib/db/prisma";

export async function resetDatabase(): Promise<void> {
  // Tenant cascades to every tenant-scoped table; User covers super admins.
  await unscopedDb.$executeRawUnsafe('TRUNCATE TABLE "Tenant", "User" RESTART IDENTITY CASCADE');
}

export interface TenantFixture {
  tenant: Tenant;
  adminUser: User;
  customer: Customer;
  address: Address;
  category: Category;
  product: Product;
  variant: ProductVariant;
  image: ProductImage;
  cart: Cart;
  cartItem: CartItem;
  order: Order;
  orderItem: OrderItem;
  statusEvent: OrderStatusEvent;
  payment: Payment;
  conversation: ChatConversation;
}

/** One row in every tenant-scoped table, all owned by a fresh tenant. */
export async function createTenantFixture(slug: string, name: string): Promise<TenantFixture> {
  const db = unscopedDb;
  const tenant = await db.tenant.create({ data: { slug, name, currency: "USD", shippingFlatRate: 500 } });
  const tid = tenant.id;

  const adminUser = await db.user.create({
    data: { tenantId: tid, email: `admin@${slug}.test`, passwordHash: "not-a-real-hash", role: "STORE_ADMIN", name: `${name} Admin` },
  });
  const customer = await db.customer.create({ data: { tenantId: tid, email: `buyer@${slug}.test`, name: `${name} Buyer` } });
  const address = await db.address.create({
    data: { tenantId: tid, customerId: customer.id, type: "SHIPPING", fullName: customer.name!, line1: "1 Main St", city: "Springfield", postalCode: "00000", country: "US" },
  });
  const category = await db.category.create({ data: { tenantId: tid, name: "Widgets", slug: "widgets" } });
  const product = await db.product.create({
    data: { tenantId: tid, name: `${name} Widget`, slug: "widget", sku: `${slug.toUpperCase()}-001`, price: 1999, currency: "USD", categoryId: category.id, stockQuantity: 10 },
  });
  const variant = await db.productVariant.create({
    data: { tenantId: tid, productId: product.id, sku: `${slug.toUpperCase()}-001-L`, name: "Large", attributes: { size: "L" }, stockQuantity: 5 },
  });
  const image = await db.productImage.create({ data: { tenantId: tid, productId: product.id, url: `https://img.test/${slug}.png` } });
  const cart = await db.cart.create({ data: { tenantId: tid, customerId: customer.id, sessionToken: `${slug}-cart-token` } });
  const cartItem = await db.cartItem.create({ data: { tenantId: tid, cartId: cart.id, productId: product.id, quantity: 1, priceAtAdd: 1999 } });
  const order = await db.order.create({
    data: {
      tenantId: tid,
      orderNumber: 1,
      customerId: customer.id,
      customerEmail: customer.email,
      status: "PAID",
      subtotal: 1999,
      shippingCost: 500,
      tax: 0,
      total: 2499,
      currency: "USD",
      shippingAddressId: address.id,
    },
  });
  const orderItem = await db.orderItem.create({
    data: { tenantId: tid, orderId: order.id, productId: product.id, skuSnapshot: product.sku, nameSnapshot: product.name, quantity: 1, unitPrice: 1999, lineTotal: 1999 },
  });
  const statusEvent = await db.orderStatusEvent.create({ data: { tenantId: tid, orderId: order.id, status: "PAID", note: "seed" } });
  const payment = await db.payment.create({
    data: { tenantId: tid, orderId: order.id, stripePaymentIntentId: `pi_${slug}`, status: "SUCCEEDED", amount: 2499, currency: "USD" },
  });

  const conversation = await db.chatConversation.create({
    data: { tenantId: tid, sessionToken: `${slug}-chat-session`, messages: [{ role: "user", content: "hi" }], messageCount: 1 },
  });

  return { tenant, adminUser, customer, address, category, product, variant, image, cart, cartItem, order, orderItem, statusEvent, payment, conversation };
}

export function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}
