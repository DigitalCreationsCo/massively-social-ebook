import { useState, useEffect } from 'react'
import Layout from './components/Layout'
import SessionsTab from './components/tabs/SessionsTab'
import ChannelsTab from './components/tabs/ChannelsTab'
import LoreTab from './components/tabs/LoreTab'
import UsersTab from './components/tabs/UsersTab'
import ChatTab from './components/tabs/ChatTab'
import DebugTab from './components/tabs/DebugTab'
import { useAdminToken } from './hooks/useAdminToken'

type Tab = 'sessions' | 'channels' | 'lore' | 'blocks' | 'users' | 'chat' | 'debug'

const TABS: { id: Tab; label: string }[] = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'channels', label: 'Channels' },
  { id: 'lore', label: 'Lore' },
  { id: 'blocks', label: 'Blocks' },
  { id: 'users', label: 'Users' },
  { id: 'chat', label: 'Chat' },
  { id: 'debug', label: 'Debug' },
]

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('sessions')
  const [pollingInterval, setPollingInterval] = useState(10000)
  const { token, setToken, isValid } = useAdminToken()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const tokenParam = params.get('token')
    if (tokenParam) {
      setToken(tokenParam)
    }
  }, [setToken])

  if (!isValid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="bg-white p-6 rounded shadow-md w-80">
          <h1 className="text-lg font-semibold mb-4">ControlRoom</h1>
          <input
            type="password"
            placeholder="Enter admin token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-3"
          />
          <p className="text-xs text-gray-500">
            Set VITE_ADMIN_TOKEN env or pass ?token= in URL
          </p>
        </div>
      </div>
    )
  }

  return (
    <Layout
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as Tab)}
      pollingInterval={pollingInterval}
      onPollingChange={setPollingInterval}
    >
      {activeTab === 'sessions' && <SessionsTab />}
      {activeTab === 'channels' && <ChannelsTab />}
      {activeTab === 'lore' && <LoreTab />}
      {activeTab === 'blocks' && <BlocksTabPlaceholder />}
      {activeTab === 'users' && <UsersTab />}
      {activeTab === 'chat' && <ChatTab />}
      {activeTab === 'debug' && <DebugTab />}
    </Layout>
  )
}

function BlocksTabPlaceholder() {
  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">Blocks</h2>
      <p className="text-gray-500">Block management coming soon</p>
    </div>
  )
}
