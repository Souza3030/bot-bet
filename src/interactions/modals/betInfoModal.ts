import { AttachmentBuilder, EmbedBuilder, ModalSubmitInteraction } from "discord.js";
import { config } from "../../config";
import { PixKeyType } from "../../types";
import { createBet, updateBet } from "../../betting/betLedger";
import { createPixPayment } from "../../payments/mercadoPago";

export const BET_INFO_MODAL_ID = "bet_info_modal";

export const BET_INFO_MODAL_INPUTS = {
  pixKey: "pix_key",
  pixKeyType: "pix_key_type",
  ownerDocument: "owner_document",
} as const;

const VALID_PIX_KEY_TYPES: PixKeyType[] = ["CPF", "CNPJ", "EMAIL", "PHONE", "RANDOM"];

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Processa o envio do modal de dados PIX: valida os campos, cria o
 * registro da aposta e gera a cobrança PIX no Mercado Pago.
 * customId esperado: "bet_info_modal:<amount>"
 */
export async function handleBetInfoModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const amount = Number(interaction.customId.split(":")[1]);

  if (!config.bet.tiers.includes(amount)) {
    await interaction.reply({ content: "⚠️ Valor de aposta inválido.", ephemeral: true });
    return;
  }

  const rawPixKey = interaction.fields.getTextInputValue(BET_INFO_MODAL_INPUTS.pixKey).trim();
  const rawPixKeyType = interaction.fields
    .getTextInputValue(BET_INFO_MODAL_INPUTS.pixKeyType)
    .trim()
    .toUpperCase();
  const rawOwnerDocument = onlyDigits(
    interaction.fields.getTextInputValue(BET_INFO_MODAL_INPUTS.ownerDocument)
  );

  if (!VALID_PIX_KEY_TYPES.includes(rawPixKeyType as PixKeyType)) {
    await interaction.reply({
      content: `⚠️ Tipo de chave PIX inválido. Use um destes: ${VALID_PIX_KEY_TYPES.join(", ")}.`,
      ephemeral: true,
    });
    return;
  }

  if (rawOwnerDocument.length !== 11 && rawOwnerDocument.length !== 14) {
    await interaction.reply({
      content: "⚠️ CPF/CNPJ inválido. Informe apenas números (11 dígitos para CPF, 14 para CNPJ).",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const bet = await createBet({
    userId: interaction.user.id,
    guildId: interaction.guildId!,
    amount,
    pixKey: rawPixKey,
    pixKeyType: rawPixKeyType as PixKeyType,
    pixOwnerDocument: rawOwnerDocument,
  });

  try {
    const payerEmail = `${interaction.user.id}@${config.bet.payerEmailDomain}`;
    const payment = await createPixPayment(
      amount,
      bet.betId,
      payerEmail,
      `MamoBall — Aposta Solo (1v1) R$ ${amount.toFixed(2)}`
    );

    await updateBet(bet.betId, { paymentId: payment.paymentId });

    const qrImage = new AttachmentBuilder(Buffer.from(payment.qrCodeBase64, "base64"), {
      name: "pix-qrcode.png",
    });

    const embed = new EmbedBuilder()
      .setColor(0x1abc9c)
      .setTitle(`💰 Pague R$ ${amount.toFixed(2)} via PIX para entrar na fila`)
      .setDescription(
        [
          "Escaneie o QR Code ou copie o código abaixo no app do seu banco.",
          "",
          "**PIX Copia e Cola:**",
          `\`\`\`${payment.qrCode}\`\`\``,
          "",
          `⏳ Este código expira em **${config.bet.paymentExpirationMs / 60000} minutos**.`,
          "Assim que o pagamento for confirmado, você entra automaticamente na fila.",
        ].join("\n")
      )
      .setImage("attachment://pix-qrcode.png")
      .setFooter({ text: `ID da aposta: ${bet.betId}` });

    await interaction.editReply({ embeds: [embed], files: [qrImage] });
  } catch (error) {
    console.error("[BetInfoModal] Falha ao criar cobrança PIX:", error);
    await updateBet(bet.betId, { status: "cancelada" });
    await interaction.editReply({
      content: "❌ Não foi possível gerar a cobrança PIX agora. Tente novamente em instantes.",
    });
  }
}
