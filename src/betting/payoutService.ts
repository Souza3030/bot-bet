import { EmbedBuilder, Guild, TextChannel, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { config } from "../config";
import { BetEntry } from "../types";
import { payoutPix, refundPayment } from "../payments/mercadoPago";
import { updateBet } from "./betLedger";

export const MANUAL_PAYOUT_BUTTON_ID = "solo_bet_manual_paid";

/**
 * Reembolsa uma aposta via Mercado Pago (usado quando a partida é cancelada,
 * ninguém confirma check-in, ou a Staff anula o resultado).
 */
export async function refundBet(bet: BetEntry, guild: Guild, reason: string): Promise<void> {
  if (!bet.paymentId) {
    console.warn(`[Payout] Aposta ${bet.betId} sem paymentId, não é possível reembolsar automaticamente.`);
    return;
  }

  try {
    await refundPayment(bet.paymentId);
    await updateBet(bet.betId, { status: "reembolsada" });
  } catch (error) {
    console.error(`[Payout] Falha ao reembolsar aposta ${bet.betId}:`, error);
    await notifyStaffManualAction(
      guild,
      `⚠️ **Reembolso automático falhou** para <@${bet.userId}> (aposta ${bet.betId}, R$ ${bet.amount.toFixed(
        2
      )}). Motivo do reembolso: ${reason}. Verifique o pagamento **${bet.paymentId}** manualmente no painel do Mercado Pago.`
    );
    return;
  }

  const user = await guild.client.users.fetch(bet.userId).catch(() => null);
  await user
    ?.send(
      `💸 Sua aposta de **R$ ${bet.amount.toFixed(2)}** foi reembolsada automaticamente. Motivo: ${reason}`
    )
    .catch(() => undefined);
}

/**
 * Paga o vencedor via PIX automaticamente. Se a API de payout do Mercado
 * Pago não estiver disponível/aprovada para esta conta, cai num fallback
 * seguro: marca a aposta como "pagamento_manual_pendente" e avisa a Staff
 * com todos os dados necessários para fazer a transferência manualmente.
 */
export async function payoutWinner(
  guild: Guild,
  winnerBet: BetEntry,
  loserBet: BetEntry
): Promise<void> {
  const pot = winnerBet.amount + loserBet.amount;
  const houseFee = pot * (config.bet.houseFeePercent / 100);
  const payoutAmount = Math.round((pot - houseFee) * 100) / 100;

  try {
    const result = await payoutPix({
      amount: payoutAmount,
      pixKey: winnerBet.pixKey,
      pixKeyType: winnerBet.pixKeyType,
      ownerDocument: winnerBet.pixOwnerDocument,
      externalReference: `payout-${winnerBet.betId}`,
    });

    await updateBet(winnerBet.betId, { status: "paga_vencedor" });
    await updateBet(loserBet.betId, { status: "perdida" });

    const winnerUser = await guild.client.users.fetch(winnerBet.userId).catch(() => null);
    await winnerUser
      ?.send(
        `🏆 Você venceu! **R$ ${payoutAmount.toFixed(2)}** foram enviados via PIX para sua chave ` +
          `(comprovante: transação \`${result.transactionId}\`).`
      )
      .catch(() => undefined);
  } catch (error) {
    console.error(`[Payout] Falha ao pagar vencedor (aposta ${winnerBet.betId}):`, error);
    await updateBet(winnerBet.betId, { status: "pagamento_manual_pendente" });
    await updateBet(loserBet.betId, { status: "perdida" });
    await notifyStaffManualPayout(guild, winnerBet, payoutAmount);
  }
}

async function notifyStaffManualAction(guild: Guild, message: string): Promise<void> {
  const staffChannel = guild.channels.cache.get(config.channels.staffChannelId) as
    | TextChannel
    | undefined;
  if (!staffChannel) {
    console.error("[Payout] Canal da Staff não encontrado para notificação manual:", message);
    return;
  }
  await staffChannel.send(message).catch(() => undefined);
}

async function notifyStaffManualPayout(
  guild: Guild,
  winnerBet: BetEntry,
  payoutAmount: number
): Promise<void> {
  const staffChannel = guild.channels.cache.get(config.channels.staffChannelId) as
    | TextChannel
    | undefined;
  if (!staffChannel) {
    console.error(
      `[Payout] Canal da Staff não encontrado. Pagamento manual pendente para ${winnerBet.userId}.`
    );
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle("⚠️ Pagamento automático falhou — ação manual necessária")
    .setDescription(
      [
        "O payout automático via Mercado Pago não pôde ser concluído (a API de Payouts pode não estar habilitada/aprovada para esta conta ainda).",
        "",
        `**Vencedor:** <@${winnerBet.userId}>`,
        `**Valor a pagar:** R$ ${payoutAmount.toFixed(2)}`,
        `**Chave PIX:** \`${winnerBet.pixKey}\` (${winnerBet.pixKeyType})`,
        `**CPF/CNPJ do titular:** \`${winnerBet.pixOwnerDocument}\``,
        `**ID da aposta:** \`${winnerBet.betId}\``,
        "",
        "Faça a transferência manualmente e clique no botão abaixo para marcar como pago.",
      ].join("\n")
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${MANUAL_PAYOUT_BUTTON_ID}:${winnerBet.betId}`)
      .setLabel("Marcar como pago manualmente")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
  );

  await staffChannel.send({ embeds: [embed], components: [row] }).catch(() => undefined);
}

/** Processa o clique no botão "Marcar como pago manualmente". */
export async function handleManualPayoutButton(
  betId: string,
  markedBy: string
): Promise<{ ok: boolean; message: string }> {
  await updateBet(betId, { status: "paga_vencedor" });
  return {
    ok: true,
    message: `✅ Aposta \`${betId}\` marcada como paga manualmente por <@${markedBy}>.`,
  };
}
