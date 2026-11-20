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
    </main>
  )
}

export default App
