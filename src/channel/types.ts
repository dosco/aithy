import type { AssistantTextStatus } from "../session/types";

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

export type ChannelReplyStatus = AssistantTextStatus;

export interface ChannelReply {
  channelId: string;
  conversationId: string;
  text: string;
  status?: ChannelReplyStatus;
}

export interface ChannelAdapter {
  receive(): AsyncIterable<ChannelInput>;
  send(reply: ChannelReply): Promise<void>;
  setActiveConversation?(conversationId: string): void;
}

export function isChannelCommand(input: ChannelInput): input is ChannelCommand {
  return "kind" in input && input.kind === "command";
}
