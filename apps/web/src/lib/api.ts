import { createClientBrowser } from "./supabase-browser";

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready_pickup"
  | "in_delivery"
  | "completed"
  | "cancelled";

export type PaymentStatus = "pending" | "partial" | "paid" | "refunded";

export interface CartLine {
  product_id: string;
  quantity: number;
}

export interface PlaceOrderResult {
  order_id: string;
  reference: string;
  total: number;
  duplicated: boolean;
}

export interface SaleResult {
  sale_id: string;
  reference: string;
  total: number;
  duplicated: boolean;
}

export interface SellerStats {
  period_from: string;
  period_to: string;
  total_sales_value: number;
  sales_count: number;
  units_sold: number;
  customers_count: number;
  top_products: { name: string; units: number; value: number }[];
}

export interface DashboardStats {
  period_from: string;
  period_to: string;
  sales_total_value: number;
  sales_count: number;
  orders_count: number;
  orders_by_status: Record<string, number>;
  customers_count: number;
  sellers_count: number;
  active_reservations: number;
  pending_discounts: number;
  low_stock_products: { name: string; quantity: number; low_stock_threshold: number }[];
  sales_by_seller: { seller: string; sales: number; value: number }[];
  top_products: { name: string; units: number; value: number }[];
}

function rpcError(error: { message: string } | null): never | void {
  if (error) throw new Error(error.message);
}

/** Cria uma encomenda. O preço e o stock são validados no servidor. */
export async function placeOrder(
  items: CartLine[],
  options: {
    deliveryMethod?: "pickup" | "delivery";
    deliveryAddress?: string;
    contactPhone?: string;
    notes?: string;
    clientRef?: string;
  } = {}
): Promise<PlaceOrderResult> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("place_order", {
    p_items: items,
    p_delivery_method: options.deliveryMethod ?? "pickup",
    p_delivery_address: options.deliveryAddress ?? null,
    p_contact_phone: options.contactPhone ?? null,
    p_notes: options.notes ?? null,
    p_client_ref: options.clientRef ?? crypto.randomUUID(),
  });
  rpcError(error);
  return data as PlaceOrderResult;
}

export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  notes?: string
): Promise<void> {
  const supabase = createClientBrowser();
  const { error } = await supabase.rpc("update_order_status", {
    p_order_id: orderId,
    p_status: status,
    p_notes: notes ?? null,
  });
  rpcError(error);
}

export async function createReservation(
  items: CartLine[],
  notes?: string
): Promise<{ reservation_id: string; expires_at: string }> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("create_reservation", {
    p_items: items,
    p_expires_at: null,
    p_notes: notes ?? null,
  });
  rpcError(error);
  return data as { reservation_id: string; expires_at: string };
}

export async function cancelReservation(reservationId: string): Promise<void> {
  const supabase = createClientBrowser();
  const { error } = await supabase.rpc("cancel_reservation", { p_reservation_id: reservationId });
  rpcError(error);
}

export async function registerSale(
  items: CartLine[],
  options: {
    customerId?: string | null;
    paymentMethod?: string;
    paymentStatus?: PaymentStatus;
    notes?: string;
    clientRef?: string;
  } = {}
): Promise<SaleResult> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("register_sale", {
    p_items: items,
    p_customer_id: options.customerId ?? null,
    p_payment_method: options.paymentMethod ?? null,
    p_payment_status: options.paymentStatus ?? "pending",
    p_notes: options.notes ?? null,
    p_client_ref: options.clientRef ?? crypto.randomUUID(),
  });
  rpcError(error);
  return data as SaleResult;
}

export async function getSellerStats(from?: string, to?: string): Promise<SellerStats> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("seller_stats", {
    p_from: from ?? null,
    p_to: to ?? null,
  });
  rpcError(error);
  return data as SellerStats;
}

export async function getDashboardStats(from?: string, to?: string): Promise<DashboardStats> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("dashboard_stats", {
    p_from: from ?? null,
    p_to: to ?? null,
  });
  rpcError(error);
  return data as DashboardStats;
}

export async function linkCustomerByPhone(phone: string) {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("link_customer_by_phone", { p_phone: phone });
  rpcError(error);
  return data as {
    found: boolean;
    linked?: boolean;
    reason?: string;
    message?: string;
    customer_id?: string;
    phone?: string;
  };
}

export interface RespostaNovoCliente {
  ok: boolean;
  existente: boolean;
  id: string;
  nome: string;
  telefone: string;
  referencia?: string | null;
  password?: string;
  provincia?: string | null;
}

/**
 * O colaborador acrescenta um cliente à carteira.
 *
 * Vai pela rota de servidor (não por RPC) porque criar conta exige a Admin API.
 * Se o telefone já tiver conta, a rota só faz o vínculo e devolve
 * `existente: true` — nesse caso não há palavra-passe nova para comunicar.
 */
export async function criarClienteNaCarteira(entrada: {
  full_name: string;
  phone: string;
  neighborhood?: string;
}): Promise<RespostaNovoCliente> {
  const res = await fetch("/api/vendedor/clientes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entrada),
  });

  const corpo = (await res.json().catch(() => ({}))) as RespostaNovoCliente & { error?: string };
  if (!res.ok) throw new Error(corpo.error ?? "Não foi possível acrescentar o cliente.");
  return corpo;
}

export async function requestDiscount(
  productId: string,
  requestedPrice: number,  justification?: string
) {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("request_discount", {
    p_product_id: productId,
    p_requested_price: requestedPrice,
    p_justification: justification ?? null,
  });
  rpcError(error);
  return data as { discount_request_id: string; status: string };
}

export async function decideDiscount(
  requestId: string,
  approve: boolean,
  finalPrice?: number
) {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("decide_discount", {
    p_request_id: requestId,
    p_approve: approve,
    p_final_price: finalPrice ?? null,
  });
  rpcError(error);
  return data as { discount_request_id: string; status: string };
}

export async function setProductStock(
  productId: string,
  quantity: number,
  reason?: string,
  provinciaId?: string | null
) {
  const supabase = createClientBrowser();
  const { error } = await supabase.rpc("set_product_stock", {
    p_product_id: productId,
    p_quantity: quantity,
    p_reason: reason ?? null,
    // `null` = armazém-sede; sem valor o servidor usa a província de quem chama.
    p_provincia_id: provinciaId ?? null,
  });
  rpcError(error);
}

export async function getOrCreateConversation(otherUserId: string): Promise<string> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("get_or_create_direct_conversation", {
    p_other_user: otherUserId,
  });
  rpcError(error);
  return data as string;
}

export async function markConversationRead(conversationId: string) {
  const supabase = createClientBrowser();
  const { error } = await supabase.rpc("mark_conversation_read", {
    p_conversation_id: conversationId,
  });
  rpcError(error);
}

export async function pushSyncQueue(operations: unknown[]) {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("sync_push", { p_operations: operations });
  rpcError(error);
  return data as { count: number; results: unknown[] };
}

// ---------------------------------------------------------------------------
// Favoritos
// ---------------------------------------------------------------------------
export async function toggleFavorite(userId: string, productId: string): Promise<boolean> {
  const supabase = createClientBrowser();
  const { data: existing } = await supabase
    .from("favorites")
    .select("id")
    .eq("user_id", userId)
    .eq("product_id", productId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from("favorites").delete().eq("id", existing.id);
    rpcError(error);
    return false;
  }

  const { error } = await supabase.from("favorites").insert({ user_id: userId, product_id: productId });
  rpcError(error);
  return true;
}

export async function listFavorites(userId: string) {
  const supabase = createClientBrowser();
  const { data, error } = await supabase
    .from("favorites")
    .select("product_id, created_at, product:products(*, images:product_images(*))")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  rpcError(error);
  return data ?? [];
}
