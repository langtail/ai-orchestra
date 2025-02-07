import { CoreMessage, ToolResultPart, TextStreamPart } from 'ai'
import { formatDataStreamPart } from '@ai-sdk/ui-utils'

export type HandlerResult<TState extends string, TContext> = {
  nextState?: TState
  context: Partial<TContext>
}

export type Handler<TState extends string, TContext> = (
  context: TContext,
  dispatch: Dispatch
) => HandlerResult<TState, TContext> | Promise<HandlerResult<TState, TContext>>

export type OrchestraEvent<TContext> =
  | StateTransitionEvent<TContext>
  | StateCompletionEvent<TContext>
  | CustomEvent

export type StateTransitionEvent<TContext> = {
  event: 'on_state_transition'
  from: string
  to: string
  context: TContext
}

export type StateCompletionEvent<TContext> = {
  event: 'on_state_completion'
  state: string
  context: TContext
}

export type CustomEvent = {
  event: 'on_custom_event'
  name: string
  data: any
}

export type Dispatch = (name: string, data: any) => Promise<void>

export type OrchestraRun<TContext> = {
  events: AsyncGenerator<OrchestraEvent<TContext>>
  history: Array<{
    agent: string
    context: TContext
    timestamp: number
  }>
}

export type StreamResult = {
  finishReason: Promise<string | null>
  toolCalls: Promise<any[]>
  response: Promise<{ messages: CoreMessage[] }>
  fullStream: AsyncIterable<any>
}

export type ExtendedStreamPart =
  | TextStreamPart<any>
  | {
      type: 'message-annotation'
      value: any
    }
  | {
      type: 'data'
      value: any
    }

export async function processStream(
  stream: StreamResult,
  dispatch: Dispatch
): Promise<{
  finishReason: string | null
  toolCalls: any[]
  messages: CoreMessage[]
}> {
  const [finishReason, toolCalls, response] = await Promise.all([
    stream.finishReason,
    stream.toolCalls,
    stream.response,
    (async () => {
      for await (const chunk of stream.fullStream) {
        if (chunk.type === 'error') {
          console.error('error', chunk.error)
        }

        await dispatch('ai-sdk-stream-chunk', chunk)

        if (
          chunk.type === 'tool-call' &&
          chunk.toolName.includes('handoffTo')
        ) {
          // NOTE: this is a hack to get the tool result to the client so useChat is happy
          await dispatch('ai-sdk-stream-chunk', {
            type: 'tool-result',
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            result: 'Done',
            args: chunk.args,
          } as ToolResultPart)
        }
      }
    })(),
  ])

  return { finishReason, toolCalls, messages: response.messages }
}

export type RunParams<TContext> = {
  agent: string
  context: TContext
  onFinish?: (finalState: {
    agent: string
    context: TContext
    timestamp: number
  }) => void | Promise<void>
}

export function createOrchestra<TContext>() {
  return <const THandlers extends Record<PropertyKey, unknown>>(handlers: {
    [K in keyof THandlers]: Handler<Extract<keyof THandlers, string>, TContext>
  }) => {
    const createRun = (params: RunParams<TContext>): OrchestraRun<TContext> => {
      const history: Array<{
        agent: string
        context: TContext
        timestamp: number
      }> = []

      async function* trackedEvents(): AsyncGenerator<
        OrchestraEvent<TContext>
      > {
        let currentAgent = params.agent || Object.keys(handlers)[0]
        let currentContext = params.context

        while (currentAgent) {
          const agent = handlers[currentAgent]
          if (!agent) {
            throw new Error(`Agent "${String(currentAgent)}" not found`)
          }

          // Track state entry
          history.push({
            agent: String(currentAgent),
            context: currentContext,
            timestamp: Date.now(),
          })

          yield {
            event: 'on_state_transition',
            from: String(currentAgent),
            context: currentContext,
          } as StateTransitionEvent<TContext>

          const customEvents: CustomEvent[] = []
          const dispatch = async (name: string, data: any) => {
            customEvents.push({
              event: 'on_custom_event',
              name,
              data,
            })
          }

          const result = await agent(currentContext, dispatch)

          for (const event of customEvents) {
            yield event
          }

          currentContext = { ...currentContext, ...result.context }
          const nextAgent = result.nextState as keyof typeof handlers

          if (nextAgent) {
            yield {
              event: 'on_state_transition',
              from: String(currentAgent),
              to: String(nextAgent),
              context: currentContext,
            } as StateTransitionEvent<TContext>
          } else {
            // Update history with final context before emitting completion
            const finalState = {
              agent: String(currentAgent),
              context: currentContext,
              timestamp: Date.now(),
            }
            history.push(finalState)

            yield {
              event: 'on_state_completion',
              state: String(currentAgent),
              context: currentContext,
            } as StateCompletionEvent<TContext>

            // Call onFinish callback if provided
            if (params.onFinish) {
              await params.onFinish(finalState)
            }

            // Exit the loop when there is no next state
            break
          }

          currentAgent = String(nextAgent)
        }
      }

      return {
        events: trackedEvents(),
        history,
      }
    }

    return {
      createRun,
    }
  }
}

export function createToolResponse(
  toolCall: any,
  result?: string
): CoreMessage {
  return {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        result: result ?? 'Done',
      },
    ],
  }
}

export async function orchestraToAIStream(
  run: OrchestraRun<any>
): Promise<ReadableStream> {
  const encoder = new TextEncoder()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()

  ;(async () => {
    try {
      for await (const event of run.events) {
        if (
          event.event === 'on_custom_event' &&
          event.name === 'ai-sdk-stream-chunk'
        ) {
          const chunk = event.data as ExtendedStreamPart
          let formattedData: string | undefined
          const chunkType = chunk.type

          switch (chunkType) {
            case 'text-delta':
              formattedData = formatDataStreamPart('text', chunk.textDelta)
              break

            case 'tool-call-streaming-start':
              formattedData = formatDataStreamPart(
                'tool_call_streaming_start',
                chunk
              )
              break

            case 'tool-call-delta':
              formattedData = formatDataStreamPart('tool_call_delta', chunk)
              break

            case 'tool-call':
              formattedData = formatDataStreamPart('tool_call', chunk)
              break

            case 'tool-result':
              formattedData = formatDataStreamPart('tool_result', chunk)
              break

            case 'error':
              formattedData = formatDataStreamPart('error', String(chunk.error))
              break

            case 'step-start':
              formattedData = formatDataStreamPart('start_step', {
                messageId: chunk.messageId,
              })
              break

            case 'step-finish':
              formattedData = formatDataStreamPart('finish_step', {
                finishReason: chunk.finishReason,
                isContinued: chunk.isContinued ?? false,
                usage: chunk.usage
                  ? {
                      promptTokens: chunk.usage.promptTokens ?? Number.NaN,
                      completionTokens:
                        chunk.usage.completionTokens ?? Number.NaN,
                    }
                  : undefined,
              })
              break

            case 'reasoning':
              formattedData = formatDataStreamPart('reasoning', chunk.textDelta)
              break

            case 'finish':
              formattedData = formatDataStreamPart('finish_message', {
                finishReason: chunk.finishReason,
                usage: chunk.usage
                  ? {
                      promptTokens: chunk.usage.promptTokens ?? Number.NaN,
                      completionTokens:
                        chunk.usage.completionTokens ?? Number.NaN,
                    }
                  : undefined,
              })
              break

            case 'message-annotation':
              formattedData = `8:${JSON.stringify([chunk.value])}\n`
              break

            case 'data':
              formattedData = `2:${JSON.stringify([chunk.value])}\n`
              break

            default: {
              const exhaustiveCheck: never = chunkType
              throw new Error(`Unknown chunk type: ${exhaustiveCheck}`)
            }
          }

          if (formattedData) {
            await writer.write(encoder.encode(formattedData))
          }
        }
      }
    } finally {
      await writer.close()
    }
  })()

  return stream.readable
}

// Usage in an API route would look like:
// async function handleRequest() {
//   const run = await orchestra.createRun({
//     agent: 'intent',
//     context: { query: 'What is the capital of France?', messages: [] },
//   })

//   const aiStream = await orchestraToAIStream(run)

//   return new Response(aiStream, {
//     headers: {
//       'Content-Type': 'text/event-stream',
//       'Cache-Control': 'no-cache',
//       Connection: 'keep-alive',
//     },
//   })
// }
