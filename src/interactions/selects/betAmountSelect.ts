import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { config } from "../../config";
import { isPlayerInBetQueue } from "../../betting/betLedger";
import { isPlayerInCheckIn } from "../../queue/betCheckin";
import { isPlayerInActiveMatch } from "../../queue/matchmaking";
import { BET_INFO_MODAL_ID, BET_INFO_MODAL_INPUTS } from "../modals/betInfoModal";

export const BET_AMOUNT_SELECT_ID = "bet_amount_select";

/** Monta o select de valores fixos de aposta (ex: R$1, R$3, R$5...). */
export function buildBetAmountSelectRow(): ActionRowBuilder<StringSelectMenuBuilder> {
  const select = new StringSelectMenuBuilder()
    .setCustomId(BET_AMOUNT_SELECT_ID)
    .setPlaceholder("Escolha o valor da sua aposta")
    .addOptions(
      config.bet.tiers.map((value) => ({
        label: `R$ ${value.toFixed(2)}`,
        value: String(value),
        description: `Apostar R$ ${value.toFixed(2)} na fila solo (1v1)`,
      }))
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

/**
 * Processa a escolha do valor: valida que o jogador está livre e abre o
 * modal pedindo a chave PIX (necessária para pagar o prêmio se ele vencer).
 */
export async function handleBetAmountSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const userId = interaction.user.id;

  if ((await isPlayerInBetQueue(userId)) || isPlayerInCheckIn(userId) || isPlayerInActiveMatch(userId)) {
    await interaction.reply({
      content: "⚠️ Você já está em uma aposta pendente, na fila, em check-in ou em partida.",
      ephemeral: true,
    });
    return;
  }

  const amount = Number(interaction.values[0]);

  const modal = new ModalBuilder()
    .setCustomId(`${BET_INFO_MODAL_ID}:${amount}`)
    .setTitle(`Aposta de R$ ${amount.toFixed(2)} — Dados PIX`);

  const pixKeyInput = new TextInputBuilder()
    .setCustomId(BET_INFO_MODAL_INPUTS.pixKey)
    .setLabel("Sua chave PIX (pra receber se vencer)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("CPF, e-mail, telefone ou chave aleatória")
    .setRequired(true);

  const pixKeyTypeInput = new TextInputBuilder()
    .setCustomId(BET_INFO_MODAL_INPUTS.pixKeyType)
    .setLabel("Tipo: CPF, CNPJ, EMAIL, PHONE ou RANDOM")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Ex: CPF")
    .setRequired(true);

  const ownerDocumentInput = new TextInputBuilder()
    .setCustomId(BET_INFO_MODAL_INPUTS.ownerDocument)
    .setLabel("CPF ou CNPJ do titular da chave PIX")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Apenas números")
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(pixKeyInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(pixKeyTypeInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(ownerDocumentInput)
  );

  await interaction.showModal(modal);
}
