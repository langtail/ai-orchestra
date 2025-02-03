import { streamText } from 'ai'
import { z } from 'zod'

// NOTE: Alias set in tsconfig.json for demo
// users should install package from npm
import {
  createOrchestra,
  processStream,
  orchestraToAIStream,
  createToolResponse,
} from 'ai-orchestra'
import { openai } from '@ai-sdk/openai'

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
        model: openai('gpt-4o'),
        messages: context.messages,
        maxSteps: 10,
        tools: {
          handoffToJokeAgent: {
            description: 'Handoff to joke agent',
            parameters: z.object({
              query: z.string().describe('Joke query'),
            }),
          },
        },
      })

      const {
        toolCalls,
        finishReason,
        messages: responseMessages,
      } = await processStream(chunks, dispatch)

      if (finishReason === 'tool-calls') {
        for (const toolCall of toolCalls) {
          if (toolCall.toolName === 'handoffToJokeAgent') {
            return {
              nextState: 'joke',
              context: {
                messages: [...responseMessages, createToolResponse(toolCall)],
              },
            }
          }
        }
      }

      return {
        context: {
          messages: [...context.messages, ...responseMessages],
        },
      }
    },
    joke: async (context, dispatch) => {
      const chunks = streamText({
        model: openai('gpt-4o'),
        system: 'You are a joke teller',
        messages: context.messages,
      })

      const { messages: responseMessages } = await processStream(
        chunks,
        dispatch
      )

      return {
        context: { messages: [...context.messages, ...responseMessages] },
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
