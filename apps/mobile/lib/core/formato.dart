import 'package:intl/intl.dart';

/// Formatação usada em toda a app.
///
/// O kwanza não usa cêntimos no dia a dia da loja: `12 500 Kz` lê-se melhor
/// num ecrã de telemóvel do que `12 500,00 Kz`, e é o que o site mostra.
String kz(num? valor) {
  if (valor == null) return '—';
  final inteiro = valor.round().abs().toString();
  final partes = StringBuffer();
  for (var i = 0; i < inteiro.length; i++) {
    if (i > 0 && (inteiro.length - i) % 3 == 0) partes.write(' ');
    partes.write(inteiro[i]);
  }
  return '${valor < 0 ? '-' : ''}${partes.toString()} Kz';
}

String _data(Object? bruto, String formato) {
  if (bruto == null) return '—';
  final texto = bruto.toString();
  final quando = DateTime.tryParse(texto)?.toLocal();
  if (quando == null) return '—';
  return DateFormat(formato).format(quando);
}

String dataCurta(Object? bruto) => _data(bruto, 'dd/MM/yyyy');
String dataHora(Object? bruto) => _data(bruto, 'dd/MM/yyyy · HH:mm');
String horaCurta(Object? bruto) => _data(bruto, 'HH:mm');

/// Etiqueta legível do estado de uma encomenda.
///
/// Os valores são os do enum `order_status` da base de dados — não inventar
/// outros nem traduzir o valor guardado.
String estadoEncomenda(Object? status) {
  switch (status?.toString()) {
    case 'pending':
      return 'Pendente';
    case 'confirmed':
      return 'Confirmada';
    case 'preparing':
      return 'Em preparação';
    case 'ready_pickup':
      return 'Pronta para recolha';
    case 'in_delivery':
      return 'Em entrega';
    case 'completed':
      return 'Concluída';
    case 'cancelled':
      return 'Cancelada';
    default:
      return '—';
  }
}

String estadoPagamento(Object? status) {
  switch (status?.toString()) {
    case 'pending':
      return 'Por pagar';
    case 'partial':
      return 'Parcialmente paga';
    case 'paid':
      return 'Paga';
    case 'refunded':
      return 'Reembolsada';
    default:
      return '—';
  }
}

/// Primeira letra do nome, para o avatar sem fotografia.
String inicial(String? nome) {
  final limpo = (nome ?? '').trim();
  if (limpo.isEmpty) return '?';
  return limpo[0].toUpperCase();
}
