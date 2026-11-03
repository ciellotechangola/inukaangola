import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Linha do carrinho guardada localmente.
///
/// O preço aqui é apenas para mostrar ao utilizador — o servidor recalcula
/// sempre o total em `place_order`. Nunca é enviado como preço oficial.
class CartLine {
  CartLine({
    required this.productId,
    required this.name,
    required this.price,
    required this.quantity,
    this.image,
  });

  final String productId;
  final String name;
  final double price;
  final String? image;
  int quantity;

  double get subtotal => price * quantity;

  Map<String, dynamic> toJson() => {
        'product_id': productId,
        'name': name,
        'price': price,
        'quantity': quantity,
        'image': image,
      };

  factory CartLine.fromJson(Map<String, dynamic> json) => CartLine(
        productId: json['product_id'] as String,
        name: json['name'] as String,
        price: (json['price'] as num).toDouble(),
        quantity: (json['quantity'] as num).toInt(),
        image: json['image'] as String?,
      );
}

/// Carrinho local, persistido em SharedPreferences.
///
/// Funciona offline: o utilizador pode montar o carrinho sem rede. A
/// encomenda só é criada quando `place_order` confirma no servidor — e é o
/// servidor que valida stock e preços.
class CartStore extends ChangeNotifier {
  CartStore._();
  static final CartStore instance = CartStore._();

  static const _chave = 'inuka.cart.v1';

  final List<CartLine> _linhas = [];
  bool _pronto = false;

  List<CartLine> get linhas => List.unmodifiable(_linhas);
  bool get pronto => _pronto;
  bool get vazio => _linhas.isEmpty;

  int get quantidadeTotal => _linhas.fold(0, (soma, l) => soma + l.quantity);
  double get total => _linhas.fold(0.0, (soma, l) => soma + l.subtotal);

  Future<void> carregar() async {
    final prefs = await SharedPreferences.getInstance();
    final bruto = prefs.getString(_chave);
    if (bruto != null) {
      try {
        final lista = jsonDecode(bruto) as List<dynamic>;
        _linhas
          ..clear()
          ..addAll(lista.map((e) => CartLine.fromJson(e as Map<String, dynamic>)));
      } catch (_) {
        // Formato antigo ou corrompido: começa vazio em vez de rebentar.
        _linhas.clear();
      }
    }
    _pronto = true;
    notifyListeners();
  }

  Future<void> _persistir() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _chave,
      jsonEncode(_linhas.map((l) => l.toJson()).toList()),
    );
    notifyListeners();
  }

  Future<void> adicionar({
    required String productId,
    required String name,
    required double price,
    String? image,
    int quantidade = 1,
  }) async {
    CartLine? existente;
    for (final l in _linhas) {
      if (l.productId == productId) {
        existente = l;
        break;
      }
    }
    if (existente != null) {
      existente.quantity += quantidade;
    } else {
      _linhas.add(CartLine(
        productId: productId,
        name: name,
        price: price,
        image: image,
        quantity: quantidade,
      ));
    }
    await _persistir();
  }

  Future<void> definirQuantidade(String productId, int quantidade) async {
    if (quantidade <= 0) {
      await remover(productId);
      return;
    }
    CartLine? linha;
    for (final l in _linhas) {
      if (l.productId == productId) {
        linha = l;
        break;
      }
    }
    if (linha == null) return;
    linha.quantity = quantidade;
    await _persistir();
  }

  Future<void> remover(String productId) async {
    _linhas.removeWhere((l) => l.productId == productId);
    await _persistir();
  }

  Future<void> limpar() async {
    _linhas.clear();
    await _persistir();
  }

  /// Payload aceite por `place_order`. Só product_id e quantidade.
  List<Map<String, dynamic>> get payload => _linhas
      .map((l) => {'product_id': l.productId, 'quantity': l.quantity})
      .toList();
}
