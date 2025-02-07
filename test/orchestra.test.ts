import { describe, it, expect, vi } from 'vitest'
import { createOrchestra, processStream } from '../lib/orchestra'
import { streamText, simulateReadableStream } from 'ai'
import { MockLanguageModelV1 } from 'ai/test'

describe('Orchestra', () => {
  it('should handle basic state transitions', async () => {
    type Context = {
      count: number
      message: string
    }

    const orchestra = createOrchestra<Context>()({
      start: async (context, dispatch) => {
        await dispatch('custom-event', { message: 'Starting' })
        return {
          nextState: 'middle',
          context: { count: context.count + 1 },
        }
      },
      middle: async (context) => {
        return {
          nextState: 'end',
          context: { count: context.count + 1 },
        }
      },
      end: async (context) => {
        return {
          context: { count: context.count + 1, message: 'Done' },
        }
      },
    })

    const run = orchestra.createRun({
      agent: 'start',
      context: { count: 0, message: '' },
    })

    const events: any[] = []
    for await (const event of run.events) {
      events.push(event)
    }

    expect(events).toHaveLength(7)

    // Initial state transition
    expect(events[0]).toMatchObject({
      event: 'on_state_transition',
      from: 'start',
    })

    // Custom event
    expect(events[1]).toMatchObject({
      event: 'on_custom_event',
      name: 'custom-event',
      data: { message: 'Starting' },
    })

    // Transition to middle
    expect(events[2]).toMatchObject({
      event: 'on_state_transition',
      from: 'start',
      to: 'middle',
    })

    // Middle state transition
    expect(events[3]).toMatchObject({
      event: 'on_state_transition',
      from: 'middle',
    })

    // Transition to end
    expect(events[4]).toMatchObject({
      event: 'on_state_transition',
      from: 'middle',
      to: 'end',
    })

    // End state transition
    expect(events[5]).toMatchObject({
      event: 'on_state_transition',
      from: 'end',
    })

    // Final completion
    expect(events[6]).toMatchObject({
      event: 'on_state_completion',
      state: 'end',
      context: {
        count: 3,
        message: 'Done',
      },
    })

    expect(run.history).toHaveLength(4)
    expect(run.history[run.history.length - 1].context).toMatchObject({
      count: 3,
      message: 'Done',
    })
  })

  it('should process AI stream correctly', async () => {
    const mockStream = {
      finishReason: Promise.resolve('stop'),
      toolCalls: Promise.resolve([]),
      response: Promise.resolve({ messages: [] }),
      fullStream: simulateReadableStream({
        chunks: [
          { type: 'text-delta', textDelta: 'Hello' },
          { type: 'text-delta', textDelta: ', ' },
          { type: 'text-delta', textDelta: 'world!' },
          {
            type: 'finish',
            finishReason: 'stop',
            usage: { completionTokens: 10, promptTokens: 3 },
          },
        ],
      }),
    }

    const dispatch = vi.fn()
    const result = await processStream(mockStream, dispatch)

    expect(result).toMatchObject({
      finishReason: 'stop',
      toolCalls: [],
      messages: [],
    })
    expect(dispatch).toHaveBeenCalledTimes(4) // 3 text chunks + finish
  })

  it('should handle tool calls in stream processing', async () => {
    const mockStream = {
      finishReason: Promise.resolve('tool_calls'),
      toolCalls: Promise.resolve([{ id: '1', name: 'handoffToAgent' }]),
      response: Promise.resolve({ messages: [] }),
      fullStream: simulateReadableStream({
        chunks: [
          {
            type: 'tool-call',
            toolCallId: '1',
            toolName: 'handoffToAgent',
            args: { agent: 'next' },
          },
        ],
      }),
    }

    const dispatch = vi.fn()
    const result = await processStream(mockStream, dispatch)

    expect(result).toMatchObject({
      finishReason: 'tool_calls',
      toolCalls: [{ id: '1', name: 'handoffToAgent' }],
    })
    expect(dispatch).toHaveBeenCalledTimes(2) // tool call + tool result
    expect(dispatch).toHaveBeenCalledWith(
      'ai-sdk-stream-chunk',
      expect.objectContaining({
        type: 'tool-result',
        toolCallId: '1',
        toolName: 'handoffToAgent',
      })
    )
  })

  it('should call onFinish with final state when run completes', async () => {
    type Context = {
      count: number
      message: string
    }

    const onFinish = vi.fn()
    const startTime = Date.now()

    const orchestra = createOrchestra<Context>()({
      start: async (context) => {
        return {
          nextState: 'end',
          context: { count: context.count + 1 },
        }
      },
      end: async (context) => {
        return {
          context: { count: context.count + 1, message: 'Done' },
        }
      },
    })

    const run = orchestra.createRun({
      agent: 'start',
      context: { count: 0, message: '' },
      onFinish,
    })

    // Consume all events
    for await (const event of run.events) {
      // Just consume the events
    }

    // Verify onFinish was called exactly once
    expect(onFinish).toHaveBeenCalledTimes(1)

    // Verify the final state passed to onFinish
    expect(onFinish).toHaveBeenCalledWith({
      agent: 'end',
      context: {
        count: 2,
        message: 'Done',
      },
      timestamp: expect.any(Number),
    })

    // Verify timestamp is recent
    const callArg = onFinish.mock.calls[0][0]
    expect(callArg.timestamp).toBeGreaterThanOrEqual(startTime)
    expect(callArg.timestamp).toBeLessThanOrEqual(Date.now())

    // Verify history matches
    expect(run.history).toHaveLength(3)
    expect(run.history[run.history.length - 1]).toMatchObject({
      agent: 'end',
      context: {
        count: 2,
        message: 'Done',
      },
    })
  })

  it('should properly terminate when there is no next state', async () => {
    type Context = { steps: number[] }

    const orchestra = createOrchestra<Context>()({
      first: async (context) => {
        return {
          nextState: 'second',
          context: { steps: [...context.steps, 1] },
        }
      },
      second: async (context) => {
        return {
          nextState: 'third',
          context: { steps: [...context.steps, 2] },
        }
      },
      third: async (context) => {
        // No nextState here - should terminate
        return {
          context: { steps: [...context.steps, 3] },
        }
      },
    })

    const run = orchestra.createRun({
      agent: 'first',
      context: { steps: [] },
    })

    const events: any[] = []
    for await (const event of run.events) {
      events.push(event)
    }

    // Verify we get the correct number of events
    // 6 events: 3 state transitions, 2 state transitions with 'to', 1 completion
    expect(events).toHaveLength(6)

    // Verify the sequence of events
    expect(events[0]).toMatchObject({
      event: 'on_state_transition',
      from: 'first',
    })
    expect(events[1]).toMatchObject({
      event: 'on_state_transition',
      from: 'first',
      to: 'second',
    })
    expect(events[2]).toMatchObject({
      event: 'on_state_transition',
      from: 'second',
    })
    expect(events[3]).toMatchObject({
      event: 'on_state_transition',
      from: 'second',
      to: 'third',
    })
    expect(events[4]).toMatchObject({
      event: 'on_state_transition',
      from: 'third',
    })
    expect(events[5]).toMatchObject({
      event: 'on_state_completion',
      state: 'third',
      context: { steps: [1, 2, 3] },
    })

    // Verify history
    expect(run.history).toHaveLength(4) // Initial + 3 states
    expect(run.history[run.history.length - 1].context).toMatchObject({
      steps: [1, 2, 3],
    })
  })

  it('should not throw "Agent undefined not found" when state has no next state', async () => {
    type Context = { value: string }

    const orchestra = createOrchestra<Context>()({
      start: async (context) => {
        // No nextState - should cleanly terminate
        return {
          context: { value: 'done' },
        }
      },
    })

    const run = orchestra.createRun({
      agent: 'start',
      context: { value: '' },
    })

    // This should complete without throwing any error
    await expect(async () => {
      for await (const event of run.events) {
        // Just consume events
      }
    }).not.toThrow('Agent "undefined" not found')
  })
})
