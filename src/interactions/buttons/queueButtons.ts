import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, EmbedBuilder } from "discord.js";
import { config } from "../../config";
import { leaveBetQueue, getBet, updateBet } from "../../betting/betLedger";
import { refundBet } from "../../betting/payoutService";
import { refreshQueueStatus } from "../../queue/betQueueStatus";

export const QUEUE_BUTTON_IDS = {
  leave: "queue_leave",
} as const;

/**
 * Monta o painel fixo explicando como entrar na fila apostada solo (1v1).
 * A entrada é feita via `/apostar` (que abre o select com os valores e o
 * modal pra registrar a chave PIX), pois envolve pagamento real.
 */
export function buildQueuePanel() {
  const embed = new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle("MamoBall — Fila Apostada Solo (1v1)")
    .setDescription(
      [
        "Use `/apostar` para escolher um valor e entrar na fila.",
        "",
        `Valores disponíveis: ${config.bet.tiers.map((v) => `R$ ${v}`).join(" • ")}`,
        "",
        "Você só é pareado com alguém que apostou o **mesmo valor**. Quem vencer leva o pote (as duas apostas), pago automaticamente via PIX.",
        "",
        "⚠️ Apostas em dinheiro real envolvem risco. Jogue com responsabilidade.",
        "",
        "Se quiser sair da fila enquanto ainda espera adversário, use o botão abaixo (sua aposta é reembolsada).",
      ].join("\n")
    )
    .setFooter({ text: "MamoBall Bet System" });

  if (config.branding.bannerUrl) {
    embed.setImage(config.branding.bannerUrl);
  }

  const leaveRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(QUEUE_BUTTON_IDS.leave)
      .setLabel("Sair da fila (reembolso)")
      .setEmoji("🚪")
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [leaveRow] };
}

export async function handleQueueButton(interaction: ButtonInteraction): Promise<void> {
  const { customId, user, guild } = interaction;

  if (!guild) {
    await interaction.reply({ content: "Este comando só funciona em servidores.", ephemeral: true });
    return;
  }

  if (customId !== QUEUE_BUTTON_IDS.leave) return;

  const removedBet = await leaveBetQueue(user.id);

  if (!removedBet) {
    await interaction.reply({
      content:
        "Você não está esperando na fila (ou já foi pareado — nesse caso, é só não confirmar presença no check-in que você é reembolsado automaticamente).",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const fullBet = await getBet(removedBet.betId);
  if (fullBet) {
    await refundBet(fullBet, guild, "saiu da fila voluntariamente");
  } else {
    await updateBet(removedBet.betId, { status: "reembolsada" });
  }

  await interaction.editReply({
    content: `✅ Você saiu da fila. Sua aposta de R$ ${removedBet.amount.toFixed(2)} foi reembolsada.`,
  });

  await refreshQueueStatus(guild);
}
