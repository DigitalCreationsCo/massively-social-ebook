import { useEffect, useState, useCallback } from 'react';
import {
  Activity, Settings2, GitMerge, FileText,
  Play, AlertCircle, CheckCircle2, FlaskConical,
  Info, History, Target, Trash2, Lock,
  ChevronDown, ChevronRight, Database, Scissors,
  Clock, Sparkles, Layers
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- Utility ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Interfaces ---
interface LoreAtom {
  id: string | number;
  content: string;
  happenedAt: number;
}

interface SearchCandidate {
  id: string | number;
  content: string;
  scoreVectorDense: number;
  scoreKeywordSparse: number;
  isNotable: boolean;
}

interface HarvestPhase {
  totalBlockCount: number;
  loreCount: number;
  candidateCount: number;
  loreAtoms?: LoreAtom[];
  searchCandidates?: SearchCandidate[];
  immediateContext?: string;
}

interface FusionCandidate {
  id: string | number;
  scoreFinal: number;
  scoreRaw: number;
  isNotable: boolean;
}

interface SaliencyPhase {
  threshold: number;
  passed: (string | number)[];
  evicted: (string | number)[];
  filteredCount: number;
  totalCandidates: number;
}

interface TimelineBlock {
  id: string | number;
  index: number;
  content: string;
}

interface TimelinePhase {
  merged: TimelineBlock[];
  fromHistorical: (string | number)[];
  fromSurvivors: (string | number)[];
  blockSequenceIntervals: number[];
  currentBlockCount: number;
}

interface ProsePhase {
  promptLength: number;
  loreAtoms: number;
  blockCount: number;
}

interface TracePhase {
  harvest?: HarvestPhase;
  fusion?: FusionCandidate[];
  saliency?: SaliencyPhase;
  timeline?: TimelinePhase;
  prose?: ProsePhase;
}

interface LabConfig {
  saliencyThreshold: number;
  weightDense: number;
  significanceCoef: number;
  temporalPhrasing: boolean;
  maxLoreAtoms?: number;
}

interface TraceObject {
  timestamp: string;
  channelId: string;
  inputQuery: string;
  providerType?: string;
  phases: TracePhase;
  finalizedPrompt?: string;
  discardedCandidates?: FusionCandidate[];
  error?: string;
  labConfig?: LabConfig;
}

// --- Collapsible Section Component ---
const CollapsibleSection = ({ 
  title, 
  icon: Icon, 
  children, 
  defaultOpen = false,
  className 
}: { 
  title: string; 
  icon: React.ElementType; 
  children: React.ReactNode; 
  defaultOpen?: boolean;
  className?: string;
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  return (
    <section className={className}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 text-primary mb-4 hover:opacity-80 transition-opacity"
      >
        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <Icon className="w-5 h-5" />
        <h2 className="text-sm font-bold uppercase tracking-widest">{title}</h2>
      </button>
      {isOpen && children}
    </section>
  );
};

// --- Stat Card Component ---
const StatCard = ({ label, value, sublabel }: { label: string; value: string | number; sublabel?: string }) => (
  <div className="bg-muted/30 border border-border rounded-xl p-3">
    <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">{label}</p>
    <p className="text-lg font-bold text-foreground">{value}</p>
    {sublabel && <p className="text-[10px] text-muted-foreground">{sublabel}</p>}
  </div>
);

// --- Chip Component ---
const Chip = ({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'default' | 'success' | 'danger' | 'muted' }) => {
  const variants = {
    default: 'bg-primary/10 text-primary border-primary/20',
    success: 'bg-green-500/10 text-green-500 border-green-500/20',
    danger: 'bg-destructive/10 text-destructive border-destructive/20',
    muted: 'bg-muted text-muted-foreground border-border',
  };
  return (
    <span className={cn("text-[10px] font-bold uppercase px-2 py-1 rounded border", variants[variant])}>
      {children}
    </span>
  );
};

// --- Sub-Components ---

const SaliencyIndicator = ({ score, threshold }: { score: number, threshold: number; }) => {
  const isSurvivor = score >= threshold;
  return (
    <div className="flex items-center gap-3 w-full">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden flex">
        <div
          className={ cn(
            "h-full transition-all duration-500",
            isSurvivor ? "bg-primary" : "bg-muted-foreground/30"
          ) }
          style={ { width: `${score * 100}%` } }
        />
      </div>
      <span className={ cn(
        "text-[10px] font-mono w-8 text-right",
        isSurvivor ? "text-primary font-bold" : "text-muted-foreground"
      ) }>
        { score.toFixed(2) }
      </span>
    </div>
  );
};

// --- Main Application ---

function App() {
  // Auth State
  const [ token, setToken ] = useState<string | null>(sessionStorage.getItem('lab-token'));

  // Lab State
  const [ traces, setTraces ] = useState<TraceObject[]>([]);
  const [ selectedTrace, setSelectedTrace ] = useState<TraceObject | null>(null);
  const [ inputQuery, setInputQuery ] = useState("");
  const [ generating, setGenerating ] = useState(false);
  const [ lastGenerationResult, setLastGenerationResult ] = useState<{ error?: string; context?: string; } | null>(null);

  // Config State (Synced with Engine defaults)
  const [ saliencyThreshold, setSaliencyThreshold ] = useState(0.65);
  const [ weightDense, setWeightDense ] = useState(0.7);
  const [ significanceCoef, _ ] = useState(1.5);
  const [ temporalPhrasing, setTemporalPhrasing ] = useState(true);
  const [ channelId, setChannelId ] = useState("test-channel");

  const API_BASE = "http://127.0.0.1:5002/__narrative_lab";

  const labFetch = useCallback(async (endpoint: string, options: RequestInit = {}) => {
    let currentToken = token;

    if (!currentToken) {
      currentToken = prompt("Enter Narrative Lab Token (see CLI output):");
      if (currentToken) {
        setToken(currentToken);
        sessionStorage.setItem('lab-token', currentToken);
      } else {
        throw new Error("Token required to access Lab.");
      }
    }

    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        ...options.headers,
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      }
    });

    if (res.status === 401) {
      sessionStorage.removeItem('lab-token');
      setToken(null);
      throw new Error("Session expired or invalid token.");
    }

    return res.json();
  }, [ token ]);

  const fetchTraces = useCallback(async () => {
    try {
      const data = await labFetch('/traces');
      const sorted = (data.traces || []).reverse();
      setTraces(sorted);
      if (sorted.length > 0 && !selectedTrace) setSelectedTrace(sorted[ 0 ]);
    } catch (err) {
      console.error("Fetch failed:", err);
    }
  }, [ labFetch, selectedTrace ]);

  const handleGenerate = async () => {
    if (!inputQuery.trim()) return;
    setGenerating(true);
    setLastGenerationResult(null);

    try {
      const data = await labFetch('/generate', {
        method: 'POST',
        body: JSON.stringify({
          channelId,
          query: inputQuery,
          config: {
            saliencyThreshold,
            weightDense,
            significanceCoef,
            temporalPhrasing
          }
        })
      });

      if (data.error) throw new Error(data.error);

      setLastGenerationResult({ context: data.context });
      await fetchTraces();
    } catch (err: any) {
      setLastGenerationResult({ error: err.message });
    } finally {
      setGenerating(false);
    }
  };

  const clearTraces = async () => {
    if (!confirm("Delete all historical traces from the narrative ledger?")) return;
    try {
      await labFetch('/traces', { method: 'DELETE' });
      setTraces([]);
      setSelectedTrace(null);
    } catch (err) {
      alert("Failed to clear ledger.");
    }
  };

  useEffect(() => {
    if (token) fetchTraces();
  }, [ token, fetchTraces ]);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/30">
      {/* Header */ }
      <header className="h-16 border-b border-border flex items-center justify-between px-8 bg-card/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shadow-lg shadow-primary/20">
            <FlaskConical className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tighter uppercase">Narrative Engine Lab</h1>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest opacity-70">v0.0.1</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-full border border-border">
            <Lock className="w-3 h-3 text-primary" />
            <span className="text-[10px] font-mono text-muted-foreground">
              { token ? `TOKEN_ACTIVE` : "AUTH_REQUIRED" }
            </span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-12 h-[calc(100-4rem)] overflow-hidden">
        {/* Left Sidebar: Ledger */ }
        <aside className="col-span-3 border-r border-border bg-card/30 flex flex-col">
          <div className="p-4 border-b border-border flex justify-between items-center">
            <h3 className="text-[11px] font-bold uppercase tracking-widest flex items-center gap-2">
              <History className="w-4 h-4 text-primary" /> Narrative Ledger
            </h3>
            <button
              onClick={ clearTraces }
              className="p-1.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive rounded-md transition-colors"
              title="Clear Ledger"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            { traces.map((t, i) => (
              <button
                key={ i }
                onClick={ () => setSelectedTrace(t) }
                className={ cn(
                  "w-full text-left p-3 rounded-xl border transition-all duration-200 group",
                  selectedTrace === t
                    ? "bg-primary/10 border-primary/30 shadow-sm"
                    : "hover:bg-muted/50 border-transparent text-muted-foreground"
                ) }
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="text-[10px] font-mono opacity-50">
                    { new Date(t.timestamp).toLocaleTimeString() }
                  </span>
                  { t.error && <AlertCircle className="w-3 h-3 text-destructive" /> }
                </div>
                <p className="text-xs font-medium line-clamp-1 group-hover:text-foreground">
                  { t.inputQuery || "Empty Simulation" }
                </p>
              </button>
            )) }
          </div>
        </aside>

        {/* Main Content: Trace Analysis */ }
        <main className="col-span-6 overflow-y-auto bg-background p-8 custom-scrollbar">
          { !selectedTrace ? (
            <div className="h-full flex flex-col items-center justify-center opacity-20 text-center">
              <Activity className="w-16 h-16 mb-4" />
              <p className="text-sm font-medium uppercase tracking-widest">Select a trace to begin analysis</p>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-10 pb-20">
              {/* Simulation Metadata */ }
              <CollapsibleSection title="Simulation Metadata" icon={Activity} defaultOpen={true}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <StatCard 
                    label="Timestamp" 
                    value={new Date(selectedTrace.timestamp).toLocaleTimeString()} 
                    sublabel={new Date(selectedTrace.timestamp).toLocaleDateString()} 
                  />
                  <StatCard label="Channel ID" value={selectedTrace.channelId} />
                  <StatCard label="Provider" value={selectedTrace.providerType || 'unknown'} />
                  <StatCard 
                    label="Status" 
                    value={selectedTrace.error ? 'Error' : 'Success'} 
                  />
                </div>
                {selectedTrace.error && (
                  <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs font-mono">
                    {selectedTrace.error}
                  </div>
                )}
              </CollapsibleSection>

              {/* Query Synthesis */ }
              <section>
                <div className="flex items-center gap-2 text-primary mb-4">
                  <Target className="w-5 h-5" />
                  <h2 className="text-sm font-bold uppercase tracking-widest">Query Synthesis</h2>
                </div>
                <div className="p-6 rounded-2xl bg-card border border-border shadow-sm">
                  <p className="text-xl font-medium leading-relaxed italic text-foreground/90">
                    "{ selectedTrace.inputQuery }"
                  </p>
                </div>
              </section>

              {/* Lab Configuration */ }
              {selectedTrace.labConfig && (
                <CollapsibleSection title="Lab Configuration" icon={Settings2} defaultOpen={false}>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <StatCard 
                      label="Saliency Gate" 
                      value={selectedTrace.labConfig.saliencyThreshold?.toFixed(2) || '0.65'} 
                    />
                    <StatCard 
                      label="Vector Weight" 
                      value={selectedTrace.labConfig.weightDense?.toFixed(2) || '0.70'} 
                    />
                    <StatCard 
                      label="Significance Coef" 
                      value={selectedTrace.labConfig.significanceCoef?.toFixed(2) || '1.50'} 
                    />
                    <StatCard 
                      label="Max Lore Atoms" 
                      value={selectedTrace.labConfig.maxLoreAtoms || 20} 
                    />
                    <StatCard 
                      label="Temporal Phrasing" 
                      value={selectedTrace.labConfig.temporalPhrasing ? 'On' : 'Off'} 
                    />
                  </div>
                </CollapsibleSection>
              )}

              {/* Harvest Phase */ }
              <CollapsibleSection title="Harvest Phase" icon={Database} defaultOpen={true}>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <StatCard 
                    label="Total Blocks" 
                    value={selectedTrace.phases.harvest?.totalBlockCount ?? 0} 
                  />
                  <StatCard 
                    label="Lore Atoms" 
                    value={selectedTrace.phases.harvest?.loreCount ?? 0} 
                  />
                  <StatCard 
                    label="Search Candidates" 
                    value={selectedTrace.phases.harvest?.candidateCount ?? 0} 
                  />
                </div>

                {/* Lore Atoms List */}
                {selectedTrace.phases.harvest?.loreAtoms && selectedTrace.phases.harvest.loreAtoms.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-[10px] font-bold uppercase text-muted-foreground mb-2">Active Lore Atoms</h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {selectedTrace.phases.harvest.loreAtoms.map((atom, i) => (
                        <div key={atom.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border">
                          <span className="text-[10px] font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">
                            #{i + 1}
                          </span>
                          <p className="text-xs text-foreground/80 leading-relaxed">{atom.content}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Search Candidates */}
                {selectedTrace.phases.harvest?.searchCandidates && selectedTrace.phases.harvest.searchCandidates.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-bold uppercase text-muted-foreground mb-2">Search Candidates</h4>
                    <div className="rounded-xl border border-border overflow-hidden bg-card">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-muted/50 border-b border-border">
                            <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">ID</th>
                            <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">Dense</th>
                            <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">Sparse</th>
                            <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">Content</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {selectedTrace.phases.harvest.searchCandidates.map((c) => (
                            <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                              <td className="px-3 py-2 text-xs font-mono">#{c.id}</td>
                              <td className="px-3 py-2 text-xs font-mono">{c.scoreVectorDense.toFixed(3)}</td>
                              <td className="px-3 py-2 text-xs font-mono">{c.scoreKeywordSparse.toFixed(3)}</td>
                              <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-xs">{c.content}...</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CollapsibleSection>

              {/* Hybrid Fusion Matrix */ }
              <CollapsibleSection title="Hybrid Fusion Matrix" icon={GitMerge} defaultOpen={true}>
                <div className="rounded-2xl border border-border overflow-hidden bg-card">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border">
                        <th className="px-4 py-3 text-[10px] font-bold uppercase text-muted-foreground">Source ID</th>
                        <th className="px-4 py-3 text-[10px] font-bold uppercase text-muted-foreground">Raw Score</th>
                        <th className="px-4 py-3 text-[10px] font-bold uppercase text-muted-foreground">Final Score</th>
                        <th className="px-4 py-3 text-[10px] font-bold uppercase text-muted-foreground">Notable</th>
                        <th className="px-4 py-3 text-[10px] font-bold uppercase text-muted-foreground text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {selectedTrace.phases.fusion?.map((c) => (
                        <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3 text-xs font-mono">#{c.id}</td>
                          <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{c.scoreRaw?.toFixed(3)}</td>
                          <td className="px-4 py-3">
                            <SaliencyIndicator
                              score={c.scoreFinal}
                              threshold={selectedTrace.labConfig?.saliencyThreshold || 0.65}
                            />
                          </td>
                          <td className="px-4 py-3">
                            {c.isNotable && <Chip variant="success">Notable</Chip>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {c.scoreFinal >= (selectedTrace.labConfig?.saliencyThreshold || 0.65) ? (
                              <Chip variant="success">Survivor</Chip>
                            ) : (
                              <Chip variant="muted">Evicted</Chip>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CollapsibleSection>

              {/* Saliency Gate Statistics */ }
              <CollapsibleSection title="Saliency Gate Statistics" icon={Scissors} defaultOpen={false}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <StatCard 
                    label="Threshold" 
                    value={selectedTrace.phases.saliency?.threshold?.toFixed(2) || '0.65'} 
                  />
                  <StatCard 
                    label="Passed" 
                    value={selectedTrace.phases.saliency?.passed?.length ?? 0} 
                    sublabel="survivors"
                  />
                  <StatCard 
                    label="Evicted" 
                    value={selectedTrace.phases.saliency?.evicted?.length ?? 0} 
                    sublabel="candidates"
                  />
                  <StatCard 
                    label="Filtered" 
                    value={selectedTrace.phases.saliency?.filteredCount ?? 0} 
                    sublabel="above threshold"
                  />
                </div>
                
                {selectedTrace.phases.saliency?.passed && selectedTrace.phases.saliency.passed.length > 0 && (
                  <div className="mb-3">
                    <h4 className="text-[10px] font-bold uppercase text-muted-foreground mb-2">Survivors</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedTrace.phases.saliency.passed.map((id) => (
                        <span key={id} className="text-xs font-mono bg-primary/10 text-primary px-2 py-1 rounded border border-primary/20">
                          #{id}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                
                {selectedTrace.phases.saliency?.evicted && selectedTrace.phases.saliency.evicted.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-bold uppercase text-muted-foreground mb-2">Evicted</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedTrace.phases.saliency.evicted.map((id) => (
                        <span key={id} className="text-xs font-mono bg-muted text-muted-foreground px-2 py-1 rounded border border-border">
                          #{id}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </CollapsibleSection>

              {/* Timeline Assembly */ }
              <CollapsibleSection title="Timeline Assembly" icon={Clock} defaultOpen={false}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <StatCard 
                    label="Current Block" 
                    value={selectedTrace.phases.timeline?.currentBlockCount ?? 0} 
                  />
                  <StatCard 
                    label="Total Merged" 
                    value={selectedTrace.phases.timeline?.merged?.length ?? 0} 
                    sublabel="blocks"
                  />
                  <StatCard 
                    label="From Skeleton" 
                    value={selectedTrace.phases.timeline?.fromHistorical?.length ?? 0} 
                    sublabel="historical"
                  />
                  <StatCard 
                    label="From Survivors" 
                    value={selectedTrace.phases.timeline?.fromSurvivors?.length ?? 0} 
                    sublabel="relevant"
                  />
                </div>

                {selectedTrace.phases.timeline?.blockSequenceIntervals && selectedTrace.phases.timeline.blockSequenceIntervals.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-[10px] font-bold uppercase text-muted-foreground mb-2">Reciprocal Skeleton Intervals</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedTrace.phases.timeline.blockSequenceIntervals.map((interval, i) => (
                        <span key={i} className="text-xs font-mono bg-muted/50 text-muted-foreground px-2 py-1 rounded border border-border">
                          {interval}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {selectedTrace.phases.timeline?.merged && selectedTrace.phases.timeline.merged.length > 0 && (
                  <div className="rounded-xl border border-border overflow-hidden bg-card">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-muted/50 border-b border-border">
                          <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">#</th>
                          <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">ID</th>
                          <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">Index</th>
                          <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">Content</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {selectedTrace.phases.timeline.merged.map((block, i) => (
                          <tr key={block.id} className="hover:bg-muted/20 transition-colors">
                            <td className="px-3 py-2 text-xs font-mono text-primary">{i + 1}</td>
                            <td className="px-3 py-2 text-xs font-mono">#{block.id}</td>
                            <td className="px-3 py-2 text-xs font-mono">{block.index}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-md">{block.content}...</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CollapsibleSection>

              {/* Prose Generation Metrics */ }
              {selectedTrace.phases.prose && (
                <CollapsibleSection title="Prose Generation Metrics" icon={Sparkles} defaultOpen={false}>
                  <div className="grid grid-cols-3 gap-3">
                    <StatCard 
                      label="Prompt Length" 
                      value={selectedTrace.phases.prose.promptLength?.toLocaleString() ?? 0} 
                      sublabel="characters"
                    />
                    <StatCard 
                      label="Lore Atoms Used" 
                      value={selectedTrace.phases.prose.loreAtoms ?? 0} 
                    />
                    <StatCard 
                      label="Blocks in Prompt" 
                      value={selectedTrace.phases.prose.blockCount ?? 0} 
                    />
                  </div>
                </CollapsibleSection>
              )}

              {/* Final Prompt Output */ }
              <CollapsibleSection title="Final Prompt Construction" icon={FileText} defaultOpen={true}>
                <div className="p-6 rounded-2xl bg-muted/30 border border-border font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-foreground/80 max-h-96 overflow-y-auto custom-scrollbar">
                  {selectedTrace.finalizedPrompt || 'No prompt generated'}
                </div>
              </CollapsibleSection>

              {/* Raw Trace Data (Debug) */ }
              <CollapsibleSection title="Raw Trace Data" icon={Layers} defaultOpen={false}>
                <pre className="p-4 rounded-xl bg-muted/50 border border-border text-[11px] font-mono text-muted-foreground overflow-x-auto max-h-96">
                  {JSON.stringify(selectedTrace, null, 2)}
                </pre>
              </CollapsibleSection>
            </div>
          ) }
        </main>

        {/* Right Sidebar: Controls */ }
        <aside className="col-span-3 border-l border-border bg-card/30 p-6 flex flex-col gap-8">
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-widest mb-6 flex items-center gap-2 text-primary">
              <Play className="w-4 h-4" /> Lab Simulation
            </h3>

            <div className="space-y-4">
              <textarea
                value={ inputQuery }
                onChange={ (e) => setInputQuery(e.target.value) }
                placeholder="Enter narrative query..."
                className="w-full h-32 bg-background border border-border rounded-xl p-4 text-sm focus:ring-2 focus:ring-primary/20 transition-all resize-none outline-none"
              />
              <button
                onClick={ handleGenerate }
                disabled={ generating }
                className={ cn(
                  "w-full py-4 border-2 rounded-xl flex items-center justify-center gap-3 font-bold text-xs transition-all",
                  generating 
                    ? "bg-muted text-muted-foreground border-border" 
                    : "bg-primary text-primary-foreground border-primary hover:scale-[1.02] active:scale-95 shadow-lg shadow-primary/20"
                ) }
              >
                { generating ? <Activity className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" /> }
                <span className="uppercase tracking-widest">
                  { generating ? "Synthesizing..." : "Run Simulation" }
                </span>
              </button>
            </div>
          </div>

          <div className="space-y-6">
            <h3 className="text-[11px] font-bold uppercase tracking-widest flex items-center gap-2 text-primary">
              <Settings2 className="w-4 h-4" /> Hyper-Parameters
            </h3>

            {/* Slider: Saliency */ }
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-[10px] font-bold text-muted-foreground uppercase">Saliency Gate</label>
                <span className="text-[10px] font-mono font-bold text-primary">{ saliencyThreshold.toFixed(2) }</span>
              </div>
              <input
                type="range" min="0" max="1" step="0.05"
                value={ saliencyThreshold }
                onChange={ (e) => setSaliencyThreshold(parseFloat(e.target.value)) }
                className="w-full accent-primary"
              />
            </div>

            {/* Slider: Dense Weight */ }
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-[10px] font-bold text-muted-foreground uppercase">Vector Weight (Dense)</label>
                <span className="text-[10px] font-mono font-bold text-primary">{ weightDense.toFixed(2) }</span>
              </div>
              <input
                type="range" min="0" max="1" step="0.05"
                value={ weightDense }
                onChange={ (e) => setWeightDense(parseFloat(e.target.value)) }
                className="w-full accent-primary"
              />
            </div>

            {/* Checkbox: Temporal */ }
            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border">
              <label className="text-[10px] font-bold text-muted-foreground uppercase">Temporal Phrasing</label>
              <button
                onClick={ () => setTemporalPhrasing(!temporalPhrasing) }
                className={ cn(
                  "w-10 h-5 rounded-full p-1 transition-colors relative",
                  temporalPhrasing ? "bg-primary" : "bg-muted-foreground/30"
                ) }
              >
                <div className={ cn(
                  "w-3 h-3 bg-white rounded-full transition-transform",
                  temporalPhrasing ? "translate-x-5" : "translate-x-0"
                ) } />
              </button>
            </div>

            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase">Channel ID</label>
              <input
                type="text"
                value={ channelId }
                onChange={ (e) => setChannelId(e.target.value) }
                className="w-full accent-primary"
              />
            </div>

            {/* Status Panel */ }
            <div className={ cn(
              "p-4 rounded-xl border transition-all duration-300 flex items-start gap-3",
              lastGenerationResult?.error ? "bg-destructive/10 border-destructive/20" :
                lastGenerationResult ? "bg-green-500/10 border-green-500/20" : "bg-muted/30 border-border"
            ) }>
              { lastGenerationResult?.error ? (
                <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
              ) : lastGenerationResult ? (
                <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
              ) : (
                <Info className="w-5 h-5 text-muted-foreground shrink-0" />
              ) }
              <div>
                <h4 className="text-[11px] font-bold uppercase tracking-tight">System Status</h4>
                <p className="text-[10px] text-muted-foreground mt-1">
                  { generating ? "Computing narrative fusion..." :
                    lastGenerationResult?.error ? lastGenerationResult.error :
                      lastGenerationResult ? "Context successfully synthesized." :
                        "Ready for simulation." }
                </p>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default App;