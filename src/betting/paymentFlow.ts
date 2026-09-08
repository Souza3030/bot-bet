import { Client, ChannelType, TextChannel } from "discord.js";
import { config } from "../config";
import { WaitingBet } from "../types";
import { findBetByPaymentId, joinBetQueue, updateBet } from "./betLedger";
import { startBetCheckIn } from "../queue/betCheckin";
import { markQueueAsCheckingIn, updateQueueStatus } from "../queue/betQueueStatus";

/**
 * Chamado sempre que o webhook do Mercado Pago (ou a reconciliação
 * periódica) informa uma mudança de status de pagamento.
 */
export async function handlePaymentStatusChange(
  client: Client,
  paymentId: string,
  status: string
): Promise<void> {
  const bet = await findBetByPaymentId(paymentId);
  if (!bet) return; // Notificação de um pagamento que não é uma aposta (não deveria acontecer)

  // Evita reprocessar o mesmo pagamento duas vezes (webhooks podem repetir).
  if (bet.status !== "aguardando_pagamento") return;

  if (status === "rejected" || status === "cancelled") {
    await updateBet(bet.betId, { status: "cancelada" });
    const user = await client.users.fetch(bet.userId).catch(() => null);
    await user
      ?.send(`❌ Seu pagamento PIX de R$ ${bet.amount.toFixed(2)} não foi aprovado. Tente novamente com /apostar.`)
      .catch(() => undefined);
    return;
  }

  if (status !== "approved") return; // ainda pendente, sem ação

  const guild = await client.guilds.fetch(config.discord.guildId).catch(() => null);
  if (!guild) {
    console.error("[PaymentFlow] Guild configurada não encontrada.");
    return;
  }

  const waitingBet: WaitingBet = {
    betId: bet.betId,
    userId: bet.userId,
    amount: bet.amount,
    pixKey: bet.pixKey,
    pixKeyType: bet.pixKeyType,
    pixOwnerDocument: bet.pixOwnerDocument,
    paymentId: bet.paymentId!,
    joinedAt: Date.now(),
  };

  const pairing = await joinBetQueue(waitingBet);

  const panelChannel = await guild.channels.fetch(config.channels.queuePanelChannelId).catch(() => null);

  if (!pairing) {
    await updateBet(bet.betId, { status: "na_fila" });

    const user = await client.users.fetch(bet.userId).catch(() => null);
    await user
      ?.send(`✅ Pagamento de R$ ${bet.amount.toFixed(2)} confirmado! Você entrou na fila, aguardando adversário.`)
      .catch(() => undefined);

    if (panelChannel?.type === ChannelType.GuildText) {
      await updateQueueStatus(guild, panelChannel as TextChannel);
    }
    return;
  }

  // Adversário encontrado: parte para o check-in.
  await markQueueAsCheckingIn(guild, pairing.waitingBet, pairing.newBet);

  if (panelChannel?.type === ChannelType.GuildText) {
    await startBetCheckIn(guild, panelChannel as TextChannel, pairing.waitingBet, pairing.newBet);
  }
}
