import { ButtonInteraction, EmbedBuilder } from "discord.js";
import { activeMatches, activeMatchBets } from "../../queue/matchmaking";
import { deleteMatchChannels } from "../../utils/channelManager";
import { config } from "../../config";
import { RESULT_BUTTON_IDS, setRegisterResultButtonState } from "./resultButtons";
import { getBet } from "../../betting/betLedger";
import { payoutWinner, refundBet } from "../../betting/payoutService";

/**
 * Processa a decisão da Staff (Aprovar/Rejeitar/Anular) sobre um resultado
 * de partida apostada pendente.
 *
 * Diferente da versão com pontos: aqui "Aprovar" dispara o payout PIX
 * automático pro vencedor, e "Anular" reembolsa os dois jogadores.
 */
export async function handleStaffDecisionButton(interaction: ButtonInteraction): Promise<void> {
  const [action, matchId] = interaction.customId.split(":");
  const match = activeMatches.get(matchId);
  const bets = activeMatchBets.get(matchId);
  const guild = interaction.guild;

  if (!guild) return;

  if (!match || !match.resultSubmitted) {
    await interaction.update({
      content: "⚠️ Esta partida não possui mais um resultado pendente.",
      embeds: [],
      components: [],
    });
    return;
  }

  if (action === RESULT_BUTTON_IDS.reject) {
    await interaction.update({
      content: `❌ Resultado da partida **${matchId}** rejeitado por <@${interaction.user.id}>. Peça para os jogadores registrarem novamente.`,
      embeds: [],
      components: [],
    });
    match.resultSubmitted = undefined;
    await setRegisterResultButtonState(match, guild, false);
    return;
  }

  if (action === RESULT_BUTTON_IDS.void) {
    await interaction.update({
      content: `🚫 Anulando a partida **${matchId}** e reembolsando os dois jogadores...`,
      embeds: [],
      components: [],
    });

    if (bets) {
      const [fullA, fullB] = await Promise.all([getBet(bets.betA.betId), getBet(bets.betB.betId)]);
      if (fullA) await refundBet(fullA, guild, "partida anulada pela Staff");
      if (fullB) await refundBet(fullB, guild, "partida anulada pela Staff");
    } else {
      console.error(`[StaffDecision] Apostas da partida ${matchId} não encontradas para reembolso.`);
    }

    const voidEmbed = new EmbedBuilder()
      .setColor(0x95a5a6)
      .setTitle(`🚫 Partida ${matchId} anulada`)
      .setDescription(
        "Esta partida foi anulada pela Staff. As duas apostas foram reembolsadas via Mercado Pago.\n" +
          "Os canais temporários serão removidos em 10 segundos."
      )
      .setFooter({ text: `Anulada por ${interaction.user.username}` })
      .setTimestamp();

    await interaction.message.edit({ content: "", embeds: [voidEmbed], components: [] });

    const textChannel = guild.channels.cache.get(match.textChannelId);
    if (textChannel?.isTextBased()) {
      await textChannel
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x95a5a6)
              .setDescription(
                "🚫 Esta partida foi **anulada** pela Staff. As duas apostas foram reembolsadas. O canal será removido em instantes."
              ),
          ],
        })
        .catch(() => undefined);
    }

    setTimeout(async () => {
      await deleteMatchChannels(guild, {
        categoryId: match.categoryId,
        textChannelId: match.textChannelId,
        voiceChannelAId: match.voiceChannelAId,
        voiceChannelBId: match.voiceChannelBId,
      });
      activeMatches.delete(matchId);
      activeMatchBets.delete(matchId);
    }, config.match.deleteChannelsDelayMs);

    return;
  }

  if (action === RESULT_BUTTON_IDS.approve) {
    await interaction.update({
      content: `⏳ Aprovando resultado da partida **${matchId}** e processando o pagamento...`,
      embeds: [],
      components: [],
    });

    const { winner, scoreA, scoreB } = match.resultSubmitted;

    if (!bets) {
      console.error(`[StaffDecision] Apostas da partida ${matchId} não encontradas para payout.`);
      await interaction.message
        .edit({
          content: "",
          embeds: [
            new EmbedBuilder()
              .setColor(0xe74c3c)
              .setTitle(`⚠️ Erro ao pagar a partida ${matchId}`)
              .setDescription(
                "Não encontrei o registro das apostas desta partida (o bot pode ter reiniciado). " +
                  "Verifique manualmente no Firestore (coleção `soloBets`) e pague o vencedor."
              ),
          ],
          components: [],
        })
        .catch(() => undefined);
      return;
    }

    const winnerBetWaiting = winner === "A" ? bets.betA : bets.betB;
    const loserBetWaiting = winner === "A" ? bets.betB : bets.betA;

    const [winnerBet, loserBet] = await Promise.all([
      getBet(winnerBetWaiting.betId),
      getBet(loserBetWaiting.betId),
    ]);

    if (winnerBet && loserBet) {
      await payoutWinner(guild, winnerBet, loserBet);
    } else {
      console.error(`[StaffDecision] Registro de aposta ausente para a partida ${matchId}.`);
    }

    const confirmationEmbed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`✅ Partida ${matchId} aprovada`)
      .setDescription(
        `Placar final: **Time A ${scoreA} x ${scoreB} Time B**\n` +
          `Vencedor: ${winner === "A" ? "🔵 Time A" : "🔴 Time B"} — <@${
            (winner === "A" ? bets.betA : bets.betB).userId
          }>\n\n` +
          `Pagamento processado (ou encaminhado à Staff, se o payout automático não estiver disponível). ` +
          `Os canais temporários serão removidos em 10 segundos.`
      )
      .setFooter({ text: `Aprovado por ${interaction.user.username}` })
      .setTimestamp();

    await interaction.message.edit({ content: "", embeds: [confirmationEmbed], components: [] });

    setTimeout(async () => {
      await deleteMatchChannels(guild, {
        categoryId: match.categoryId,
        textChannelId: match.textChannelId,
        voiceChannelAId: match.voiceChannelAId,
        voiceChannelBId: match.voiceChannelBId,
      });
      activeMatches.delete(matchId);
      activeMatchBets.delete(matchId);
    }, config.match.deleteChannelsDelayMs);
  }
}
