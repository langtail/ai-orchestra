import { anthropic } from '@ai-sdk/anthropic'
import { CoreMessage, streamText } from 'ai'
import { z } from 'zod'
import {
  createOrchestra,
  createToolResponse,
  processStream,
} from '../lib/orchestra'

// Test usage showing both sync and async handlers
interface MyContext {
  query: string
  messages: CoreMessage[]
}

const orchestra = createOrchestra<MyContext>()({
  intent: async (context, dispatch) => {
    const chunks = streamText({
      model: anthropic('claude-3-5-haiku-20241022'),
      system:
        'You are a helpful assistant that processes intents. If you need to handoff to a different agent, use the handoff tool.',
      messages: [{ role: 'user', content: context.query }],
      maxSteps: 10,
      tools: {
        joke: {
          description: 'Tells a joke',
          parameters: z.object({
            topic: z.string().describe('The topic of the joke'),
          }),
          execute: async ({ topic }) => {
            return `Why did the ${topic} cross the road?`
          },
        },
        handoffToPlanningAgent: {
          description: 'Hand off to the planning agent',
          parameters: z.object({
            name: z.string().describe('The name of the planning agent'),
          }),
        },
      },
    })

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
  plan: async (context, dispatch) => {
    console.log('Planning...')
    const chunks = streamText({
      model: anthropic('claude-3-5-haiku-20241022'),
      system: 'You are a helpful assistant that plans events',
      messages: [{ role: 'user', content: context.query }],
    })

    console.log('Streaming...')

    const { messages } = await processStream(chunks, dispatch)

    console.log('Done streaming...', messages)

    return {
      context: {
        query: context.query,
        messages: [...context.messages, ...messages],
      },
    }
  },
  execute: async (context, dispatch) => {
    console.log('Executing...')
    await dispatch('execution_complete', { status: 'success' })
    return {
      context: {},
    }
  },
})

const run = await orchestra.createRun({
  agent: 'plan',
  context: { query: 'Help me plan a party', messages: [] },
})

for await (const event of run.events) {
  console.log(event)
}

// After completion, analyze the full history
const finalState = run.history[run.history.length - 1]
console.log('Final state:', finalState)
