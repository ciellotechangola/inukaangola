/**
 * Constantes do chat partilhadas entre cliente e servidor.
 *
 * Vivem num módulo **sem** `"use client"` de propósito: `lib/chat.ts` é um
 * módulo de cliente e importá-lo de uma route handler mistura os dois mundos.
 */
export const BUCKET_ANEXOS = "message-attachments";

/** O CHECK de `message_attachments.file_size` recusa acima disto. */
export const LIMITE_ANEXO = 20 * 1024 * 1024;
