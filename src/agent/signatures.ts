import { f } from "@ax-llm/ax";

export const aithySignature = f()
  .input("userRequest", f.string("The user's latest message or task"))
  .input("channelContext", f.json("Channel, sender, and conversation metadata"))
  .input("conversationHistory", f.string("Prior user and assistant messages in this conversation, oldest first").optional())
  .output("agentResponse", f.string("Final response to send back on the same channel"))
  .build();
