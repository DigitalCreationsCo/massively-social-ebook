import type { BroadcastChannelConfig } from "../../broadcast/config";
import type { ChatGateway } from "../gateway";
import { TwitchChatConnector } from "./twitch";
import { YoutubeChatConnector } from "./youtube";

type Connector = { start(): void; stop(): Promise<void> };

export class ExternalChatConnectors {
  private readonly connectors: Connector[] = [];

  constructor(configs: Map<string, BroadcastChannelConfig>, gateway: ChatGateway) {
    for (const config of configs.values()) {
      if (config.youtube) this.connectors.push(new YoutubeChatConnector(config.channelId, config.youtube, gateway));
      if (config.twitch) this.connectors.push(new TwitchChatConnector(config.channelId, config.twitch, gateway));
    }
  }

  start(): void {
    for (const connector of this.connectors) connector.start();
  }

  async stop(): Promise<void> {
    await Promise.all(this.connectors.map((connector) => connector.stop()));
  }
}
