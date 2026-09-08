import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { buildBetAmountSelectRow } from "../interactions/selects/betAmountSelect";
import { isPlayerInBetQueue } from "../betting/betLedger";
import { isPlayerInCheckIn } from "../queue/betCheckin";
import { isPlayerInActiveMatch } from "../queue/matchmaking";

export const data = new SlashCommandBuilder()
  .setName("apostar")
  .setDescription("Escolha um valor e entre na fila apostada Solo (1v1).");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;

  if ((await isPlayerInBetQueue(userId)) || isPlayerInCheckIn(userId) || isPlayerInActiveMatch(userId)) {
    await interaction.reply({
      content: "⚠️ Você já está em uma aposta pendente, na fila, em check-in ou em partida.",
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: "Escolha quanto quer apostar:",
    components: [buildBetAmountSelectRow()],
    ephemeral: true,
  });
}
