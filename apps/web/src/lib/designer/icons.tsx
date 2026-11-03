"use client";

import {
  Award,
  BadgePercent,
  Brush,
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  Crown,
  Diamond,
  Droplets,
  Flower2,
  Gift,
  HandHeart,
  Heart,
  Leaf,
  MapPin,
  Megaphone,
  MessageCircle,
  Music,
  PartyPopper,
  Phone,
  Quote,
  Scissors,
  Send,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Sun,
  Tag,
  ThumbsUp,
  Truck,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Conjunto de ícones disponíveis no editor.
 *
 * A chave é o que fica guardado no documento — nunca o componente. Assim
 * podemos trocar de biblioteca sem invalidar projetos já guardados.
 */
export const ICONS: { key: string; label: string; Icon: LucideIcon }[] = [
  { key: "sparkles", label: "Brilho", Icon: Sparkles },
  { key: "star", label: "Estrela", Icon: Star },
  { key: "heart", label: "Coração", Icon: Heart },
  { key: "gift", label: "Prenda", Icon: Gift },
  { key: "crown", label: "Coroa", Icon: Crown },
  { key: "flower", label: "Flor", Icon: Flower2 },
  { key: "leaf", label: "Folha", Icon: Leaf },
  { key: "sun", label: "Sol", Icon: Sun },
  { key: "droplets", label: "Gotas", Icon: Droplets },
  { key: "brush", label: "Pincel", Icon: Brush },
  { key: "scissors", label: "Tesoura", Icon: Scissors },
  { key: "badge-percent", label: "Desconto", Icon: BadgePercent },
  { key: "tag", label: "Etiqueta", Icon: Tag },
  { key: "party", label: "Festa", Icon: PartyPopper },
  { key: "megaphone", label: "Anúncio", Icon: Megaphone },
  { key: "shopping-bag", label: "Compras", Icon: ShoppingBag },
  { key: "truck", label: "Entrega", Icon: Truck },
  { key: "phone", label: "Telefone", Icon: Phone },
  { key: "map-pin", label: "Localização", Icon: MapPin },
  { key: "message", label: "Mensagem", Icon: MessageCircle },
  { key: "send", label: "Enviar", Icon: Send },
  { key: "check", label: "Confirmado", Icon: CheckCircle2 },
  { key: "shield", label: "Confiança", Icon: ShieldCheck },
  { key: "award", label: "Prémio", Icon: Award },
  { key: "users", label: "Equipa", Icon: Users },
  { key: "wallet", label: "Pagamento", Icon: Wallet },
  { key: "thumbs-up", label: "Gosto", Icon: ThumbsUp },
  { key: "quote", label: "Citação", Icon: Quote },
  { key: "calendar", label: "Data", Icon: Calendar },
  { key: "clock", label: "Hora", Icon: Clock },
  { key: "camera", label: "Fotografia", Icon: Camera },
  { key: "music", label: "Música", Icon: Music },
  { key: "zap", label: "Energia", Icon: Zap },
  { key: "diamond", label: "Diamante", Icon: Diamond },
  { key: "hand-heart", label: "Cuidado", Icon: HandHeart },
];

const MAPA = new Map(ICONS.map((i) => [i.key, i.Icon]));

export function getIcon(key: string): LucideIcon {
  return MAPA.get(key) ?? Sparkles;
}
