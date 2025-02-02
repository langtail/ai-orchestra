# AI Orchestra 🎭

A powerful state machine orchestrator for AI agents with streaming support. AI Orchestra helps you build complex AI workflows by managing state transitions, handling events, and processing AI streams seamlessly.

[![npm version](https://badge.fury.io/js/ai-orchestra.svg)](https://badge.fury.io/js/ai-orchestra)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- 🎯 **State Machine Architecture** - Build complex AI workflows with clear state transitions
- 🌊 **Streaming Support** - Native support for AI streaming responses
- 🔄 **Event System** - Rich event system for state transitions and custom events
- 📝 **TypeScript First** - Built with TypeScript for excellent type safety and IDE support
- 🔌 **Framework Agnostic** - Works with any JavaScript/TypeScript project
- 🚀 **Modern ESM** - Full ESM support with CommonJS compatibility

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

## Quick Start

Here's a simple example of how to use AI Orchestra:

```typescript
import { createOrchestra } from 'ai-orchestra'

// Define your context type
type Context = {
  query: string
  messages: string[]
}

// Create an orchestra instance with typed states and context
const orchestra = createOrchestra<Context>()({
  start: async (context, dispatch) => {
    await dispatch('custom-event', { message: 'Starting analysis' })
    return {
      nextState: 'processing',
      context: { ...context, messages: [...context.messages, 'Started'] },
    }
  },
  processing: async (context) => {
    // Process the query
    return {
      nextState: 'complete',
      context: { ...context, messages: [...context.messages, 'Processed'] },
    }
  },
  complete: async (context) => {
    return {
      context: { ...context, messages: [...context.messages, 'Completed'] },
    }
  },
})

// Create and run an instance
const run = orchestra.createRun({
  agent: 'start',
  context: { query: 'What is AI?', messages: [] },
})

// Listen to events
for await (const event of run.events) {
  console.log('Event:', event)
}
```

## Advanced Example with AI Integration

Here's a more comprehensive example showing how to use AI Orchestra with the Vercel AI SDK and tool handling:

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

This example demonstrates:

- Integration with Anthropic's Claude model
- Tool definition and handling
- State transitions based on AI responses
- Message history management
- Event streaming and processing

## API Reference

### `createOrchestra<TContext>()`

Creates a new orchestra instance with typed context.

```typescript
type Handler<TState, TContext> = (
  context: TContext,
  dispatch: Dispatch
) => HandlerResult<TState, TContext> | Promise<HandlerResult<TState, TContext>>

const orchestra = createOrchestra<TContext>()({
  stateName: async (context, dispatch) => {
    // Handle state logic
    return {
      nextState?: 'nextStateName',
      context: { /* updated context */ }
    }
  }
})
```

### Event Types

The orchestra emits several types of events:

```typescript
type OrchestraEvent<TContext> =
  | StateTransitionEvent<TContext>
  | StateCompletionEvent<TContext>
  | CustomEvent

// State transition event
{
  event: 'on_state_transition'
  from: string
  to?: string
  context: TContext
}

// State completion event
{
  event: 'on_state_completion'
  state: string
  context: TContext
}

// Custom event
{
  event: 'on_custom_event'
  name: string
  data: any
}
```

### Stream Processing

AI Orchestra provides utilities for handling AI streams:

```typescript
import { processStream } from 'ai-orchestra'

const result = await processStream(aiStream, async (chunk) => {
  // Handle stream chunks
})
```

## Usage with AI Models

AI Orchestra works seamlessly with various AI models. Here's an example using the Vercel AI SDK:

```typescript
import { streamText } from 'ai'
import { createOrchestra, processStream } from 'ai-orchestra'

const orchestra = createOrchestra<Context>()({
  intent: async (context, dispatch) => {
    const stream = streamText({
      model: openai,
      prompt: context.query,
    })

    await processStream(stream, dispatch)

    return {
      nextState: 'complete',
      context,
    }
  },
})
```

## Best Practices

1. **Type Your Context** - Always define types for your context to get the best TypeScript experience
2. **Handle Errors** - Implement error handling in your state handlers
3. **Keep States Focused** - Each state should have a single responsibility
4. **Use Custom Events** - Leverage custom events for detailed progress tracking
5. **Stream Processing** - Use the built-in stream processing utilities for AI responses

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT © [Petr Brzek](https://github.com/petrbrzek)
