import { ChatInputCommandInteraction, SharedSlashCommand } from "discord.js";
import * as painelFilas from "./painelFilas";
import * as apostar from "./apostar";

export interface Command {
  data: SharedSlashCommand;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export const commands: Command[] = [painelFilas, apostar];
