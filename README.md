# AI Orchestra 🎭

![AI Orchestra](https://replicate.delivery/xezq/i34RlRAenhShMiJRCC3qt2eq2k43vIZmfcrToCu8KtGvV1WoA/tmp9q_4jc7w.jpg)

Simple orchestration for AI Agents built around Vercel's `streamText`. AI Orchestra provides a lightweight way to handle agent handoffs and state transitions, similar to OpenAI's Swarm but with more developer control and less magic. Think of it as a simpler alternative to LangGraph, focused on streaming and agent coordination.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- 🎯 **Simple Agent Handoffs** - Coordinate multiple AI agents with clear state transitions
- 🌊 **Built for Streaming** - Native support for Vercel's `streamText` and AI SDK
- 🔄 **Developer Control** - Full control over agent behavior and state transitions
- 📝 **TypeScript First** - Built with TypeScript for excellent type safety
- 🎭 **Swarm-like Patterns** - Similar patterns to OpenAI's Swarm, but more flexible
- 🚀 **Minimal Dependencies** - Core dependencies are Vercel's `ai` package and `zod` for type safety

## Installation

```bash
# Using npm
npm install ai-orchestra

# Using yarn
yarn add ai-orchestra

# Using pnpm
pnpm add ai-orchestra

# Using bun
bun add ai-orchestra
```

## Example

Here's how to use AI Orchestra with the Vercel AI SDK and tool handling:

```typescript
import { anthropic } from '@ai-sdk/anthropic'
import { CoreMessage, streamText } from 'ai'
import { z } from 'zod'
import {
  createOrchestra,
  createToolResponse,
  processStream,
} from 'ai-orchestra'

// Define your context with message history
interface MyContext {
  messages: CoreMessage[]
}

const orchestra = createOrchestra<MyContext>()({
  // Intent classification state
  intent: async (context, dispatch) => {
    const chunks = streamText({
      model: anthropic('claude-3-5-haiku-20241022'),
      system:
        'You are a helpful assistant that processes intents. If you need to handoff to a different agent, use the handoff tool.',
      messages: context.messages,
      maxSteps: 10,
      tools: {
        // Tool for telling jokes
        joke: {
          description: 'Tells a joke',
          parameters: z.object({
            topic: z.string().describe('The topic of the joke'),
          }),
          execute: async ({ topic }) => {
            return `Why did the ${topic} cross the road?`
          },
        },
        // Tool for handing off to another agent
        handoffToPlanningAgent: {
          description: 'Hand off to the planning agent',
          parameters: z.object({
            name: z.string().describe('The name of the planning agent'),
          }),
        },
      },
    })

    // Process the stream and handle tool calls
    const { finishReason, toolCalls, messages } = await processStream(
      chunks,
      dispatch
    )

    if (finishReason === 'tool-calls') {
      for (const toolCall of toolCalls) {
        if (toolCall.toolName === 'handoffToPlanningAgent') {
          return {
            nextState: 'plan',
            context: {
              messages: [
                ...messages,
                createToolResponse(toolCall, 'Handing off to intent agent'),
              ],
            },
          }
        }
      }
    }

    return {
      nextState: 'intent',
      context: {
        messages: [...context.messages, ...messages],
      },
    }
  },

  // Planning state
  plan: async (context, dispatch) => {
    const chunks = streamText({
      model: anthropic('claude-3-5-haiku-20241022'),
      system: 'You are a helpful assistant that plans events',
      messages: context.messages,
      tools: {
        // Anthropic needs tools defined for any conversation with previous tool usage
        // https://github.com/BerriAI/litellm/issues/5388
        dummyTool: {
          description: 'A dummy tool',
          parameters: z.object({}),
        },
      },
    })

    const { messages } = await processStream(chunks, dispatch)

    return {
      context: {
        messages: [...context.messages, ...messages],
      },
    }
  },
})

// Run the orchestra
const run = await orchestra.createRun({
  agent: 'intent',
  context: {
    messages: [
      {
        role: 'user',
        content: 'Help me plan a party',
      },
    ],
  },
})

// Listen to all events
for await (const event of run.events) {
  console.log('Event:', event)
}

// Get the final state
const finalState = run.history[run.history.length - 1]
```

## Streaming Custom Data

AI Orchestra supports streaming custom data alongside the model's response, which can be used with Vercel's `useChat` hook. This is useful for sending additional information like status updates, message IDs, or content references.

Here's how you can dispatch custom data in your state handlers:

```typescript
import { anthropic } from '@ai-sdk/anthropic'
import { CoreMessage, streamText } from 'ai'
import { z } from 'zod'
import { createOrchestra, processStream } from 'ai-orchestra'

const orchestra = createOrchestra<MyContext>()({
  intent: async (context, dispatch) => {
    // Dispatch custom data that will be available in useChat hook
    await dispatch('ai-sdk-stream-chunk', {
      type: 'data',
      value: { status: 'initialized' },
    })

    const chunks = streamText({
      model: anthropic('claude-3-5-haiku-20241022'),
      system: 'You are a helpful assistant',
      messages: context.messages,
      maxSteps: 10,
    })

    // Process the stream and handle tool calls
    const { messages } = await processStream(chunks, async (chunk) => {
      // You can dispatch data during stream processing
      await dispatch('ai-sdk-stream-chunk', {
        type: 'data',
        value: { progress: 'processing chunk' },
      })
    })

    // Dispatch completion data
    await dispatch('ai-sdk-stream-chunk', {
      type: 'data',
      value: { status: 'completed' },
    })

    return {
      context: {
        messages: [...context.messages, ...messages],
      },
    }
  },
})
```

On the client side, you can access this data using the `useChat` hook:

```typescript
import { useChat } from 'ai/react'

export default function Chat() {
  const { messages, data, setData } = useChat()

  return (
    <div>
      {/* Display streamed data */}
      {data && <pre>{JSON.stringify(data, null, 2)}</pre>}

      {/* Display messages */}
      {messages.map((m) => (
        <div key={m.id}>{m.content}</div>
      ))}
    </div>
  )
}
```

The streamed data will be automatically available in the `data` property of the `useChat` hook, and you can use `setData` to manage this data manually if needed.

## Using with Next.js

AI Orchestra provides a helper function `orchestraToAIStream` to easily integrate with Next.js API routes. Here's how to use it:

```typescript
// app/api/chat/route.ts
import { orchestraToAIStream } from 'ai-orchestra'
import { anthropic } from '@ai-sdk/anthropic'
import { streamText } from 'ai'
import { z } from 'zod'
import { createOrchestra } from 'ai-orchestra'

export const runtime = 'edge'

export async function POST(req: Request) {
  const { messages } = await req.json()

  const orchestra = createOrchestra<{ messages: any[] }>()({
    chat: async (context, dispatch) => {
      // You can dispatch status updates
      await dispatch('ai-sdk-stream-chunk', {
        type: 'data',
        value: { status: 'started' },
      })

      const chunks = streamText({
        model: anthropic('claude-3-5-haiku-20241022'),
        messages: context.messages,
        tools: {
          search: {
            description: 'Search for information',
            parameters: z.object({
              query: z.string().describe('Search query'),
            }),
          },
        },
      })

      const { messages: responseMessages } = await processStream(
        chunks,
        dispatch
      )

      return {
        context: {
          messages: [...context.messages, ...responseMessages],
        },
      }
    },
  })

  // Create a run instance
  const run = await orchestra.createRun({
    agent: 'chat',
    context: { messages },
  })

  // Convert orchestra events to AI SDK stream
  const aiStream = await orchestraToAIStream(run)

  // Return the stream with proper headers
  return new Response(aiStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
```

Then in your React component:

```typescript
'use client'

import { useChat } from 'ai/react'

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit, data } = useChat()

  return (
    <div>
      {/* Display stream status */}
      {data && <div>Status: {data[data.length - 1]?.status}</div>}

      {/* Display messages */}
      {messages.map((m) => (
        <div key={m.id}>{m.content}</div>
      ))}

      {/* Chat input */}
      <form onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Say something..."
        />
      </form>
    </div>
  )
}
```

The `orchestraToAIStream` function handles:

- Converting orchestra events to AI SDK stream format
- Streaming message chunks
- Streaming custom data
- Tool calls and responses
- Error handling

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT © [Petr Brzek](https://github.com/petrbrzek)
