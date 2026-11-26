"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Download, Loader2 } from "lucide-react";
import { descarregar, ErroDownload } from "@/lib/descarregar";

/**
 * Botão «Descarregar» que guarda o ficheiro sem abrir nada.
 *
 * Três estados visíveis, porque um download que demora dois segundos e não diz
 * nada parece um botão avariado: a preparar (roda), guardado (visto) e falhou
 * (frase curta). O rótulo não desaparece no telemóvel — um ícone sozinho num
 * cartão de feed não se percebe.
 */
type Estado = "parado" | "a-preparar" | "pronto" | "erro";

export function BotaoDescarregar({
  href,
  nome,
  className,
  rotulo = "Descarregar",
  rotuloPronto = "Guardado",
  rotuloErro = "Falhou",
  titulo = "Descarregar esta publicação",
  esconderRotulo,
}: {
  /** Rota nossa que devolve o ficheiro em anexo. */
  href: string;
  /** Nome usado se o servidor não mandar um em `Content-Disposition`. */
  nome?: string;
  className?: string;
  rotulo?: string;
  rotuloPronto?: string;
  rotuloErro?: string;
  titulo?: string;
  /** Em ecrãs pequenos só o ícone. */
  esconderRotulo?: boolean;
}) {
  const [estado, setEstado] = useState<Estado>("parado");
  const [detalhe, setDetalhe] = useState("");
  const vivo = useRef(true);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
      if (temporizador.current) clearTimeout(temporizador.current);
    };
  }, []);

  const ocupado = estado === "a-preparar";

  const aoClicar = async () => {
    if (ocupado) return;
    setEstado("a-preparar");
    setDetalhe("");

    try {
      const guardado = await descarregar(href, nome);
      if (!vivo.current) return;
      setEstado("pronto");
      setDetalhe(guardado);
    } catch (erro) {
      if (!vivo.current) return;
      setEstado("erro");
      setDetalhe(
        erro instanceof ErroDownload ? erro.message : "Não foi possível descarregar."
      );
    }

    temporizador.current = setTimeout(() => {
      if (vivo.current) {
        setEstado("parado");
        setDetalhe("");
      }
    }, 4000);
  };

  const texto =
    estado === "a-preparar"
      ? "A preparar…"
      : estado === "pronto"
        ? rotuloPronto
        : estado === "erro"
          ? rotuloErro
          : rotulo;

  return (
    <button
      type="button"
      onClick={aoClicar}
      disabled={ocupado}
      aria-busy={ocupado}
      title={estado === "erro" && detalhe ? detalhe : titulo}
      aria-label={titulo}
      className={`${className ?? ""} ${
        estado === "pronto"
          ? "text-[#4ADE80]"
          : estado === "erro"
            ? "text-[#F87171]"
            : ""
      } ${ocupado ? "cursor-progress opacity-70" : ""}`}
    >
      {estado === "a-preparar" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : estado === "pronto" ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Download className="h-3.5 w-3.5" />
      )}
      <span className={esconderRotulo ? "hidden sm:inline" : undefined}>{texto}</span>
    </button>
  );
}
