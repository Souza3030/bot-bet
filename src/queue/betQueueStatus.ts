import { EmbedBuilder, Guild, TextChannel } from "discord.js";
import { WaitingBet } from "../types";
import { listWaitingBets } from "../betting/betLedger";

interface QueueStatusLocation {
  channelId: string;
  messageId: string;
}

const statusMessages = new Map<string, QueueStatusLocation>();

function buildQueueStatusEmbed(waitingBets: WaitingBet[]): EmbedBuilder {
  const lines =
    waitingBets.length > 0
      ? waitingBets.map(
          (bet) => `<@${bet.userId}> — **R$ ${bet.amount.toFixed(2)}** — aguardando adversário`
        )
      : ["Ninguém esperando no momento."];

  return new EmbedBuilder()
    .setColor(waitingBets.length > 0 ? 0xf1c40f : 0x5865f2)
    .setTitle(`🏐 Fila Apostada Solo (1v1) — ${waitingBets.length} jogador(es) esperando`)
    .setDescription(lines.join("\n"))
    .setFooter({ text: "Use /apostar para escolher um valor e entrar na fila." })
    .setTimestamp();
}

async function editStatus(guild: Guild, embed: EmbedBuilder): Promise<boolean> {
  const location = statusMessages.get(guild.id);
  if (!location) return false;

  const channel = await guild.channels.fetch(location.channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return false;

  const message = await channel.messages.fetch(location.messageId).catch(() => null);
  if (!message) return false;

  await message.edit({ embeds: [embed] }).catch(() => undefined);
  return true;
}

export async function updateQueueStatus(guild: Guild, channel: TextChannel): Promise<void> {
  const waitingBets = await listWaitingBets();
  const embed = buildQueueStatusEmbed(waitingBets);
  if (await editStatus(guild, embed)) return;

  const message = await channel.send({ embeds: [embed] });
  statusMessages.set(guild.id, { channelId: channel.id, messageId: message.id });
}

export async function refreshQueueStatus(guild: Guild): Promise<void> {
  const waitingBets = await listWaitingBets();
  await editStatus(guild, buildQueueStatusEmbed(waitingBets));
}

export async function markQueueAsCheckingIn(guild: Guild, betA: WaitingBet, betB: WaitingBet): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle("🏐 Fila Apostada Solo (1v1) — Adversários pareados!")
    .setDescription(
      [
        `<@${betA.userId}> vs <@${betB.userId}>`,
        `💰 Pote: **R$ ${(betA.amount + betB.amount).toFixed(2)}**`,
        "",
        "Os 2 jogadores estão confirmando presença para a partida.",
      ].join("\n")
    )
    .setFooter({ text: "Aguarde a próxima atualização..." })
    .setTimestamp();

  await editStatus(guild, embed);
}

export async function markMatchCreated(guild: Guild, matchChannelId: string): Promise<void> {
  await editStatus(
    guild,
    new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("✅ Partida Solo (1v1) criada")
      .setDescription(`Os jogadores foram pareados e a partida foi criada em <#${matchChannelId}>.`)
      .setFooter({ text: "Use /apostar novamente para entrar em uma nova fila." })
      .setTimestamp()
  );
}
