import Image from "next/image";

/**
 * Imagens de produto vêm de URLs arbitários: Supabase Storage, CDN da marca
 * ou um link colado pela gerência. O `next/image` recusa hosts que não
 * estejam declarados em `next.config.ts` e lança uma excepção que derruba a
 * página inteira — o catálogo chegou a devolver 500 por causa de um único
 * URL externo inválido.
 *
 * Aqui só passamos pelo optimizador os hosts conhecidos; qualquer outro URL
 * é servido por um `<img>` normal. Nunca falha, nunca derruba a página.
 */
const HOSTS_OTIMIZADOS = [/\.supabase\.co$/i, /\.supabase\.in$/i];

function podeOtimizar(src: string): boolean {
  if (src.startsWith("/")) return true;
  try {
    const { hostname } = new URL(src);
    return HOSTS_OTIMIZADOS.some((re) => re.test(hostname));
  } catch {
    return false;
  }
}

interface ProductImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
  sizes?: string;
  priority?: boolean;
}

export default function ProductImage({
  src,
  alt,
  width = 300,
  height = 300,
  className,
  sizes,
  priority,
}: ProductImageProps) {
  if (!podeOtimizar(src)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        className={className}
        loading={priority ? "eager" : "lazy"}
      />
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      sizes={sizes}
      priority={priority}
    />
  );
}
