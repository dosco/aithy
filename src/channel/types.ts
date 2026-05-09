export interface ChannelMessage {
  id: string;
  channelId: string;
  conversationId: string;
  senderId: string;
  text: string;
  createdAt: Date;
}

export interface ChannelCommand {
  kind: "command";
  id: string;
  channelId: string;
  conversationId: string;
  senderId: string;
  text: string;
  createdAt: Date;
}

export type ChannelInput = ChannelMessage | ChannelCommand;

export interface ChannelReply {
  channelId: string;
  conversationId: string;
  text: string;
}

export interface ChannelAdapter {
  receive(): AsyncIterable<ChannelInput>;
  send(reply: ChannelReply): Promise<void>;
  setActiveConversation?(conversationId: string): void;
}

export function isChannelCommand(input: ChannelInput): input is ChannelCommand {
  return "kind" in input && input.kind === "command";
}
