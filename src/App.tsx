import { useState } from 'react'
import { Button, Text } from '@gravity-ui/uikit'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <main className="app">
      <Text as="h1" variant="display-1">MTS Dashboard</Text>
      <Text as="p" variant="body-2">React + TypeScript + Gravity UI</Text>
      <Button view="action" size="l" onClick={() => setCount(count + 1)}>
        Счётчик: {count}
      </Button>
      <a
        className="rickroll"
        href="https://www.youtube.com/watch?v=dQw4w9WgXc"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Смотреть Rick Astley — Never Gonna Give You Up"
      >
        <img
          src="https://i.ytimg.com/vi/dQw4w9WgXc/hqdefault.jpg"
          alt="Рик Эстли в клипе Never Gonna Give You Up"
          width="480"
          height="360"
        />
        <Text as="span" variant="body-2">You've been rickrolled! 🕺</Text>
      </a>
    </main>
  )
}

export default App
