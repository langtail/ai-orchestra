'use client'

import { useChat } from 'ai/react'

export default function Home() {
  const { messages, input, handleInputChange, handleSubmit, data } = useChat()

  const lastData = data?.[data.length - 1] as { status: string } | undefined

  return (
    <div className="page">
      <h1>AI Orchestra</h1>

      {/* Display stream status */}
      {lastData?.status && <div>Status: {lastData.status}</div>}

      {/* Display messages */}
      <div className="messages">
        {messages.map((m) => (
          <div key={m.id} className={`message ${m.role}`}>
            {m.content}
          </div>
        ))}
      </div>

      {/* Chat input */}
      <form onSubmit={handleSubmit} className="input-form">
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Say something..."
        />
        <button type="submit">Send</button>
      </form>
    </div>
  )
}
