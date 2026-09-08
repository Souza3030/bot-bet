import { Guild } from "discord.js";
import { createMatchChannels } from "../utils/channelManager";
import { ActiveMatch, QueueMode, Team, WaitingBet } from "../types";

/**
 * Registro de partidas ativas em memória, indexado pelo matchId.
 * Usado para localizar a partida ao registrar/aprovar resultados.
 */
export const activeMatches = new Map<string, ActiveMatch>();

/**
 * Mapeia matchId -> as duas apostas (com valor, chave PIX etc.) que deram
 * origem à partida, para que o payout/reembolso saiba pra quem pagar.
 */
export const activeMatchBets = new Map<string, { betA: WaitingBet; betB: WaitingBet }>();

function generateMatchId(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

/**
 * Cria uma nova partida 1v1 a partir de duas apostas já pagas e pareadas.
 */
export async function createBetMatch(
  guild: Guild,
  mode: QueueMode,
  betA: WaitingBet,
  betB: WaitingBet
): Promise<ActiveMatch> {
  const matchId = generateMatchId();

  const teamA: Team = { name: "A", memberIds: [betA.userId] };
  const teamB: Team = { name: "B", memberIds: [betB.userId] };

  const channels = await createMatchChannels(guild, mode, matchId, teamA, teamB);

  const match: ActiveMatch = {
    matchId,
    mode,
    teamA,
    teamB,
    categoryId: channels.categoryId,
    textChannelId: channels.textChannelId,
    voiceChannelAId: channels.voiceChannelAId,
    voiceChannelBId: channels.voiceChannelBId,
    createdAt: Date.now(),
  };

  activeMatches.set(matchId, match);
  activeMatchBets.set(matchId, { betA, betB });
  return match;
}

/**
 * Verifica se um jogador já está em alguma partida ativa (canais temporários
 * ainda não encerrados). Usado para não deixar alguém apostar de novo
 * enquanto ainda está disputando uma partida.
 */
export function isPlayerInActiveMatch(userId: string): boolean {
  for (const match of activeMatches.values()) {
    if (match.teamA.memberIds.includes(userId) || match.teamB.memberIds.includes(userId)) {
      return true;
    }
  }
  return false;
}
