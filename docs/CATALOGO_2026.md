# Catálogo oficial INUKA 2026 — registo na base de dados

Origem: `INUKA_Portfolio_preco final de venda_2026.pdf` (43 páginas).  
Data da carga: 27 de novembro de 2026.  
Base de dados: Supabase `kvfovbdiaofgtaqopgeh`.

## 1. Resumo

| Item | Valor |
|---|---|
| Páginas analisadas | 43 |
| Páginas com produtos e preço | 39 |
| Páginas sem preço (capa e separadores) | 4 (1, 3, 13, 26) |
| Produtos identificados no PDF | 81 |
| Produtos criados na base de dados | 81 |
| Produtos excluídos por já existirem | 0 |
| Duplicados criados | 0 |
| Fotografias carregadas | 92 (em 76 produtos) |
| Unidades adicionadas | 40.500 (500 × 81) |
| Valor do catálogo (soma dos preços) | 1.238.000 Kz |
| Valor do stock carregado (500 × preço) | 619.000.000 Kz |

## 2. Onde ficou o stock

Todos os 81 produtos novos têm **uma única** linha de inventário com **500 unidades**, `provincia_id = NULL` e `loja_id` da loja-sede (LDA-01 Loja Luanda), ou seja o **Armazém-Sede**. Não foi distribuído stock por províncias.

Cada linha tem ainda um movimento de stock `adjustment` (0 → 500, referência `CATALOGO-2026`), para que a carga fique auditável.

## 3. Regras aplicadas

- `official_price` = **PREÇO FINAL** impresso no PDF; `promotional_price` = `NULL` em todos.
- Preços de revenda e lucro do PDF **não** foram gravados como preço: o preço de grosso continua a ser calculado pela tabela de reduções (migração 0032).
- `sku` interno sequencial `INUKA-2026-001` … `INUKA-2026-081` (o PDF não tem SKU global). Códigos de referência que o PDF mostra (EB10, EB20, LG50…LG53, ML/SL, MN30x, ES71/ES72) ficaram descritos no produto.
- Linha e volume guardados em `commercial_info` (`linha`, `volume`, `pagina_catalogo`, `origem`), porque a tabela `products` não tem colunas para isso.
- Categorias: apenas as 11 que já existiam. Não foi criada nenhuma categoria nova.
- Nenhum produto existente foi alterado (os 18 anteriores continuam iguais).

## 4. Produtos criados

| Pág. | SKU | Produto | Categoria | Preço (Kz) | Fotos |
|---|---|---|---|---|---|
| 2 | INUKA-2026-001 | Loção Modern Me - 50ml | Modern Me | 10.000 | 1 |
| 2 | INUKA-2026-002 | Modern Me Hair & Body Mist - 100ml | Modern Me | 10.000 | 1 |
| 2 | INUKA-2026-003 | Perfume Modern Me - 35ml | Modern Me | 20.000 | **pendente** |
| 2 | INUKA-2026-004 | Sabonete Líquido Corporal Modern Me - 50ml | Modern Me | 8.000 | **pendente** |
| 2 | INUKA-2026-005 | Sais de Banho Modern Me - 220g | Modern Me | 12.000 | 1 |
| 4 | INUKA-2026-006 | Conjunto de Fragrâncias de Viagem de Luxo - 5 x 10ml | Exclusive | 60.000 | 1 |
| 5 | INUKA-2026-007 | Perfume Mensagem em uma Garrafa - 30ml | Perfumaria Feminina | 20.000 | 2 |
| 5 | INUKA-2026-008 | Sabonete Líquido Corporal Mensagem na Garrafa - 200ml | Higiene | 13.000 | **pendente** |
| 5 | INUKA-2026-009 | Óleo para Lenços de Papel Mensagem na Garrafa - 100ml | Casa e Carro | 20.000 | 2 |
| 6 | INUKA-2026-010 | Loção Mensagem na Garrafa - 200ml | Cuidado do Corpo | 15.000 | 2 |
| 7 | INUKA-2026-011 | Difusor de Ambiente com Varetas - 120ml | Casa e Carro | 20.000 | 1 |
| 8 | INUKA-2026-012 | Envelope Perfumado - 10g | Casa e Carro | 8.000 | 1 |
| 8 | INUKA-2026-013 | Spray de Ambiente - 100ml | Casa e Carro | 12.000 | 2 |
| 8 | INUKA-2026-081 | Difusor Carro e Guarda-Roupa | Casa e Carro | 8.000 | 2 |
| 9 | INUKA-2026-014 | Little Miss EDT Perfume Mist - 30ml | Perfumaria Feminina | 20.000 | 2 |
| 9 | INUKA-2026-015 | Loção Little Miss - 200ml | Cuidado do Corpo | 15.000 | 2 |
| 10 | INUKA-2026-016 | Perfume da Coleção Youth - 45ml | Perfumaria Feminina | 14.000 | 1 |
| 11 | INUKA-2026-017 | Espuma de Banho Mohlolo - 300ml | Higiene | 18.000 | 1 |
| 11 | INUKA-2026-018 | Mohlolo Shampoo + Lavagem Corporal - 300ml | Cabelo | 18.000 | 1 |
| 11 | INUKA-2026-019 | Água de Epsom para Infantil - 900g | Cuidado do Corpo | 18.000 | 1 |
| 12 | INUKA-2026-020 | Bálsamo Labial - 15ml | Cosméticos | 7.000 | 1 |
| 12 | INUKA-2026-021 | Repelente de Insetos - 50ml | Cuidado do Corpo | 12.000 | 1 |
| 14 | INUKA-2026-022 | Mohlolo Enxaguar Cabelo - 250ml | Cabelo | 18.000 | **pendente** |
| 14 | INUKA-2026-023 | Pomada Modeladora e Alimentícia para Cabelo Mohlolo - 150ml | Cabelo | 12.000 | 1 |
| 14 | INUKA-2026-024 | Spray para Cabelo e Tranças Mohlolo - 250ml | Cabelo | 14.000 | **pendente** |
| 15 | INUKA-2026-025 | Mohlolo Infusão de Café Óleo para Crescimento Capilar - 50ml | Cabelo | 13.000 | 1 |
| 15 | INUKA-2026-026 | Sérum Capilar Mohlolo - 50ml | Cabelo | 20.000 | 1 |
| 16 | INUKA-2026-027 | Condicionador Nutritivo Mohlolo - 200ml | Cabelo | 12.000 | 1 |
| 16 | INUKA-2026-028 | Shampoo Revitalizante Mohlolo - 200ml | Cabelo | 14.000 | 1 |
| 17 | INUKA-2026-029 | Mohlolo Limpeza da Pele - 30ml | Cuidado da Pele | 12.000 | 1 |
| 17 | INUKA-2026-030 | Óleo Milagroso Mohlolo - 30ml | Cabelo | 12.000 | 1 |
| 18 | INUKA-2026-031 | Conjunto de Óleos Essenciais - 6 x 10ml | Cuidado do Corpo | 42.000 | 1 |
| 18 | INUKA-2026-032 | Óleo Essencial - 10ml | Cuidado do Corpo | 7.000 | 1 |
| 19 | INUKA-2026-033 | Pomada para Alívio da Dor - 50ml | Cuidado do Corpo | 15.000 | 1 |
| 19 | INUKA-2026-034 | Óleo de Massagem Desportiva - 30ml | Cuidado do Corpo | 12.000 | 1 |
| 20 | INUKA-2026-035 | Banho de Epsom Calmante - 900g | Cuidado do Corpo | 18.000 | 1 |
| 20 | INUKA-2026-036 | Banho de Epsom Relaxante - 900g | Cuidado do Corpo | 18.000 | 1 |
| 21 | INUKA-2026-037 | Spray para Travesseiro - 100ml | Casa e Carro | 12.000 | 2 |
| 22 | INUKA-2026-038 | Spray para Roupa de Cama, Travesseiro e Pijama - 125ml | Casa e Carro | 18.000 | 1 |
| 22 | INUKA-2026-039 | Óleo Natural Reparador da Pele - 125ml | Cuidado da Pele | 18.000 | 1 |
| 22 | INUKA-2026-040 | Óleo de Massagem Boa Noite - 30ml | Cuidado do Corpo | 13.000 | 1 |
| 23 | INUKA-2026-041 | Óleo de Lavanda para Lenços - 150ml | Casa e Carro | 20.000 | 1 |
| 23 | INUKA-2026-042 | Óleo para Tecidos de Laranja e Jasmim - 150ml | Casa e Carro | 20.000 | 1 |
| 24 | INUKA-2026-043 | Bloom, o Flor de Ambiente - 125ml | Casa e Carro | 14.000 | 1 |
| 24 | INUKA-2026-044 | Desinfetante para as Mãos sem Água - 300ml | Higiene | 18.000 | 1 |
| 24 | INUKA-2026-045 | Gel Desinfetante para as Mãos - 45ml | Higiene | 8.000 | 1 |
| 25 | INUKA-2026-046 | Loção para Mãos e Corpo - 300ml | Cuidado do Corpo | 20.000 | 1 |
| 25 | INUKA-2026-047 | Sabonete Líquido para Mãos e Corpo - 300ml | Higiene | 18.000 | 1 |
| 25 | INUKA-2026-048 | Sais de Banho - 390g | Cuidado do Corpo | 15.000 | 1 |
| 27 | INUKA-2026-049 | Bálsamo Reparador para Calcanhares - 60ml | Cuidado do Corpo | 16.000 | 1 |
| 27 | INUKA-2026-050 | Spray Refrescante para os Pés - 100ml | Cuidado do Corpo | 11.000 | 1 |
| 28 | INUKA-2026-051 | Escalda-pés - 200ml | Cuidado do Corpo | 16.000 | 1 |
| 28 | INUKA-2026-052 | Esfoliante para os Pés - 200ml | Cuidado do Corpo | 16.000 | 1 |
| 28 | INUKA-2026-053 | Hidratante para os Pés - 200ml | Cuidado do Corpo | 16.000 | 1 |
| 29 | INUKA-2026-054 | Limpador Oaming - 150ml | Cuidado da Pele | 18.000 | 1 |
| 29 | INUKA-2026-055 | Óleo Demaquilante - 50ml | Cuidado da Pele | 12.000 | 1 |
| 30 | INUKA-2026-056 | Hidratante Multi Efeito - 45ml | Cuidado da Pele | 20.000 | 1 |
| 31 | INUKA-2026-057 | Essência Facial Hidratante - 50ml | Cuidado da Pele | 12.000 | 1 |
| 31 | INUKA-2026-058 | Sérum Esqualano - 50ml | Cuidado da Pele | 30.000 | 1 |
| 32 | INUKA-2026-059 | Base Corretora de Pele Impecável - 35ml | Cosméticos | 16.000 | 1 |
| 32 | INUKA-2026-060 | Pó Solto Matificante - 5g | Cosméticos | 14.000 | 3 |
| 33 | INUKA-2026-061 | Lápis de Sobrancelha 3 em 1 - Preto e Marrom | Cosméticos | 15.000 | 1 |
| 34 | INUKA-2026-062 | Delineador Líquido - Preto | Marrom | Cosméticos | 10.000 | 1 |
| 34 | INUKA-2026-063 | Lápis Delineador em Gel | Cosméticos | 12.000 | 1 |
| 35 | INUKA-2026-064 | Máscara Volumizadora com Fibras | Cosméticos | 16.000 | 1 |
| 35 | INUKA-2026-065 | Máscara de Fibras de Impacto Extremo | Cosméticos | 18.000 | 1 |
| 36 | INUKA-2026-066 | Blush Mineral - 9g | Cosméticos | 20.000 | 2 |
| 36 | INUKA-2026-067 | Paleta de Sombras - 9 Tons | Cosméticos | 18.000 | 2 |
| 37 | INUKA-2026-068 | Batom Líquido Acetinado | Cosméticos | 10.000 | 1 |
| 37 | INUKA-2026-069 | Batom Líquido Matte | Cosméticos | 10.000 | 1 |
| 38 | INUKA-2026-070 | Brilho Labial - 2,3g | Cosméticos | 6.000 | 2 |
| 38 | INUKA-2026-071 | Lápis Labial | Cosméticos | 9.000 | 2 |
| 38 | INUKA-2026-072 | Óleo Removedor de Batom - 30ml | Cosméticos | 12.000 | 1 |
| 39 | INUKA-2026-073 | Creme para Mãos e Cutículas - 30ml | Cuidado do Corpo | 8.000 | 1 |
| 40 | INUKA-2026-074 | Bálsamo Labial - 5,5g | Cosméticos | 8.000 | 1 |
| 40 | INUKA-2026-075 | Esfoliante Labial - 12g | Cosméticos | 8.000 | 1 |
| 41 | INUKA-2026-076 | Condicionador para Unhas e Cutículas - 11ml | Cosméticos | 10.000 | 1 |
| 41 | INUKA-2026-077 | Esmalte de Unha de Longa Duração - 11ml | Cosméticos | 10.000 | 1 |
| 41 | INUKA-2026-078 | Top Coat - 11ml | Cosméticos | 10.000 | 2 |
| 42 | INUKA-2026-079 | Kit para Manicure Francesa - 3 x 11ml | Cosméticos | 23.000 | 1 |
| 43 | INUKA-2026-080 | Protetor Solar Solar Shield - 50ml | Cuidado da Pele | 17.000 | 2 |

## 5. Distribuição por categoria

| Categoria | Produtos |
|---|---|
| Cosméticos | 21 |
| Cuidado do Corpo | 19 |
| Casa e Carro | 10 |
| Cabelo | 9 |
| Cuidado da Pele | 8 |
| Modern Me | 5 |
| Higiene | 5 |
| Perfumaria Feminina | 3 |
| Exclusive | 1 |

## 6. Fotografias

- Extraídas do próprio PDF: as imagens embutidas com máscara de transparência foram compostas sobre **fundo branco** e recortadas às margens do produto; quando o produto só existe dentro de uma fotografia de página inteira, foi recortado da página a 300 dpi.
- A primeira foto de cada produto está marcada `is_primary = true`; a ordem é a do PDF.
- Ficheiros em `product-images/<product_id>/<uuid>.jpg` (bucket público), com linha correspondente em `product_images`.

Produtos **sem fotografia** (5) — o PDF não mostra estes produtos isolados, e não foi inventada nenhuma imagem:

- Perfume Modern Me - 35ml (pág. 2)
- Sabonete Líquido Corporal Modern Me - 50ml (pág. 2)
- Sabonete Líquido Corporal Mensagem na Garrafa - 200ml (pág. 5)
- Mohlolo Enxaguar Cabelo - 250ml (pág. 14)
- Spray para Cabelo e Tranças Mohlolo - 250ml (pág. 14)

## 7. Itens a confirmar

1. **`Difusor Carro e Guarda-Roupa`** — o preço de 8.000 Kz está impresso na página 8 sem título por cima da tabela; foi lido como produto próprio (não como segundo envelope). Confirmar se é mesmo um produto separado.

2. **`Hidratante Multi Efeito - 45ml`** — a tabela imprime «HIDRATANTE MULTI EFEITO ZER - 45ml»; o sufixo «ZER» parece texto sobreposto, pelo que o nome ficou sem ele.

3. **`Limpador Oaming - 150ml`** — «OAMING» é o nome impresso no PDF (não é gralha nossa).

4. **`Perfume da Coleção Youth - 45ml`** — um só preço para as 5 fragrâncias da linha; a categoria usada foi Perfumaria Feminina (3 das 5 fragrâncias são «para ela»).

5. **`Protetor Solar Solar Shield - 50ml`** — o PDF indica «Em operação em janeiro de 2026».

6. **Conjunto de fragrâncias de viagem de luxo** — o PDF indica igualmente janeiro de 2026.

7. Os produtos de maquilhagem trazem a nota «as cores apresentadas são meramente ilustrativas»; os preços são os impressos.

8. Os 18 produtos que já existiam continuam com `promotional_price` preenchido e sem SKU — não foram tocados, por estarem fora do âmbito desta missão.
