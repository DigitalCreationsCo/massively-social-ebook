import { ReactNode } from 'react'

interface Tab {
  id: string
  label: string
}

interface LayoutProps {
  children: ReactNode
  tabs: Tab[]
  activeTab: string
  onTabChange: (id: string) => void
  pollingInterval: number
  onPollingChange: (interval: number) => void
}

export default function Layout({
  children,
  tabs,
  activeTab,
  onTabChange,
  pollingInterval,
  onPollingChange,
}: LayoutProps) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">ControlRoom</h1>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Poll:</label>
          <select
            value={pollingInterval}
            onChange={(e) => onPollingChange(Number(e.target.value))}
            className="text-xs border border-gray-300 rounded px-2 py-1"
          >
            <option value={5000}>5s</option>
            <option value={10000}>10s</option>
            <option value={30000}>30s</option>
            <option value={60000}>60s</option>
          </select>
        </div>
      </header>
      
      <nav className="bg-white border-b border-gray-200">
        <div className="flex gap-1 px-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
