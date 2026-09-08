import { StringSelectMenuInteraction } from "discord.js";
import { BET_AMOUNT_SELECT_ID, handleBetAmountSelect } from "../interactions/selects/betAmountSelect";

export async function handleSelectMenuInteraction(interaction: StringSelectMenuInteraction): Promise<void> {
  try {
    if (interaction.customId === BET_AMOUNT_SELECT_ID) {
      await handleBetAmountSelect(interaction);
      return;
    }

    console.warn(`[SelectMenuHandler] customId não reconhecido: ${interaction.customId}`);
  } catch (error) {
    console.error(`[SelectMenuHandler] Erro ao processar ${interaction.customId}:`, error);
    const errorMessage = { content: "❌ Ocorreu um erro ao processar sua escolha.", ephemeral: true };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(errorMessage).catch(() => undefined);
    } else {
      await interaction.reply(errorMessage).catch(() => undefined);
    }
  }
}
