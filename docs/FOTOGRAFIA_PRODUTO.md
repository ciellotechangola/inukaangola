# Fotografia de produto — a regra e o sítio onde vive

> Uma só regra, um só componente. Se a área da fotografia voltar a ficar
> escura ou com alturas diferentes, o defeito está num sítio e não em dez.

## A regra

1. **O fundo é branco e é do sistema.** `#FFFFFF`, definido em CSS — não vem
   da fotografia. Uma imagem com fundo preto, transparente, colorido ou
   irregular continua a viver num painel branco.
2. **O painel é quadrado** (`aspect-ratio: 1 / 1`). É isto que faz todos os
   cartões terem a mesma altura, seja a foto retrato, paisagem ou quadrada.
3. **A fotografia é `object-fit: contain` + `object-position: center`.**
   Aparece inteira, centrada, sem esticar e sem cortar. O que sobra é branco.
4. **Os ficheiros das fotografias não são tocados.** Isto é o palco, não a
   imagem.

## Onde vive

| Peça | Ficheiro |
|---|---|
| Painel (CSS) | `.foto-painel` em `apps/web/src/app/globals.css` |
| Componente | `apps/web/src/components/produto/FotoProduto.tsx` |
| Imagem de baixo nível | `apps/web/src/components/ProductImage.tsx` |

`FotoProduto` é a única porta para uma fotografia de produto. Recebe `src`,
`alt` e, se for miniatura, `lado` (px). O resto — branco, quadrado, `contain`,
centrado, selos por cima, lugar vazio — é decidido lá.

```tsx
// Cartão de catálogo (largura do pai, quadrado)
<FotoProduto src={imagem} alt={p.name} raio="lg" respiro="normal" />

// Miniatura de 64 px
<FotoProduto src={p.imagem} alt={p.nome} lado={64} raio="md" respiro="curto" />

// Selos por cima (desconto, «Novo», «N fotos»)
<FotoProduto src={imagem} alt={p.name}>{selos}</FotoProduto>
```

## Porque é que a imagem está `position: absolute`

Não é decoração. Com a imagem no fluxo normal, uma fotografia 300×900 esticava
o cartão para o triplo da altura dos outros: a altura deixava de ser automática
e o `aspect-ratio` era ignorado. Ancorada às quatro bordas do painel, a imagem
enche o quadrado que o painel decidiu e **nunca** o redimensiona.

## Onde é usado

- `components/ProductCard.tsx` — catálogo público, página inicial, relacionados
- `components/ProductGallery.tsx` — página do produto (galeria e miniaturas)
- `components/ComprarNovamente.tsx` — reposição rápida
- `app/(public)/carrinho` — linhas do carrinho
- `app/(app)/cliente/favoritos` — favoritos
- `app/(app)/revenda/catalogo` — catálogo a grosso (revendedor)
- `app/(app)/gerente/revendedores` — cadastro de preços de grosso
- `app/(app)/gerente/produtos` — lista de produtos (miniatura) e pré-visualizações

## Testado com

Verticais e estreitas (300×900), horizontais e largas (900×300), quadradas
(500×500), fundo preto na origem, fundo transparente, muito pequenas (48×48),
produto cortado na origem e sem fotografia. Em todas: painel branco quadrado,
mesma altura, imagem inteira e centrada. Verificado a 1440 px e a 390 px, sem
transbordo horizontal.
