import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../config/app_config.dart';
import '../core/formato.dart';

/// Fotografia de perfil do utilizador autenticado.
///
/// O bucket `avatars` é público para leitura e a política de escrita só deixa
/// mexer na pasta com o nome do próprio `auth.uid()`. Não é preciso SQL novo:
/// o mesmo bucket serve clientes, colaboradores e gestores.
///
/// O ficheiro é sempre substituído (nunca acumulado): ao guardar, os ficheiros
/// antigos da pasta são apagados. Sem isto, cada troca de fotografia deixava
/// lixo pago no bucket.
class FotoPerfil extends StatefulWidget {
  const FotoPerfil({
    super.key,
    required this.userId,
    this.url,
    this.nome,
    this.raio = 40,
    this.editavel = true,
    this.aoMudar,
  });

  final String userId;
  final String? url;
  final String? nome;
  final double raio;
  final bool editavel;
  final void Function(String? url)? aoMudar;

  @override
  State<FotoPerfil> createState() => _FotoPerfilState();
}

class _FotoPerfilState extends State<FotoPerfil> {
  static const _bucket = 'avatars';
  static const _limiteBytes = 3 * 1024 * 1024;

  String? _url;
  bool _aEnviar = false;

  @override
  void initState() {
    super.initState();
    _url = widget.url;
  }

  @override
  void didUpdateWidget(covariant FotoPerfil antigo) {
    super.didUpdateWidget(antigo);
    // A página recarrega o perfil depois de guardar; acompanhar o valor novo
    // evita que a fotografia antiga fique presa no ecrã.
    if (antigo.url != widget.url) _url = widget.url;
  }

  Future<void> _abrirOpcoes() async {
    if (!widget.editavel || _aEnviar) return;

    final escolha = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppConfig.charcoal,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_library_outlined, color: AppConfig.gold),
              title: const Text('Escolher da galeria'),
              onTap: () => Navigator.of(context).pop('galeria'),
            ),
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined, color: AppConfig.gold),
              title: const Text('Tirar fotografia'),
              onTap: () => Navigator.of(context).pop('camera'),
            ),
            if (_url != null)
              ListTile(
                leading: const Icon(Icons.delete_outline, color: AppConfig.danger),
                title: const Text('Remover fotografia',
                    style: TextStyle(color: AppConfig.danger)),
                onTap: () => Navigator.of(context).pop('remover'),
              ),
          ],
        ),
      ),
    );

    if (escolha == null || !mounted) return;
    if (escolha == 'remover') {
      await _remover();
      return;
    }
    await _escolher(escolha == 'camera' ? ImageSource.camera : ImageSource.gallery);
  }

  Future<void> _escolher(ImageSource fonte) async {
    setState(() => _aEnviar = true);
    try {
      final ficheiro = await ImagePicker().pickImage(
        source: fonte,
        maxWidth: 1200,
        maxHeight: 1200,
        imageQuality: 85,
      );
      if (ficheiro == null) return;

      final bytes = await ficheiro.readAsBytes();
      if (bytes.length > _limiteBytes) {
        _avisar('A fotografia tem de ter menos de 3 MB.');
        return;
      }

      final cliente = Supabase.instance.client;
      final extensao = _extensao(ficheiro.name);
      final caminho = '${widget.userId}/${const Uuid().v4()}.$extensao';

      await cliente.storage.from(_bucket).uploadBinary(
            caminho,
            bytes,
            fileOptions: FileOptions(contentType: _tipoConteudo(extensao), upsert: true),
          );

      final url = cliente.storage.from(_bucket).getPublicUrl(caminho);
      await cliente
          .from('profiles')
          .update({'avatar_url': url}).eq('id', widget.userId);

      // Só agora se apagam os anteriores: se o upload falhasse, a fotografia
      // antiga continuava a servir.
      await _apagarAnteriores(excepto: caminho);

      if (!mounted) return;
      setState(() => _url = url);
      widget.aoMudar?.call(url);
    } on StorageException catch (e) {
      _avisar(e.message.toLowerCase().contains('policy')
          ? 'Sem permissão para alterar esta fotografia.'
          : e.message);
    } on PostgrestException catch (e) {
      _avisar(e.message);
    } catch (_) {
      _avisar('Não foi possível enviar a fotografia. Verifique a ligação.');
    } finally {
      if (mounted) setState(() => _aEnviar = false);
    }
  }

  Future<void> _remover() async {
    setState(() => _aEnviar = true);
    try {
      final cliente = Supabase.instance.client;
      await cliente
          .from('profiles')
          .update({'avatar_url': null}).eq('id', widget.userId);
      await _apagarAnteriores();
      if (!mounted) return;
      setState(() => _url = null);
      widget.aoMudar?.call(null);
    } catch (_) {
      _avisar('Não foi possível remover a fotografia.');
    } finally {
      if (mounted) setState(() => _aEnviar = false);
    }
  }

  /// Apaga os ficheiros da pasta do utilizador (menos o acabado de enviar).
  /// Um erro aqui não pode estragar o que já está guardado — é só limpeza.
  Future<void> _apagarAnteriores({String? excepto}) async {
    try {
      final cliente = Supabase.instance.client;
      final ficheiros =
          await cliente.storage.from(_bucket).list(path: widget.userId);
      final apagar = <String>[];
      for (final f in ficheiros) {
        final caminho = '${widget.userId}/${f.name}';
        if (caminho != excepto) apagar.add(caminho);
      }
      if (apagar.isNotEmpty) {
        await cliente.storage.from(_bucket).remove(apagar);
      }
    } catch (_) {
      // Sem permissão ou rede em baixo: o URL antigo continua a existir.
    }
  }

  String _extensao(String nome) {
    final partes = nome.split('.');
    if (partes.length < 2) return 'jpg';
    final ext = partes.last.toLowerCase();
    return const ['jpg', 'jpeg', 'png', 'webp'].contains(ext) ? ext : 'jpg';
  }

  String _tipoConteudo(String extensao) {
    switch (extensao) {
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      default:
        return 'image/jpeg';
    }
  }

  void _avisar(String mensagem) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(mensagem),
        backgroundColor: AppConfig.charcoal,
        duration: const Duration(seconds: 3),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final tamanho = widget.raio * 2;

    return Semantics(
      button: widget.editavel,
      label: widget.editavel ? 'Alterar fotografia de perfil' : 'Fotografia de perfil',
      child: GestureDetector(
        onTap: _abrirOpcoes,
        child: Stack(
          alignment: Alignment.bottomRight,
          children: [
            ClipOval(
              child: SizedBox(
                width: tamanho,
                height: tamanho,
                child: _url == null
                    ? _iniciais()
                    : Image.network(
                        _url!,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => _iniciais(),
                      ),
              ),
            ),
            if (_aEnviar)
              Positioned.fill(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: AppConfig.dark.withValues(alpha: 0.6),
                    shape: BoxShape.circle,
                  ),
                  child: const Center(
                    child: SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: AppConfig.gold,
                      ),
                    ),
                  ),
                ),
              ),
            if (widget.editavel && !_aEnviar)
              Container(
                padding: const EdgeInsets.all(4),
                decoration: const BoxDecoration(
                  color: AppConfig.gold,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.photo_camera,
                  size: widget.raio * 0.32,
                  color: AppConfig.dark,
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _iniciais() {
    return DecoratedBox(
      decoration: const BoxDecoration(color: AppConfig.surface),
      child: Center(
        child: Text(
          inicial(widget.nome),
          style: TextStyle(fontSize: widget.raio * 0.8, color: AppConfig.gold),
        ),
      ),
    );
  }
}
