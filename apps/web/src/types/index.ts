export type UserRole = "visitor" | "customer" | "seller" | "manager";

export interface Profile {
  id: string;
  role: UserRole;
  full_name: string;
  phone: string | null;
  email: string | null;
  neighborhood: string | null;
  avatar_url: string | null;
  is_active: boolean;
  /** Província atribuída. `null` = administração nacional / por atribuir. */
  provincia_id: string | null;
  is_national_admin: boolean;
  /** Código único de referência, ex.: INK-UIG-00042. */
  referencia: string | null;
  created_at: string;
  updated_at: string;
}

/** Província da INUKA — funciona também como registo de delegação. */
export interface Provincia {
  id: string;
  nome: string;
  codigo: string;
  slug: string;
  capital: string | null;
  delegacao_nome: string | null;
  delegacao_endereco: string | null;
  delegacao_telefone: string | null;
  is_default: boolean;
  is_active: boolean;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface Product {
  id: string;
  sku: string | null;
  name: string;
  category_id: string | null;
  description: string | null;
  official_price: number;
  promotional_price: number | null;
  is_active: boolean;
  is_featured: boolean;
  is_bestseller: boolean;
  is_new: boolean;
  /** `null` = produto nacional, visível em todas as províncias. */
  provincia_id: string | null;
  category?: Category;
  images?: ProductImage[];
  created_at?: string;
  updated_at?: string;
}

export interface ProductImage {
  id: string;
  product_id: string;
  storage_path: string;
  url: string | null;
  sort_order: number;
  is_primary: boolean;
}

export interface CartItem {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  product: Product;
}

export interface Order {
  id: string;
  reference: string;
  customer_id: string;
  seller_id: string | null;
  status: string;
  total_amount: number;
  delivery_method: string | null;
  payment_status: string;
  created_at: string;
}
