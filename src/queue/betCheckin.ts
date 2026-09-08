import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  Guild,
  TextChannel,
} from "discord.js";
import { BetCheckInSession, MODE_CONFIG, WaitingBet } from "../types";
import { config } from "../config";
import { createBetMatch } from "./matchmaking";
import { sendMatchAnnouncement } from "../utils/matchAnnouncement";
import { requeueBet, getBet, updateBet } from "../betting/betLedger";
import { refundBet } from "../betting/payoutService";
import { markMatchCreated, refreshQueueStatus } from "./betQueueStatus";

export const CHECKIN_BUTTON_ID = "queue_checkin_confirm";

const sessions = new Map<string, BetCheckInSession>();

/**
 * Jogadores atualmente "ocupados" (em uma sessão de check-in em andamento),
 * usado para impedir que apostem de novo enquanto isso.
 */
const busyPlayers = new Set<string>();

export function isPlayerInCheckIn(userId: string): boolean {
  return busyPlayers.has(userId);
}

function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function bothPlayers(session: BetCheckInSession): string[] {
  return [session.betA.userId, session.betB.userId];
}

function buildCheckInEmbed(session: BetCheckInSession): EmbedBuilder {
  const pot = session.betA.amount + session.betB.amount;
  const pending = bothPlayers(session).filter((id) => !session.confirmed.has(id));

  const line = (bet: WaitingBet) =>
    `${session.confirmed.has(bet.userId) ? "✅" : "⏳"} <@${bet.userId}> — apostou R$ ${bet.amount.toFixed(2)}`;

  return new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle(`✅ Check-in — Fila ${MODE_CONFIG[session.mode].label}`)
    .setDescription(
      [
        `💰 **Pote da partida: R$ ${pot.toFixed(2)}** (quem vencer leva tudo, descontada a taxa da casa se houver).`,
        `Vocês têm **${config.queue.checkInTimeoutMs / 1000} segundos** para confirmar presença.`,
        "",
        line(session.betA),
        line(session.betB),
        "",
        pending.length > 0
          ? `**Aguardando:** ${pending.map((id) => `<@${id}>`).join(", ")}`
          : "Todos confirmaram! Iniciando partida...",
      ].join("\n")
    );
}

function buildCheckInRow(sessionId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CHECKIN_BUTTON_ID}:${sessionId}`)
      .setLabel("Confirmar Presença")
      .setEmoji("🖐️")
      .setStyle(ButtonStyle.Success)
  );
}

/** Inicia a fase de check-in para duas apostas que acabaram de ser pareadas. */
export async function startBetCheckIn(
  guild: Guild,
  channel: TextChannel,
  betA: WaitingBet,
  betB: WaitingBet
): Promise<void> {
  const sessionId = generateSessionId();

  const session: BetCheckInSession = {
    sessionId,
    mode: "solo",
    channelId: channel.id,
    guildId: guild.id,
    betA,
    betB,
    confirmed: new Set(),
    timeout: setTimeout(() => resolveCheckIn(sessionId, guild), config.queue.checkInTimeoutMs),
  };

  sessions.set(sessionId, session);
  bothPlayers(session).forEach((id) => busyPlayers.add(id));

  await updateBet(betA.betId, { status: "pareada" });
  await updateBet(betB.betId, { status: "pareada" });

  const mentions = bothPlayers(session)
    .map((id) => `<@${id}>`)
    .join(" ");

  const message = await channel.send({
    content: mentions,
    embeds: [buildCheckInEmbed(session)],
    components: [buildCheckInRow(sessionId)],
  });

  session.messageId = message.id;
}

export async function handleCheckInButton(interaction: ButtonInteraction): Promise<void> {
  const sessionId = interaction.customId.split(":")[1];
  const session = sessions.get(sessionId);

  if (!session) {
    await interaction.reply({ content: "⚠️ Esta sessão de check-in não está mais ativa.", ephemeral: true });
    return;
  }

  if (!bothPlayers(session).includes(interaction.user.id)) {
    await interaction.reply({ content: "⚠️ Você não faz parte desta partida.", ephemeral: true });
    return;
  }

  if (session.confirmed.has(interaction.user.id)) {
    await interaction.reply({ content: "Você já confirmou presença.", ephemeral: true });
    return;
  }

  session.confirmed.add(interaction.user.id);
  await interaction.reply({ content: "✅ Presença confirmada!", ephemeral: true });

  const channel = interaction.guild?.channels.cache.get(session.channelId);
  if (channel?.isTextBased() && session.messageId) {
    const message = await channel.messages.fetch(session.messageId).catch(() => null);
    await message
      ?.edit({ embeds: [buildCheckInEmbed(session)], components: [buildCheckInRow(sessionId)] })
      .catch(() => undefined);
  }

  if (session.confirmed.size === 2 && interaction.guild) {
    clearTimeout(session.timeout);
    await resolveCheckIn(sessionId, interaction.guild);
  }
}

/**
 * Resolve a sessão de check-in.
 * - Os 2 confirmaram: cria a partida normalmente (dinheiro fica retido até o resultado).
 * - Só 1 confirmou: quem confirmou volta pra fila (mantém o dinheiro pago,
 *   aguardando novo adversário); quem não confirmou é reembolsado.
 * - Ninguém confirmou: os 2 são reembolsados.
 */
async function resolveCheckIn(sessionId: string, guild: Guild): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  sessions.delete(sessionId);
  bothPlayers(session).forEach((id) => busyPlayers.delete(id));

  const channel = guild.channels.cache.get(session.channelId);
  const textChannel = channel?.isTextBased() ? channel : null;

  const aOk = session.confirmed.has(session.betA.userId);
  const bOk = session.confirmed.has(session.betB.userId);

  if (aOk && bOk) {
    if (textChannel && session.messageId) {
      const message = await textChannel.messages.fetch(session.messageId).catch(() => null);
      await message
        ?.edit({
          content: "",
          embeds: [
            new EmbedBuilder()
              .setColor(0x2ecc71)
              .setTitle("✅ Check-in concluído")
              .setDescription("Os dois jogadores confirmaram presença! Criando a partida..."),
          ],
          components: [],
        })
        .catch(() => undefined);
    }

    try {
      const match = await createBetMatch(guild, session.mode, session.betA, session.betB);
      await sendMatchAnnouncement(guild, match);
      await updateBet(session.betA.betId, { status: "em_partida", matchId: match.matchId });
      await updateBet(session.betB.betId, { status: "em_partida", matchId: match.matchId });
      await markMatchCreated(guild, match.textChannelId);
    } catch (error) {
      console.error("[BetCheckIn] Falha ao criar a partida:", error);
      const betAFull = await getBet(session.betA.betId);
      const betBFull = await getBet(session.betB.betId);
      if (betAFull) await refundBet(betAFull, guild, "falha técnica ao criar a partida");
      if (betBFull) await refundBet(betBFull, guild, "falha técnica ao criar a partida");
      await refreshQueueStatus(guild);
    }
    return;
  }

  // Check-in incompleto: quem confirmou volta pra fila, quem não confirmou é reembolsado.
  const [confirmedBet, unconfirmedBet] = aOk
    ? [session.betA, session.betB]
    : bOk
    ? [session.betB, session.betA]
    : [null, null];

  if (confirmedBet) {
    await requeueBet(confirmedBet);
    await updateBet(confirmedBet.betId, { status: "na_fila" });
  }

  const toRefund = confirmedBet ? [unconfirmedBet!] : [session.betA, session.betB];
  for (const bet of toRefund) {
    const fullBet = await getBet(bet.betId);
    if (fullBet) await refundBet(fullBet, guild, "não confirmou presença a tempo (check-in)");
  }

  await refreshQueueStatus(guild);

  if (textChannel && session.messageId) {
    const message = await textChannel.messages.fetch(session.messageId).catch(() => null);
    await message
      ?.edit({
        content: "",
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("❌ Check-in falhou")
            .setDescription(
              [
                confirmedBet
                  ? `<@${unconfirmedBet!.userId}> não confirmou a tempo e foi reembolsado. <@${confirmedBet.userId}> voltou para a fila aguardando novo adversário.`
                  : "Nenhum dos dois confirmou a tempo. Ambos foram reembolsados.",
              ].join("\n")
            ),
        ],
        components: [],
      })
      .catch(() => undefined);
  }
}
