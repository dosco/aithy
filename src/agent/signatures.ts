import { f } from "@ax-llm/ax";

export const aithySignature = f()
  .input("userProfile", f.json().cache().optional())
  .input("userRequest", f.string("The user's latest message or task"))
  .input("memoryContext", f.string("Deterministically preloaded durable memories and episodes for this turn").optional())
  .input("knowledgeContext", f.string("Bounded matching summaries from enabled Knowledge Library bundles").optional())
  .input("urlContext", f.string("Automatically fetched URL content for the latest request").optional())
  .input("searchContext", f.string("Automatically fetched web search results for the latest request").optional())
  .input("artifactContext", f.string("Current run artifact output directory and publishing rules").optional())
  .input("channelContext", f.json("Channel, sender, and conversation metadata"))
  .input("conversationHistory", f.string("Prior user and assistant messages in this conversation, oldest first").optional())
  .output("agentResponse", f.string("Final response to send back on the same channel"))
  .build();
