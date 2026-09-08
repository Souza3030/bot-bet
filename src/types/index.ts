/**
 * Modalidades de fila apostada suportadas. Este bot cobre apenas "solo"
 * (1v1); as versões duo/trio/squad apostadas seguem a mesma estrutura em
 * projetos irmãos.
 */
export type QueueMode = "solo";

interface ModeConfig {
  label: string;
  totalPlayers: number;
  playersPerTeam: number;
}

export const MODE_CONFIG: Record<QueueMode, ModeConfig> = {
  solo: { label: "Solo (1v1) — Apostado", totalPlayers: 2, playersPerTeam: 1 },
};

/** Um time dentro de uma partida (aqui, sempre 1 jogador). */
export interface Team {
  name: "A" | "B";
  memberIds: string[];
}

/** Resultado submetido por um jogador, aguardando aprovação da Staff. */
export interface PendingResult {
  matchId: string;
  submittedBy: string;
  scoreA: number;
  scoreB: number;
  winner: "A" | "B";
  staffMessageId?: string;
}

/** Uma partida ativa (canais temporários criados, aguardando resultado). */
export interface ActiveMatch {
  matchId: string;
  mode: QueueMode;
  teamA: Team;
  teamB: Team;
  categoryId: string;
  textChannelId: string;
  voiceChannelAId: string;
  voiceChannelBId: string;
  createdAt: number;
  resultSubmitted?: PendingResult;
  /** ID da mensagem de anúncio da partida (usado para reabilitar o botão de resultado). */
  announcementMessageId?: string;
}

// ---------------------------------------------------------------------------
// Apostas
// ---------------------------------------------------------------------------

/** Tipos de chave PIX aceitos pela API de payout do Mercado Pago. */
export type PixKeyType = "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "RANDOM";

export type BetStatus =
  | "aguardando_pagamento"
  | "na_fila"
  | "pareada"
  | "em_partida"
  | "paga_vencedor"
  | "perdida"
  | "reembolsada"
  | "pagamento_manual_pendente"
  | "expirada"
  | "cancelada";

/**
 * Registro completo de uma aposta de um jogador, do momento em que ele
 * escolhe o valor até o desfecho final (vitória paga, derrota, reembolso).
 * Persistido no Firestore (coleção `soloBets`).
 */
export interface BetEntry {
  betId: string;
  userId: string;
  guildId: string;
  amount: number;
  pixKey: string;
  pixKeyType: PixKeyType;
  /** CPF ou CNPJ do titular da chave PIX, exigido pela API de payout. */
  pixOwnerDocument: string;
  /** ID do pagamento (cobrança PIX) criado no Mercado Pago para esta aposta. */
  paymentId?: string;
  status: BetStatus;
  matchId?: string;
  createdAt: number;
  updatedAt: number;
}

/** Uma aposta paga aguardando um adversário do mesmo valor (fila). */
export interface WaitingBet {
  betId: string;
  userId: string;
  amount: number;
  pixKey: string;
  pixKeyType: PixKeyType;
  pixOwnerDocument: string;
  paymentId: string;
  joinedAt: number;
}

/**
 * Sessão de check-in ativa para duas apostas pareadas: os 2 jogadores
 * precisam confirmar presença antes de a partida (com dinheiro em jogo)
 * ser criada.
 */
export interface BetCheckInSession {
  sessionId: string;
  mode: QueueMode;
  channelId: string;
  messageId?: string;
  guildId: string;
  betA: WaitingBet;
  betB: WaitingBet;
  confirmed: Set<string>;
  timeout: NodeJS.Timeout;
}
